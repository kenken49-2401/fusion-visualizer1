import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';

async function frontPoints(page: Page) {
  await page.getByRole('button', { name: '正面', exact: true }).click();
  const rect = (await page.locator('#viewport canvas').boundingBox())!;
  const aspect = rect.width / rect.height;
  const halfFov = 36 * Math.PI / 360;
  const distance = Math.hypot(1, 1.5, .04) / 2 / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect))) * 1.2;
  const camera = new PerspectiveCamera(36, aspect, distance / 10000, distance * 100);
  camera.position.set(0, .75, distance); camera.lookAt(0, .75, 0); camera.updateMatrixWorld();
  // Actual original stand's front face, just inside its top and pole/brace vertices.
  return [[.014, 1.495, .02], [.014, .475, .02]].map(p => {
    const v = new Vector3(...p).project(camera);
    return { x: rect.x + (v.x + 1) * rect.width / 2, y: rect.y + (1 - v.y) * rect.height / 2 };
  });
}

test('real 3D measurements survive orbit, reload and model switching, with independent annotations', async ({ page }) => {
  await page.goto('/?model=figure-stand');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.locator('.measurement-toggle').click();
  const [a, b] = await frontPoints(page);
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('.measurement-label.is-pending')).toBeVisible();
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('.measurement-list li')).toHaveCount(1);
  await expect(page.locator('.measurement-list')).toContainText('1,027.57 mm');
  await expect(page.locator('.measurement-list')).toContainText('頂点 → 頂点');
  const label = page.locator('.measurement-label');
  const originalPosition = await label.getAttribute('style');
  const canvas = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .55, canvas.y + canvas.height * .55);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .6, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.measurement-list li')).toHaveCount(1);
  await expect(page.locator('.measurement-label.is-pending')).toHaveCount(0);
  await expect.poll(() => label.getAttribute('style')).not.toBe(originalPosition);
  await page.locator('.measurement-visibility').click(); await expect(label).toBeHidden();
  await page.locator('.measurement-visibility').click(); await expect(label).toBeVisible();
  await page.reload(); await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.measurement-list')).toContainText('1,027.57 mm');
  await page.locator('#model-select').selectOption('signage');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'signage');
  await expect(page.locator('.measurement-list li')).toHaveCount(0);
  await page.locator('#model-select').selectOption('figure-stand');
  await expect(page.locator('#viewport')).toHaveAttribute('data-model-id', 'figure-stand');
  await expect(page.locator('.measurement-list')).toContainText('1,027.57 mm');
  await page.getByRole('button', { name: '計測 M1 を削除', exact: true }).click();
  await expect(page.locator('.measurement-list li')).toHaveCount(0);
});

test('real touch taps measure, while pinch and canceled touch gestures do not', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP dispatches real browser touch input');
  await page.goto('/?model=figure-stand');
  await expect(page.locator('#viewport')).toHaveAttribute('data-ready', 'true');
  await page.locator('.measurement-toggle').click();
  const [a] = await frontPoints(page);
  const client = await context.newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({ id, x, y });
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: { id: number; x: number; y: number }[]) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [touch(1, a.x, a.y), touch(2, a.x + 35, a.y + 35)]);
  await send('touchMove', [touch(1, a.x - 10, a.y - 10), touch(2, a.x + 50, a.y + 50)]);
  await send('touchEnd', []);
  await expect(page.locator('.measurement-label')).toHaveCount(0);
  await send('touchStart', [touch(1, a.x, a.y)]); await send('touchCancel', []);
  await expect(page.locator('.measurement-label')).toHaveCount(0);
  // Reset the camera after the genuine pinch before selecting the known vertices.
  const points = await frontPoints(page);
  for (const point of points) { await send('touchStart', [touch(1, point.x, point.y)]); await send('touchEnd', []); }
  await expect(page.locator('.measurement-list li')).toHaveCount(1);
  await expect(page.locator('.measurement-list')).toContainText('1,027.57 mm');
  await client.detach();
});
