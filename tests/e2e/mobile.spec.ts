import { test, expect } from '@playwright/test';

test('phone portrait and landscape stay within the viewport with operable controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
