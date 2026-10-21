import { describe, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshPhongMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { cloneBodyForPreview, disposeBodyPreview } from '../../src/body-thumbnails';
import { attachBodyPicker, createBodySelection } from '../../src/body-selection';
import type { Body } from '../../src/model-loader';

function fixture() {
  const parent = new Group(); parent.position.set(3, 2, -1); parent.rotation.y = 0.7; parent.scale.set(-2, 1, 0.5);
  const object = new Group(); object.position.set(0.5, 1, 2); parent.add(object);
  const geometry = new BoxGeometry(1, 2, 3), material = new MeshPhongMaterial({ color: '#69875b' });
  const mesh = new Mesh(geometry, [material]); mesh.position.set(1, 0, 0); object.add(mesh);
  mesh.add(new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial()));
  parent.updateMatrixWorld(true);
  const body: Body = { id: 'build:0/object:1', name: '部材', object, meshes: [mesh], triangles: 12 };
  return { parent, object, geometry, material, mesh, body };
}

describe('isolated body previews', () => {
  it('preserves whole-body world transforms including reflection, excludes viewer edges, and owns clone resources', () => {
    const { body, mesh, object, geometry, material } = fixture();
    object.visible = false;
    const originalMatrix = mesh.matrix.clone(), originalWorld = mesh.matrixWorld.clone();
    const positions = [...geometry.getAttribute('position').array];
    const sourceGeometryDispose = vi.spyOn(geometry, 'dispose'), sourceMaterialDispose = vi.spyOn(material, 'dispose');
    const preview = cloneBodyForPreview(body); const clone = preview.children[0] as Mesh;
    expect(preview.children).toHaveLength(1); expect(clone.children).toHaveLength(0);
    expect(clone.geometry).not.toBe(geometry); expect((clone.material as MeshPhongMaterial[])[0]).not.toBe(material);
    expect(clone.matrix.equals(originalWorld)).toBe(true); expect(clone.visible).toBe(true); expect(object.visible).toBe(false);
    expect(new Box3().setFromObject(preview).getSize(new Vector3()).toArray()).toEqual(new Box3().setFromObject(body.object).getSize(new Vector3()).toArray());
    const clonedDispose = vi.spyOn(clone.geometry, 'dispose'), clonedMaterialDispose = vi.spyOn((clone.material as MeshPhongMaterial[])[0], 'dispose');
    disposeBodyPreview(preview); expect(clonedDispose).toHaveBeenCalledOnce(); expect(clonedMaterialDispose).toHaveBeenCalledOnce();
    expect(sourceGeometryDispose).not.toHaveBeenCalled(); expect(sourceMaterialDispose).not.toHaveBeenCalled();
    expect(mesh.matrix.equals(originalMatrix)).toBe(true); expect(mesh.matrixWorld.equals(originalWorld)).toBe(true);
    expect([...geometry.getAttribute('position').array]).toEqual(positions); expect(mesh.material).toEqual([material]);
  });
});

describe('temporary body selection', () => {
  it('owns and cleans overlays, follows transforms/visibility, and preserves original color and references', () => {
    const { body, geometry, material, mesh, object } = fixture();
    const scene = new Scene(), invalidate = vi.fn(); const selection = createBodySelection(scene, [body], invalidate);
    const geometryDispose = vi.spyOn(geometry, 'dispose'), materialDispose = vi.spyOn(material, 'dispose');
    const originalMaterials = mesh.material;
    expect(scene.children[0].visible).toBe(false);
    selection.select(body.id); expect(selection.selectedId).toBe(body.id);
    const overlay = scene.children[0], fill = overlay.children[0] as Mesh;
    const fillDispose = vi.spyOn(fill.geometry, 'dispose');
    expect(fill.geometry).not.toBe(geometry); expect(fill.matrix.equals(mesh.matrixWorld)).toBe(true);
    expect(mesh.material).toBe(originalMaterials); expect(material.color.getHexString()).toBe('69875b');
    object.visible = false; selection.refresh(); expect(overlay.visible).toBe(false);
    object.visible = true; object.position.x += 1; selection.refresh();
    expect(overlay.visible).toBe(true); expect(fill.matrix.equals(mesh.matrixWorld)).toBe(true);
    selection.select('missing'); expect(selection.selectedId).toBeUndefined(); expect(overlay.children).toHaveLength(0); expect(fillDispose).toHaveBeenCalledOnce();
    selection.select(body.id); selection.dispose(); selection.dispose(); expect(scene.children).toHaveLength(0);
    expect(geometryDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled(); expect(mesh.material).toBe(originalMaterials);
  });
});

function pointer(target: EventTarget, type: string, values: Record<string, number | boolean> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerId: 1, isPrimary: true, button: 0, clientX: 50, clientY: 50, ...values })) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event); return event;
}
function pickerFixture() {
  const element = document.createElement('canvas'); document.body.append(element);
  element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON() {} });
  const object = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshPhongMaterial()); object.add(mesh); object.updateMatrixWorld(true);
  const body: Body = { id: 'part', name: 'part', object, meshes: [mesh], triangles: 12 };
  const camera = new PerspectiveCamera(40, 1, 0.01, 100); camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const onSelect = vi.fn(); let enabled = true;
  const dispose = attachBodyPicker({ element, camera, bodies: [body], onSelect, isEnabled: () => enabled });
  return { element, body, onSelect, dispose, disable: () => { enabled = false; } };
}

describe('viewport body taps', () => {
  it('picks visible source meshes without preventing gestures and removes all event handlers on dispose', () => {
    const f = pickerFixture(); const down = pointer(f.element, 'pointerdown'); pointer(window, 'pointerup');
    expect(down.defaultPrevented).toBe(false); expect(f.onSelect).toHaveBeenLastCalledWith('part');
    f.body.object.visible = false; pointer(f.element, 'pointerdown'); pointer(window, 'pointerup');
    expect(f.onSelect).toHaveBeenLastCalledWith(undefined);
    f.dispose(); f.onSelect.mockClear(); pointer(f.element, 'pointerdown'); pointer(window, 'pointerup'); expect(f.onSelect).not.toHaveBeenCalled();
  });
  it('rejects orbit movement, return-to-origin drags, pinch sequences, cancellation and active tools', () => {
    const f = pickerFixture();
    pointer(f.element, 'pointerdown'); pointer(window, 'pointermove', { clientX: 65 }); pointer(window, 'pointerup');
    pointer(f.element, 'pointerdown'); pointer(f.element, 'pointerdown', { pointerId: 2, isPrimary: false }); pointer(window, 'pointerup', { pointerId: 2 }); pointer(window, 'pointerup');
    pointer(f.element, 'pointerdown'); pointer(window, 'pointercancel'); pointer(window, 'pointerup');
    pointer(f.element, 'pointerdown'); f.disable(); pointer(window, 'pointerup');
    pointer(f.element, 'pointerdown'); pointer(window, 'pointerup');
    expect(f.onSelect).not.toHaveBeenCalled(); f.dispose();
  });
});
