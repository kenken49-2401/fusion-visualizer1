import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

test('real model draws; body visibility, presets and pointer orbit change the actual canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#model-size')).toHaveText('1,000 × 40 × 1,500 mm');
  await expect(page.locator('#viewport')).toHaveAttribute('data-triangles', '68');
  await expect(page.locator('#body-list')).toContainText('ボディ2');
  const canvas = page.locator('canvas');
  await page.waitForTimeout(300);
  const visible = await canvas.screenshot();
  await page.getByRole('button', { name: 'ボディ2を表示', exact: true }).click();
  await expect(page.locator('#status')).toContainText('0 / 1');
  await page.waitForTimeout(200);
  const hidden = await canvas.screenshot();
  expect(visible.equals(hidden)).toBe(false);
  await page.getByRole('button', { name: 'ボディ2を表示', exact: true }).click();
  await page.getByRole('button', { name: '正面', exact: true }).click();
  await page.waitForTimeout(200);
  const front = await canvas.screenshot();
  await page.getByRole('button', { name: '右側面', exact: true }).click();
  await page.waitForTimeout(200);
  expect(front.equals(await canvas.screenshot())).toBe(false);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-view="right"]')).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.wheel(0, -200);
  await page.getByRole('button', { name: '全体を表示' }).click();
  await page.getByLabel('グリッド', { exact: true }).uncheck();
  await expect(page.locator('#show-grid')).not.toBeChecked();
  await page.screenshot({ path: 'test-results/viewer-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('public build contains no editor code or save endpoint', async ({ page, request }) => {
  await page.goto('/?admin=1');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: /開発者/ })).toHaveCount(0);
  const scripts = readdirSync('dist/assets').filter(name => name.endsWith('.js')).map(name => readFileSync(`dist/assets/${name}`, 'utf8')).join('\n');
  expect(scripts).not.toContain('/__admin/colors');
  expect(scripts).not.toContain('/__admin/sync');
  expect(scripts).not.toContain('GitHubへ同期');
  expect(scripts).not.toContain('LOCAL ADMIN');
  expect(scripts).not.toContain('未保存の変更');
  const response = await request.post('/__admin/colors', { data: { colors: {} } });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.headers()['content-type'] || '').not.toContain('application/json');
  expect((await request.post('/__admin/sync', { data: {} })).status()).toBeGreaterThanOrEqual(400);
});

test('model network failures produce a readable retry state', async ({ page }) => {
  await page.route('**/models/figure-stand.3mf', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('404');
  await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
});
