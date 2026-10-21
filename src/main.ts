import { Box3 } from 'three';
import { mountShell } from './shell';
import { fetchCatalog, fetchConfig } from './config';
import { loadModel } from './model-loader';
import { Appearance } from './appearance';
import { ModelScene, type View } from './scene';
import { mountDrawings } from './drawings';
import { mountMeasurements } from './measurements';
import { mountGroups } from './groups';
import { createBodyThumbnails } from './body-thumbnails';
import { attachBodyPicker, createBodySelection } from './body-selection';
import { fetchModelMetadata } from './model-metadata';
import './style.css';

mountShell(document.querySelector<HTMLElement>('#app')!);
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const activeView = (view?: string) => viewButtons.forEach(button => {
  const active = button.dataset.view === view;
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
});

function showError(message: string): void {
  el('loading').hidden = true;
  const panel = el('error');
  panel.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'モデルを表示できませんでした';
  const detail = document.createElement('p'); detail.textContent = message;
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再読み込み'; retry.onclick = () => location.reload();
  panel.append(heading, detail, retry); panel.hidden = false;
  el('status').textContent = '読み込みを確認してください';
  el('viewport').dataset.ready = 'error';
  viewButtons.forEach(button => { button.disabled = true; });
  el<HTMLButtonElement>('fit').disabled = true;
}

function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const message = document.createElement('div'); message.className = 'toast'; message.setAttribute('role', 'status'); message.textContent = text;
  document.body.append(message); window.setTimeout(() => message.remove(), 3500);
}

el<HTMLButtonElement>('share').onclick = async () => {
  const shared = import.meta.env.DEV && __LOCAL_ADMIN__
    ? new URL('https://kenken49-2401.github.io/fusion-visualizer1/')
    : new URL(import.meta.env.BASE_URL, location.origin);
  const selected = el<HTMLSelectElement>('model-select').value;
  if (selected) shared.searchParams.set('model', selected);
  const url = shared.href;
  try {
    if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) await navigator.share({ title: document.title, url });
    else { await navigator.clipboard.writeText(url); toast('共有リンクをコピーしました'); }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const dialog = document.createElement('dialog');
    const label = document.createElement('label'); label.textContent = 'このリンクをコピーして共有できます';
    const input = document.createElement('input'); input.value = url; input.readOnly = true; input.style.cssText = 'display:block;width:100%;margin-top:16px;padding:12px';
    const close = document.createElement('button'); close.textContent = '閉じる'; close.onclick = () => dialog.close();
    dialog.append(label, input, close); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal(); input.select();
  }
};

