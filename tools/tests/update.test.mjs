import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { packArchive } from '../archive.mjs';
import { updateDesktop, updateGitCheckout, DEFAULT_MANIFEST_URL } from '../desktop-update.mjs';

const OLD = 'a'.repeat(40); const NEW = 'b'.repeat(40);
const STATE = '.local/desktop-update.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const initial = {
  'src/app.mjs': 'old app', 'package.json': '{"private":true}',
  'public/catalog.json': 'catalog', 'public/viewer.json': 'viewer settings', 'public/models/stand.3mf': 'old model',
  'assembly-guide/public/catalog.json': 'guide catalog', 'assembly-guide/public/viewer.json': 'guide settings',
  'assembly-guide/public/models/stand.3mf': 'guide model', 'assembly-guide/public/guides/instructions.json': 'guide instructions',
};
const baseline = (files, commit) => ({ schemaVersion: 1, commit, files: Object.fromEntries(Object.entries(files).map(([path, data]) => [path, hash(data)])) });
async function put(root, path, content) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }
async function fixture(t, files = initial, state = true) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  for (const [path, content] of Object.entries(files)) await put(root, path, content);
  if (state) await put(root, STATE, JSON.stringify(baseline(files, OLD)));
  return root;
}
function release(files, { commit = NEW, corrupt = false, manifestChanges = {}, stateChanges = {} } = {}) {
  const archive = packArchive(new Map([...Object.entries(files).map(([p, bytes]) => [p, Buffer.from(bytes)]), [STATE, Buffer.from(JSON.stringify({ ...baseline(files, commit), ...stateChanges }))]]));
  const manifest = { schemaVersion: 1, repository: 'kenken49-2401/fusion-visualizer1', commit, archive: `https://kenken49-2401.github.io/fusion-visualizer1/downloads/fusion-editor-${commit}.zip`, sha256: corrupt ? '0'.repeat(64) : hash(archive), ...manifestChanges };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith(`${DEFAULT_MANIFEST_URL}?t=`)) return new Response(JSON.stringify(manifest));
    assert.equal(url, manifest.archive);
    return new Response(archive);
  };
  return { fetchImpl, calls };
}
const quiet = { onMessage() {} };
const content = (root, path) => readFile(join(root, path), 'utf8');

test('updates code, additions and removals, verifies backups, writes state last and then reports current', async t => {
  const root = await fixture(t, { ...initial, 'src/obsolete.mjs': 'remove me' });
  const files = { ...initial, 'src/app.mjs': 'new app', 'src/new.mjs': 'new module' };
  const remote = release(files);
  assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'updated');
  assert.equal(await content(root, 'src/app.mjs'), 'new app');
  assert.equal(await content(root, 'src/new.mjs'), 'new module');
  await assert.rejects(lstat(join(root, 'src/obsolete.mjs')), { code: 'ENOENT' });
  const state = JSON.parse(await content(root, STATE));
  assert.deepEqual(state, baseline(files, NEW));
  const transactions = await readdir(join(root, '.local/updater/backups'));
  assert.equal(transactions.length, 1);
  assert.equal(await content(root, `.local/updater/backups/${transactions[0]}/files/src/app.mjs`), 'old app');
  assert.equal(JSON.parse(await content(root, `.local/updater/backups/${transactions[0]}/journal.json`)).status, 'complete');
  const callsBefore = remote.calls.length;
  assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'current');
  assert.equal(remote.calls.length, callsBefore + 1);
  assert.equal(remote.calls[0].options.redirect, 'error');
  assert.equal(remote.calls[0].options.cache, 'no-store');
});

