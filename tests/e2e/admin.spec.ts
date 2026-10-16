import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

let original: string;
test.beforeAll(() => { original = readFileSync('public/viewer.json', 'utf8'); });
test.afterAll(() => { writeFileSync('public/viewer.json', original); });

test('local color editor previews, saves, survives reload and restores the original vertex color', async ({ page }) => {
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
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors['build:0/object:1']).toBe('#78957d');
  await page.reload();
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(swatch).toHaveCSS('background-color', 'rgb(120, 149, 125)');
  await page.getByRole('button', { name: '色を編集（開発者用）', exact: true }).click();
  await page.getByRole('button', { name: '元の色', exact: true }).click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(0, 0, 0)');
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
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors['build:0/object:1']).toBe('#78957d');
  await save.click();
  await expect(page.locator('.editor-state')).toContainText('保存済み');
  expect(JSON.parse(readFileSync('public/viewer.json', 'utf8')).colors['build:0/object:1']).toBe('#658ba0');
});
