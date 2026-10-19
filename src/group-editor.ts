import { validateGroups, type BodyGroup } from './config';
import type { Body } from './model-loader';

const clone = (groups: BodyGroup[]) => groups.map(group => ({ ...group, bodyIds: [...group.bodyIds] }));
export function mountGroupEditor(container: HTMLElement, bodies: Body[], initial: BodyGroup[], changed: () => void, applyColor: (ids: string[], color: string) => void) {
  let groups = clone(initial);
  let editing: string | undefined;
  let pending = false;
  const section = document.createElement('section'); section.className = 'group-editor';
  section.innerHTML = '<h3>ボディのグループ</h3><p>ボディを選んで名前を付けます。1つのボディは1つのグループに所属できます。グループは形状を結合しません。</p><div class="editor-group-list"></div><form class="group-form"><label>グループ名<input type="text" maxlength="160" autocomplete="off" aria-label="グループ名"></label><fieldset><legend>所属するボディ</legend><div class="group-member-list"></div></fieldset><p class="group-form-error" role="status"></p><div class="group-form-actions"><button type="submit">グループを作成</button><button type="button" class="group-cancel">選択を解除</button></div></form>';
  container.append(section);
  const form = section.querySelector<HTMLFormElement>('form')!;
  const name = form.querySelector<HTMLInputElement>('input')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const message = form.querySelector<HTMLElement>('.group-form-error')!;
  const choices = new Map<string, HTMLInputElement>();
  const duplicates = new Map<string, number>();
  bodies.forEach(body => duplicates.set(body.name, (duplicates.get(body.name) || 0) + 1));
  bodies.forEach((body, index) => {
    const label = document.createElement('label'); label.className = 'group-member';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = body.id; input.dataset.bodyId = body.id;
    const text = document.createElement('span'); text.textContent = duplicates.get(body.name)! > 1 ? `${body.name} · ${String(index + 1).padStart(2, '0')}` : body.name;
    label.append(input, text); form.querySelector('.group-member-list')!.append(label); choices.set(body.id, input);
    input.onchange = () => { pending = true; message.textContent = ''; changed(); };
  });
  name.oninput = () => { pending = true; message.textContent = ''; changed(); };
  function resetForm() {
    editing = undefined; pending = false; name.value = ''; submit.textContent = 'グループを作成'; message.textContent = '';
    choices.forEach(input => { input.checked = false; input.disabled = false; });
    availability();
  }
  function availability() {
    choices.forEach((input, bodyId) => {
      const owner = groups.find(group => group.bodyIds.includes(bodyId));
      input.disabled = Boolean(owner && owner.id !== editing);
      input.closest('label')!.title = owner && owner.id !== editing ? `${owner.name}に所属しています。先に所属先のグループを編集してください。` : bodyId;
      if (input.disabled) input.checked = false;
    });
  }
  function render() {
    const list = section.querySelector<HTMLElement>('.editor-group-list')!; list.replaceChildren();
    for (const group of groups) {
      const row = document.createElement('div'); row.className = 'editor-group'; row.dataset.groupId = group.id;
      const title = document.createElement('strong'); title.textContent = `${group.name}（${group.bodyIds.length} ボディ）`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編集'; edit.setAttribute('aria-label', `${group.name}を編集`);
      edit.onclick = () => {
        if (pending) { message.textContent = '編集中のグループを作成・更新するか、選択を解除してください。'; return; }
        editing = group.id; pending = false; name.value = group.name; submit.textContent = 'グループを更新'; message.textContent = '';
        choices.forEach((input, id) => { input.checked = group.bodyIds.includes(id); }); availability(); changed(); name.focus();
      };
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.setAttribute('aria-label', `${group.name}を削除`);
      remove.onclick = () => {
        if (pending) { message.textContent = '編集中のグループを作成・更新するか、選択を解除してください。'; return; }
        groups = groups.filter(item => item.id !== group.id); if (editing === group.id) resetForm(); render(); changed();
      };
      const color = document.createElement('input'); color.type = 'color'; color.value = '#78957d'; color.setAttribute('aria-label', `${group.name}の一括適用色`);
      const paint = document.createElement('button'); paint.type = 'button'; paint.textContent = '色を一括適用'; paint.setAttribute('aria-label', `${group.name}に色を一括適用`);
      paint.onclick = () => applyColor(group.bodyIds, color.value);
      row.append(title, edit, remove, color, paint); list.append(row);
    }
    if (!groups.length) { const empty = document.createElement('p'); empty.textContent = 'グループはまだありません。'; list.append(empty); }
    availability();
  }
  form.onsubmit = event => {
    event.preventDefault();
    const id = editing ?? `group-${crypto.randomUUID()}`;
    const next = { id, name: name.value, bodyIds: [...choices].filter(([, input]) => input.checked).map(([bodyId]) => bodyId) };
    try {
      groups = validateGroups(editing ? groups.map(group => group.id === editing ? next : group) : [...groups, next], bodies.map(body => body.id));
      resetForm(); render(); changed();
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'グループを確認してください。'; }
  };
  form.querySelector<HTMLButtonElement>('.group-cancel')!.onclick = () => { resetForm(); changed(); };
  resetForm(); render();
  return {
    groups: () => clone(groups), pending: () => pending,
    reset(next: BodyGroup[]) { groups = clone(next); resetForm(); render(); },
  };
}
