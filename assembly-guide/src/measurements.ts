import {
  BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  Raycaster, SphereGeometry, Vector2, Vector3, type Object3D, type Intersection,
} from 'three';
import type { ModelScene } from './scene';
import type { LoadedModel } from './model-loader';
import './measurements.css';

type Point = { position: [number, number, number]; snapped: boolean };
export type Measurement = { id: number; a: Point; b: Point };
const sessions = new Map<string, Measurement[]>();
const prefix = 'fusion-viewer:measurements:v1:';
export function distanceMM(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000;
}
export function isWorldVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}
export function parseMeasurements(raw: string | null, modelKey: string): Measurement[] {
  try {
    const data = JSON.parse(raw || 'null');
    if (data?.version !== 1 || data.modelKey !== modelKey || !Array.isArray(data.items) || data.items.length > 500) return [];
    const point = (p: Point) => p && typeof p.snapped === 'boolean' && Array.isArray(p.position) && p.position.length === 3 && p.position.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e9);
    const ids = new Set<number>();
    return data.items.filter((item: Measurement) => {
      if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id) || !point(item.a) || !point(item.b) || distanceMM(item.a.position, item.b.position) < 1e-6) return false;
      ids.add(item.id); return true;
    });
  } catch { return []; }
}
const format = (item: Measurement) => `${distanceMM(item.a.position, item.b.position).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} mm`;

