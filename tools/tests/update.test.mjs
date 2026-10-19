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
const baseline = (files, commit) => ({ schemaVersion: 1, dataMergeVersion: 1, commit, files: Object.fromEntries(Object.entries(files).map(([path, data]) => [path, hash(data)])) });
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

const json = value => `${JSON.stringify(value, null, 2)}\n`;
function modelData(ids) {
  const files = { ...initial };
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    files[`${prefix}catalog.json`] = json({ schemaVersion: 1, models: ids.map(id => ({ id, title: id, config: `models/${id}.json` })) });
    for (const id of ids) {
      files[`${prefix}models/${id}.json`] = json({ schemaVersion: 1, model: `models/${id}.3mf`, title: id, description: '', updatedAt: '2026-10-19', upAxis: 'Z', frontAxis: 'Y', colors: {} });
      files[`${prefix}models/${id}.3mf`] = `original ${id} model`;
      if (prefix.startsWith('assembly-guide')) files[`${prefix}guides/${id}.json`] = json({ schemaVersion: 1, productId: id, title: id, steps: [] });
    }
  }
  return files;
}

test('adds two complete new models to both edited bundles without replacing user data or catalog edits', async t => {
  const old = modelData(['stand']);
  const root = await fixture(t, old);
  const incoming = modelData(['stand', 'new-one', 'new-two']);
  incoming['src/app.mjs'] = 'new code';
  const localCatalogs = {};
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    const catalog = JSON.parse(old[`${prefix}catalog.json`]);
    catalog.customNote = 'keep this local metadata'; catalog.models[0].title = 'My renamed stand';
    catalog.models.push({ id: 'personal', title: 'User model', config: 'models/personal.json', customEntry: true });
    localCatalogs[prefix] = catalog;
    await put(root, `${prefix}catalog.json`, json(catalog));
    await put(root, `${prefix}models/personal.json`, json({ ...JSON.parse(old[`${prefix}models/stand.json`]), model: 'models/personal.3mf' }));
    await put(root, `${prefix}models/personal.3mf`, 'personal bytes');
    await put(root, `${prefix}models/stand.3mf`, 'my saved stand colors');
  }
  await put(root, 'assembly-guide/public/guides/stand.json', 'my hand-edited instructions');
  await put(root, 'assembly-guide/public/guides/personal.json', 'my personal guide');
  assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming) })).status, 'updated');
  const state = JSON.parse(await content(root, STATE));
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    const merged = JSON.parse(await content(root, `${prefix}catalog.json`));
    assert.deepEqual(merged, { ...localCatalogs[prefix], models: [...localCatalogs[prefix].models, ...JSON.parse(incoming[`${prefix}catalog.json`]).models.slice(1)] });
    assert.equal(await content(root, `${prefix}models/stand.3mf`), 'my saved stand colors');
    assert.equal(await content(root, `${prefix}models/stand.json`), old[`${prefix}models/stand.json`]);
    assert.equal(await content(root, `${prefix}models/personal.3mf`), 'personal bytes');
    assert.equal(state.files[`${prefix}models/stand.3mf`], hash(old[`${prefix}models/stand.3mf`]));
    assert.equal(state.files[`${prefix}catalog.json`], hash(incoming[`${prefix}catalog.json`]));
    for (const id of ['new-one', 'new-two']) {
      for (const suffix of [`models/${id}.json`, `models/${id}.3mf`, ...(prefix.startsWith('assembly-guide') ? [`guides/${id}.json`] : [])]) {
        assert.equal(await content(root, prefix + suffix), incoming[prefix + suffix]);
        assert.equal(state.files[prefix + suffix], hash(incoming[prefix + suffix]));
      }
    }
  }
  assert.equal(await content(root, 'assembly-guide/public/guides/stand.json'), 'my hand-edited instructions');
  assert.equal(await content(root, 'assembly-guide/public/guides/personal.json'), 'my personal guide');
  // On a subsequent release, a deliberately removed previously shipped entry stays removed.
  const catalogPath = 'public/catalog.json';
  const merged = JSON.parse(await content(root, catalogPath));
  merged.models = merged.models.filter(entry => entry.id !== 'new-one');
  await put(root, catalogPath, json(merged));
  await rm(join(root, 'public/models/new-one.json')); await rm(join(root, 'public/models/new-one.3mf'));
  assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming, { commit: 'c'.repeat(40) }) })).status, 'updated');
  assert.deepEqual(JSON.parse(await content(root, catalogPath)), merged);
  await assert.rejects(lstat(join(root, 'public/models/new-one.3mf')), { code: 'ENOENT' });
});

