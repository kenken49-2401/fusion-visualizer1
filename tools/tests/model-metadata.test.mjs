import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { generateModelMetadata } from '../model-metadata.mjs';
import { metadataForModel, fetchModelMetadata } from '../../src/model-metadata.ts';
import { metadataForModel as guideMetadataForModel, fetchModelMetadata as fetchGuideMetadata } from '../../assembly-guide/src/model-metadata.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = data => JSON.stringify(data);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fusion-model-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, env = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Metadata Test']); git(['config', 'user.email', 'metadata@example.invalid']);
  const put = async (path, bytes) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), bytes); };
  const commit = date => { git(['add', '.']); git(['commit', '-qm', 'Fixture content'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }); return git(['rev-parse', 'HEAD']); };
  const app = async prefix => {
    await put(`${prefix}/catalog.json`, json({ schemaVersion: 1, models: [{ id: 'sample', title: 'Sample', config: 'viewer.json' }] }));
    await put(`${prefix}/viewer.json`, json({ schemaVersion: 1, model: 'models/sample.3mf' }));
    await put(`${prefix}/models/sample.3mf`, 'original model bytes');
  };
  return { root, git, put, commit, app };
}

test('records each app model content commit; unrelated config, guide and app releases cannot advance it', async t => {
  const { root, put, commit, app } = await fixture(t);
  await app('public'); const rootCommit = commit('2025-01-02T03:04:05Z');
  await app('assembly-guide/public'); const guideCommit = commit('2025-02-03T04:05:06Z');
  await put('src/app.ts', 'release new UI'); await put('assembly-guide/public/guides/sample.json', 'edited guide');
  await put('public/viewer.json', json({ schemaVersion: 1, model: 'models/sample.3mf', updatedAt: '2026-10-19' }));
  commit('2026-10-19T01:02:03Z');
  const rootMetadata = await generateModelMetadata({ root });
  const childMetadata = await generateModelMetadata({ root, publicDir: 'assembly-guide/public' });
  assert.deepEqual(rootMetadata.models['models/sample.3mf'], { sha256: hash('original model bytes'), uploadedAt: '2025-01-02T03:04:05.000Z', commit: rootCommit });
  assert.deepEqual(childMetadata.models['models/sample.3mf'], { sha256: hash('original model bytes'), uploadedAt: '2025-02-03T04:05:06.000Z', commit: guideCommit });
  await put('public/models/sample.3mf', 'new saved colors'); const changedCommit = commit('2026-10-20T01:02:03Z');
  const updated = await generateModelMetadata({ root });
  assert.equal(updated.models['models/sample.3mf'].commit, changedCommit);
  assert.equal(updated.models['models/sample.3mf'].uploadedAt, '2026-10-20T01:02:03.000Z');
  assert.deepEqual(await generateModelMetadata({ root, publicDir: 'assembly-guide/public' }), childMetadata);
});

test('follows renamed model history and skips mode-only commits', async t => {
  const { root, git, put, commit, app } = await fixture(t);
  await app('public'); const originalCommit = commit('2025-03-04T05:06:07Z');
  git(['update-index', '--chmod=+x', 'public/models/sample.3mf']);
  git(['commit', '-qm', 'Mode only'], { GIT_AUTHOR_DATE: '2025-04-05T06:07:08Z', GIT_COMMITTER_DATE: '2025-04-05T06:07:08Z' });
  await rename(join(root, 'public/models/sample.3mf'), join(root, 'public/models/renamed.3mf'));
  await put('public/viewer.json', json({ schemaVersion: 1, model: 'models/renamed.3mf' }));
  commit('2026-10-19T02:03:04Z');
  const metadata = await generateModelMetadata({ root });
  assert.equal(metadata.models['models/renamed.3mf'].commit, originalCommit);
  assert.equal(metadata.models['models/renamed.3mf'].uploadedAt, '2025-03-04T05:06:07.000Z');
});

