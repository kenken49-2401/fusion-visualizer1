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

test('narrow phone fits the complete annotated drawing and returns from the parts table to the selected edge', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/?model=signage');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '寸法付き図面', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '寸法図', exact: true });
  const tableButton = dialog.locator('.drawings-parts tbody button').last();
  await tableButton.scrollIntoViewIfNeeded();
  const selectedIndex = String(await dialog.locator('.drawings-parts tbody button').count() - 1);
  await tableButton.tap();
  await expect(dialog.getByLabel('図面の部品', { exact: true })).toHaveValue(selectedIndex);
  await expect(dialog.locator('[data-selected-edge]')).toHaveCount(1);
  await expect(dialog.locator('[data-edge-endpoint]')).toHaveCount(2);
  await expect(dialog.locator('[data-edge-label]')).toContainText('3D実長');
  const assertFitted = async () => {
    await expect.poll(async () => {
      return dialog.locator('.drawings-diagram svg').evaluate(svg => {
        const rect = svg.getBoundingClientRect();
        const label = svg.querySelector('[data-edge-label]')!.getBoundingClientRect();
        const tolerance = 2;
        return rect.left >= -tolerance && rect.right <= innerWidth + tolerance && rect.top >= -tolerance && rect.bottom <= innerHeight + tolerance &&
          label.left >= rect.left - tolerance && label.right <= rect.right + tolerance && label.top >= rect.top - tolerance && label.bottom <= rect.bottom + tolerance;
      });
    }).toBe(true);
  };
  await assertFitted();
  const before = Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'));
  const edgeIndex = await dialog.getByLabel('辺の3D実長', { exact: true }).inputValue();
  // Changing device orientation preserves the selected actual edge and its millimeter length.
  await page.setViewportSize({ width: 640, height: 320 });
  await expect(dialog.getByLabel('辺の3D実長', { exact: true })).toHaveValue(edgeIndex);
  expect(Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'))).toBeCloseTo(before, 6);
  await assertFitted();
  await dialog.getByLabel('図面の方向', { exact: true }).selectOption('right');
  await expect(dialog.locator('svg')).toContainText('右側面');
  const selected = dialog.locator('[data-selected-edge]');
  const projectedLength = Number(await selected.getAttribute('data-length-mm'));
  expect(projectedLength).toBeGreaterThan(0);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(dialog.getByLabel('図面の方向', { exact: true })).toHaveValue('right');
  expect(Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'))).toBeCloseTo(projectedLength, 6);
  await assertFitted();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone can display both new standing desks without horizontal page overflow', async ({ page }) => {
  await page.goto('/?model=standing-desk-large');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'standing-desk-large');
  await expect(page.locator('#model-body-count')).toHaveText('19 ボディ');
  await page.getByLabel('閲覧するモデル', { exact: true }).selectOption('standing-desk-small');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'standing-desk-small');
  await expect(page.locator('#model-body-count')).toHaveText('13 ボディ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
