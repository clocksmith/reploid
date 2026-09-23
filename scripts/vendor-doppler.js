#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pin = JSON.parse(readFileSync(path.join(root, 'package-lock.json'))).packages['node_modules/doppler-gpu'];
const hex = Buffer.from(pin.integrity.split('-')[1], 'base64').toString('hex');
const cache = execFileSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).trim();
const archive = process.argv[2] || path.join(cache, '_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
if (!existsSync(archive)) throw new Error('Supply the exact pinned Doppler archive; it is not in the npm cache.');
const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
if (integrity !== pin.integrity) throw new Error('Doppler archive integrity mismatch');
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (entries.some(entry => !entry.startsWith('package/') || entry.split('/').includes('..'))) throw new Error('Unsafe archive path');
const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
if (listing.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw new Error('Archive links are not supported');
const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
if (manifest.name !== 'doppler-gpu' || manifest.version !== pin.version) throw new Error('Archive package identity mismatch');
const target = path.join(root, 'self/vendor/doppler', pin.version);
mkdirSync(target, { recursive: true });
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', target]);
const archiveDirectory = path.join(root, 'deploy/artifacts');
mkdirSync(archiveDirectory, { recursive: true });
copyFileSync(archive, path.join(archiveDirectory, `doppler-gpu-${pin.version}.tgz`));
console.log(JSON.stringify({ version: pin.version, integrity, files: entries.length, target }));