test('local dirty bytes cannot inherit an old upload date and an uncommitted new model has no record', async t => {
  const { root, put, commit, app } = await fixture(t);
  await app('public'); commit('2025-01-02T03:04:05Z');
  await put('public/models/sample.3mf', 'uncommitted color edit');
  const metadata = await generateModelMetadata({ root });
  assert.equal(metadata.models['models/sample.3mf'].sha256, hash('original model bytes'));
  for (const parse of [metadataForModel, guideMetadataForModel]) {
    assert.deepEqual(parse(metadata, 'models/sample.3mf', hash('uncommitted color edit')), { status: 'local-change' });
    assert.equal(parse(metadata, 'models/sample.3mf', hash('original model bytes')).status, 'known');
  }
  await put('public/viewer.json', json({ schemaVersion: 1, model: 'models/new.3mf' })); await put('public/models/new.3mf', 'new model');
  assert.deepEqual((await generateModelMetadata({ root })).models, {});
});

test('missing or malformed metadata and unverified hashes never produce timestamps', () => {
  const model = 'models/a.3mf', sha = hash('a');
  const valid = { schemaVersion: 1, models: { [model]: { sha256: sha, uploadedAt: '2025-01-02T03:04:05.000Z' } } };
  for (const parse of [metadataForModel, guideMetadataForModel]) {
    assert.equal(parse(valid, model, sha).status, 'known');
    for (const [manifest, fingerprint] of [[null, sha], [{ schemaVersion: 2 }, sha], [valid, undefined], [valid, 'fallback-checksum'], [{ ...valid, models: {} }, sha], [{ ...valid, models: { [model]: { sha256: sha, uploadedAt: '2025-02-30T03:04:05.000Z' } } }, sha]]) assert.deepEqual(parse(manifest, model, fingerprint), { status: 'unknown' });
  }
});

test('rejects shallow history rather than assigning the app release timestamp to old models', async t => {
  const { root, commit, app } = await fixture(t);
  await app('public'); commit('2025-01-02T03:04:05Z');
  const shallow = `${root}-shallow`; t.after(() => rm(shallow, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', pathToFileURL(root).href, shallow]);
  await assert.rejects(generateModelMetadata({ root: shallow }), /Full Git history/);
});

test('local verified metadata needs no remote request; published fallback requires the same actual model hash', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const model = 'models/sample.3mf', sha = hash('current model');
  const record = { schemaVersion: 1, models: { [model]: { sha256: sha, uploadedAt: '2025-01-02T03:04:05.000Z' } } };
  const publishedURL = 'https://kenken49-2401.github.io/fusion-visualizer1/model-metadata.json';
  for (const fetchMetadata of [fetchModelMetadata, fetchGuideMetadata]) {
    const calls = [];
    globalThis.fetch = async url => { calls.push(url); return new Response(JSON.stringify(record)); };
    assert.equal((await fetchMetadata(model, sha, publishedURL)).status, 'known'); assert.equal(calls.length, 1);
    calls.length = 0;
    globalThis.fetch = async url => { calls.push(url); return new Response(JSON.stringify(url === publishedURL ? record : { schemaVersion: 1, models: { [model]: { ...record.models[model], sha256: hash('older model') } } })); };
    assert.equal((await fetchMetadata(model, sha, publishedURL)).status, 'known'); assert.equal(calls.length, 2); assert.equal(calls[1], publishedURL);
    calls.length = 0;
    assert.equal((await fetchMetadata(model, sha, 'https://untrusted.example/metadata.json')).status, 'local-change'); assert.equal(calls.length, 1);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await fetchMetadata(model, sha, publishedURL), { status: 'unknown' });
    globalThis.fetch = async () => { assert.fail('No verified fingerprint must not trigger a request'); };
    assert.deepEqual(await fetchMetadata(model, undefined, publishedURL), { status: 'unknown' });
  }
});
