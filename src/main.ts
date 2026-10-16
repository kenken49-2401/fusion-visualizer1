import { Box3 } from 'three';
import { mountShell } from './shell';
import { fetchConfig } from './config';
import { loadModel } from './model-loader';
import { Appearance } from './appearance';
import { ModelScene, type View } from './scene';
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
  const url = new URL(import.meta.env.BASE_URL, location.origin).href;
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
  const config = await fetchConfig();
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
  for (const body of loaded.bodies) {
    const row = document.createElement('li'); row.className = 'body-row'; row.dataset.bodyId = body.id;
    const swatch = document.createElement('span'); swatch.className = 'body-swatch'; swatch.style.backgroundColor = appearance.swatch(body); swatches.set(body.id, swatch);
    const name = document.createElement('span'); name.className = 'body-name'; name.textContent = body.name; name.title = body.name;
    const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'body-focus'; focus.textContent = '⌖'; focus.setAttribute('aria-label', `${body.name}に注目`);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'body-toggle'; toggle.setAttribute('aria-pressed', 'true'); toggle.setAttribute('aria-label', `${body.name}を表示`);
    toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    toggle.onclick = () => {
      body.object.visible = !body.object.visible;
      row.classList.toggle('is-hidden', !body.object.visible); toggle.setAttribute('aria-pressed', String(body.object.visible));
      setStatus(); scene.requestRender();
    };
    focus.onclick = () => {
      if (!body.object.visible) toggle.click();
      activeView(); scene.focus(new Box3().setFromObject(body.object));
    };
    row.append(swatch, name, focus, toggle); el('body-list').append(row);
  }
  viewButtons.forEach(button => { button.onclick = () => { const view = button.dataset.view as View; activeView(view); scene.setView(view); }; });
  scene.onCameraChange = () => activeView();
  el<HTMLButtonElement>('fit').onclick = () => scene.fitAll();
  el<HTMLInputElement>('show-grid').onchange = event => scene.setGrid((event.target as HTMLInputElement).checked);
  el('loading').hidden = true; setStatus();
  el('viewport').dataset.ready = 'true';
  el('viewport').dataset.triangles = String(loaded.triangles);
  // The editor and its save API exist only on the loopback development server in explicit admin mode.
  if (import.meta.env.DEV && __LOCAL_ADMIN__) {
    const { mountEditor } = await import('./admin');
    mountEditor({ config, bodies: loaded.bodies, appearance, invalidate: () => {
      for (const body of loaded.bodies) swatches.get(body.id)!.style.backgroundColor = appearance.swatch(body);
      scene.requestRender();
    }, notify: toast });
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) scene.dispose(); });
}

start().catch(error => {
  console.error(error);
  showError(error instanceof Error ? error.message : '端末のWebGL対応とネットワーク接続を確認してください。');
});
