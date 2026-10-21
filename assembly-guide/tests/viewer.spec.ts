import { test, expect } from '@playwright/test';
test('products, cumulative step bodies, red additions, supplies, and fixed-position graphics are rendered', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?product=pillar-decoration');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#products a')).toHaveCount(5);
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
test('both attached standing desks load as complete draft models and keep their links', async ({ page }) => {
    await page.goto('/?product=standing-desk-large');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    for (const [id, title, count] of [['standing-desk-large', '立ち机 大', '19'], ['standing-desk-small', '立ち机 小', '13']]) {
        await page.locator(`#products [data-product-id="${id}"]`).click();
        await expect(page.locator('#viewport')).toHaveAttribute('data-product-id', id);
        await expect(page.locator('#guide-title')).toHaveText(title);
        await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', count);
        await expect(page.locator('#guide-status')).toContainText('下書き');
        await expect(page.locator('.fixing-label')).toHaveCount(0);
        await page.reload();
        await expect(page.locator('#viewport')).toHaveAttribute('data-product-id', id);
    }
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

test('public guide groups focus only already visible parts and retain the current step colors', async ({ page }) => {
    await page.route('**/guides/standing-desk-large.json', async route => {
        const response = await route.fetch(), guide = await response.json(), first = guide.steps[0];
        guide.groups = [{ id: 'desk-pair', name: '机の組', bodyIds: first.bodyIds.slice(0, 2) }];
        guide.steps = [{ ...first, bodyIds: first.bodyIds.slice(0, 1) }, { ...first, id: 'step-2', bodyIds: first.bodyIds.slice(1) }];
        await route.fulfill({ response, json: guide });
    });
    await page.goto('/?product=standing-desk-large');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '1');
    await page.getByRole('button', { name: '机の組の表示中の部品に注目', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-focused-group', 'desk-pair');
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '1');
    await expect(page.locator('#viewport')).toHaveAttribute('data-new-bodies', '1');
    await expect(page.getByRole('button', { name: 'グループを作成', exact: true })).toHaveCount(0);
});

test('body thumbnails highlight a part; visibility overrides reset without changing step assignments', async ({ page, request }) => {
    const record = await (await request.get('/model-metadata.json')).json();
    await page.goto('/?product=pillar-decoration');
    await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#guide-body-list img')).toHaveCount(4);
    const first = page.locator('.guide-body-row').first(), second = page.locator('.guide-body-row').nth(1);
    const firstId = await first.getAttribute('data-body-id'), secondId = await second.getAttribute('data-body-id');
    await first.locator('.guide-body-select').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-selected-body', firstId!);
    await expect(first).toHaveAttribute('data-selected', 'true');
    await first.locator('.guide-body-visibility').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '0');
    await second.locator('.guide-body-visibility').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '1');
    await expect(second).toHaveAttribute('data-manual', 'true');
    await page.getByRole('button', { name: '表示を手順に戻す', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '1');
    await expect(first).toHaveAttribute('data-visible', 'true');
    await expect(second).toHaveAttribute('data-visible', 'false');
    const part = page.locator('#all-materials .supply-body-select').first();
    await part.scrollIntoViewIfNeeded();
    await expect(part.locator('img')).toHaveJSProperty('naturalWidth', 128);
    await part.click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-selected-body', firstId!);
    await page.getByRole('button', { name: '次のステップを3Dで表示', exact: true }).click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-visible-bodies', '2');
    await expect(page.locator('#viewport')).toHaveAttribute('data-manual-visibility', '0');
    await expect(page.locator('#viewport')).not.toHaveAttribute('data-selected-body');
    await expect(page.locator('#model-uploaded time')).toHaveAttribute('datetime', record.models['models/pillar-decoration.3mf'].uploadedAt);
    expect(secondId).not.toBe(firstId);
});