export function mountMeasurements({ scene, model, modelKey, panel }: {
  scene: ModelScene; model: LoadedModel; modelKey: string; panel: HTMLElement;
}): { dispose(): void; clear(): void } {
  const canvas = scene.renderer.domElement;
  const viewport = canvas.parentElement!;
  let items = sessions.get(modelKey) ?? [];
  let storageAvailable = true;
  if (!sessions.has(modelKey)) {
    try { items = parseMeasurements(localStorage.getItem(prefix + modelKey), modelKey); }
    catch { storageAvailable = false; }
  }
  let measuring = false;
  let visible = true;
  let pending: Point | undefined;
  let disposed = false;
  let nextId = Math.max(0, ...items.map(item => item.id)) + 1;
  const group = new Group(); group.name = '距離計測'; scene.scene.add(group);
  const overlay = document.createElement('div'); overlay.className = 'measurement-overlay'; overlay.setAttribute('aria-hidden', 'true'); viewport.append(overlay);
  panel.innerHTML = `<div class="measurement-heading"><h2>距離を計測</h2><button type="button" class="measurement-toggle" aria-pressed="false">計測を開始</button></div>
    <p class="measurement-help">モデル上の2点を選ぶと、3D空間の距離を表示します。ドラッグで回転できます。</p>
    <label class="measurement-snap"><input type="checkbox" checked> 頂点にスナップ</label>
    <p class="measurement-status" role="status" aria-live="polite"></p>
    <div class="measurement-actions"><button type="button" class="measurement-cancel">選択を取消</button><button type="button" class="measurement-visibility" aria-pressed="true">注釈を隠す</button><button type="button" class="measurement-clear">すべて削除</button></div>
    <ol class="measurement-list"></ol><p class="measurement-storage">このブラウザだけに保存されます。</p>`;
  const toggle = panel.querySelector<HTMLButtonElement>('.measurement-toggle')!;
  const snap = panel.querySelector<HTMLInputElement>('input')!;
  const status = panel.querySelector<HTMLElement>('.measurement-status')!;
  const cancel = panel.querySelector<HTMLButtonElement>('.measurement-cancel')!;
  const visibility = panel.querySelector<HTMLButtonElement>('.measurement-visibility')!;
  const clearButton = panel.querySelector<HTMLButtonElement>('.measurement-clear')!;
  const list = panel.querySelector<HTMLOListElement>('.measurement-list')!;
  const storage = panel.querySelector<HTMLElement>('.measurement-storage')!;
  const geometries: BufferGeometry[] = [];
  const materials: (MeshBasicMaterial | LineBasicMaterial)[] = [];
  let labels: { element: HTMLElement; position: Vector3 }[] = [];
  let markers: Mesh[] = [];
  const cleanupGraphics = () => {
    group.clear(); geometries.splice(0).forEach(g => g.dispose()); materials.splice(0).forEach(m => m.dispose());
    overlay.replaceChildren(); labels = []; markers = [];
  };
  function project() {
    if (disposed) return;
    scene.camera.updateMatrixWorld();
    const rect = canvas.getBoundingClientRect();
    const parentRect = viewport.getBoundingClientRect();
    labels.forEach(({ element, position }) => {
      const projected = position.clone().project(scene.camera);
      element.hidden = !visible || projected.z < -1 || projected.z > 1;
      element.style.transform = `translate(${rect.left - parentRect.left + (projected.x + 1) * rect.width / 2}px, ${rect.top - parentRect.top + (1 - projected.y) * rect.height / 2}px) translate(-50%, -120%)`;
    });
    markers.forEach(marker => {
      const distance = marker.position.distanceTo(scene.camera.position);
      marker.scale.setScalar(Math.max(1e-8, distance * 2 * Math.tan(scene.camera.fov * Math.PI / 360) / Math.max(rect.height, 1) * 4));
    });
  }
  function marker(point: Point) {
    const geometry = new SphereGeometry(1, 12, 8); geometries.push(geometry);
    const material = new MeshBasicMaterial({ color: point.snapped ? 0xb66330 : 0x227e75, depthTest: false }); materials.push(material);
    const mesh = new Mesh(geometry, material); mesh.position.fromArray(point.position); mesh.renderOrder = 1000; group.add(mesh); markers.push(mesh);
  }
  function label(position: Vector3, text: string, isPending = false) {
    const element = document.createElement('span'); element.className = `measurement-label${isPending ? ' is-pending' : ''}`; element.textContent = text; overlay.append(element); labels.push({ element, position });
  }
  function draw() {
    cleanupGraphics();
    items.forEach(item => {
      marker(item.a); marker(item.b);
      const a = new Vector3().fromArray(item.a.position), b = new Vector3().fromArray(item.b.position);
      const geometry = new BufferGeometry().setFromPoints([a, b]); geometries.push(geometry);
      const material = new LineBasicMaterial({ color: 0xb66330, depthTest: false }); materials.push(material);
      const line = new Line(geometry, material); line.renderOrder = 999; group.add(line);
      label(a.add(b).multiplyScalar(0.5), `M${item.id} · ${format(item)}`);
    });
    if (pending) { marker(pending); label(new Vector3().fromArray(pending.position), `始点 · ${pending.snapped ? '頂点' : '面上'}`, true); }
    group.visible = visible; project(); scene.requestRender();
  }
  function update(message?: string) {
    toggle.textContent = measuring ? '計測を終了' : '計測を開始'; toggle.setAttribute('aria-pressed', String(measuring));
    canvas.classList.toggle('is-measuring', measuring);
    status.textContent = message ?? (measuring ? pending ? '2点目を選択してください。Escで取消。' : '1点目を選択してください。' : '計測を開始して2点を選択。');
    cancel.disabled = !pending; visibility.disabled = items.length === 0 && !pending; clearButton.disabled = items.length === 0 && !pending;
    visibility.textContent = visible ? '注釈を隠す' : '注釈を表示'; visibility.setAttribute('aria-pressed', String(visible));
    storage.textContent = storageAvailable ? 'このブラウザだけに保存されます。' : '保存を利用できません。このセッション中のみ保持します。';
    list.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('li');
      const text = document.createElement('span'); text.textContent = `M${item.id} · ${format(item)}`;
      const details = document.createElement('small'); details.textContent = `${item.a.snapped ? '頂点' : '面上'} → ${item.b.snapped ? '頂点' : '面上'}`; text.append(details);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.setAttribute('aria-label', `計測 M${item.id} を削除`);
      remove.onclick = () => { items = items.filter(entry => entry.id !== item.id); save(); draw(); update(); };
      row.append(text, remove); list.append(row);
    });
  }
  function save() {
    sessions.set(modelKey, items);
    try { localStorage.setItem(prefix + modelKey, JSON.stringify({ version: 1, modelKey, items })); }
    catch { storageAvailable = false; }
  }
  function cancelPending() { pending = undefined; draw(); update(); }
  function clear() { items = []; pending = undefined; nextId = 1; save(); draw(); update(); }
  toggle.onclick = () => { measuring = !measuring; pending = undefined; if (measuring) visible = true; draw(); update(); };
  cancel.onclick = cancelPending; clearButton.onclick = clear;
  visibility.onclick = () => { visible = !visible; draw(); update(); };
  const raycaster = new Raycaster();
  function pointFromHit(hit: Intersection, x: number, y: number): Point {
    let position = hit.point.clone(), snapped = false;
    if (snap.checked && hit.face && hit.object instanceof Mesh) {
      const positions = hit.object.geometry.getAttribute('position');
      const rect = canvas.getBoundingClientRect(); let nearest = 22;
      for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
        const vertex = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(hit.object.matrixWorld);
        const p = vertex.clone().project(scene.camera);
        const distance = Math.hypot(rect.left + (p.x + 1) * rect.width / 2 - x, rect.top + (1 - p.y) * rect.height / 2 - y);
        if (p.z >= -1 && p.z <= 1 && distance < nearest) { nearest = distance; position = vertex; snapped = true; }
      }
    }
    return { position: position.toArray(), snapped };
  }
  function choose(x: number, y: number) {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    scene.camera.updateMatrixWorld(); model.object.updateMatrixWorld(true);
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), scene.camera);
    const meshes = model.bodies.flatMap(body => body.meshes).filter(isWorldVisible);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { update('モデル上の点を選択してください。'); return; }
    const point = pointFromHit(hit, x, y);
    if (!pending) pending = point;
    else {
      if (distanceMM(pending.position, point.position) < 1e-6) { update('始点と異なる点を選択してください。'); return; }
      if (items.length >= 500) { update('計測は500件までです。不要な計測を削除してください。'); return; }
      items = [...items, { id: nextId++, a: pending, b: point }]; pending = undefined; save();
    }
    visible = true; draw(); update();
  }
  const pointers = new Map<number, { x: number; y: number; time: number; moved: boolean; blocked: boolean }>();
  const down = (event: PointerEvent) => {
    if (!measuring || event.button !== 0) return;
    if (pointers.size || !event.isPrimary) pointers.forEach(p => { p.blocked = true; });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now(), moved: false, blocked: pointers.size > 0 || !event.isPrimary });
  };
  const move = (event: PointerEvent) => {
    const p = pointers.get(event.pointerId); if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6) p.moved = true;
  };
  const up = (event: PointerEvent) => {
    const p = pointers.get(event.pointerId); pointers.delete(event.pointerId);
    if (measuring && p && !p.blocked && !p.moved && performance.now() - p.time < 800 && Math.hypot(event.clientX - p.x, event.clientY - p.y) <= 6) choose(event.clientX, event.clientY);
  };
  const abort = (event: PointerEvent) => { pointers.delete(event.pointerId); };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && pending) cancelPending(); };
  canvas.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', abort); window.addEventListener('keydown', keydown);
  scene.controls.addEventListener('change', project);
  const resize = new ResizeObserver(project); resize.observe(viewport);
  draw(); update();
  return { clear, dispose() {
    disposed = true; sessions.set(modelKey, items);
    canvas.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', abort); window.removeEventListener('keydown', keydown);
    scene.controls.removeEventListener('change', project); resize.disconnect();
    cleanupGraphics(); scene.scene.remove(group); overlay.remove(); panel.replaceChildren(); canvas.classList.remove('is-measuring');
  } };
}
