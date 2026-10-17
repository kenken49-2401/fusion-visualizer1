import { inflateRawSync } from 'node:zlib';
import { TextDecoder } from 'node:util';

const MAX_FILES = 4096;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fail = message => { throw new Error(`Invalid ZIP: ${message}`); };
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function safePath(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || name.startsWith('/') || /[\\:<>"|?*\x00-\x1f\x7f]/.test(name)) fail('unsafe path');
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(part)) fail('unsafe path component');
  }
  return name;
}
function register(names, name) {
  safePath(name);
  const key = name.normalize('NFC').toLowerCase();
  if (names.has(key)) fail('path collision');
  const parts = key.split('/');
  for (let index = 1; index < parts.length; index++) if (names.has(parts.slice(0, index).join('/'))) fail('file/directory collision');
  for (const existing of names) if (existing.startsWith(`${key}/`)) fail('file/directory collision');
  names.add(key);
}
function extras(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) fail('truncated extra field');
    const type = bytes.readUInt16LE(offset), length = bytes.readUInt16LE(offset + 2);
    if (type === 1) fail('ZIP64 is unsupported');
    offset += 4 + length;
    if (offset > bytes.length) fail('truncated extra field');
  }
}

/** Portable source-file ZIP. Paths are relative POSIX paths; no directory entries. */
export function packArchive(input) {
  const entries = input instanceof Map ? [...input] : Object.entries(input);
  if (entries.length > MAX_FILES) fail('too many files');
  const names = new Set(), local = [], central = [];
  let offset = 0, total = 0;
  for (const [path, value] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    register(names, path);
    if (!(value instanceof Uint8Array)) fail('file content must be bytes');
    const body = Buffer.from(value), name = Buffer.from(path, 'utf8');
    if (decoder.decode(name) !== path) fail('invalid UTF8 filename');
    total += body.length;
    if (body.length > MAX_FILE || total > MAX_TOTAL || name.length > 4096) fail('size limit exceeded');
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(0x21, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** Validate central/local metadata and CRC before returning bounded inflated files. */
export function unpackArchive(input) {
  if (!(input instanceof Uint8Array)) fail('archive must be bytes');
  const bytes = Buffer.from(input);
  if (bytes.length < 22 || bytes.length > MAX_TOTAL + 8 * 1024 * 1024) fail('archive size limit');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) fail('end record missing');
  const count = bytes.readUInt16LE(end + 10), length = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) fail('split archives unsupported');
  if (count === 65535 || start === 0xffffffff || length === 0xffffffff || count > MAX_FILES) fail('ZIP64 or file count limit');
  if (start + length !== end) fail('central directory bounds');
  const names = new Set(), result = new Map(), ranges = [];
  let cursor = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('central directory entry');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38), local = bytes.readUInt32LE(cursor + 42);
    if (flags & ~0x808 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34)) fail('unsupported encryption, flags, compression or disk');
    const mode = external >>> 16;
    if ((mode & 0o170000) && (mode & 0o170000) !== 0o100000 || external & 0x10) fail('non-regular file');
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail('ZIP64 unsupported');
    total += size;
    if (size > MAX_FILE || total > MAX_TOTAL) fail('uncompressed size limit');
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || nameLength > 4096) fail('central entry bounds');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (!(flags & 0x800) && nameBytes.some(byte => byte > 127)) fail('non-UTF8 filename');
    let name;
    try { name = decoder.decode(nameBytes); } catch { fail('invalid UTF8 filename'); }
    register(names, name); extras(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) fail('local header bounds');
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const data = local + 30 + localName + localExtra, finish = data + compressed;
    if (finish > start || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method || !bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes)) fail('local header mismatch');
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size)) fail('local sizes/CRC mismatch');
    extras(bytes.subarray(local + 30 + localName, data));
    if (ranges.some(([a, b]) => local < b && finish > a)) fail('overlapping entries');
    ranges.push([local, finish]);
    let body;
    try { body = method === 0 ? Buffer.from(bytes.subarray(data, finish)) : inflateRawSync(bytes.subarray(data, finish), { maxOutputLength: Math.max(1, size) }); } catch { fail('invalid compressed data or inflated size'); }
    if (body.length !== size || crc32(body) !== crc) fail('integrity check failed');
    result.set(name, body); cursor = next;
  }
  if (cursor !== end) fail('central directory count mismatch');
  return result;
}
