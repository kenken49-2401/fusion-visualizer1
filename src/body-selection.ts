import {
  Camera, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, Raycaster, Scene, Vector2, type Object3D,
} from 'three';
import type { Body } from './model-loader';

function isVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}

/** Selection is a disposable overlay, independent of source materials and saved appearance. */
export function createBodySelection(scene: Scene, bodies: Body[], invalidate: () => void) {
  const overlay = new Group(); overlay.name = '選択中のボディ'; overlay.userData.bodySelection = true;
  overlay.visible = false;
  scene.add(overlay);
  let selectedId: string | undefined;
  let disposed = false;
  const sourceMeshes = new Map<Mesh, Mesh>();
  function clearOverlay() {
    overlay.traverse(object => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      }
    });
    overlay.clear(); sourceMeshes.clear();
  }
  function refresh() {
    if (disposed) return;
    const body = bodies.find(item => item.id === selectedId);
    overlay.visible = Boolean(body && isVisible(body.object));
    if (body) for (const [source, target] of sourceMeshes) {
      source.updateWorldMatrix(true, false); target.matrix.copy(source.matrixWorld); target.matrixWorldNeedsUpdate = true;
      target.visible = isVisible(source);
    }
    invalidate();
  }
  function select(id?: string) {
    if (disposed) return;
    const body = bodies.find(item => item.id === id);
    selectedId = body?.id; clearOverlay();
    if (body) for (const source of body.meshes) {
      const fill = new Mesh(source.geometry.clone(), new MeshBasicMaterial({ color: 0xffbd42, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }));
      fill.matrixAutoUpdate = false; fill.renderOrder = 1000;
      const outline = new LineSegments(new EdgesGeometry(source.geometry, 20), new LineBasicMaterial({ color: 0xbc4a00, depthTest: false, depthWrite: false, transparent: false }));
      outline.renderOrder = 1001; fill.add(outline); overlay.add(fill); sourceMeshes.set(source, fill);
    }
    refresh();
  }
  return {
    select, refresh,
    get selectedId() { return selectedId; },
    dispose() { if (disposed) return; clearOverlay(); scene.remove(overlay); selectedId = undefined; disposed = true; invalidate(); },
  };
}

interface PickerOptions {
  element: HTMLElement;
  camera: Camera;
  bodies: Body[];
  onSelect: (id?: string) => void;
  isEnabled: () => boolean;
}

/** Observe taps without preventing orbit gestures or consuming tool pointer events. */
export function attachBodyPicker({ element, camera, bodies, onSelect, isEnabled }: PickerOptions): () => void {
  const pointers = new Map<number, { x: number; y: number; time: number; blocked: boolean }>();
  const ray = new Raycaster();
  const meshBodies = new Map(bodies.flatMap(body => body.meshes.map(mesh => [mesh, body] as const)));
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const blocked = pointers.size > 0 || !event.isPrimary || !isEnabled();
    if (pointers.size) pointers.forEach(pointer => { pointer.blocked = true; });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now(), blocked });
  };
  const move = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId);
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.blocked = true;
  };
  const up = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId); pointers.delete(event.pointerId);
    if (!pointer || pointer.blocked || !isEnabled() || performance.now() - pointer.time > 700 || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    camera.updateMatrixWorld();
    ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const visible = bodies.filter(body => isVisible(body.object)).flatMap(body => body.meshes.filter(mesh => {
      if (!isVisible(mesh)) return false;
      mesh.updateWorldMatrix(true, false); return true;
    }));
    const hit = ray.intersectObjects(visible, false)[0];
    onSelect(hit ? meshBodies.get(hit.object as Mesh)?.id : undefined);
  };
  const cancel = (event: PointerEvent) => { pointers.delete(event.pointerId); };
  const blur = () => pointers.clear();
  element.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', blur);
  return () => {
    element.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur); pointers.clear();
  };
}