test('keeps an entire locally edited viewer data bundle while updating code and untouched child data', async t => {
  const root = await fixture(t);
  await put(root, 'public/models/stand.3mf', 'my saved body colors');
  await put(root, 'public/models/personal.3mf', 'personal model');
  const files = { ...initial, 'src/app.mjs': 'new app', 'public/catalog.json': 'upstream catalog', 'public/models/stand.3mf': 'upstream model', 'public/models/new.3mf': 'new upstream model', 'assembly-guide/public/viewer.json': 'new child settings' };
  assert.equal((await updateDesktop(root, { ...quiet, ...release(files) })).status, 'updated');
  assert.equal(await content(root, 'src/app.mjs'), 'new app');
  assert.equal(await content(root, 'public/catalog.json'), 'catalog');
  assert.equal(await content(root, 'public/models/stand.3mf'), 'my saved body colors');
  assert.equal(await content(root, 'public/models/personal.3mf'), 'personal model');
  await assert.rejects(lstat(join(root, 'public/models/new.3mf')), { code: 'ENOENT' });
  assert.equal(await content(root, 'assembly-guide/public/viewer.json'), 'new child settings');
  const state = JSON.parse(await content(root, STATE));
  assert.equal(state.files['public/models/stand.3mf'], hash(initial['public/models/stand.3mf']));
  assert.equal(state.files['public/models/new.3mf'], undefined);
});

test('keeps all child model/config/guide data together when a local guide changes', async t => {
  const root = await fixture(t);
  await put(root, 'assembly-guide/public/guides/instructions.json', 'my guide edits');
  const files = { ...initial, 'src/app.mjs': 'new app', 'assembly-guide/public/models/stand.3mf': 'upstream guide model', 'assembly-guide/public/catalog.json': 'upstream guide catalog', 'assembly-guide/public/guides/instructions.json': 'upstream instructions' };
  assert.equal((await updateDesktop(root, { ...quiet, ...release(files) })).status, 'updated');
  assert.equal(await content(root, 'assembly-guide/public/models/stand.3mf'), 'guide model');
  assert.equal(await content(root, 'assembly-guide/public/catalog.json'), 'guide catalog');
  assert.equal(await content(root, 'assembly-guide/public/guides/instructions.json'), 'my guide edits');
});

test('upstream and local code conflict aborts the whole plan without altering any tracked file', async t => {
  const root = await fixture(t);
  await put(root, 'src/app.mjs', 'my source edits');
  const before = await content(root, STATE);
  const files = { ...initial, 'package.json': 'upstream package', 'src/app.mjs': 'upstream app', 'public/models/stand.3mf': 'upstream model' };
  assert.equal((await updateDesktop(root, { ...quiet, ...release(files) })).status, 'conflict');
  assert.equal(await content(root, 'src/app.mjs'), 'my source edits');
  assert.equal(await content(root, 'package.json'), initial['package.json']);
  assert.equal(await content(root, 'public/models/stand.3mf'), 'old model');
  assert.equal(await content(root, STATE), before);
});

test('retains code edited only locally and handles a locally deleted unchanged source', async t => {
  const root = await fixture(t);
  await put(root, 'src/app.mjs', 'my app');
  await rm(join(root, 'package.json'));
  const files = { ...initial, 'src/new.mjs': 'new upstream source' };
  assert.equal((await updateDesktop(root, { ...quiet, ...release(files) })).status, 'updated');
  assert.equal(await content(root, 'src/app.mjs'), 'my app');
  await assert.rejects(lstat(join(root, 'package.json')), { code: 'ENOENT' });
  assert.equal(await content(root, 'src/new.mjs'), 'new upstream source');
});

