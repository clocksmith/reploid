#!/usr/bin/env node
/**
 * Test script for DOPPLER Native Host
 * Tests the native messaging protocol implementation
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Protocol constants
const MAGIC = 0x5245504c; // "REPL"
const HEADER_SIZE = 16;

// Commands
const CMD_PING = 0x00;
const CMD_PONG = 0x01;
const CMD_READ = 0x02;
const CMD_READ_RESPONSE = 0x03;
const CMD_LIST = 0x06;
const CMD_LIST_RESPONSE = 0x07;
const CMD_ERROR = 0xff;

// Flags
const FLAG_LAST_CHUNK = 0x02;

/**
 * Create native messaging message (4-byte length prefix + JSON)
 */
function createNativeMessage(obj) {
  const json = JSON.stringify(obj);
  const jsonBuf = Buffer.from(json, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(jsonBuf.length, 0);
  return Buffer.concat([lenBuf, jsonBuf]);
}

/**
 * Create binary protocol header
 */
function createHeader(cmd, flags, reqId, payloadLen) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt8(cmd, 4);
  header.writeUInt8(flags, 5);
  header.writeUInt32LE(reqId, 8);
  header.writeUInt32LE(payloadLen, 12);
  return header;
}

/**
 * Create PING message
 */
function createPingMessage(reqId) {
  const header = createHeader(CMD_PING, 0, reqId, 0);
  return { type: 'binary', data: Array.from(header) };
}

/**
 * Create READ message
 */
function createReadMessage(reqId, filePath, offset = 0, length = 1024) {
  const pathBuf = Buffer.from(filePath, 'utf8');
  const payloadLen = 16 + pathBuf.length;
  const payload = Buffer.alloc(payloadLen);

  // Offset (u64 as two u32s)
  payload.writeUInt32LE(offset & 0xffffffff, 0);
  payload.writeUInt32LE(Math.floor(offset / 0x100000000), 4);

  // Length (u64 as two u32s)
  payload.writeUInt32LE(length & 0xffffffff, 8);
  payload.writeUInt32LE(Math.floor(length / 0x100000000), 12);

  // Path
  pathBuf.copy(payload, 16);

  const header = createHeader(CMD_READ, 0, reqId, payloadLen);
  const message = Buffer.concat([header, payload]);

  return { type: 'binary', data: Array.from(message) };
}

/**
 * Create LIST message
 */
function createListMessage(reqId, dirPath) {
  const pathBuf = Buffer.from(dirPath, 'utf8');
  const header = createHeader(CMD_LIST, 0, reqId, pathBuf.length);
  const message = Buffer.concat([header, pathBuf]);
  return { type: 'binary', data: Array.from(message) };
}

/**
 * Parse response from native host
 */
function parseResponse(data) {
  if (data.type !== 'binary' || !data.data) {
    return { error: 'Not a binary response' };
  }

  const buf = Buffer.from(data.data);
  if (buf.length < HEADER_SIZE) {
    return { error: 'Response too short' };
  }

  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) {
    return { error: `Invalid magic: 0x${magic.toString(16)}` };
  }

  const cmd = buf.readUInt8(4);
  const flags = buf.readUInt8(5);
  const reqId = buf.readUInt32LE(8);
  const payloadLen = buf.readUInt32LE(12);

  const payload = payloadLen > 0 ? buf.slice(HEADER_SIZE, HEADER_SIZE + payloadLen) : null;

  return { cmd, flags, reqId, payloadLen, payload };
}

/**
 * Run test
 */
