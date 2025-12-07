//! Titan Native Bridge Host
//! Phase 3: Native file access for LLM inference
//!
//! Communicates with Chrome extension via native messaging protocol.
//! Provides mmap-based file access to bypass browser storage limits.

use std::io::{self, Read, Write};
use std::fs::File;
use std::path::Path;
use memmap2::MmapOptions;

// Protocol constants
const MAGIC: u32 = 0x5245504C; // "REPL"
const HEADER_SIZE: usize = 16;
const MAX_CHUNK_SIZE: usize = 8 * 1024 * 1024; // 8MB

// Commands
const CMD_PING: u8 = 0x00;
const CMD_PONG: u8 = 0x01;
const CMD_READ: u8 = 0x02;
const CMD_READ_RESPONSE: u8 = 0x03;
const CMD_ERROR: u8 = 0xFF;

// Flags
const FLAG_LAST_CHUNK: u8 = 0x02;

// Error codes
const ERR_NOT_FOUND: u32 = 1;
const ERR_PERMISSION_DENIED: u32 = 2;
const ERR_IO_ERROR: u32 = 3;
const ERR_INVALID_REQUEST: u32 = 4;

fn main() {
    // Native messaging uses stdin/stdout
    let stdin = io::stdin();
    let stdout = io::stdout();

    let mut stdin_lock = stdin.lock();
    let mut stdout_lock = stdout.lock();

    loop {
        // Read message length (4 bytes, native byte order)
        let mut len_buf = [0u8; 4];
        if stdin_lock.read_exact(&mut len_buf).is_err() {
            break; // EOF or error
        }
        let msg_len = u32::from_ne_bytes(len_buf) as usize;

        if msg_len == 0 || msg_len > 1024 * 1024 {
            eprintln!("[TitanBridge] Invalid message length: {}", msg_len);
            continue;
        }

        // Read message
        let mut msg_buf = vec![0u8; msg_len];
        if stdin_lock.read_exact(&mut msg_buf).is_err() {
            eprintln!("[TitanBridge] Failed to read message");
            continue;
        }

        // Parse JSON wrapper from Chrome
        let msg: serde_json::Value = match serde_json::from_slice(&msg_buf) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[TitanBridge] Failed to parse JSON: {}", e);
                continue;
            }
        };

        // Handle message
        if let Some(response) = handle_message(&msg) {
            // Write response
            let response_bytes = serde_json::to_vec(&response).unwrap();
            let len_bytes = (response_bytes.len() as u32).to_ne_bytes();
            stdout_lock.write_all(&len_bytes).unwrap();
            stdout_lock.write_all(&response_bytes).unwrap();
            stdout_lock.flush().unwrap();
        }
    }
}

fn handle_message(msg: &serde_json::Value) -> Option<serde_json::Value> {
    let msg_type = msg.get("type")?.as_str()?;

    match msg_type {
        "binary" => {
            let data = msg.get("data")?.as_array()?;
            let bytes: Vec<u8> = data.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();

            if bytes.len() < HEADER_SIZE {
                return Some(create_error_response(0, ERR_INVALID_REQUEST, "Message too short"));
            }

            // Parse header
            let magic = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            if magic != MAGIC {
                return Some(create_error_response(0, ERR_INVALID_REQUEST, "Invalid magic"));
            }

            let cmd = bytes[4];
            let _flags = bytes[5];
            let req_id = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
            let payload_len = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;

            let payload = if payload_len > 0 && bytes.len() >= HEADER_SIZE + payload_len {
                &bytes[HEADER_SIZE..HEADER_SIZE + payload_len]
            } else {
                &[]
            };

            match cmd {
                CMD_PING => Some(create_pong_response(req_id)),
                CMD_READ => handle_read_request(req_id, payload),
                _ => Some(create_error_response(req_id, ERR_INVALID_REQUEST, "Unknown command")),
            }
        }
        "ack" => {
            // ACK for backpressure - just acknowledge receipt
            None
        }
        _ => {
            eprintln!("[TitanBridge] Unknown message type: {}", msg_type);
            None
        }
    }
}