test('blocks checksum mismatches, unsafe URLs and mismatched archive baseline without code writes', async t => {
  const root = await fixture(t);
  const cases = [
    release({ ...initial, 'src/app.mjs': 'new' }, { corrupt: true }),
    release(initial, { stateChanges: { files: { ...baseline(initial, NEW).files, 'src/app.mjs': '0'.repeat(64) } } }),
    release(initial, { stateChanges: { files: { '../escape.mjs': hash('escape') } } }),
    release(initial, { manifestChanges: { archive: 'https://evil.example/update.zip' } }),
    release(initial, { manifestChanges: { archive: 'http://kenken49-2401.github.io/fusion-visualizer1/downloads/a.zip' } }),
    release(initial, { manifestChanges: { archive: `https://kenken49-2401.github.io/fusion-visualizer1/downloads/fusion-editor-${OLD}.zip` } }),
  ];
  for (const remote of cases) {
    assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'skipped');
    assert.equal(await content(root, 'src/app.mjs'), 'old app');
  }
  let fetched = false;
  assert.equal((await updateDesktop(root, { ...quiet, manifestURL: 'https://evil.example/manifest.json', fetchImpl: () => { fetched = true; } })).status, 'skipped');
  assert.equal(fetched, false);
});

test('offline is non-destructive and stale concurrent lock blocks the second updater', async t => {
  const root = await fixture(t);
  const fetchImpl = async () => { throw new Error('offline'); };
  assert.equal((await updateDesktop(root, { ...quiet, fetchImpl })).status, 'offline');
  assert.equal(await content(root, 'src/app.mjs'), 'old app');
  await put(root, '.local/updater/update.lock', 'another update');
  assert.equal((await updateDesktop(root, { ...quiet, ...release(initial) })).status, 'skipped');
});

test('initializes a matching raw ZIP copy conservatively and refuses differing source', async t => {
  const root = await fixture(t, initial, false);
  assert.equal((await updateDesktop(root, { ...quiet, ...release(initial) })).status, 'updated');
  assert.equal(JSON.parse(await content(root, STATE)).commit, NEW);
  const other = await fixture(t, { ...initial, 'src/app.mjs': 'unknown local source' }, false);
  assert.equal((await updateDesktop(other, { ...quiet, ...release(initial) })).status, 'conflict');
  await assert.rejects(lstat(join(other, STATE)), { code: 'ENOENT' });
});

test('rejects symlink file ancestors and protected paths never overwrite installed dependencies', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'desktop-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, 'linked'));
  const remote = release({ ...initial, 'linked/new.mjs': 'outside write' });
  assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'skipped');
  await assert.rejects(lstat(join(outside, 'new.mjs')), { code: 'ENOENT' });
  await put(root, 'node_modules/local.txt', 'installed dependency');
  assert.equal((await updateDesktop(root, { ...quiet, ...release({ ...initial, 'src/app.mjs': 'new source' }) })).status, 'updated');
  assert.equal(await content(root, 'node_modules/local.txt'), 'installed dependency');
});

test('rolls back prior writes and restores state when a later atomic write fails', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const files = { ...initial, 'locked/app.mjs': 'old locked file' };
  const root = await fixture(t, files);
  const state = await content(root, STATE);
  await chmod(join(root, 'locked'), 0o500);
  try {
    assert.equal((await updateDesktop(root, { ...quiet, ...release({ ...files, 'src/app.mjs': 'new app', 'locked/app.mjs': 'new locked file' }) })).status, 'skipped');
    assert.equal(await content(root, 'src/app.mjs'), 'old app');
    assert.equal(await content(root, 'locked/app.mjs'), 'old locked file');
    assert.equal(await content(root, STATE), state);
    const transactions = await readdir(join(root, '.local/updater/backups'));
    assert.equal(JSON.parse(await content(root, `.local/updater/backups/${transactions[0]}/journal.json`)).status, 'rolled-back');
  } finally { await chmod(join(root, 'locked'), 0o700); }
});

