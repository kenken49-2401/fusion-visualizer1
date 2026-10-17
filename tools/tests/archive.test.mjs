import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packArchive, unpackArchive } from '../archive.mjs';
import { buildDesktopPackage } from '../package-desktop.mjs';
const one = () => packArchive(new Map([['safe.txt', Buffer.from('hello')]]));
const central = bytes => bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));

test('round-trip Unicode, spaces, binary bytes and deterministic output', () => {
  const files = new Map([['日本語/hello world.txt', Buffer.from('本文')], ['binary.dat', Buffer.from([0, 255, 3])]]);
  const zip = packArchive(files), unpacked = unpackArchive(zip);
  for (const [name, bytes] of files) assert.deepEqual(unpacked.get(name), bytes);
  assert.deepEqual(packArchive(files), zip);
  assert.deepEqual([...unpackArchive(packArchive({ 'empty.txt': Buffer.alloc(0) })).keys()], ['empty.txt']);
});

test('accepts deflated payload with validated central-directory CRC', () => {
  const zip = one(), nameLength = zip.readUInt16LE(26), c = central(zip);
  const payload = deflateRawSync(Buffer.from('hello'));
  const header = Buffer.from(zip.subarray(0, 30 + nameLength)); header.writeUInt16LE(8, 8); header.writeUInt32LE(payload.length, 18);
  const directory = Buffer.from(zip.subarray(c, zip.length - 22)); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(payload.length, 20);
  const end = Buffer.from(zip.subarray(-22)); end.writeUInt32LE(header.length + payload.length, 16);
  assert.equal(unpackArchive(Buffer.concat([header, payload, directory, end])).get('safe.txt').toString(), 'hello');
});

test('rejects unsafe paths, Windows device names and portable collisions', () => {
  for (const path of ['../bad', '/absolute', 'a/../b', 'a//b', 'a\\b', 'C:drive', 'a:stream', 'CON.txt', 'a/NUL', 'COM1', 'LPT¹.txt', 'a.', 'a ', './a', 'a\0b']) {
    assert.throws(() => packArchive({ [path]: Buffer.from('x') }), /Invalid ZIP/);
  }
  for (const paths of [['A.txt', 'a.txt'], ['é.txt', 'é.txt'], ['file', 'file/child']]) assert.throws(() => packArchive(Object.fromEntries(paths.map(path => [path, Buffer.alloc(0)]))), /collision/);
  const zip = one(), c = central(zip);
  Buffer.from('../x.txt').copy(zip, 30); Buffer.from('../x.txt').copy(zip, c + 46);
  assert.throws(() => unpackArchive(zip), /unsafe/);
});

test('rejects corruption, metadata disagreement, encryption, symlinks and zip bombs', () => {
  const mutations = [
    bytes => { bytes[38] ^= 1; },
    bytes => bytes.writeUInt16LE(1, central(bytes) + 8),
    bytes => bytes.writeUInt16LE(99, central(bytes) + 10),
    bytes => bytes.writeUInt32LE((0o120777 << 16) >>> 0, central(bytes) + 38),
    bytes => bytes.writeUInt32LE(33 * 1024 * 1024, central(bytes) + 24),
    bytes => bytes.writeUInt32LE(0xffffffff, central(bytes) + 20),
    bytes => bytes.writeUInt16LE(5000, bytes.length - 12),
    bytes => { bytes[30] ^= 1; },
  ];
  for (const mutate of mutations) { const bytes = one(); mutate(bytes); assert.throws(() => unpackArchive(bytes), /Invalid ZIP/); }
  assert.throws(() => unpackArchive(one().subarray(0, -1)), /Invalid ZIP/);
  assert.throws(() => packArchive({ huge: Buffer.alloc(33 * 1024 * 1024) }), /size limit/);
});

test('package contains tracked source and verified baseline, excluding generated and credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-package-'));
  try {
    const git = args => execFileSync('git', ['-C', root, ...args]);
    git(['init', '-q']);
    const sources = { 'package.json': '{}', 'Start-Editor.cmd': '@echo off', 'assembly-guide/a.txt': 'guide', 'tools/日本語 file.mjs': 'source', '.env': 'secret', '.npmrc': 'token', 'node_modules/a': 'generated', 'dist/a': 'generated', '.local/backups/original.3mf': 'private', 'coverage/a': 'generated', 'test-results/a': 'generated', 'playwright-report/a': 'generated' };
    for (const [path, value] of Object.entries(sources)) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value); }
    git(['add', '.']);
    await writeFile(join(root, 'untracked-secret.txt'), 'private');
    const output = join(root, 'output'), commit = 'a'.repeat(40);
    const metadata = await buildDesktopPackage({ root, output, commit });
    const zip = await readFile(join(output, 'fusion-editor-windows.zip'));
    assert.deepEqual(zip, await readFile(join(output, `fusion-editor-${commit}.zip`)));
    assert.equal(metadata.sha256, createHash('sha256').update(zip).digest('hex'));
    assert.equal(metadata.archive, `https://kenken49-2401.github.io/fusion-visualizer1/downloads/fusion-editor-${commit}.zip`);
    const files = unpackArchive(zip), state = JSON.parse(files.get('.local/desktop-update.json'));
    assert.equal(state.commit, commit); assert.equal(state.schemaVersion, 1);
    assert.deepEqual([...files.keys()].sort(), ['.local/desktop-update.json', 'Start-Editor.cmd', 'assembly-guide/a.txt', 'package.json', 'tools/日本語 file.mjs'].sort());
    assert.equal(Object.keys(state.files).length, files.size - 1);
    for (const [path, hash] of Object.entries(state.files)) assert.equal(hash, createHash('sha256').update(files.get(path)).digest('hex'));
    assert.deepEqual(JSON.parse(await readFile(join(output, 'editor-update.json'))), metadata);
  } finally { await rm(root, { recursive: true, force: true }); }
});
