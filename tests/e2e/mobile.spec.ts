import { test, expect } from '@playwright/test';

test('phone portrait and landscape stay within the viewport with operable controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const viewport = (await page.locator('#viewport').boundingBox())!;
  const toolbar = (await page.locator('.view-controls').boundingBox())!;
  expect(viewport.y + viewport.height).toBeLessThanOrEqual(toolbar.y);
  await page.getByRole('button', { name: '上面', exact: true }).tap();
  await expect(page.locator('[data-view="top"]')).toHaveAttribute('aria-pressed', 'true');
  const control = (await page.locator('[data-view="top"]').boundingBox())!;
  expect(control.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'test-results/viewer-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: '立体', exact: true }).tap();
  await expect(page.locator('[data-view="iso"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone can switch a model, start measurement from canvas tools and open a dimensioned drawing', async ({ page }) => {
  await page.goto('/?model=signage');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('閲覧するモデル', { exact: true }).selectOption('pillar-decoration');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'pillar-decoration');
  await page.getByRole('button', { name: '2点間を測る', exact: true }).tap();
  await expect(page.locator('#measurement-shortcut')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#measurement-shortcut').tap();
  await page.getByRole('button', { name: '寸法付き図面', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '寸法図', exact: true });
  await expect(dialog).toBeVisible();
  await page.getByLabel('図面の方向', { exact: true }).selectOption('top');
  await expect(dialog.locator('svg')).toContainText('平面');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).tap();
});