test('Git uses only main fetch and fast-forward merge after fixed origin/root checks', async t => {
  const root = await fixture(t);
  const calls = []; let merged = false;
  const git = async args => {
    calls.push(args);
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? root : merged ? NEW : OLD;
    if (args[0] === 'remote') return 'https://github.com/kenken49-2401/fusion-visualizer1.git';
    if (args[0] === 'symbolic-ref') return 'main';
    if (args[0] === 'merge') merged = true;
    return '';
  };
  assert.equal((await updateGitCheckout(root, { ...quiet, git })).status, 'updated');
  assert.deepEqual(calls.filter(args => ['fetch', 'merge'].includes(args[0])), [['fetch', 'origin', 'main'], ['merge', '--ff-only', 'origin/main']]);
  assert.equal(calls.some(args => ['push', 'reset', 'clean', 'stash'].includes(args[0])), false);
  for (const condition of ['origin', 'branch', 'divergence', 'parent']) {
    const limited = [];
    const run = async args => {
      limited.push(args);
      if (condition === 'origin' && args[0] === 'remote') return 'https://github.com/other/repository';
      if (condition === 'branch' && args[0] === 'symbolic-ref') return 'feature';
      if (condition === 'parent' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') return dirname(root);
      if (condition === 'divergence' && args[0] === 'merge') throw new Error('not fast-forward');
      return git(args);
    };
    assert.equal((await updateGitCheckout(root, { ...quiet, git: run })).status, 'skipped');
    if (condition !== 'divergence') assert.equal(limited.some(args => args[0] === 'fetch'), false);
  }
});

async function deadPID() {
  const process = spawn(globalThis.process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = process.pid; await once(process, 'exit'); return pid;
}

test('reclaims dead PID locks and preserves active owners plus replacement tokens', async t => {
  const root = await fixture(t);
  const dead = await deadPID();
  for (const value of [String(dead), JSON.stringify({ pid: dead, token: 'previous-process' })]) {
    await put(root, '.local/updater/update.lock', value);
    assert.equal((await updateDesktop(root, { ...quiet, ...release(initial, { commit: OLD }) })).status, 'current');
    await assert.rejects(lstat(join(root, '.local/updater/update.lock')), { code: 'ENOENT' });
  }
  const active = JSON.stringify({ pid: process.pid, token: 'active-owner' });
  await put(root, '.local/updater/update.lock', active);
  assert.equal((await updateDesktop(root, { ...quiet, ...release(initial) })).status, 'skipped');
  assert.equal(await content(root, '.local/updater/update.lock'), active);
  await rm(join(root, '.local/updater/update.lock'));
  const remote = release({ ...initial, 'src/app.mjs': 'new code' });
  const fetchImpl = async (...args) => {
    const response = await remote.fetchImpl(...args);
    if (args[0].includes('editor-update.json')) await put(root, '.local/updater/update.lock', active);
    return response;
  };
  assert.equal((await updateDesktop(root, { ...quiet, fetchImpl })).status, 'skipped');
  assert.equal(await content(root, '.local/updater/update.lock'), active);
  assert.equal(await content(root, 'src/app.mjs'), 'old app');
});

async function interrupted(root) {
  const directory = '.local/updater/backups/interrupted';
  const state = await readFile(join(root, STATE));
  await put(root, `${directory}/files/src/app.mjs`, 'old app');
  await put(root, `${directory}/files/${STATE}`, state);
  await put(root, 'src/app.mjs', 'half-installed app');
  await put(root, 'src/added.mjs', 'half-installed new file');
  const nextState = JSON.stringify(baseline({ ...initial, 'src/app.mjs': 'half-installed app', 'src/added.mjs': 'half-installed new file' }, NEW));
  await put(root, STATE, nextState);
  const entries = [
    { path: 'src/app.mjs', existed: true, originalSha256: hash('old app'), targetSha256: hash('half-installed app') },
    { path: 'src/added.mjs', existed: false, originalSha256: null, targetSha256: hash('half-installed new file') },
    { path: STATE, existed: true, originalSha256: hash(state), targetSha256: hash(nextState) },
  ];
  await put(root, `${directory}/journal.json`, JSON.stringify({ schemaVersion: 1, status: 'prepared', commit: NEW, files: entries }));
  await put(root, '.local/updater/update.lock', JSON.stringify({ pid: await deadPID(), token: 'killed-owner' }));
  return { directory, state };
}

test('recovers an interrupted prepared transaction before the current-version check', async t => {
  const root = await fixture(t);
  const { directory, state } = await interrupted(root);
  const messages = [];
  const outcome = await updateDesktop(root, { ...release(initial, { commit: OLD }), onMessage: message => messages.push(message) });
  assert.equal(outcome.status, 'current');
  assert.equal(outcome.fatal, undefined);
  assert.equal(await content(root, 'src/app.mjs'), 'old app');
  assert.equal(await content(root, STATE), state.toString());
  await assert.rejects(lstat(join(root, 'src/added.mjs')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await content(root, `${directory}/journal.json`)).status, 'rolled-back');
  assert(messages.some(message => message.includes('前回中断')));
});

test('refuses launch after interrupted update if a file was subsequently edited or backup is missing', async t => {
  for (const mode of ['local-edit', 'missing-backup', 'rollback-incomplete']) {
    const root = await fixture(t);
    const { directory } = await interrupted(root);
    if (mode === 'local-edit') await put(root, 'src/app.mjs', 'new user edits after crash');
    if (mode === 'missing-backup') await rm(join(root, `${directory}/files/src/app.mjs`));
    if (mode === 'rollback-incomplete') {
      const journal = JSON.parse(await content(root, `${directory}/journal.json`));
      await put(root, `${directory}/journal.json`, JSON.stringify({ ...journal, status: 'rollback-incomplete' }));
    }
    const before = await content(root, 'src/app.mjs');
    let fetched = false;
    const outcome = await updateDesktop(root, { ...quiet, fetchImpl: () => { fetched = true; throw new Error('must not fetch'); } });
    assert.equal(outcome.status, 'skipped');
    assert.equal(outcome.fatal, true);
    assert.equal(fetched, false);
    assert.equal(await content(root, 'src/app.mjs'), before);
    assert.equal(await content(root, 'src/added.mjs'), 'half-installed new file');
  }
});

test('rejects case-only and Unicode-normalization path aliases across release baselines', async t => {
  for (const [oldPath, newPath] of [['Readme.md', 'README.md'], ['caf\u00e9.mjs', 'cafe\u0301.mjs']]) {
    const root = await fixture(t, { ...initial, [oldPath]: 'same bytes' });
    const outcome = await updateDesktop(root, { ...quiet, ...release({ ...initial, [newPath]: 'same bytes' }) });
    assert.equal(outcome.status, 'skipped');
    assert.equal(await content(root, oldPath), 'same bytes');
    assert.equal(JSON.parse(await content(root, STATE)).commit, OLD);
  }
});

test('rollback preserves edits made after an updater write and marks recovery fatal', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const files = { ...initial };
  for (let i = 0; i < 80; i++) files[`later/${i}.mjs`] = 'old';
  files['locked/app.mjs'] = 'old locked file';
  const root = await fixture(t, files);
  const next = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, path.endsWith('.mjs') ? 'upstream new content' : bytes]));
  let touched = false; let edited = Promise.resolve();
  const watcher = watch(join(root, 'src'), (event, name) => {
    if (touched || event !== 'rename' || name !== 'app.mjs') return;
    touched = true;
    edited = writeFile(join(root, 'src/app.mjs'), 'external edits after updater write');
  });
  await chmod(join(root, 'locked'), 0o500);
  try {
    const outcome = await updateDesktop(root, { ...quiet, ...release(next) });
    await edited;
    assert.equal(touched, true);
    assert.equal(outcome.fatal, true);
    assert.equal(await content(root, 'src/app.mjs'), 'external edits after updater write');
    assert.equal(await content(root, 'later/0.mjs'), 'old');
    assert.equal(JSON.parse(await content(root, STATE)).commit, OLD);
  } finally { watcher.close(); await chmod(join(root, 'locked'), 0o700); }
});
