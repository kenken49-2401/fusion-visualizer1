import type { LoadedModel } from './model-loader';
import { groupStepBodies, newId, parseGroups, type Guide } from './schema';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
};
function action(host: HTMLElement, text: string, click: () => void) {
    const button = node('button', text); button.type = 'button'; button.onclick = click; host.append(button); return button;
}
function members(host: HTMLElement, model: LoadedModel, names: Map<string, string>, selected: Set<string>, ownership: (id: string) => string | undefined, labelFor: (name: string) => string, change: (id: string, checked: boolean) => void) {
    const list = node('div'); list.className = 'editor-body-list'; host.append(list);
    for (const body of model.bodies) {
        const owner = ownership(body.id), label = node('label'), check = node('input');
        check.type = 'checkbox'; check.value = body.id; check.checked = selected.has(body.id); check.disabled = owner !== undefined;
        check.setAttribute('aria-label', labelFor(names.get(body.id)!));
        check.onchange = () => change(body.id, check.checked);
        label.append(check, document.createTextNode(`${names.get(body.id)}${owner ? `（${owner}に所属）` : ''}`)); list.append(label);
    }
}

export function createGroupEditor({ getGuide, model, onChange, notify }: {
    getGuide: () => Guide;
    model: LoadedModel;
    onChange: (render: boolean) => void;
    notify: (message: string) => void;
}) {
    const duplicates = new Map<string, number>();
    model.bodies.forEach(body => duplicates.set(body.name, (duplicates.get(body.name) ?? 0) + 1));
    const names = new Map(model.bodies.map((body, index) => [body.id, duplicates.get(body.name)! > 1 ? `${body.name} · ${String(index + 1).padStart(2, '0')}` : body.name]));
    const knownBodies = model.bodies.map(body => body.id);
    let newName = '';
    const newMembers = new Set<string>();
    return { render(host: HTMLElement) {
        const guide = getGuide();
        host.classList.add('group-editor-section');
        host.append(node('p', '部品に名前付きのまとまりを作り、ステップへまとめて追加できます。グループを変更・削除しても、既に割り当てたステップは変わりません。1つの部品が属するグループは1つです。'));
        for (const [index, group] of guide.groups.entries()) {
            const row = node('fieldset'); row.dataset.groupId = group.id;
            row.append(node('legend', group.name)); host.append(row);
            const label = node('label', `グループ ${index + 1}の名前`), name = node('input');
            name.value = group.name; name.maxLength = 160; name.setAttribute('aria-label', `グループ ${index + 1}の名前`);
            const refreshName = () => {
                group.name = name.value; row.querySelector('legend')!.textContent = group.name;
                row.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(check => check.setAttribute('aria-label', `${names.get(check.value)}を${group.name}に含める`));
                remove.textContent = `グループ「${group.name}」を削除`; onChange(false);
            };
            name.oninput = refreshName;
            name.onchange = () => { name.value = name.value.trim(); refreshName(); };
            label.append(name); row.append(label);
            members(row, model, names, new Set(group.bodyIds), id => guide.groups.find(other => other.id !== group.id && other.bodyIds.includes(id))?.name, name => `${name}を${group.name}に含める`, (id, checked) => {
                if (!checked && group.bodyIds.length === 1) { notify('グループには1つ以上の部品が必要です。まとまりをなくす場合はグループを削除してください。'); onChange(true); return; }
                group.bodyIds = checked ? [...group.bodyIds, id] : group.bodyIds.filter(member => member !== id);
                newMembers.delete(id); onChange(true);
            });
            const remove = action(row, `グループ「${group.name}」を削除`, () => { guide.groups = guide.groups.filter(other => other.id !== group.id); onChange(true); });
        }
        const creation = node('fieldset'); creation.className = 'new-group-editor'; creation.append(node('legend', '新しいグループ')); host.append(creation);
        creation.append(node('p', '名前と部品を選んで「グループを作成」を押してください。作成後に「手順を保存」でファイルへ記録します。'));
        const label = node('label', '新しいグループの名前'), name = node('input');
        name.value = newName; name.maxLength = 160; name.setAttribute('aria-label', '新しいグループの名前'); label.append(name); creation.append(label);
        const owner = (id: string) => guide.groups.find(group => group.bodyIds.includes(id))?.name;
        for (const id of newMembers) if (owner(id) !== undefined || !knownBodies.includes(id)) newMembers.delete(id);
        members(creation, model, names, newMembers, owner, name => `${name}を新しいグループに含める`, (id, checked) => { if (checked) newMembers.add(id); else newMembers.delete(id); refreshCreation(); });
        const create = action(creation, 'グループを作成', () => {
            try { guide.groups = parseGroups([...guide.groups, { id: newId(), name: newName, bodyIds: [...newMembers] }], knownBodies); }
            catch (error) { notify(error instanceof Error ? error.message : 'グループを確認してください。'); return; }
            newName = ''; newMembers.clear(); onChange(true);
        });
        function refreshCreation() { create.disabled = !newName.trim() || newMembers.size === 0; }
        name.oninput = () => { newName = name.value; refreshCreation(); };
        refreshCreation();
    } };
}

export function renderGroupShortcuts(host: HTMLElement, guide: Guide, index: number, onChange: () => void, notify: (message: string) => void) {
    if (!guide.groups.length) return;
    const shortcuts = node('div'); shortcuts.className = 'step-group-shortcuts'; shortcuts.append(node('h4', 'グループからまとめて選ぶ')); host.append(shortcuts);
    const step = guide.steps[index];
    for (const group of guide.groups) {
        const row = node('div'); row.className = 'step-group-shortcut'; row.dataset.groupId = group.id;
        const added = groupStepBodies(guide, index, group.id, 'add'), removed = groupStepBodies(guide, index, group.id, 'remove');
        const addable = added.bodyIds.length - step.bodyIds.length, assigned = step.bodyIds.length - removed.bodyIds.length;
        row.append(node('strong', group.name), node('span', `このステップ ${assigned} / ${group.bodyIds.length} 部品${added.blockedBodyIds.length ? `・別ステップで割当済み ${added.blockedBodyIds.length} 部品` : ''}`));
        action(row, `${group.name}をこのステップに追加`, () => { const next = groupStepBodies(guide, index, group.id, 'add'), count = next.bodyIds.length - step.bodyIds.length; step.bodyIds = next.bodyIds; onChange(); notify(`${group.name}から${count}部品を追加しました。${next.blockedBodyIds.length ? '別ステップの割当は変更していません。' : ''}`); }).disabled = addable === 0;
        action(row, `${group.name}をこのステップから外す`, () => { step.bodyIds = groupStepBodies(guide, index, group.id, 'remove').bodyIds; onChange(); }).disabled = assigned === 0;
        shortcuts.append(row);
    }
}
