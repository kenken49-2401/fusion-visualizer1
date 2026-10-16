import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, BufferGeometry, EventDispatcher, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { ModelScene } from '../../src/scene';
import type { LoadedModel } from '../../src/model-loader';
import { distanceMM, isWorldVisible, mountMeasurements, parseMeasurements } from '../../src/measurements';
const a = { position: [0, 0, 0], snapped: true };
const b = { position: [.003, .004, 0], snapped: false };
const item = { id: 1, a, b };
const saved = (items: unknown, modelKey = 'original-content-hash') => JSON.stringify({ version: 1, modelKey, items });
describe('3D measurement distances', () => {
  it('measures a 3-4-5 triangle in millimeters', () => { expect(distanceMM(a.position, b.position)).toBeCloseTo(5); });
  it('includes depth and is independent of camera projection', () => { expect(distanceMM([1, 2, 3], [1, 2, 3.025])).toBeCloseTo(25); });
});
describe('local measurement persistence', () => {
  it('restores original coordinates and snapping state', () => { expect(parseMeasurements(saved([item]), 'original-content-hash')).toEqual([item]); });
  it('rejects stale model identities and malformed storage', () => {
    expect(parseMeasurements(saved([item]), 'changed-content-hash')).toEqual([]);
    for (const raw of ['{bad', 'null', '{"version":9}', saved(null)]) expect(parseMeasurements(raw, 'original-content-hash')).toEqual([]);
  });
  it('ignores zero distances, invalid coordinates and duplicate IDs', () => {
    const invalid = [null, { ...item, id: -1 }, { ...item, b: a }, { ...item, b: { position: [null, 0, 1], snapped: false } }, { ...item, a: { ...a, position: [1e12, 0, 0] } }];
    expect(parseMeasurements(saved([...invalid, item, item]), 'original-content-hash')).toEqual([item]);
  });
});
describe('raycast visibility', () => {
  it('requires both mesh and all its ancestors to be visible', () => {
    const root = new Group(), body = new Group(), mesh = new Mesh(); root.add(body); body.add(mesh);
    expect(isWorldVisible(mesh)).toBe(true);
    body.visible = false; expect(isWorldVisible(mesh)).toBe(false);
    body.visible = true; root.visible = false; expect(isWorldVisible(mesh)).toBe(false);
    root.visible = true; mesh.visible = false; expect(isWorldVisible(mesh)).toBe(false);
  });
});


describe('measurement interactions', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });
  it('ignores drag gestures, keeps pending markers and persistent projected labels, then disposes', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const viewport = document.createElement('div'), canvas = document.createElement('canvas'), panel = document.createElement('section');
    viewport.append(canvas); document.body.append(viewport, panel);
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON() {} };
    canvas.getBoundingClientRect = () => rect; viewport.getBoundingClientRect = () => rect;
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 0, 2, 0], 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial()), object = new Group(); object.add(mesh);
    const model = { object, bodies: [{ id: 'one', name: 'One', object, meshes: [mesh], triangles: 1 }], bounds: new Box3(), sizeMM: new Vector3(), sourceUnit: 'meter', triangles: 1 } as LoadedModel;
    const camera = new PerspectiveCamera(90, 1, .01, 100); camera.position.z = 5; camera.updateMatrixWorld();
    const scene = { camera, controls: new EventDispatcher(), renderer: { domElement: canvas }, scene: new Scene(), requestRender: vi.fn() } as unknown as ModelScene;
    const point = (type: string, x: number, y: number, target: EventTarget = canvas) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } }); target.dispatchEvent(event);
    };
    const api = mountMeasurements({ scene, model, modelKey: 'interaction-test-content', panel });
    panel.querySelector<HTMLButtonElement>('.measurement-toggle')!.click();
    point('pointerdown', 100, 110); point('pointermove', 120, 110, window); point('pointerup', 100, 110, window);
    expect(viewport.querySelectorAll('.measurement-label')).toHaveLength(0);
    point('pointerdown', 100, 110); point('pointerup', 100, 110, window);
    expect(viewport.querySelector('.measurement-label')?.textContent).toContain('始点');
    expect(scene.scene.getObjectByName('距離計測')?.children).toHaveLength(1);
    point('pointerdown', 100, 90); point('pointerup', 100, 90, window);
    expect(panel.querySelector('.measurement-list')?.textContent).toContain('1,000 mm');
    const label = viewport.querySelector<HTMLElement>('.measurement-label')!;
    expect(label.textContent).toContain('M1'); const before = label.style.transform;
    camera.position.x = .5; scene.controls.dispatchEvent({ type: 'change' });
    expect(label.style.transform).not.toBe(before);
    api.dispose(); expect(viewport.querySelector('.measurement-overlay')).toBeNull(); expect(scene.scene.getObjectByName('距離計測')).toBeUndefined();
    const restored = mountMeasurements({ scene, model, modelKey: 'interaction-test-content', panel });
    expect(panel.querySelector('.measurement-list')?.textContent).toContain('1,000 mm');
    restored.clear(); expect(panel.querySelector('.measurement-list')?.children).toHaveLength(0); restored.dispose();
    geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose();
  });
});
