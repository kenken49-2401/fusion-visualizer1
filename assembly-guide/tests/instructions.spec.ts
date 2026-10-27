import { test, expect } from '@playwright/test';

for (const [id, counts, titles] of [
  ['standing-desk-large', [1, 7, 21, 23], ['天板支えを用意する', '足6本を取り付ける', 'A1〜A6・B1〜B8を取り付ける', '天板 大・小を取り付ける']],
  ['standing-desk-small', [1, 5, 13, 14], ['天板支えを用意する', '足4本を取り付ける', 'A1〜A4・B1〜B4を取り付ける', '天板を取り付ける']],
  ['menu-sign', [8, 9, 9, 9, 9], ['人形立てを用意する', 'メニュー看板を上に載せる', '固定する', '立てる', 'テントに紐で固定する']],
] as const) test(`${id} follows the published sequence on desktop and phone without a fixing-position section`, async ({ page }) => {
  await page.goto(`/?product=${id}&step=1`);
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { name: '固定位置', exact: true })).toHaveCount(0);
  await expect(page.locator('#fixings')).toHaveCount(0);
  for (let i = 0; i < titles.length; i++) {
    await expect(page.locator('#viewport')).toHaveAttribute('data-step', String(i + 1));
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', String(counts[i]));
    await expect(page.locator('#scene-step-title')).toHaveText(titles[i]);
    if (id !== 'menu-sign' && i > 0) {
      await expect(page.locator('#tools')).toContainText(['', '65mmビス', '55mmビス', '25mmビス'][i]);
      if (i === 3) await expect(page.locator('#tools')).toContainText('貫通しないように注意');
    }
    if (i < titles.length - 1) await page.getByRole('button', { name: '次のステップを3Dで表示', exact: true }).click();
  }
  if (id !== 'menu-sign') {
    await expect(page.locator('.legend-new')).toHaveCount(0);
    await page.locator('#steps button').nth(2).click();
    await expect(page.locator('#step-description')).toContainText('緑');
    await expect(page.locator('#step-description')).toContainText('紫');
  } else {
    await expect(page.locator('#step-materials')).toContainText('紐');
    await expect(page.locator('#methods')).toContainText('紐でテントに固定する');
  }
  await page.reload();
  await expect(page.locator('#viewport')).toHaveAttribute('data-step', id === 'menu-sign' ? '5' : '3');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '前のステップを3Dで表示', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
