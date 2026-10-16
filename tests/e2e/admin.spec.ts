import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const originals = new Map<string, Buffer>();
test.beforeAll(() => {
  const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8'));
  for (const entry of catalog.models) {
    const path = `public/${entry.config}`;
    originals.set(path, readFileSync(path));
    originals.set(`public/${JSON.parse(readFileSync(path, 'utf8')).model}`, readFileSync(`public/${JSON.parse(readFileSync(path, 'utf8')).model}`));
  }
});
test.afterEach(() => { for (const [path, bytes] of originals) writeFileSync(path, bytes); });
const modelXML = () => { const files = unzipSync(readFileSync('public/models/figure-stand.3mf')); return strFromU8(files[Object.keys(files).find(p => p.endsWith('.model'))!]); };

test('local editor bakes colors into 3MF and reload uses the saved color as its reset color', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  const swatch = page.locator('.body-swatch');
  await expect(swatch).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.getByRole('button', { name: 'ボディ2をセージにする', exact: true }).click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(120, 149, 125)');
  await expect(page.locator('.editor-state')).toContainText('未保存');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors).toEqual({});
  expect(modelXML()).toContain('#78957dff');
  await page.getByRole('button', { name: '読込時の色', exact: true }).click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  await page.getByRole('button', { name: 'ボディ2をセージにする', exact: true }).click();
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  await page.reload();
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(swatch).toHaveCSS('background-color', 'rgb(120, 149, 125)');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  await page.getByRole('button', { name: 'ボディ2をブルーにする', exact: true }).click();
  await page.getByRole('button', { name: '読込時の色', exact: true }).click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(120, 149, 125)');
  // The baked color is now the color loaded by this page.
  await expect(page.getByRole('button', { name: '設定を保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'ボディ2をセージにする', exact: true }).click();
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors).toEqual({});
});

test('local save endpoint rejects foreign origins, bad colors and outdated revisions', async ({ request }) => {
  const origin = 'http://127.0.0.1:5174';
  const info = await (await request.get('/__admin/config')).json();
  const foreign = await request.post('/__admin/colors', { headers: { Origin: 'https://example.com' }, data: { revision: info.revision, colors: {} } });
  expect(foreign.status()).toBe(403);
  const bad = await request.post('/__admin/colors', { headers: { Origin: origin }, data: { revision: info.revision, colors: { body: 'red' } } });
  expect(bad.status()).toBe(400);
  const stale = await request.post('/__admin/colors', { headers: { Origin: origin }, data: { revision: 'stale', colors: {} } });
  expect(stale.status()).toBe(409);
});

test('editing during a slow save keeps new changes pending and prevents overlapping saves', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__admin/colors', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  await page.getByRole('button', { name: 'ボディ2をセージにする', exact: true }).click();
  const save = page.getByRole('button', { name: '設定を保存', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'ボディ2をブルーにする', exact: true }).click();
  await expect(save).toBeDisabled();
  release();
  await expect(page.locator('.editor-state')).toContainText('未保存の変更');
  await expect(save).toBeEnabled();
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors).toEqual({});
  expect(modelXML()).toContain('#78957dff');
  await save.click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors).toEqual({});
  expect(modelXML()).toContain('#658ba0ff');
});


test('GitHub sync is explicit, disabled for drafts and reports errors separately', async ({ page }) => {
  let syncCalls = 0;
  await page.route('**/__admin/sync', route => { syncCalls++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Git認証を確認してください。' }) }); });
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  const sync = page.getByRole('button', { name: 'GitHubへ同期', exact: true });
  await sync.click();
  await expect(page.locator('.editor-sync-state')).toContainText('Git認証');
  await page.getByRole('button', { name: 'ボディ2をセージにする', exact: true }).click();
  await expect(sync).toBeDisabled();
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(sync).toBeEnabled();
  expect(syncCalls).toBe(1);
  await expect(page.locator('.editor-sync-state')).toContainText('未実行');
});


test('admin revision covers model bytes and saves are isolated to the selected catalog model', async ({ request }) => {
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const info = await (await request.get('/__admin/config?model=pillar-decoration')).json();
  const config = 'public/models/pillar-decoration.json';
  const model = `public/${JSON.parse(readFileSync(config, 'utf8')).model}`;
  writeFileSync(model, Buffer.concat([readFileSync(model), Buffer.from('revision-check')]));
  const stale = await request.post('/__admin/colors', { headers, data: { modelId: 'pillar-decoration', revision: info.revision, colors: {} } });
  expect(stale.status()).toBe(409);
  writeFileSync(model, originals.get(model)!);
  const fresh = await (await request.get('/__admin/config?model=pillar-decoration')).json();
  const saved = await request.post('/__admin/colors', { headers, data: { modelId: 'pillar-decoration', revision: fresh.revision, colors: { 'build:0/object:1': '#123456' } } });
  expect(saved.status()).toBe(200);
  expect(readFileSync('public/models/figure-stand.3mf')).toEqual(originals.get('public/models/figure-stand.3mf'));
  expect(readFileSync('public/viewer.json')).toEqual(originals.get('public/viewer.json'));
  expect((await request.get('/__admin/config?model=../viewer')).status()).toBe(400);
});


test('duplicate body names have numbered editor labels and independent presets', async ({ page }) => {
  await page.goto('/?model=signage');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  const panel = page.getByRole('region', { name: '開発者用の色編集' });
  await expect(panel.getByLabel('ボディ1 · 01の色', { exact: true })).toHaveCount(1);
  await expect(panel.getByLabel('ボディ1 · 31の色', { exact: true })).toHaveCount(1);
  const before = await panel.getByLabel('ボディ1 · 02の色', { exact: true }).inputValue();
  await panel.getByRole('button', { name: 'ボディ1 · 01をセージにする', exact: true }).click();
  await expect(panel.getByLabel('ボディ1 · 01の色', { exact: true })).toHaveValue('#78957d');
  await expect(panel.getByLabel('ボディ1 · 02の色', { exact: true })).toHaveValue(before);
  await expect(panel.getByRole('button', { name: 'ボディ1 · 01に注目', exact: true })).toHaveCount(1);
  await panel.getByRole('button', { name: '変更を取り消す', exact: true }).click();
});
