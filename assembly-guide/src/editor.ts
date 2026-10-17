import { Matrix3, Raycaster, Vector2, Vector3 } from 'three';
import type { LoadedModel } from './model-loader';
import type { ModelScene } from './scene';
import { newId, parseGuide, type Guide, type GuideStep, type IconKind, type MarkerKind } from './schema';
interface Context {
    guide: Guide;
    model: LoadedModel;
    scene: ModelScene;
    host: HTMLElement;
    getIndex: () => number;
    update: (guide: Guide, index: number) => void;
    notify: (message: string) => void;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const n = document.createElement(tag); if (text !== undefined)
    n.textContent = text; return n; };
const lines = (s: string) => s.split('\n').map(v => v.trim()).filter(Boolean);
export async function mountGuideEditor(context: Context) {
    const { model, scene, host, notify } = context;
    let guide = context.guide, index = context.getIndex(), saving = false, syncing = false, armed = false;
    const response = await fetch(`/__guide/config?product=${guide.productId}`, { cache: 'no-store' });
    if (!response.ok)
        throw new Error('編集用の手順を読み取れません。');
    const initial = await response.json();
    if (initial.modelFingerprint && model.fingerprint && initial.modelFingerprint !== model.fingerprint)
        throw new Error('モデルが更新されました。再読み込みしてください。');
    guide = parseGuide(initial.guide, model.bodies.map(b => b.id));
    index = Math.min(index, guide.steps.length - 1);
    let revision = initial.revision as string, saved = JSON.stringify(guide);
    context.update(guide, index);
    const open = el('button', '手順を編集（開発者用）');
    open.className = 'button';
    open.type = 'button';
    document.querySelector('.manual-heading')!.append(open);
    const panel = el('section');
    panel.className = 'guide-editor';
    panel.hidden = true;
    panel.setAttribute('aria-label', '制作手順の編集者モード');
    host.append(panel);
    const toolbar = el('div'), status = el('p'), syncStatus = el('p'), save = el('button', '手順を保存'), sync = el('button', 'GitHubへ同期'), close = el('button', '閉じる'), form = el('div');
    toolbar.className = 'editor-toolbar';
    status.setAttribute('role', 'status');
    syncStatus.setAttribute('role', 'status');
    save.type = sync.type = close.type = 'button';
    toolbar.append(save, sync, close);
    panel.append(el('h2', '制作手順の編集'), el('p', 'このPCで手順を編集します。保存先はこの制作手順アプリのJSONです。元の閲覧アプリと3MFは変更しません。'), toolbar, status, syncStatus, form);
    const hint = el('div');
    hint.className = 'placement-hint';
    hint.hidden = true;
    const hintText = el('span'), cancel = el('button', '配置を中止'), back = el('button', '編集へ戻る');
    hint.append(hintText, cancel, back);
    document.querySelector('.viewport-stage')!.append(hint);
    const dirty = () => JSON.stringify(guide) !== saved;
    function refresh() { save.disabled = saving || syncing || !dirty(); sync.disabled = saving || syncing || dirty(); status.textContent = saving ? '保存しています…' : dirty() ? '未保存の変更があります' : '保存済みの手順を表示中'; }
    function touch() { context.update(guide, index); refresh(); }
    function action(text: string, fn: () => void, parent: HTMLElement = form) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', fn); parent.append(b); return b; }
    function field(parent: HTMLElement, name: string, value: string, onInput: (value: string) => void, multi = false) { const label = el('label', name), input = multi ? el('textarea') : el('input'); input.value = value; input.setAttribute('aria-label', name); if (input instanceof HTMLTextAreaElement)
        input.rows = 3; input.addEventListener('input', () => { onInput(input.value); touch(); }); label.append(input); parent.append(label); return input; }
    function select<T extends string>(parent: HTMLElement, name: string, value: T, options: [
        T,
        string
    ][], change: (v: T) => void) { const label = el('label', name), input = el('select'); input.setAttribute('aria-label', name); for (const [v, title] of options) {
        const option = el('option', title);
        option.value = v;
        input.append(option);
    } input.value = value; input.onchange = () => change(input.value as T); label.append(input); parent.append(label); return input; }
    function section(title: string) { const s = el('section'); s.className = 'editor-section'; s.append(el('h3', title)); form.append(s); return s; }
    function render() {
        armed = false;
        hint.hidden = true;
        form.replaceChildren();
        const step = guide.steps[index];
        const overview = section('制作物と公開状態');
        field(overview, '制作物の名前', guide.title, v => guide.title = v);
        field(overview, '制作物の説明', guide.summary, v => guide.summary = v, true);
        select(overview, '手順の状態', guide.status, [['draft', '下書き'], ['ready', '作成者確認済み']], v => { guide.status = v; touch(); });
        const assigned = new Set(guide.steps.flatMap(s => s.bodyIds));
        overview.append(el('p', `部品の割当：${assigned.size} / ${model.bodies.length}。確認済みにするには全ての部品と各ステップの説明が必要です。`));
        const steps = section('ステップを作る');
        select(steps, '編集するステップ', String(index), guide.steps.map((s, i) => [String(i), `${i + 1}. ${s.title}`]), v => { index = Number(v); context.update(guide, index); render(); });
        const controls = el('div');
        controls.className = 'editor-actions';
        steps.append(controls);
        action('ステップを追加', () => { const s: GuideStep = { id: newId(), title: '新しいステップ', description: '', bodyIds: [], materials: [], tools: [], methods: [], markers: [] }; guide.steps.splice(index + 1, 0, s); index++; guide.status = 'draft'; touch(); render(); }, controls);
        action('前へ移動', () => { [guide.steps[index - 1], guide.steps[index]] = [guide.steps[index], guide.steps[index - 1]]; index--; touch(); render(); }, controls).disabled = index === 0;
        action('後へ移動', () => { [guide.steps[index], guide.steps[index + 1]] = [guide.steps[index + 1], guide.steps[index]]; index++; touch(); render(); }, controls).disabled = index === guide.steps.length - 1;
        action('このステップを削除', () => { if (!confirm('このステップを削除しますか？ 保存するまではファイルに反映されません。'))
            return; guide.steps.splice(index, 1); index = Math.min(index, guide.steps.length - 1); guide.status = 'draft'; touch(); render(); }, controls).disabled = guide.steps.length === 1;
        field(steps, 'ステップの見出し', step.title, v => step.title = v);
        field(steps, '日本語の作業説明', step.description, v => step.description = v, true);
        const bodies = section('このステップで追加する部品');
        bodies.append(el('p', 'チェックした部品がこのステップで赤く表示されます。割当先を変える場合は元のステップのチェックを外してください。'));
        const bodyList = el('div');
        bodyList.className = 'editor-body-list';
        bodies.append(bodyList);
        model.bodies.forEach((body, i) => { const owner = guide.steps.findIndex((s, j) => j !== index && s.bodyIds.includes(body.id)), label = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = step.bodyIds.includes(body.id); check.disabled = owner >= 0; check.setAttribute('aria-label', `${i + 1}. ${body.name}を追加`); check.onchange = () => { step.bodyIds = check.checked ? [...step.bodyIds, body.id] : step.bodyIds.filter(id => id !== body.id); touch(); }; label.append(check, document.createTextNode(`${i + 1}. ${body.name}${owner >= 0 ? `（Step ${owner + 1}で追加）` : ''}`)); bodyList.append(label); });
        const methods = section('このステップの固定方法・器具');
        field(methods, '固定方法（1行に1つ）', step.methods.join('\n'), v => step.methods = lines(v), true);
        field(methods, '必要な器具・工具（1行に1つ）', step.tools.join('\n'), v => step.tools = lines(v), true);
        const required = section('このステップで使う物資');
        for (const material of guide.materials) {
            const row = el('div');
            row.className = 'requirement-editor';
            const label = el('label'), check = el('input');
            check.type = 'checkbox';
            const req = step.materials.find(r => r.materialId === material.id);
            check.checked = !!req;
            label.append(check, document.createTextNode(material.name));
            row.append(label);
            const quantity = el('input');
            quantity.type = 'text';
            quantity.value = req?.quantity ?? '';
            quantity.placeholder = '使用数';
            quantity.disabled = !req;
            quantity.setAttribute('aria-label', `${material.name}の使用数`);
            quantity.oninput = () => { const current = step.materials.find(r => r.materialId === material.id); if (current) {
                current.quantity = quantity.value;
                touch();
            } };
            check.onchange = () => { step.materials = check.checked ? [...step.materials, { materialId: material.id, quantity: quantity.value || material.quantity }] : step.materials.filter(r => r.materialId !== material.id); touch(); render(); };
            row.append(quantity);
            required.append(row);
        }
        const markers = section('3D上の固定位置');
        markers.append(el('p', '「3Dで固定位置を追加」を押してモデル表面をタップします。ビスの挿入方向は表面から内側へ向けて初期設定します。位置・方向・長さは後から調整できます。'));
        const type = select<MarkerKind>(markers, '追加する固定記号', 'screw', [['screw', 'ビスと矢印'], ['arrow', '矢印'], ['point', '位置の印']], () => { });
        const markerLabel = el('input');
        markerLabel.value = '固定位置';
        markerLabel.setAttribute('aria-label', '追加する固定位置の説明');
        markers.append(markerLabel);
        action('3Dで固定位置を追加', () => { armed = true; pendingType = type.value as MarkerKind; pendingLabel = markerLabel.value || '固定位置'; hintText.textContent = 'モデル上の固定位置をタップしてください。'; hint.hidden = false; document.querySelector('.viewer-card')!.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, markers);
        step.markers.forEach((marker, i) => {
            const row = el('fieldset');
            row.className = 'marker-editor';
            row.append(el('legend', `固定位置 ${i + 1}`));
            markers.append(row);
            field(row, `固定位置 ${i + 1}の説明`, marker.label, v => marker.label = v);
            select<MarkerKind>(row, `固定位置 ${i + 1}の種類`, marker.type, [['screw', 'ビスと矢印'], ['arrow', '矢印'], ['point', '位置の印']], v => { marker.type = v; touch(); });
            row.append(el('p', '位置：表示モデルの X・Y・Z 座標（mm）／方向：ビスを入れる向き'));
            for (const key of ['position', 'direction'] as const) {
                const coords = el('div');
                coords.className = 'coordinate-fields';
                row.append(coords);
                for (let a = 0; a < 3; a++) {
                    const name = `固定位置 ${i + 1}の${key === 'position' ? '位置' : '方向'} ${['X', 'Y', 'Z'][a]}`;
                    const input = field(coords, name, String(marker[key][a]), v => { marker[key][a] = v.trim() === '' ? Number.NaN : Number(v); }) as HTMLInputElement;
                    input.type = 'number';
                    input.step = 'any';
                }
            }
            const length = field(row, `固定位置 ${i + 1}のビス長さ（mm）`, String(marker.lengthMM), v => marker.lengthMM = Number(v)) as HTMLInputElement;
            length.type = 'number';
            length.min = '0.1';
            length.step = 'any';
            action(`固定位置 ${i + 1}を削除`, () => { step.markers.splice(i, 1); touch(); render(); }, row);
        });
        const materials = section('制作物全体の物資一覧');
        materials.append(el('p', '部材・ビス・工具などの仕様と合計数量を入力します。数量には「未設定」などの文字も使えます。'));
        guide.materials.forEach((material, i) => { const row = el('fieldset'); row.className = 'material-editor'; row.append(el('legend', `物資 ${i + 1}`)); materials.append(row); field(row, `物資 ${i + 1}の名前`, material.name, v => material.name = v); field(row, `物資 ${i + 1}の合計数量`, material.quantity, v => material.quantity = v); field(row, `物資 ${i + 1}の単位`, material.unit, v => material.unit = v); select<IconKind>(row, `物資 ${i + 1}のアイコン`, material.icon, [['part', '部材'], ['screw', 'ビス'], ['tool', '工具'], ['other', 'その他']], v => { material.icon = v; touch(); }); field(row, `物資 ${i + 1}の補足`, material.note, v => material.note = v, true); action(`物資 ${i + 1}を削除`, () => { guide.materials.splice(i, 1); guide.steps.forEach(s => s.materials = s.materials.filter(r => r.materialId !== material.id)); touch(); render(); }, row); });
        action('物資を追加', () => { guide.materials.push({ id: newId(), name: '新しい物資', quantity: '未設定', unit: '点', icon: 'other', note: '' }); touch(); render(); }, materials);
        const files = section('JSONの控え・取り込み');
        action('JSONを書き出す', () => { try {
            const value = parseGuide(guide, model.bodies.map(b => b.id)), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' })), a = el('a');
            a.href = url;
            a.download = `${guide.productId}-guide.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            notify(e instanceof Error ? e.message : '書き出せません。');
        } }, files);
        const input = el('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.setAttribute('aria-label', '手順JSONを取り込む');
        input.onchange = async () => { const file = input.files?.[0]; if (!file)
            return; try {
            if (file.size > 2 * 1024 * 1024)
                throw new Error('JSONは2MB以下にしてください。');
            const next = parseGuide(JSON.parse(await file.text()), model.bodies.map(b => b.id));
            if (next.productId !== guide.productId)
                throw new Error('選択中の制作物のJSONを指定してください。');
            guide = next;
            index = 0;
            touch();
            render();
            notify('JSONを取り込みました。保存するとファイルに反映されます。');
        }
        catch (e) {
            notify(e instanceof Error ? e.message : '取り込めません。');
        } };
        files.append(input);
        refresh();
    }
    let pendingType: MarkerKind = 'screw', pendingLabel = '固定位置';
    const canvas = scene.renderer.domElement;
    let start: {
        x: number;
        y: number;
        id: number;
    } | undefined;
    const active = new Set<number>();
    let canceled = false;
    const down = (event: PointerEvent) => { active.add(event.pointerId); if (active.size > 1) {
        canceled = true;
        start = undefined;
    }
    else {
        canceled = false;
        start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    } };
    const up = (event: PointerEvent) => {
        active.delete(event.pointerId);
        const initial = start;
        start = undefined;
        if (!armed || canceled || !initial || initial.id !== event.pointerId || event.button > 0 || Math.hypot(event.clientX - initial.x, event.clientY - initial.y) > 7)
            return;
        const rect = canvas.getBoundingClientRect(), ray = new Raycaster();
        ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), scene.camera);
        const hit = ray.intersectObjects(model.bodies.filter(b => b.object.visible).flatMap(b => b.meshes), false)[0];
        if (!hit) {
            notify('表示中の部品の表面を選んでください。');
            return;
        }
        const direction = hit.face ? hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize().negate() : new Vector3(0, -1, 0);
        guide.steps[index].markers.push({ id: newId(), type: pendingType, label: pendingLabel, position: hit.point.clone().multiplyScalar(1000).toArray() as [
                number,
                number,
                number
            ], direction: direction.toArray() as [
                number,
                number,
                number
            ], lengthMM: 40 });
        armed = false;
        touch();
        render();
        hintText.textContent = '固定位置を追加しました。';
        hint.hidden = false;
        notify('固定位置を追加しました。座標や方向は編集画面で調整できます。');
    };
    const cancelPointer = () => { start = undefined; canceled = true; active.clear(); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up, true);
    canvas.addEventListener('pointercancel', cancelPointer);
    cancel.onclick = () => { armed = false; hint.hidden = true; };
    back.onclick = () => { armed = false; hint.hidden = true; panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    open.onclick = () => { panel.hidden = !panel.hidden; open.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden)
        panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    close.onclick = () => { panel.hidden = true; open.setAttribute('aria-expanded', 'false'); armed = false; hint.hidden = true; };
    open.setAttribute('aria-expanded', 'false');
    save.onclick = async () => { if (saving || syncing || !dirty())
        return; let value: Guide; try {
        value = parseGuide(guide, model.bodies.map(b => b.id));
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '手順を確認してください。');
        return;
    } const requestText = JSON.stringify(guide); saving = true; refresh(); try {
        const response = await fetch('/__guide/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: guide.productId, revision, guide: value }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || '保存できませんでした。');
        revision = result.revision;
        saved = JSON.stringify(result.guide);
        if (JSON.stringify(guide) === requestText) {
            guide = result.guide;
            context.update(guide, index);
            render();
        }
        syncStatus.textContent = 'このPCに保存済み。GitHubへの同期は未実行です。';
        notify('制作手順を保存しました。');
    }
    catch (e) {
        notify(e instanceof Error ? e.message : '保存できませんでした。');
    }
    finally {
        saving = false;
        refresh();
    } };
    sync.onclick = async () => { if (saving || syncing || dirty())
        return; syncing = true; refresh(); syncStatus.textContent = 'GitHubへ同期しています…'; try {
        const response = await fetch('/__guide/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: guide.productId, revision }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || '同期できませんでした。');
        syncStatus.textContent = 'GitHubへ同期しました。公開処理が完了すると反映されます。';
    }
    catch (e) {
        syncStatus.textContent = e instanceof Error ? e.message : '同期できませんでした。';
    }
    finally {
        syncing = false;
        refresh();
    } };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty())
        event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    render();
    return { selectStep(next: number) { index = next; render(); }, dispose() { window.removeEventListener('beforeunload', beforeUnload); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up, true); canvas.removeEventListener('pointercancel', cancelPointer); panel.remove(); hint.remove(); open.remove(); } };
}
