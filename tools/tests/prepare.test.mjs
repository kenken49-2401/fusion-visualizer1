import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDesktopEditor } from '../prepare-desktop.mjs';
const commit = 'a'.repeat(40);
const baseline = { schemaVersion: 1, commit, files: { 'public/catalog.json': 'b'.repeat(64) } };
async function fixture(t, state) {
  const root = await mkdtemp(join(tmpdir(), 'fusion-prepare-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assembly-guide'));
  if (state !== undefined) {
    await mkdir(join(root, '.local'));
    await writeFile(join(root, '.local/desktop-update.json'), typeof state === 'string' ? state : JSON.stringify(state));
  }
  return { root, guideRoot: join(root, 'assembly-guide') };
}

test('a checkout or standalone guide without distribution state starts without update or network', async t => {
  const { guideRoot } = await fixture(t);
  const result = await prepareDesktopEditor(guideRoot, { updateImpl() { assert.fail('Must not update without state'); } });
  assert.equal(result.status, 'skipped');
});

test('fresh or reconciled desktop state skips the update implementation', async t => {
  const { guideRoot } = await fixture(t, { ...baseline, dataMergeVersion: 1 });
  const result = await prepareDesktopEditor(guideRoot, { updateImpl() { assert.fail('Must not update an already prepared distribution'); } });
  assert.equal(result.status, 'current'); assert.equal(result.commit, commit);
});

test('legacy state invokes latest updater once with repository root and preserves its result', async t => {
  const { root, guideRoot } = await fixture(t, baseline);
  const messages = [], updateResult = { status: 'updated', commit }; let calls = 0;
  const onMessage = message => messages.push(message);
  const result = await prepareDesktopEditor(guideRoot, { onMessage, async updateImpl(actualRoot, options) {
    calls++; assert.equal(actualRoot, root); assert.equal(options.onMessage, onMessage);
    await writeFile(join(root, '.local/desktop-update.json'), JSON.stringify({ ...baseline, dataMergeVersion: 1 }));
    return updateResult;
  } });
  assert.equal(calls, 1); assert.equal(result, updateResult); assert.equal(messages.length, 1);
  await prepareDesktopEditor(guideRoot, { updateImpl() { assert.fail('Second startup must skip completed migration'); } });
});

test('offline or ordinary conflict permits installed local app, fatal result aborts startup', async t => {
  const { guideRoot } = await fixture(t, baseline);
  for (const status of ['offline', 'conflict', 'skipped']) {
    const result = await prepareDesktopEditor(guideRoot, { onMessage() {}, async updateImpl() { return { status, message: 'ordinary outcome' }; } });
    assert.equal(result.status, status);
  }
  await assert.rejects(prepareDesktopEditor(guideRoot, { onMessage() {}, async updateImpl() { return { status: 'skipped', fatal: true, message: 'manual recovery required' }; } }), error => error.fatal === true && error.message === 'manual recovery required');
});

test('unreadable or malformed existing state is not mistaken for a missing distribution', async t => {
  for (const state of ['not-json', { ...baseline, schemaVersion: 2 }, { ...baseline, commit: 'invalid' }, { ...baseline, files: [] }]) {
    const { guideRoot } = await fixture(t, state);
    await assert.rejects(prepareDesktopEditor(guideRoot, { updateImpl() { assert.fail('Invalid state must not trigger network'); } }), /更新履歴が不正/);
  }
  const { root, guideRoot } = await fixture(t);
  await mkdir(join(root, '.local/desktop-update.json'), { recursive: true });
  await assert.rejects(prepareDesktopEditor(guideRoot, { updateImpl() { assert.fail('Unreadable state must not trigger network'); } }), /更新履歴を読み取れません/);
});
