import './style.css';
import './manual.css';
import { fetchCatalog, fetchConfig } from './config';
import { loadModel } from './model-loader';
import { ModelScene, type View } from './scene';
import { Appearance } from './appearance';
import { FixingView } from './markers';
import { mountDrawings } from './drawings';
import { mountMeasurements } from './measurements';
import { parseGuide, stepBodies, type Guide, type IconKind } from './schema';
declare const __GUIDE_ADMIN__: boolean;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<a class="skip-link" href="#instruction">制作手順へ進む</a><header class="site-header"><a class="brand" href="./"><span class="brand-mark">◇</span><span class="brand-type">FUSION<span class="brand-divider">/</span><span class="brand-light">ASSEMBLY GUIDE</span></span></a><span class="header-note">3Dで、つくり方を確かめる。</span></header><main class="workspace"><div class="page-heading"><div><p class="eyebrow">BUILD WITH A CLEAR VIEW</p><h1>制作手順書</h1><p class="page-description">制作物を選び、部品・固定位置・作業内容をステップごとに確認できます。</p></div></div><section aria-label="制作物を選ぶ"><h2>制作物を選ぶ</h2><div id="products" class="product-cards"></div></section><div id="load-state" role="status">制作物を読み込んでいます…</div><section id="guide-content" hidden><div class="manual-heading"><div><span id="guide-status" class="guide-badge"></span><h2 id="guide-title"></h2><p id="guide-summary"></p></div><button class="button" id="share">この手順を共有</button></div><div class="guide-layout"><section class="viewer-card"><div class="viewport-toolbar"><span class="viewport-label">3D 制作手順</span><button id="fit" class="fit-button">全体を表示</button></div><div class="viewport-stage"><div id="viewport" tabindex="0" aria-label="制作物の3D表示"></div></div><div class="assembly-step-controls"><button id="scene-previous" aria-label="前のステップを3Dで表示">←</button><div><small id="scene-step-counter"></small><strong id="scene-step-title"></strong></div><button id="scene-next" aria-label="次のステップを3Dで表示">→</button><a href="#instruction">説明を見る ↓</a></div><div class="guide-view-controls" aria-label="3D表示の方向"><button data-view="iso" aria-pressed="true">立体</button><button data-view="front" aria-pressed="false">正面</button><button data-view="right" aria-pressed="false">右側面</button><button data-view="top" aria-pressed="false">上面</button><button id="complete" aria-pressed="false">完成形を確認</button><button id="drawing">寸法付き図面</button></div><div class="guide-legend"><span><i class="legend-new"></i>このステップで追加</span><span><i class="legend-existing"></i>前のステップまでの部品</span><span id="body-status"></span></div><p class="model-help">ドラッグで回転・2本指で移動・ピンチで拡大縮小。赤いビスと矢印は固定位置を示す説明用の記号です。</p></section><div class="guide-side"><div id="editor-host"></div><section id="instruction" class="instruction-panel" tabindex="-1"><p class="eyebrow" id="step-counter"></p><h2 id="step-title"></h2><p id="step-description" class="step-description"></p><div class="step-navigation"><button id="previous" class="button">← 前のステップ</button><button id="next" class="button">次のステップ →</button></div><nav aria-label="制作ステップ"><ol id="steps" class="step-list"></ol></nav><section class="step-section"><h3>このステップの物資</h3><ul id="step-materials" class="supply-list"></ul></section><section class="step-section"><h3>固定方法</h3><ul id="methods"></ul></section><section class="step-section"><h3>必要な器具・工具</h3><ul id="tools"></ul></section><section class="step-section"><h3>固定位置</h3><ul id="fixings" class="fixing-list"></ul></section></section></div></div><details class="guide-measurements"><summary>2点間の距離を測る</summary><div id="measurement-panel"></div></details><section class="all-materials"><div class="section-kicker">MATERIALS & PARTS</div><h2>この制作物に必要な物資</h2><p>数量・仕様は手順の作成者が設定した内容です。</p><ul id="all-materials" class="supply-grid"></ul></section></section><div id="notice" role="status" class="guide-notice" hidden></div><footer class="guide-footer">Fusion / 制作手順書 · 独立したアプリ</footer></main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (text: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); return b; };
const icons: Record<IconKind, string> = { part: '▱', screw: '⊕', tool: '⚒', other: '◇' };
function itemList(id: string, items: string[], empty = '設定なし') { $(id).replaceChildren(...(items.length ? items : [empty]).map(text => { const li = document.createElement('li'); li.textContent = text; return li; })); }
let noticeTimer = 0;
function notify(message: string) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = window.setTimeout(() => $('notice').hidden = true, 6000); }
function supplyNode(material: Guide['materials'][number], quantity = material.quantity) { const li = document.createElement('li'), symbol = document.createElement('span'), content = document.createElement('div'), name = document.createElement('strong'), amount = document.createElement('span'), note = document.createElement('small'); symbol.className = 'supply-icon'; symbol.textContent = icons[material.icon]; symbol.setAttribute('aria-hidden', 'true'); name.textContent = material.name; amount.textContent = `${quantity || '未設定'} ${material.unit}`; note.textContent = material.note; content.append(name, amount, note); li.append(symbol, content); return li; }
async function start() {
    const catalog = await fetchCatalog();
    const query = new URLSearchParams(location.search);
    const entry = catalog.find(e => e.id === query.get('product')) ?? catalog[0];
    const guides = await Promise.allSettled(catalog.map(async product => {
        const response = await fetch(`${import.meta.env.BASE_URL}guides/${product.id}.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error('制作手順を取得できませんでした。');
        return parseGuide(await response.json());
    }));
    for (const [i, product] of catalog.entries()) {
        const a = document.createElement('a');
        a.className = 'product-card';
        a.href = `?product=${encodeURIComponent(product.id)}`;
        a.dataset.productId = product.id;
        a.setAttribute('aria-current', product.id === entry.id ? 'page' : 'false');
        const mark = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('span');
        mark.textContent = '◇';
        const details = guides[i];
        name.textContent = details.status === 'fulfilled' ? details.value.title : product.title;
        detail.textContent = '制作手順・物資を確認 →';
        a.append(mark, name, detail);
        $('products').append(a);
    }
    const config = await fetchConfig(entry.config);
    const selectedGuide = guides[catalog.indexOf(entry)];
    if (selectedGuide.status !== 'fulfilled') throw new Error('制作手順を読み取れません。手順JSONを確認してください。');
    const raw = selectedGuide.value;
    const model = await loadModel(config);
    let guide = parseGuide(raw, model.bodies.map(b => b.id));
    if (guide.productId !== entry.id)
        throw new Error('モデルと手順の制作物が一致しません。');
    $('load-state').hidden = true;
    $('guide-content').hidden = false;
    const scene = new ModelScene($('viewport'));
    scene.setModel(model);
    const appearance = new Appearance(model.bodies), fixings = new FixingView(scene, $('viewport'), model.bounds.getSize(model.sizeMM.clone()).length());
    const disposeDrawings = mountDrawings({ model, title: guide.title, trigger: $<HTMLButtonElement>('drawing') });
    const measurements = mountMeasurements({ scene, model, modelKey: `assembly-guide:${entry.id}:${model.fingerprint}:${config.upAxis}:${config.frontAxis}`, panel: $('measurement-panel') });
    let index = Math.min(guide.steps.length - 1, Math.max(0, (Math.trunc(Number(query.get('step'))) || 1) - 1)), complete = false;
    let editor: {
        selectStep: (index: number) => void;
        dispose: () => void;
    } | undefined;
    function selectStep(next: number) { index = Math.max(0, Math.min(guide.steps.length - 1, next)); complete = false; render(); editor?.selectStep(index); }
    function render() {
        const step = guide.steps[index], state = stepBodies(guide, index);
        $('guide-title').textContent = guide.title;
        document.querySelector<HTMLElement>(`.product-card[data-product-id="${entry.id}"] strong`)!.textContent = guide.title;
        $('guide-summary').textContent = guide.summary;
        $('guide-status').textContent = guide.status === 'draft' ? '下書きの手順' : '作成者確認済みの手順';
        $('guide-status').dataset.status = guide.status;
        $('step-counter').textContent = `STEP ${index + 1} / ${guide.steps.length}`;
        $('scene-step-counter').textContent = `STEP ${index + 1} / ${guide.steps.length}`;
        $('scene-step-title').textContent = step.title;
        $('step-title').textContent = step.title;
        $('step-description').textContent = step.description || 'このステップの説明は未設定です。';
        for (const body of model.bodies) {
            body.object.visible = complete || state.visible.has(body.id);
            appearance.set(body, !complete && state.current.has(body.id) ? '#df3b35' : config.colors[body.id] || '#8a9c88');
        }
        const viewport = $('viewport');
        viewport.dataset.ready = 'true';
        viewport.dataset.productId = entry.id;
        viewport.dataset.step = String(index + 1);
        viewport.dataset.visibleBodies = String(complete ? model.bodies.length : state.visible.size);
        viewport.dataset.newBodies = String(complete ? 0 : state.current.size);
        $('body-status').textContent = `${complete ? model.bodies.length : state.visible.size} / ${model.bodies.length} 部品表示`;
        $('complete').setAttribute('aria-pressed', String(complete));
        $('complete').textContent = complete ? '手順の表示に戻る' : '完成形を確認';
        $('steps').replaceChildren(...guide.steps.map((s, i) => { const li = document.createElement('li'), b = button(`${i + 1}. ${s.title}`, () => selectStep(i)); b.setAttribute('aria-current', i === index ? 'step' : 'false'); li.append(b); return li; }));
        $<HTMLButtonElement>('scene-previous').disabled = index === 0;
        $<HTMLButtonElement>('scene-next').disabled = index === guide.steps.length - 1;
        $<HTMLButtonElement>('previous').disabled = index === 0;
        $<HTMLButtonElement>('next').disabled = index === guide.steps.length - 1;
        $('all-materials').replaceChildren(...guide.materials.map(m => supplyNode(m)));
        const stepMaterials = step.materials.map(r => supplyNode(guide.materials.find(m => m.id === r.materialId)!, r.quantity));
        if (stepMaterials.length)
            $('step-materials').replaceChildren(...stepMaterials);
        else
            itemList('step-materials', [], 'このステップの物資は未設定です。');
        itemList('methods', step.methods);
        itemList('tools', step.tools);
        fixings.set(complete ? [] : step.markers.filter(m => [...m.position, ...m.direction, m.lengthMM].every(Number.isFinite) && Math.hypot(...m.direction) > 1e-8 && m.lengthMM > 0));
        $('fixings').replaceChildren(...step.markers.map(m => { const li = document.createElement('li'), b = button(m.label || '固定位置', () => fixings.focus(m)); li.append(b); return li; }));
        if (!step.markers.length)
            itemList('fixings', [], '固定位置の記号は未設定です。');
        const url = new URL(location.href);
        url.searchParams.set('product', entry.id);
        url.searchParams.set('step', String(index + 1));
        history.replaceState(null, '', url);
        scene.requestRender();
    }
    $('scene-previous').onclick = () => selectStep(index - 1);
    $('scene-next').onclick = () => selectStep(index + 1);
    $('previous').onclick = () => selectStep(index - 1);
    $('next').onclick = () => selectStep(index + 1);
    $('fit').onclick = () => { scene.fitAll(); fixings.update(); };
    $('complete').onclick = () => { complete = !complete; render(); };
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => { scene.setView(b.dataset.view as View); document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === b))); fixings.update(); });
    $('share').onclick = async () => { try {
        const url = new URL(location.href);
        if (import.meta.env.DEV)
            url.href = `https://kenken49-2401.github.io/fusion-visualizer1/assembly-guide/?product=${entry.id}&step=${index + 1}`;
        await navigator.clipboard.writeText(url.href);
        notify('手順へのリンクをコピーしました。');
    }
    catch {
        notify('アドレス欄のURLからこの手順を共有できます。');
    } };
    render();
    if (import.meta.env.DEV && __GUIDE_ADMIN__) {
        const { mountGuideEditor } = await import('./editor');
        editor = await mountGuideEditor({ guide, model, scene, host: $('editor-host'), getIndex: () => index, update: (next, nextIndex) => { guide = next; index = Math.min(Math.max(0, nextIndex), guide.steps.length - 1); complete = false; render(); }, notify });
    }
    window.addEventListener('pagehide', () => { editor?.dispose(); disposeDrawings(); measurements.dispose(); fixings.dispose(); scene.dispose(); }, { once: true });
}
start().catch(error => { const message = error instanceof Error ? error.message : '読み込みに失敗しました。'; $('load-state').hidden = false; $('load-state').textContent = message; $('load-state').append(button('再読み込み', () => location.reload())); });