fn handle_read_request(req_id: u32, payload: &[u8]) -> Option<serde_json::Value> {
    if payload.len() < 16 {
        return Some(create_error_response(req_id, ERR_INVALID_REQUEST, "Payload too short"));
    }

    // Parse offset and length (u64 as two u32s)
    let offset_low = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]) as u64;
    let offset_high = u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]) as u64;
    let offset = offset_low + (offset_high << 32);

    let length_low = u32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]) as u64;
    let length_high = u32::from_le_bytes([payload[12], payload[13], payload[14], payload[15]]) as u64;
    let length = length_low + (length_high << 32);

    // Parse path
    let path_bytes = &payload[16..];
    let path = match std::str::from_utf8(path_bytes) {
        Ok(s) => s,
        Err(_) => return Some(create_error_response(req_id, ERR_INVALID_REQUEST, "Invalid path encoding")),
    };

    // Security: Only allow paths in allowed directories
    if !is_path_allowed(path) {
        return Some(create_error_response(req_id, ERR_PERMISSION_DENIED, "Path not in allowed directory"));
    }

    // Open and mmap file
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            let code = if e.kind() == io::ErrorKind::NotFound {
                ERR_NOT_FOUND
            } else if e.kind() == io::ErrorKind::PermissionDenied {
                ERR_PERMISSION_DENIED
            } else {
                ERR_IO_ERROR
            };
            return Some(create_error_response(req_id, code, &e.to_string()));
        }
    };

    let mmap = match unsafe { MmapOptions::new().map(&file) } {
        Ok(m) => m,
        Err(e) => return Some(create_error_response(req_id, ERR_IO_ERROR, &e.to_string())),
    };

    let file_len = mmap.len() as u64;
    if offset >= file_len {
        return Some(create_error_response(req_id, ERR_INVALID_REQUEST, "Offset beyond file end"));
    }

    let actual_length = std::cmp::min(length, file_len - offset) as usize;
    let data = &mmap[offset as usize..(offset as usize + actual_length)];

    // Send response in chunks
    let mut pos = 0;
    while pos < actual_length {
        let chunk_size = std::cmp::min(MAX_CHUNK_SIZE, actual_length - pos);
        let chunk = &data[pos..pos + chunk_size];
        let is_last = pos + chunk_size >= actual_length;

        let response = create_read_response(req_id, offset + pos as u64, chunk, is_last);

        // For multi-chunk responses, we need to send each chunk separately
        // This is a simplified version - real implementation would wait for ACKs
        pos += chunk_size;

        if is_last || pos >= actual_length {
            return Some(response);
        }
    }

    None
}

fn is_path_allowed(path: &str) -> bool {
    let path = Path::new(path);

    // Must be absolute path
    if !path.is_absolute() {
        return false;
    }

    // Check against allowed directories
    // TODO: Make this configurable
    let allowed_dirs = [
        "/Users",
        "/home",
        "/tmp",
        "/var/tmp",
    ];

    for allowed in &allowed_dirs {
        if path.starts_with(allowed) {
            // Disallow path traversal
            let canonical = match path.canonicalize() {
                Ok(p) => p,
                Err(_) => return false,
            };
            return canonical.starts_with(allowed);
        }
    }

    false
}

fn create_pong_response(req_id: u32) -> serde_json::Value {
    let mut header = vec![0u8; HEADER_SIZE];
    header[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    header[4] = CMD_PONG;
    header[5] = 0; // flags
    header[8..12].copy_from_slice(&req_id.to_le_bytes());
    header[12..16].copy_from_slice(&0u32.to_le_bytes()); // payload len

    serde_json::json!({
        "type": "binary",
        "data": header
    })
}

fn create_read_response(req_id: u32, offset: u64, data: &[u8], is_last: bool) -> serde_json::Value {
    // Payload: offset (8 bytes) + data
    let payload_len = 8 + data.len();
    let mut message = vec![0u8; HEADER_SIZE + payload_len];

    // Header
    message[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    message[4] = CMD_READ_RESPONSE;
    message[5] = if is_last { FLAG_LAST_CHUNK } else { 0 };
    message[8..12].copy_from_slice(&req_id.to_le_bytes());
    message[12..16].copy_from_slice(&(payload_len as u32).to_le_bytes());

    // Payload: offset
    message[16..20].copy_from_slice(&(offset as u32).to_le_bytes());
    message[20..24].copy_from_slice(&((offset >> 32) as u32).to_le_bytes());

    // Payload: data
    message[24..].copy_from_slice(data);

    serde_json::json!({
        "type": "binary",
        "data": message
    })
}

fn create_error_response(req_id: u32, code: u32, message: &str) -> serde_json::Value {
    let msg_bytes = message.as_bytes();
    let payload_len = 4 + msg_bytes.len();
    let mut response = vec![0u8; HEADER_SIZE + payload_len];

    // Header
    response[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    response[4] = CMD_ERROR;
    response[5] = 0;
    response[8..12].copy_from_slice(&req_id.to_le_bytes());
    response[12..16].copy_from_slice(&(payload_len as u32).to_le_bytes());

    // Payload: error code + message
    response[16..20].copy_from_slice(&code.to_le_bytes());
    response[20..].copy_from_slice(msg_bytes);

    serde_json::json!({
        "type": "binary",
        "data": response
    })
}
