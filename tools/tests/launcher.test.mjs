import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLock, dependencyFingerprint, findNpmCLI, isLivePID, probeRuntime } from '../launch-editor.mjs';

test('dependency stamp changes with lock contents or Node major', () => {
  assert.deepEqual(dependencyFingerprint('abc', 24), dependencyFingerprint('abc', 24));
  assert.notDeepEqual(dependencyFingerprint('abc', 24), dependencyFingerprint('abcd', 24));
  assert.notDeepEqual(dependencyFingerprint('abc', 24), dependencyFingerprint('abc', 26));
});

test('PID checking and exclusive launcher lock preserve a live owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fusion-launcher-'));
  try {
    assert.equal(isLivePID(process.pid), true);
    assert.equal(isLivePID(-1), false);
    const release = await acquireLock(root);
    await assert.rejects(acquireLock(root), /別のエディター/);
    release();
    const nextRelease = await acquireLock(root);
    release(); // Old owner must not remove a newer token.
    assert.equal(JSON.parse(await readFile(path.join(root, '.local/updater/launcher.lock'), 'utf8')).pid, process.pid);
    nextRelease();
    await assert.rejects(readFile(path.join(root, '.local/updater/launcher.lock')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('abandoned PID lock is reclaimed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fusion-launcher-'));
  try {
    await mkdir(path.join(root, '.local/updater'), { recursive: true });
    await writeFile(path.join(root, '.local/updater/launcher.lock'), JSON.stringify({ pid: 2147483647, token: 'abandoned' }));
    const release = await acquireLock(root);
    release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('recognizes only the admin runtime, preserving other port occupants', async () => {
  let payload = { app: 'fusion-assembly-guide', mode: 'admin' };
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/__guide/runtime');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await probeRuntime(port), 'editor');
    payload = { app: 'fusion-assembly-guide', mode: 'public' };
    assert.equal(await probeRuntime(port), 'other');
    payload = { app: 'unrelated', mode: 'admin' };
    assert.equal(await probeRuntime(port), 'other');
    assert.equal(server.listening, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.equal(await probeRuntime(port), 'free');
});

test('discovers npm alongside Node without interpolating shell commands', () => {
  const cli = findNpmCLI();
  if (cli) assert.match(cli, /npm[\\/]bin[\\/]npm-cli\.js$/);
});

test('Windows double-click wrapper survives Unicode paths and replacing its own batch file', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'Fusion 起動 (test) space-'));
  try {
    const batch = await readFile(new URL('../../Start-Editor.cmd', import.meta.url));
    assert.equal(/(?<!\r)\n/.test(batch.toString('utf8')), false, 'ship actual CRLF bytes');
    await mkdir(path.join(root, 'tools'));
    await writeFile(path.join(root, 'Start-Editor.cmd'), batch);
    // Replace the batch while its Node command is running, as a real update does.
    // Any resumed sequential reading would encounter the marker or a failing exit.
    const replacement = '@echo REPARSED_UPDATED_BATCH\r\nexit /b 97\r\n'.repeat(100);
    await writeFile(path.join(root, 'tools/launch-editor.mjs'), `
      import { writeFileSync } from 'node:fs';
      writeFileSync(new URL('../received.json', import.meta.url), JSON.stringify(process.argv.slice(2)));
      writeFileSync(new URL('../Start-Editor.cmd', import.meta.url), ${JSON.stringify(replacement)});
    `);
    const batchPath = path.join(root, 'Start-Editor.cmd');
    // /s strips exactly the first and last quotes. Keep the quoted batch path
    // inside that outer pair; verbatim arguments preserve cmd.exe's own syntax.
    const command = `""${batchPath}" --no-update --no-browser"`;
    const child = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: os.tmpdir(), windowsVerbatimArguments: true, windowsHide: true,
      input: '', encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, `stdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'received.json'), 'utf8')), ['--no-update', '--no-browser']);
    assert.equal(await readFile(batchPath, 'utf8'), replacement, 'stub actually replaced the running batch');
    assert.doesNotMatch(`${child.stdout}\n${child.stderr}`, /REPARSED_UPDATED_BATCH/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
