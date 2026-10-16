import type { ViewerConfig } from './config';
import type { Body } from './model-loader';
import type { Appearance } from './appearance';

interface Context {
  modelId: string;
  config: ViewerConfig;
  bodies: Body[];
  appearance: Appearance;
  focusBody?: (body: Body) => void;
  invalidate: () => void;
  notify: (message: string) => void;
}

export async function mountEditor({ modelId, config, bodies, appearance, focusBody, invalidate, notify }: Context): Promise<void> {
  const info = await fetch(`/__admin/config?model=${encodeURIComponent(modelId)}`, { cache: 'no-store' });
  if (!info.ok) throw new Error('管理画面を開けません。npm run dev:admin で起動してください。');
  const initial = await info.json() as { config: ViewerConfig; revision: string };
  let revision = initial.revision;
  const baseRevision = revision;
  let syncing = false;
  let syncMessage = '';
  let saved = { ...initial.config.colors };
  let draft = { ...saved };
  let saving = false;
  const dirty = () => JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const openButton = document.createElement('button');
  openButton.className = 'button admin-open'; openButton.type = 'button'; openButton.textContent = '色を編集（開発者用）';
  document.querySelector('.page-heading')!.append(openButton);
  const panel = document.createElement('section'); panel.className = 'local-editor'; panel.hidden = true;
  panel.setAttribute('aria-label', '開発者用の色編集');
  panel.innerHTML = '<div class="editor-heading"><span class="editor-badge">LOCAL ADMIN</span><h2>ボディの色</h2><button type="button" class="editor-close" aria-label="色編集を閉じる">×</button></div><p>このPCでプレビューし、保存すると3MF本体に色を記録します。GitHubへの同期は別の操作です。</p><div class="editor-bodies"></div><p class="editor-state" role="status"></p><div class="editor-actions"><button type="button" data-action="revert">変更を取り消す</button><button type="button" data-action="save" class="save-colors">設定を保存</button></div><p class="editor-sync-state" role="status"></p><button type="button" data-action="sync">GitHubへ同期</button><button type="button" data-action="export" class="editor-export">設定ファイルをダウンロード</button>';
  document.querySelector('.inspection-panel')!.prepend(panel);
  const state = panel.querySelector<HTMLElement>('.editor-state')!;
  const save = panel.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const revert = panel.querySelector<HTMLButtonElement>('[data-action="revert"]')!;
  const sync = panel.querySelector<HTMLButtonElement>('[data-action="sync"]')!;
  const syncState = panel.querySelector<HTMLElement>('.editor-sync-state')!;
  const pickers = new Map<string, HTMLInputElement>();
  const resetButtons = new Map<string, HTMLButtonElement>();
  const refresh = () => {
    save.disabled = saving || syncing || !dirty(); revert.disabled = saving || syncing || !dirty();
    sync.disabled = saving || syncing || dirty();
    syncState.textContent = syncing ? 'GitHubへ同期しています…' : syncMessage;
    state.textContent = saving ? '保存しています…' : dirty() ? '未保存の変更があります' : '保存済みの設定を表示中';
    for (const body of bodies) {
      pickers.get(body.id)!.value = appearance.swatch(body);
      resetButtons.get(body.id)!.disabled = !draft[body.id];
    }
    invalidate();
  };
  const duplicateNames = new Map<string, number>();
  bodies.forEach(body => duplicateNames.set(body.name, (duplicateNames.get(body.name) || 0) + 1));
  for (const [index, body] of bodies.entries()) {
    const displayName = duplicateNames.get(body.name)! > 1 ? `${body.name} · ${String(index + 1).padStart(2, '0')}` : body.name;
    const row = document.createElement('div'); row.className = 'editor-row';
    const label = document.createElement('label'); label.textContent = displayName;
    const picker = document.createElement('input'); picker.type = 'color'; picker.value = appearance.swatch(body); picker.setAttribute('aria-label', `${displayName}の色`);
    label.append(picker); pickers.set(body.id, picker);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '読込時の色'; resetButtons.set(body.id, reset);
    picker.addEventListener('input', () => { draft[body.id] = picker.value; appearance.set(body, picker.value); refresh(); });
    reset.onclick = () => { delete draft[body.id]; appearance.set(body); refresh(); };
    const presets = document.createElement('div'); presets.className = 'color-presets';
    for (const [name, color] of [['セージ', '#78957d'], ['アイボリー', '#e7dec8'], ['テラコッタ', '#b76951'], ['ブルー', '#658ba0'], ['黒', '#202622']]) {
      const button = document.createElement('button'); button.type = 'button'; button.style.background = color; button.title = name; button.setAttribute('aria-label', `${displayName}を${name}にする`);
      button.onclick = () => { draft[body.id] = color; appearance.set(body, color); refresh(); };
      presets.append(button);
    }
    const focus = document.createElement('button'); focus.type = 'button'; focus.textContent = '注目';
    focus.setAttribute('aria-label', `${displayName}に注目`); focus.disabled = !focusBody;
    focus.onclick = () => focusBody?.(body);
    row.append(label, reset, focus, presets); panel.querySelector('.editor-bodies')!.append(row);
  }
  openButton.onclick = () => { panel.hidden = !panel.hidden; openButton.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  openButton.setAttribute('aria-expanded', 'false');
  panel.querySelector<HTMLButtonElement>('.editor-close')!.onclick = () => { panel.hidden = true; openButton.setAttribute('aria-expanded', 'false'); };
  revert.onclick = () => { draft = { ...saved }; appearance.apply(draft); refresh(); };
  save.onclick = async () => {
    if (saving || syncing || !dirty()) return;
    saving = true; refresh();
    const savingColors = { ...draft };
    let failure: string | undefined;
    try {
      const response = await fetch('/__admin/colors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, colors: savingColors, revision, baseRevision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存に失敗しました。');
      revision = result.revision; saved = savingColors;
      config.colors = { ...saved }; config.updatedAt = result.config.updatedAt;
      document.getElementById('updated-at')!.textContent = config.updatedAt.replaceAll('-', '.');
      syncMessage = 'このPCの3MFに保存済み。GitHubへの同期は未実行です。';
      notify('3MFに色を保存しました。');
    } catch (error) {
      failure = error instanceof Error ? error.message : '保存に失敗しました。';
    } finally {
      saving = false; refresh();
      if (failure) state.textContent = failure;
    }
  };
  sync.onclick = async () => {
    if (saving || syncing || dirty()) return;
    syncing = true; refresh();
    try {
      const response = await fetch('/__admin/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId, revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '同期に失敗しました。');
      syncMessage = 'GitHubへ同期しました。公開処理の完了後に反映されます。';
    } catch (error) { syncMessage = error instanceof Error ? error.message : '同期に失敗しました。'; }
    finally { syncing = false; refresh(); }
  };
  panel.querySelector<HTMLButtonElement>('[data-action="export"]')!.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...config, colors: draft }, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'viewer.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault(); });
  refresh();
}