test('skips deleted old entries, local ID/config/file aliases and incomplete guide pairs', async t => {
  const old = modelData(['stand', 'retired']);
  const root = await fixture(t, old);
  const incoming = modelData(['stand', 'retired', 'new-one', 'new-two', 'new-three', 'new-four']);
  delete incoming['assembly-guide/public/guides/new-four.json'];
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    const catalog = JSON.parse(old[`${prefix}catalog.json`]);
    catalog.models = [catalog.models[0],
      { id: 'new-one', title: 'User-owned ID', config: 'models/personal.json' },
      { id: 'personal-two', title: 'User-owned config path', config: 'models/new-two.json' }];
    for (const filename of ['personal', 'new-two']) await put(root, `${prefix}models/${filename}.json`, old[`${prefix}models/stand.json`]);
    await put(root, `${prefix}catalog.json`, json(catalog));
    await rm(join(root, `${prefix}models/retired.json`)); await rm(join(root, `${prefix}models/retired.3mf`));
    await put(root, `${prefix}models/NEW-THREE.3mf`, 'user case alias');
  }
  assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming) })).status, 'updated');
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    const catalog = JSON.parse(await content(root, `${prefix}catalog.json`));
    assert.deepEqual(catalog.models.map(e => e.id), ['stand', 'new-one', 'personal-two', ...(prefix === 'public/' ? ['new-four'] : [])]);
    for (const id of ['retired', 'new-one', 'new-two']) await assert.rejects(lstat(join(root, `${prefix}models/${id}.3mf`)), { code: 'ENOENT' });
    // A case-insensitive filesystem resolves the lowercase path to the user's
    // uppercase file. Check actual directory entries instead of stat aliases.
    const names = await readdir(join(root, `${prefix}models`));
    assert(names.includes('NEW-THREE.3mf'));
    assert(!names.includes('new-three.3mf'));
    assert.equal(await content(root, `${prefix}models/NEW-THREE.3mf`), 'user case alias');
  }
});

test('an edited child guide alone retains its existing paired model while new release models arrive', async t => {
  const old = modelData(['stand']); const root = await fixture(t, old);
  const guidePath = 'assembly-guide/public/guides/stand.json';
  await put(root, guidePath, 'my guide edits');
  const incoming = modelData(['stand', 'new-one', 'new-two']);
  incoming['assembly-guide/public/models/stand.3mf'] = 'upstream revised old model';
  incoming[guidePath] = 'upstream revised old guide';
  assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming) })).status, 'updated');
  assert.equal(await content(root, guidePath), 'my guide edits');
  assert.equal(await content(root, 'assembly-guide/public/models/stand.3mf'), old['assembly-guide/public/models/stand.3mf']);
  assert.deepEqual(JSON.parse(await content(root, 'assembly-guide/public/catalog.json')).models.map(e => e.id), ['stand', 'new-one', 'new-two']);
  for (const id of ['new-one', 'new-two']) {
    for (const file of [`models/${id}.json`, `models/${id}.3mf`, `guides/${id}.json`]) assert.equal(await content(root, `assembly-guide/public/${file}`), incoming[`assembly-guide/public/${file}`]);
  }
});