async function start(): Promise<void> {
  const catalog = await fetchCatalog();
  const requested = new URLSearchParams(location.search).get('model');
  const entry = catalog.find(model => model.id === requested) ?? catalog[0];
  const selector = el<HTMLSelectElement>('model-select');
  selector.replaceChildren(...catalog.map(model => new Option(model.title, model.id)));
  selector.value = entry.id; selector.disabled = false;
  selector.onchange = () => {
    const url = new URL(location.href); url.searchParams.set('model', selector.value);
    location.assign(url.href);
  };
  if (requested && requested !== entry.id) toast('指定のモデルが見つからないため、最初のモデルを表示します。');
  const config = await fetchConfig(entry.config);
  el('model-name').textContent = config.title;
  document.title = `${config.title} — Fusion Visualizer`;
  el('viewport').setAttribute('aria-label', `${config.title}の3Dモデル。ドラッグで回転、ピンチで拡大縮小。`);
  const filename = document.querySelector('.file-name'); if (filename) filename.textContent = `${config.title}.3mf`;
  document.querySelector('.page-description')!.textContent = config.description;
  el('updated-at').textContent = config.updatedAt.replaceAll('-', '.');
  const scene = new ModelScene(el('viewport'));
  el('viewport').addEventListener('viewer-error', event => showError((event as CustomEvent<string>).detail));
  let loaded;
  try { loaded = await loadModel(config); } catch (error) { scene.dispose(); throw error; }
  const appearance = new Appearance(loaded.bodies);
  appearance.apply(config.colors);
  scene.setModel(loaded);
  const uploadInfo = document.createElement('p'); uploadInfo.id = 'model-uploaded'; uploadInfo.className = 'model-uploaded'; uploadInfo.textContent = '3MF最終アップロード：確認中';
  document.querySelector('.model-section')!.append(uploadInfo);
  void fetchModelMetadata(config.model, loaded.fingerprint, 'https://kenken49-2401.github.io/fusion-visualizer1/model-metadata.json').then(metadata => {
    uploadInfo.dataset.status = metadata.status; uploadInfo.replaceChildren(document.createTextNode('3MF最終アップロード：'));
    if (metadata.status === 'known' && metadata.uploadedAt) {
      const time = document.createElement('time'); time.dateTime = metadata.uploadedAt;
      time.textContent = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(metadata.uploadedAt)) + '（日本時間）'; uploadInfo.append(time);
    } else uploadInfo.append(document.createTextNode(metadata.status === 'local-change' ? '公開版と異なる3MF（日時は未確認）' : '記録なし'));
  });
  const selection = createBodySelection(scene.scene, loaded.bodies, () => scene.requestRender());
  const format = (n: number) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(Math.abs(n) < 0.0001 ? 0 : n);
  el('model-unit').textContent = `mm${loaded.sourceUnit === 'millimeter' ? '' : '（元データから換算）'}`;
  el('model-body-count').textContent = `${loaded.bodies.length} ボディ`;
  el('model-size').textContent = `${format(loaded.sizeMM.x)} × ${format(loaded.sizeMM.z)} × ${format(loaded.sizeMM.y)} mm`;
  el<HTMLAnchorElement>('download-model').href = `${import.meta.env.BASE_URL}${config.model}`;
  el<HTMLAnchorElement>('download-model').download = `${config.title}.3mf`;
  const swatches = new Map<string, HTMLElement>();
  const setStatus = () => {
    const visible = loaded.bodies.filter(body => body.object.visible).length;
    el('status').textContent = `${visible} / ${loaded.bodies.length} ボディ表示 · ${loaded.triangles.toLocaleString('ja-JP')} ポリゴン`;
  };
  const duplicateNames = new Map<string, number>();
  const selectionTools = document.createElement('div'); selectionTools.className = 'body-selection-tools';
  const selectionLabel = document.createElement('span'); selectionLabel.textContent = '画像・名前をタップして部品を強調'; selectionLabel.setAttribute('role', 'status');
  const clearSelection = document.createElement('button'); clearSelection.type = 'button'; clearSelection.textContent = '選択を解除'; clearSelection.disabled = true;
  selectionTools.append(selectionLabel, clearSelection); el('body-list').before(selectionTools);
  const rows = new Map<string, HTMLElement>();
  const selectBody = (id?: string) => {
    selection.select(id);
    const body = loaded.bodies.find(item => item.id === selection.selectedId);
    for (const [bodyId, row] of rows) {
      const selected = bodyId === selection.selectedId;
      row.classList.toggle('is-selected', selected);
      row.querySelector('.body-select')!.setAttribute('aria-pressed', String(selected));
      if (selected) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
    clearSelection.disabled = !body;
    selectionLabel.textContent = body ? `${body.name}を強調表示${body.object.visible ? '' : '（非表示中）'}` : '画像・名前をタップして部品を強調';
    if (body) el('viewport').dataset.selectedBody = body.id; else delete el('viewport').dataset.selectedBody;
  };
  clearSelection.onclick = () => selectBody();
  const groups = mountGroups(el('body-list').closest('section')!, loaded.bodies, () => {
    for (const body of loaded.bodies) {
      const row = [...el('body-list').querySelectorAll<HTMLElement>('[data-body-id]')].find(node => node.dataset.bodyId === body.id);
      row?.classList.toggle('is-hidden', !body.object.visible);
      row?.querySelector('.body-toggle')?.setAttribute('aria-pressed', String(body.object.visible));
    }
    if (selection.selectedId && !loaded.bodies.find(body => body.id === selection.selectedId)?.object.visible) selectBody(); else selection.refresh();
    setStatus(); scene.requestRender();
  }, members => {
    const bounds = new Box3(); members.forEach(body => bounds.union(new Box3().setFromObject(body.object)));
    activeView(); scene.focus(bounds);
    el('viewport').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  groups.setGroups(config.groups ?? []);
  loaded.bodies.forEach(body => duplicateNames.set(body.name, (duplicateNames.get(body.name) || 0) + 1));
  for (const [index, body] of loaded.bodies.entries()) {
    const row = document.createElement('li'); row.className = 'body-row'; row.dataset.bodyId = body.id;
    const swatch = document.createElement('span'); swatch.className = 'body-swatch'; swatch.style.backgroundColor = appearance.swatch(body); swatches.set(body.id, swatch);
    const displayName = duplicateNames.get(body.name)! > 1 ? `${body.name} · ${String(index + 1).padStart(2, '0')}` : body.name;
    const name = document.createElement('span'); name.className = 'body-name'; name.textContent = displayName; name.title = `${displayName} (${body.id})`;
    const select = document.createElement('button'); select.type = 'button'; select.className = 'body-select'; select.setAttribute('aria-label', `${displayName}を選択`); select.setAttribute('aria-pressed', 'false');
    const thumbnail = document.createElement('span'); thumbnail.className = 'body-thumbnail'; thumbnail.dataset.bodyId = body.id; thumbnail.textContent = '準備中';
    select.append(thumbnail, name);
    const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'body-focus'; focus.textContent = '⌖'; focus.setAttribute('aria-label', `${displayName}に注目`);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'body-toggle'; toggle.setAttribute('aria-pressed', 'true'); toggle.setAttribute('aria-label', `${displayName}を表示`);
    toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    toggle.onclick = () => {
      body.object.visible = !body.object.visible;
      row.classList.toggle('is-hidden', !body.object.visible); toggle.setAttribute('aria-pressed', String(body.object.visible));
      if (!body.object.visible && selection.selectedId === body.id) selectBody(); else selection.refresh();
      setStatus(); groups.update(); scene.requestRender();
    };
    select.onclick = () => {
      if (!body.object.visible) toggle.click();
      selectBody(body.id);
      el('viewport').scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    focus.onclick = () => {
      if (!body.object.visible) toggle.click();
      activeView(); scene.focus(new Box3().setFromObject(body.object));
    };
    row.append(select, swatch, focus, toggle); el('body-list').append(row); rows.set(body.id, row);
  }
  // PNG images share a single temporary context; they do not add a canvas per row.
  let disposed = false;
  void createBodyThumbnails(loaded.bodies).then(images => {
    if (disposed) return;
    for (const body of loaded.bodies) {
      const target = rows.get(body.id)!.querySelector<HTMLElement>('.body-thumbnail')!;
      const source = images.get(body.id);
      if (!source) { target.textContent = '画像なし'; continue; }
      const image = document.createElement('img'); image.src = source; image.alt = `${body.name}の単体3Dプレビュー`; image.width = 128; image.height = 128; image.draggable = false;
      target.replaceChildren(image);
    }
    el('body-list').dataset.thumbnailsReady = 'true';
  }).catch(() => {
    if (disposed) return;
    rows.forEach(row => { row.querySelector('.body-thumbnail')!.textContent = '画像なし'; });
    el('body-list').dataset.thumbnailsReady = 'unavailable';
  });
  viewButtons.forEach(button => { button.onclick = () => { const view = button.dataset.view as View; activeView(view); scene.setView(view); }; });
  scene.onCameraChange = () => activeView();
  el<HTMLButtonElement>('fit').onclick = () => scene.fitAll();
  el<HTMLInputElement>('show-grid').onchange = event => scene.setGrid((event.target as HTMLInputElement).checked);
  el('loading').hidden = true; setStatus();
  el('viewport').dataset.ready = 'true';
  el('viewport').dataset.triangles = String(loaded.triangles);
  el('viewport').dataset.modelId = entry.id;
  const closeDrawings = mountDrawings({ model: loaded, title: config.title, trigger: el<HTMLButtonElement>('open-drawings') });
  el<HTMLButtonElement>('open-drawings').disabled = false;
  const measurements = mountMeasurements({ scene, model: loaded, modelKey: `${entry.id}:${loaded.fingerprint}:${config.upAxis}:${config.frontAxis}`, panel: el('measurement-panel') });
  const measurementToggle = el('measurement-panel').querySelector<HTMLButtonElement>('.measurement-toggle')!;
  const stopBodyPicker = attachBodyPicker({ element: scene.renderer.domElement, camera: scene.camera, bodies: loaded.bodies, onSelect: selectBody, isEnabled: () => measurementToggle.getAttribute('aria-pressed') !== 'true' });
  const shortcut = el<HTMLButtonElement>('measurement-shortcut');
  shortcut.disabled = false;
  shortcut.onclick = () => measurementToggle.click();
  measurementToggle.addEventListener('click', () => {
    const active = measurementToggle.getAttribute('aria-pressed') === 'true';
    shortcut.setAttribute('aria-pressed', String(active));
    shortcut.textContent = active ? '計測を終了' : '2点間を測る';
    if (active) el('viewport').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  el<HTMLButtonElement>('drawing-shortcut').disabled = false;
  el<HTMLButtonElement>('drawing-shortcut').onclick = () => el<HTMLButtonElement>('open-drawings').click();
  // The editor and its save API exist only on the loopback development server in explicit admin mode.
  if (import.meta.env.DEV && __LOCAL_ADMIN__) {
    const { mountEditor } = await import('./admin');
    mountEditor({ modelId: entry.id, config, bodies: loaded.bodies, appearance, groupsChanged: groups.setGroups,
    focusBody: body => {
      if (!body.object.visible) el('body-list').querySelector<HTMLButtonElement>(`[data-body-id="${body.id}"] .body-toggle`)?.click();
      activeView(); scene.focus(new Box3().setFromObject(body.object));
      el('viewport').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, invalidate: () => {
      for (const body of loaded.bodies) swatches.get(body.id)!.style.backgroundColor = appearance.swatch(body);
      scene.requestRender();
    }, notify: toast });
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; stopBodyPicker(); selection.dispose(); closeDrawings(); measurements.dispose(); scene.dispose(); } });
}

start().catch(error => {
  console.error(error);
  showError(error instanceof Error ? error.message : '端末のWebGL対応とネットワーク接続を確認してください。');
});
