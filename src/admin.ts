import type { ViewerConfig } from './config';
import type { Body } from './model-loader';
import type { Appearance } from './appearance';

interface Context {
  config: ViewerConfig;
  bodies: Body[];
  appearance: Appearance;
  invalidate: () => void;
  notify: (message: string) => void;
}

export async function mountEditor({ config, bodies, appearance, invalidate, notify }: Context): Promise<void> {
  const info = await fetch('/__admin/config', { cache: 'no-store' });
  if (!info.ok) throw new Error('管理画面を開けません。npm run dev:admin で起動してください。');
  const initial = await info.json() as { config: ViewerConfig; revision: string };
  let revision = initial.revision;
  let saved = { ...initial.config.colors };
  let draft = { ...saved };
  let saving = false;
  const dirty = () => JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const openButton = document.createElement('button');
  openButton.className = 'button admin-open'; openButton.type = 'button'; openButton.textContent = '色を編集（開発者用）';
  document.querySelector('.page-heading')!.append(openButton);
  const panel = document.createElement('section'); panel.className = 'local-editor'; panel.hidden = true;
  panel.setAttribute('aria-label', '開発者用の色編集');
  panel.innerHTML = '<div class="editor-heading"><span class="editor-badge">LOCAL ADMIN</span><h2>ボディの色</h2><button type="button" class="editor-close" aria-label="色編集を閉じる">×</button></div><p>このPCでプレビューし、保存した設定をGitHub経由で公開します。</p><div class="editor-bodies"></div><p class="editor-state" role="status"></p><div class="editor-actions"><button type="button" data-action="revert">変更を取り消す</button><button type="button" data-action="save" class="save-colors">設定を保存</button></div><button type="button" data-action="export" class="editor-export">設定ファイルをダウンロード</button>';
  document.querySelector('.inspection-panel')!.prepend(panel);
  const state = panel.querySelector<HTMLElement>('.editor-state')!;
  const save = panel.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const revert = panel.querySelector<HTMLButtonElement>('[data-action="revert"]')!;
  const pickers = new Map<string, HTMLInputElement>();
  const resetButtons = new Map<string, HTMLButtonElement>();
  const refresh = () => {
    save.disabled = saving || !dirty(); revert.disabled = saving || !dirty();
    state.textContent = saving ? '保存しています…' : dirty() ? '未保存の変更があります' : '保存済みの設定を表示中';
    for (const body of bodies) {
      pickers.get(body.id)!.value = appearance.swatch(body);
      resetButtons.get(body.id)!.disabled = !draft[body.id];
    }
    invalidate();
  };
  for (const body of bodies) {
    const row = document.createElement('div'); row.className = 'editor-row';
    const label = document.createElement('label'); label.textContent = body.name;
    const picker = document.createElement('input'); picker.type = 'color'; picker.value = appearance.swatch(body); picker.setAttribute('aria-label', `${body.name}の色`);
    label.append(picker); pickers.set(body.id, picker);
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '元の色'; resetButtons.set(body.id, reset);
    picker.addEventListener('input', () => { draft[body.id] = picker.value; appearance.set(body, picker.value); refresh(); });
    reset.onclick = () => { delete draft[body.id]; appearance.set(body); refresh(); };
    const presets = document.createElement('div'); presets.className = 'color-presets';
    for (const [name, color] of [['セージ', '#78957d'], ['アイボリー', '#e7dec8'], ['テラコッタ', '#b76951'], ['ブルー', '#658ba0'], ['黒', '#202622']]) {
      const button = document.createElement('button'); button.type = 'button'; button.style.background = color; button.title = name; button.setAttribute('aria-label', `${body.name}を${name}にする`);
      button.onclick = () => { draft[body.id] = color; appearance.set(body, color); refresh(); };
      presets.append(button);
    }
    row.append(label, reset, presets); panel.querySelector('.editor-bodies')!.append(row);
  }
  openButton.onclick = () => { panel.hidden = !panel.hidden; openButton.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  openButton.setAttribute('aria-expanded', 'false');
  panel.querySelector<HTMLButtonElement>('.editor-close')!.onclick = () => { panel.hidden = true; openButton.setAttribute('aria-expanded', 'false'); };
  revert.onclick = () => { draft = { ...saved }; appearance.apply(draft); refresh(); };
  save.onclick = async () => {
    if (saving || !dirty()) return;
    saving = true; refresh();
    const savingColors = { ...draft };
    let failure: string | undefined;
    try {
      const response = await fetch('/__admin/colors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colors: savingColors, revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存に失敗しました。');
      revision = result.revision; saved = savingColors;
      config.colors = { ...saved }; config.updatedAt = result.config.updatedAt;
      document.getElementById('updated-at')!.textContent = config.updatedAt.replaceAll('-', '.');
      notify('色設定を保存しました。GitHubへの反映で公開されます。');
    } catch (error) {
      failure = error instanceof Error ? error.message : '保存に失敗しました。';
    } finally {
      saving = false; refresh();
      if (failure) state.textContent = failure;
    }
  };
  panel.querySelector<HTMLButtonElement>('[data-action="export"]')!.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...config, colors: draft }, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'viewer.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault(); });
  refresh();
}