test('reconciles the same release once after the shipped old updater withheld new models', async t => {
  // The previous updater already installed the release's code and commit, but
  // retained the old data baselines and omitted all newly shipped model paths.
  const old = modelData(['stand']); old['src/app.mjs'] = 'already updated code';
  const root = await fixture(t, old);
  const oldPolicyState = baseline(old, NEW); delete oldPolicyState.dataMergeVersion;
  await put(root, STATE, json(oldPolicyState));
  await put(root, 'public/models/stand.3mf', 'my saved colors');
  await put(root, 'assembly-guide/public/guides/stand.json', 'my guide edits');
  const incoming = modelData(['stand', 'new-one', 'new-two']); incoming['src/app.mjs'] = old['src/app.mjs'];
  const remote = release(incoming);
  assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'updated');
  for (const prefix of ['public/', 'assembly-guide/public/']) {
    assert.deepEqual(JSON.parse(await content(root, `${prefix}catalog.json`)).models.map(entry => entry.id), ['stand', 'new-one', 'new-two']);
    for (const id of ['new-one', 'new-two']) {
      for (const file of [`models/${id}.json`, `models/${id}.3mf`, ...(prefix.startsWith('assembly-guide') ? [`guides/${id}.json`] : [])]) assert.equal(await content(root, prefix + file), incoming[prefix + file]);
    }
  }
  assert.equal(await content(root, 'public/models/stand.3mf'), 'my saved colors');
  assert.equal(await content(root, 'assembly-guide/public/guides/stand.json'), 'my guide edits');
  assert.equal(await content(root, 'assembly-guide/public/models/stand.3mf'), old['assembly-guide/public/models/stand.3mf']);
  assert.equal(JSON.parse(await content(root, STATE)).dataMergeVersion, 1);
  assert.equal(remote.calls.length, 2);
  assert.equal((await updateDesktop(root, { ...quiet, ...remote })).status, 'current');
  assert.equal(remote.calls.length, 3); // Only the manifest is fetched on subsequent launches.
});

test('conservatively preserves catalogs with unsafe or invalid local/incoming references', async t => {
  for (const variant of ['local-config', 'external', 'traversal', 'bad-schema']) {
    const old = modelData(['stand']); const root = await fixture(t, old);
    const incoming = modelData(['stand', 'new-one']);
    const catalogPath = 'public/catalog.json';
    if (variant === 'local-config') await put(root, 'public/models/stand.json', json({ schemaVersion: 1, model: '../outside.3mf' }));
    else {
      const catalog = JSON.parse(incoming[catalogPath]);
      if (variant === 'external') catalog.models[1].config = 'https://example.com/new-one.json';
      if (variant === 'traversal') incoming['public/models/new-one.json'] = json({ ...JSON.parse(incoming['public/models/new-one.json']), model: 'models/../outside.3mf' });
      if (variant === 'bad-schema') catalog.schemaVersion = 2;
      incoming[catalogPath] = json(catalog);
      await put(root, 'public/models/stand.3mf', 'my edited colors');
    }
    assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming) })).status, 'updated');
    assert.equal(await content(root, catalogPath), old[catalogPath]);
    await assert.rejects(lstat(join(root, 'public/models/new-one.json')), { code: 'ENOENT' });
    assert.equal(JSON.parse(await content(root, STATE)).files['public/models/new-one.json'], undefined);
  }
});

test('rolls back additive model files, catalog and baseline together after a catalog write fails', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const old = modelData(['stand']); const root = await fixture(t, old);
  await put(root, 'public/models/stand.3mf', 'local stand colors');
  const originalState = await content(root, STATE);
  const incoming = modelData(['stand', 'new-one', 'new-two']); incoming['src/app.mjs'] = 'new app';
  await chmod(join(root, 'public'), 0o500);
  try {
    assert.equal((await updateDesktop(root, { ...quiet, ...release(incoming) })).status, 'skipped');
    assert.equal(await content(root, 'src/app.mjs'), old['src/app.mjs']);
    assert.equal(await content(root, 'public/models/stand.3mf'), 'local stand colors');
    assert.equal(await content(root, 'public/catalog.json'), old['public/catalog.json']);
    assert.equal(await content(root, STATE), originalState);
    for (const prefix of ['public/', 'assembly-guide/public/']) for (const id of ['new-one', 'new-two']) {
      for (const suffix of ['json', '3mf']) await assert.rejects(lstat(join(root, `${prefix}models/${id}.${suffix}`)), { code: 'ENOENT' });
    }
    const transactions = await readdir(join(root, '.local/updater/backups'));
    const journal = JSON.parse(await content(root, `.local/updater/backups/${transactions[0]}/journal.json`));
    assert.equal(journal.status, 'rolled-back'); assert.equal(journal.files.at(-1).path, STATE);
  } finally { await chmod(join(root, 'public'), 0o700); }
});

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
