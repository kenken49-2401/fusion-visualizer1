import { test, expect } from '@playwright/test';
test('products, cumulative step bodies, red additions, supplies, and fixed-position graphics are rendered', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?product=pillar-decoration');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#products a')).toHaveCount(3);
    await expect(page.locator('#guide-title')).toHaveText('柱装飾');
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '1');
    await expect(page.locator('#viewport')).toHaveAttribute('data-new-bodies', '1');
    await expect(page.locator('.fixing-label')).toHaveCount(1);
    await expect(page.locator('#step-description')).toContainText('下書き');
    const first = await page.locator('#viewport canvas').screenshot();
    await page.getByRole('button', { name: '次のステップ →', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '2');
    await expect(page.locator('#viewport')).toHaveAttribute('data-new-bodies', '1');
    await expect(page.locator('.fixing-label')).toHaveCount(0);
    expect((await page.locator('#viewport canvas').screenshot()).equals(first)).toBe(false);
    await page.getByRole('button', { name: '次のステップ →', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '3');
    await page.getByRole('button', { name: '完成形を確認', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '4');
    await expect(page.locator('#viewport')).toHaveAttribute('data-new-bodies', '0');
    await page.getByRole('button', { name: '手順の表示に戻る', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '3');
    await expect(page.locator('#all-materials li')).toHaveCount(5);
    await expect(page.locator('#step-materials li')).toHaveCount(1);
    await page.getByRole('button', { name: '寸法付き図面', exact: true }).click();
    await expect(page.getByLabel('図面の方向', { exact: true }).locator('option')).toHaveCount(6);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.locator('[data-product-id="signage"]').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-product-id', 'signage');
    await expect(page.locator('#all-materials li')).toHaveCount(32);
    await page.reload();
    await expect(page.locator('#viewport')).toHaveAttribute('data-product-id', 'signage');
    expect(errors).toEqual([]);
});
test('public build has no editor module or writable route even with an edit query', async ({ page, request }) => {
    const scripts: string[] = [];
    page.on('response', r => { if (r.url().endsWith('.js'))
        scripts.push(r.url()); });
    await page.goto('/?product=figure-stand&edit=1');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('button', { name: '手順を編集（開発者用）', exact: true })).toHaveCount(0);
    for (const url of scripts) {
        const response = await request.get(url);
        const source = await response.text();
        for (const marker of ['/__guide/runtime', '/__guide/save', '/__guide/sync', '制作手順の編集者モード'])
            expect(source).not.toContain(marker);
    }
    const response = await request.post('/__guide/save', { data: {} });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    // A static SPA host may fall back to index.html for unknown GET paths.
    const runtime = await request.get('/__guide/runtime');
    expect(runtime.headers()['content-type']).not.toContain('application/json');
    expect(await runtime.text()).not.toContain('"mode":"admin"');
});
