import { test, expect } from '@playwright/test';
import type { Vector3 } from 'three';
import type { ModelScene } from '../src/scene';

declare global {
  interface Window { zoomScene: ModelScene; zoomAnchor: Vector3; zoomBefore: Vector3; }
}
test.use({ hasTouch: true, baseURL: 'http://127.0.0.1:5274' });

test.beforeEach(async ({ page }) => {
  await page.route('**/zoom-test', route => route.fulfill({ contentType: 'text/html', body:
    '<body style="margin:16px"><div style="height:600px"></div><div id="viewport" style="width:100%;height:400px"></div><div style="height:800px"></div></body>' }));
  await page.goto('/zoom-test');
  await page.evaluate(async () => {
    const path = '/src/scene.ts';
    const { ModelScene } = await import(/* @vite-ignore */ path);
    const scene: ModelScene = new ModelScene(document.querySelector('#viewport'));
    scene.camera.position.set(0, 0, 5);
    scene.controls.update(); scene.requestRender();
    window.zoomScene = scene;
  });
});

for (const scrolled of [false, true]) test(`wheel and pinch keep their off-center anchor${scrolled ? ' after page scroll on a phone' : ''}`, async ({ page, context }) => {
  if (scrolled) { await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 500)); }
  else await page.evaluate(() => scrollTo(0, 600));
  await page.waitForTimeout(150);
  const rect = (await page.locator('canvas').boundingBox())!;
  const point = { x: rect.x + rect.width * .67, y: rect.y + rect.height * .43 };
  const saveAnchor = () => page.evaluate(point => {
    const s = window.zoomScene, c = s.camera, r = s.renderer.domElement.getBoundingClientRect();
    const ray = c.position.clone().set((point.x - r.left) / r.width * 2 - 1, -(point.y - r.top) / r.height * 2 + 1, .5).unproject(c).sub(c.position).normalize();
    const normal = c.getWorldDirection(c.position.clone());
    window.zoomAnchor = c.position.clone().addScaledVector(ray, s.controls.target.clone().sub(c.position).dot(normal) / ray.dot(normal));
    window.zoomBefore = c.position.clone();
  }, point);
  const checkAnchor = async () => {
    await expect.poll(() => page.evaluate(point => {
      const s = window.zoomScene, r = s.renderer.domElement.getBoundingClientRect(), p = window.zoomAnchor.clone().project(s.camera);
      return Math.hypot(r.left + (p.x + 1) * r.width / 2 - point.x, r.top + (1 - p.y) * r.height / 2 - point.y);
    }, point)).toBeLessThan(2);
    expect(await page.evaluate(() => window.zoomScene.camera.position.distanceTo(window.zoomBefore))).toBeGreaterThan(.01);
  };
  for (const delta of [-250, 250]) {
    await saveAnchor(); await page.mouse.move(point.x, point.y); await page.mouse.wheel(0, delta); await checkAnchor();
  }
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', distance: number) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: point.x - distance, y: point.y, id: 1 }, { x: point.x + distance, y: point.y, id: 2 }] });
  for (const distances of [[40, 44, 48, 52, 56, 60, 64], [64, 60, 56, 52, 48, 44, 40]]) {
    await saveAnchor(); await touch('touchStart', distances[0]);
    for (const distance of distances.slice(1)) { await touch('touchMove', distance); await page.waitForTimeout(20); }
    await touch('touchEnd', 0); await page.waitForTimeout(250); await checkAnchor();
  }
});
