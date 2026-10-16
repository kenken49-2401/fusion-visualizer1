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
  await expect(dialog.locator('[data-projected-dimension="width"]')).toContainText('975.0');
  await page.getByLabel('図面の部品', { exact: true }).selectOption('0');
  await expect(dialog.locator('[data-selected-edge]')).toHaveCount(1);
  await expect(dialog.locator('[data-edge-label]')).toContainText('3D実長');
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


test('clicking an actual drawing edge attaches its true length to both projected endpoints', async ({ page }) => {
  await page.goto('/?model=figure-stand');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '寸法付き図面', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '寸法図', exact: true });
  await dialog.locator('g[data-drawing-part="0"]').click();
  await expect(dialog.getByLabel('図面の部品', { exact: true })).toHaveValue('0');
  // Original mesh: pole endpoints are z=1500 and z=472.426432 mm.
  await expect(dialog.locator('[data-edge-label]')).toContainText('1,027.6');
  expect(Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'))).toBeCloseTo(1500 - 472.426432, 2);
  await dialog.locator('svg').scrollIntoViewIfNeeded();
  const target = await dialog.locator('svg').evaluate(svg => {
    for (const line of svg.querySelectorAll<SVGLineElement>('line[data-drawing-edge]')) {
      const matrix = line.getScreenCTM(); if (!matrix) continue;
      const start = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(matrix);
      const end = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(matrix);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 20) continue;
      const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2;
      const hit = document.elementFromPoint(x, y)?.closest('[data-drawing-edge]');
      if (hit) return { x, y, index: hit.getAttribute('data-drawing-edge')! };
    }
    throw new Error('No visible, directly clickable model edge');
  });
  await page.mouse.click(target.x, target.y);
  await expect(dialog.getByLabel('辺の3D実長', { exact: true })).toHaveValue(target.index);
  const selectedLength = Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'));
  expect(selectedLength).toBeGreaterThan(0);
  const assertEndpoints = async () => {
    const coordinates = await dialog.locator('svg').evaluate(svg => {
      const line = svg.querySelector('[data-selected-edge]')!;
      return ['start', 'end'].map((name, i) => {
        const marker = svg.querySelector(`[data-edge-endpoint="${name}"]`)!;
        return { marker: [Number(marker.getAttribute('cx')), Number(marker.getAttribute('cy'))], line: [Number(line.getAttribute(`x${i + 1}`)), Number(line.getAttribute(`y${i + 1}`))] };
      });
    });
    for (const pair of coordinates) expect(pair.marker).toEqual(pair.line);
  };
  await assertEndpoints();
  await dialog.getByLabel('図面の方向', { exact: true }).selectOption('right');
  await expect(dialog.getByLabel('辺の3D実長', { exact: true })).toHaveValue(target.index);
  expect(Number(await dialog.locator('[data-selected-edge]').getAttribute('data-length-mm'))).toBeCloseTo(selectedLength, 6);
  await assertEndpoints();
});
