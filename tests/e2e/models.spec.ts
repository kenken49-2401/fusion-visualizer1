import { test, expect } from '@playwright/test';

test('the selector loads all actual models, preserves links and distinguishes repeated body names', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('閲覧するモデル', { exact: true }).selectOption('pillar-decoration');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'pillar-decoration');
  await expect(page.locator('#model-name')).toHaveText('柱装飾');
  await expect(page.locator('#model-body-count')).toHaveText('4 ボディ');
  await expect(page.locator('#model-size')).toHaveText('975 × 845 × 1,990 mm');
  await expect(page).toHaveURL(/model=pillar-decoration/);
  await page.getByLabel('閲覧するモデル', { exact: true }).selectOption('signage');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'signage');
  await expect(page.locator('#model-body-count')).toHaveText('31 ボディ');
  await expect(page.locator('#viewport')).toHaveAttribute('data-triangles', '1876');
  await expect(page.locator('.body-name').first()).toHaveText('ボディ1 · 01');
  await expect(page.locator('.body-name').nth(1)).toHaveText('ボディ1 · 02');
  await page.reload();
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'signage');
  expect(errors).toEqual([]);
});

test('dimensioned views show true part lengths, change direction, and export an SVG', async ({ page }) => {
  await page.goto('/?model=pillar-decoration');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '寸法付き図面', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '寸法図', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('tbody tr')).toHaveCount(4);
  await expect(dialog.locator('svg')).toContainText('投影幅 975.0');
  await page.getByLabel('図面の部品', { exact: true }).selectOption('0');
  await expect(dialog.locator('svg')).toContainText('外接寸法');
  await page.getByLabel('辺の3D実長', { exact: true }).selectOption('0');
  await expect(dialog.locator('svg')).toContainText('3D実長');
  await page.getByLabel('図面の方向', { exact: true }).selectOption('right');
  await expect(dialog.locator('svg')).toContainText('右側面');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'SVG保存', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
