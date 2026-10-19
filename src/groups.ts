import type { BodyGroup } from './config';
import type { Body } from './model-loader';

/** Groups refer to existing body objects only; visibility never combines their geometry. */
export function mountGroups(container: HTMLElement, bodies: Body[], changed: () => void, focus: (members: Body[]) => void) {
  let groups: BodyGroup[] = [];
  const known = new Map(bodies.map(body => [body.id, body]));
  const section = document.createElement('section'); section.className = 'inspector-section public-groups'; section.hidden = true;
  section.setAttribute('aria-label', 'ボディのグループ');
  section.innerHTML = '<div class="section-kicker">BODY GROUPS</div><h2>グループ</h2><p class="section-description">まとめて表示を切り替えたり、注目できます。</p><ul class="group-list" aria-label="グループ一覧"></ul>';
  container.before(section);
  function update() {
    for (const group of groups) {
      const row = [...section.querySelectorAll<HTMLElement>('[data-group-id]')].find(node => node.dataset.groupId === group.id);
      if (!row) continue;
      const members = group.bodyIds.flatMap(id => known.get(id) ? [known.get(id)!] : []);
      const visible = members.filter(body => body.object.visible).length;
      const toggle = row.querySelector<HTMLButtonElement>('.group-toggle')!;
      toggle.setAttribute('aria-pressed', visible === members.length ? 'true' : visible === 0 ? 'false' : 'mixed');
      toggle.textContent = visible === members.length ? '非表示' : '表示';
      row.querySelector<HTMLElement>('.group-count')!.textContent = `${visible} / ${members.length} ボディ表示`;
    }
  }
  function setGroups(next: BodyGroup[]) {
    groups = next.map(group => ({ ...group, bodyIds: group.bodyIds.filter(id => known.has(id)) })).filter(group => group.bodyIds.length);
    section.hidden = !groups.length;
    const list = section.querySelector('ul')!; list.replaceChildren();
    for (const group of groups) {
      const row = document.createElement('li'); row.className = 'public-group'; row.dataset.groupId = group.id;
      const name = document.createElement('strong'); name.textContent = group.name;
      const count = document.createElement('span'); count.className = 'group-count';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'group-toggle'; toggle.setAttribute('aria-label', `${group.name}の表示切り替え`);
      const members = group.bodyIds.map(id => known.get(id)!);
      toggle.onclick = () => { const visible = !members.every(body => body.object.visible); members.forEach(body => { body.object.visible = visible; }); changed(); update(); };
      const focusButton = document.createElement('button'); focusButton.type = 'button'; focusButton.className = 'group-focus'; focusButton.textContent = '注目'; focusButton.setAttribute('aria-label', `${group.name}のグループに注目`);
      focusButton.onclick = () => { members.forEach(body => { body.object.visible = true; }); changed(); update(); focus(members); };
      row.append(name, count, focusButton, toggle); list.append(row);
    }
    update();
  }
  return { setGroups, update };
}
