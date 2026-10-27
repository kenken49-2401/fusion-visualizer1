import { test, expect } from '@playwright/test';
for (const [id, counts, markers] of [
  ['standing-desk-large', [1, 7, 21, 23], 8], ['standing-desk-small', [1, 5, 13, 14], 4], ['menu-sign', [8, 9, 9, 9, 9], 0],
] as const) test(`${id} shows imported steps, compact groups and 35mm fixings`, async ({ page, request }) => {
  const guide = await (await request.get(`/guides/${id}.json`)).json();
  await page.goto(`/?product=${id}&step=1`);
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#fixings, #methods, #step-materials, #all-materials, .guide-body-row-status')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /固定方法|必要な物資|このステップの物資/ })).toHaveCount(0);
  await expect(page.locator('.guide-body-row img')).toHaveCount(counts[counts.length - 1]);
  for (const group of guide.groups ?? []) for (const bodyId of group.bodyIds) {
    await expect(page.locator(`.guide-body-row[data-body-id="${bodyId}"] .guide-body-select > span`)).toHaveText(group.name);
  }
  for (let i = 0; i < counts.length; i++) {
    await expect(page.locator('#viewport')).toHaveAttribute('data-step', String(i + 1));
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', String(counts[i]));
    await expect(page.locator('#scene-step-title')).toHaveText(guide.steps[i].title);
    if (i < counts.length - 1) await page.getByRole('button', { name: '次のステップを3Dで表示', exact: true }).click();
  }
  await expect(page.locator('.fixing-label')).toHaveCount(markers);
  for (const label of await page.locator('.fixing-label').all()) await expect(label).toHaveAttribute('data-length-mm', '35');
  if (markers) {
    await page.getByRole('button', { name: '上面', exact: true }).click();
    await page.locator('#viewport').screenshot({ path: `test-results/${id}-fixings-top.png` });
    await page.getByRole('button', { name: '寸法付き図面', exact: true }).click();
    await expect(page.getByLabel('図面の部品').locator('option').nth(1)).toHaveText('1. A');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await page.reload(); await expect(page.locator('#viewport')).toHaveAttribute('data-step', String(counts.length));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '前のステップを3Dで表示', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