async function runTests() {
  console.log('=== DOPPLER Native Host Test ===\n');

  // Start native host
  const hostPath = join(__dirname, 'native-host.js');
  const host = spawn('node', [hostPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let responseBuffer = Buffer.alloc(0);
  const responses = [];

  host.stdout.on('data', (chunk) => {
    responseBuffer = Buffer.concat([responseBuffer, chunk]);

    // Parse complete messages
    while (responseBuffer.length >= 4) {
      const msgLen = responseBuffer.readUInt32LE(0);
      if (responseBuffer.length < 4 + msgLen) break;

      const msgData = responseBuffer.slice(4, 4 + msgLen);
      responseBuffer = responseBuffer.slice(4 + msgLen);

      try {
        const msg = JSON.parse(msgData.toString('utf8'));
        responses.push(msg);
      } catch (err) {
        console.error('Failed to parse response:', err);
      }
    }
  });

  host.stderr.on('data', (data) => {
    console.error('Host stderr:', data.toString());
  });

  // Helper to send message and wait for response
  const sendAndWait = (msg, timeout = 2000) => {
    return new Promise((resolve, reject) => {
      const startLen = responses.length;
      host.stdin.write(createNativeMessage(msg));

      const checkResponse = () => {
        if (responses.length > startLen) {
          resolve(responses[responses.length - 1]);
        }
      };

      const interval = setInterval(checkResponse, 50);
      setTimeout(() => {
        clearInterval(interval);
        if (responses.length > startLen) {
          resolve(responses[responses.length - 1]);
        } else {
          reject(new Error('Timeout waiting for response'));
        }
      }, timeout);
    });
  };

  try {
    // Test 1: PING
    console.log('Test 1: PING');
    const pingMsg = createPingMessage(1);
    const pongResp = await sendAndWait(pingMsg);
    const pong = parseResponse(pongResp);

    if (pong.cmd === CMD_PONG && pong.reqId === 1) {
      console.log('  PASS: Received PONG\n');
    } else {
      console.log('  FAIL: Unexpected response:', pong, '\n');
    }

    // Test 2: READ file
    console.log('Test 2: READ file');
    const testFile = join(__dirname, 'test-data.txt');
    const testContent = 'Hello from DOPPLER Native Bridge test!';
    writeFileSync(testFile, testContent);

    const readMsg = createReadMessage(2, testFile, 0, 1024);
    const readResp = await sendAndWait(readMsg);
    const read = parseResponse(readResp);

    if (read.cmd === CMD_READ_RESPONSE && read.reqId === 2) {
      // Payload: 8 bytes offset + data
      const dataOffset = read.payload.slice(0, 8);
      const data = read.payload.slice(8);
      const content = data.toString('utf8');

      if (content === testContent) {
        console.log('  PASS: Read correct content\n');
      } else {
        console.log(`  FAIL: Content mismatch. Expected "${testContent}", got "${content}"\n`);
      }
    } else if (read.cmd === CMD_ERROR) {
      const errCode = read.payload.readUInt32LE(0);
      const errMsg = read.payload.slice(4).toString('utf8');
      console.log(`  FAIL: Error ${errCode}: ${errMsg}\n`);
    } else {
      console.log('  FAIL: Unexpected response:', read, '\n');
    }

    // Cleanup test file
    unlinkSync(testFile);

    // Test 3: READ non-existent file
    console.log('Test 3: READ non-existent file');
    const badReadMsg = createReadMessage(3, '/tmp/nonexistent-doppler-test-file.txt', 0, 100);
    const badReadResp = await sendAndWait(badReadMsg);
    const badRead = parseResponse(badReadResp);

    if (badRead.cmd === CMD_ERROR) {
      const errCode = badRead.payload.readUInt32LE(0);
      console.log(`  PASS: Got expected error code ${errCode}\n`);
    } else {
      console.log('  FAIL: Expected error response, got:', badRead, '\n');
    }

    // Test 4: READ disallowed path
    console.log('Test 4: READ disallowed path (security check)');
    const secReadMsg = createReadMessage(4, '/etc/passwd', 0, 100);
    const secReadResp = await sendAndWait(secReadMsg);
    const secRead = parseResponse(secReadResp);

    if (secRead.cmd === CMD_ERROR) {
      const errCode = secRead.payload.readUInt32LE(0);
      const errMsg = secRead.payload.slice(4).toString('utf8');
      if (errCode === 2) {
        // ERR_PERMISSION_DENIED
        console.log(`  PASS: Permission denied as expected\n`);
      } else {
        console.log(`  FAIL: Wrong error code ${errCode}: ${errMsg}\n`);
      }
    } else {
      console.log('  FAIL: Expected permission error, got:', secRead, '\n');
    }

    // Test 5: LIST directory
    console.log('Test 5: LIST directory');
    const testDir = join(__dirname, 'test-list-dir');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    mkdirSync(join(testDir, 'subdir'), { recursive: true });

    const listMsg = createListMessage(5, testDir);
    const listResp = await sendAndWait(listMsg);
    const list = parseResponse(listResp);

    if (list.cmd === CMD_LIST_RESPONSE && list.reqId === 5) {
      const entries = JSON.parse(list.payload.toString('utf8'));
      const hasSubdir = entries.some(e => e.name === 'subdir' && e.isDir);
      const hasFile1 = entries.some(e => e.name === 'file1.txt' && !e.isDir);
      const hasFile2 = entries.some(e => e.name === 'file2.txt' && !e.isDir);

      if (hasSubdir && hasFile1 && hasFile2) {
        console.log(`  PASS: Listed ${entries.length} entries (dirs first)\n`);
      } else {
        console.log(`  FAIL: Missing expected entries. Got:`, entries, '\n');
      }
    } else if (list.cmd === CMD_ERROR) {
      const errCode = list.payload.readUInt32LE(0);
      const errMsg = list.payload.slice(4).toString('utf8');
      console.log(`  FAIL: Error ${errCode}: ${errMsg}\n`);
    } else {
      console.log('  FAIL: Unexpected response:', list, '\n');
    }

    // Cleanup test directory
    unlinkSync(join(testDir, 'file1.txt'));
    unlinkSync(join(testDir, 'file2.txt'));
    rmdirSync(join(testDir, 'subdir'));
    rmdirSync(testDir);

    // Test 6: LIST non-existent directory
    console.log('Test 6: LIST non-existent directory');
    const badListMsg = createListMessage(6, '/tmp/nonexistent-doppler-test-dir');
    const badListResp = await sendAndWait(badListMsg);
    const badList = parseResponse(badListResp);

    if (badList.cmd === CMD_ERROR) {
      const errCode = badList.payload.readUInt32LE(0);
      console.log(`  PASS: Got expected error code ${errCode}\n`);
    } else {
      console.log('  FAIL: Expected error response, got:', badList, '\n');
    }

    console.log('=== All tests completed ===');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    host.kill();
  }
}

runTests().catch(console.error);
