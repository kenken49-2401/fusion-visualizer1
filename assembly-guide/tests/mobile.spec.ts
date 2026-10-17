import { test, expect } from '@playwright/test';
test('phone can choose products, advance steps and inspect annotations without page overflow', async ({ page }) => {
    await page.goto('/?product=pillar-decoration');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByRole('button', { name: '次のステップを3Dで表示', exact: true }).tap();
        await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', viewport.width === 390 ? '2' : '3');
    }
    await page.locator('[data-product-id="figure-stand"]').tap();
    await expect(page.locator('#viewport')).toHaveAttribute('data-product-id', 'figure-stand');
    await expect(page.locator('.fixing-label')).toHaveCount(1);
    await page.getByRole('button', { name: '上面', exact: true }).tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/guide-phone.png', fullPage: true });
});
