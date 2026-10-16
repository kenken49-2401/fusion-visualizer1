import { Box3, EdgesGeometry, Vector3 } from 'three';
import type { Body, LoadedModel } from './model-loader';
import './drawings.css';

export type DrawingView = 'front' | 'right' | 'top';
export interface DrawingEdge { start: Vector3; end: Vector3; lengthMM: number }
export interface DrawingPart { id: string; number: number; name: string; bounds: Box3; sizeMM: Vector3; edges: DrawingEdge[] }
const viewNames: Record<DrawingView, string> = { front: '正面（X / Y）', right: '右側面（−Z / Y）', top: '平面（X / −Z）' };
const note = '3MFメッシュから作成 / 全ボディ対象 / 単位 mm / 外接寸法・辺長は近似値';
const detail = '外接寸法は配置後の X幅・Z奥行・Y高さ。辺長は3D実長（投影寸法とは異なります）。曲面は線分近似、稜線は角度1°以上。隠線処理・CAD公差・加工寸法の保証はありません。';
const fmt = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Coordinates remain in world meters; SVG uses an inverted vertical axis. */
export function projectPoint(point: Vector3, view: DrawingView): [number, number] {
  if (view === 'right') return [-point.z, -point.y];
  if (view === 'top') return [point.x, point.z];
  return [point.x, -point.y];
}

export function projectedBounds(bounds: Box3, view: DrawingView) {
  const points: [number, number][] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(projectPoint(new Vector3(x, y, z), view));
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, widthMM: (maxX - minX) * 1000, heightMM: (maxY - minY) * 1000 };
}

/** Bake full instance transforms before extracting creases, including nonuniform scale. */
export function measurePart(body: Body, index: number): DrawingPart {
  body.object.updateWorldMatrix(true, true);
  const bounds = new Box3();
  const edges: DrawingEdge[] = [];
  const seen = new Set<string>();
  const key = (p: Vector3) => p.toArray().map(v => Math.round(v * 1e8)).join(',');
  for (const mesh of body.meshes) {
    // Keep tessellation near its local origin to avoid Float32 precision loss
    // when a small part is translated far from the assembly origin.
    const origin = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const relative = mesh.matrixWorld.clone().setPosition(0, 0, 0);
    const geometry = mesh.geometry.clone().applyMatrix4(relative);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(new Vector3().fromBufferAttribute(positions, i).add(origin));
    const lines = new EdgesGeometry(geometry, 1);
    const p = lines.getAttribute('position');
    for (let i = 0; i < p.count; i += 2) {
      const start = new Vector3().fromBufferAttribute(p, i).add(origin), end = new Vector3().fromBufferAttribute(p, i + 1).add(origin);
      const lengthMM = start.distanceTo(end) * 1000;
      const edgeKey = [key(start), key(end)].sort().join('/');
      if (lengthMM > 0.00001 && !seen.has(edgeKey)) { seen.add(edgeKey); edges.push({ start, end, lengthMM }); }
    }
    lines.dispose(); geometry.dispose();
  }
  edges.sort((a, b) => b.lengthMM - a.lengthMM);
  return { id: body.id, number: index + 1, name: body.name, bounds, sizeMM: bounds.getSize(new Vector3()).multiplyScalar(1000), edges };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgNode(tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountDrawings({ model, title, trigger }: { model: LoadedModel; title: string; trigger: HTMLButtonElement }): () => void {
  let parts: DrawingPart[] | undefined;
  let selectedEdge = -1;
  const dialog = el('dialog'); dialog.className = 'drawings-dialog'; dialog.setAttribute('aria-label', '寸法図');
  const header = el('header'), heading = el('h2', '寸法図'), close = el('button', '閉じる'); close.type = 'button';
  header.append(heading, close);
  const controls = el('div'); controls.className = 'drawings-controls';
  const view = el('select'); view.setAttribute('aria-label', '図面の方向');
  for (const [value, label] of Object.entries(viewNames)) { const option = el('option', label); option.value = value; view.append(option); }
  const part = el('select'); part.setAttribute('aria-label', '図面の部品'); part.append(el('option', '全体（全ボディ）')); part.options[0].value = '';
  model.bodies.forEach((body, i) => { const option = el('option', `${i + 1}. ${body.name}`); option.value = String(i); part.append(option); });
  const viewLabel = el('label', '方向 '), partLabel = el('label', '部品 '); viewLabel.append(view); partLabel.append(part);
  const download = el('button', 'SVG保存'), print = el('button', '印刷 / PDF'); download.type = print.type = 'button';
  controls.append(viewLabel, partLabel, download, print);
  const sheet = el('div'); sheet.className = 'drawings-sheet';
  const diagram = el('div'); diagram.className = 'drawings-diagram';
  const caveat = el('p', `${note}。${detail}`); caveat.className = 'drawings-note';
  const status = el('p'); status.setAttribute('role', 'status'); status.className = 'drawings-status';
  const tableWrap = el('div'); tableWrap.className = 'drawings-table-wrap';
  const table = el('table'); table.className = 'drawings-parts';
  const caption = el('caption', '部品寸法一覧（全ボディ・mm）');
  const tableHead = el('thead'), headingRow = el('tr');
  for (const name of ['番号 / 部品', '幅 X', '奥行 Z', '高さ Y']) { const cell = el('th', name); cell.scope = 'col'; headingRow.append(cell); }
  tableHead.append(headingRow); const tableBody = el('tbody'); table.append(caption, tableHead, tableBody); tableWrap.append(table);
  const edgeSection = el('section'); edgeSection.className = 'drawings-edges';
  sheet.append(diagram, caveat, tableWrap, edgeSection); dialog.append(header, controls, status, sheet); document.body.append(dialog);

  function render() {
    if (!parts) return;
    status.textContent = '';
    const allBounds = new Box3(); parts.forEach(p => allBounds.union(p.bounds));
    const selected = part.value === '' ? undefined : parts[Number(part.value)];
    const shown = selected ? [selected] : parts;
    const direction = view.value as DrawingView;
    const b = projectedBounds(selected?.bounds ?? allBounds, direction);
    const spanX = Math.max((b.maxX - b.minX), 0.000001), spanY = Math.max((b.maxY - b.minY), 0.000001);
    const scale = Math.min(650 / spanX, 440 / spanY);
    const x = (v: number) => 110 + (650 - spanX * scale) / 2 + (v - b.minX) * scale;
    const y = (v: number) => 95 + (440 - spanY * scale) / 2 + (v - b.minY) * scale;
    const svg = svgNode('svg', { viewBox: '0 0 900 690', width: 900, height: 690, role: 'img', 'aria-label': `${title} ${viewNames[direction]} 寸法図` });
    svg.append(svgNode('rect', { width: 900, height: 690, fill: '#fffdf5' }));
    const text = (tx: number, ty: number, value: string, size = 14, anchor = 'start') => {
      const node = svgNode('text', { x: tx, y: ty, fill: '#202521', 'font-family': 'sans-serif', 'font-size': size, 'text-anchor': anchor }, value);
      const available = 865 - tx;
      if (anchor === 'start' && value.length * size > available) { node.setAttribute('textLength', String(available)); node.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      svg.append(node);
    };
    const line = (x1: number, y1: number, x2: number, y2: number, color = '#202521', width = 1) => svg.appendChild(svgNode('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': width }));
    text(35, 33, title.slice(0, 70), 20); text(35, 59, `${viewNames[direction]} / ${selected ? `${selected.number}. ${selected.name}` : '全体・全ボディ'} / mm`, 15);
    for (const p of shown) {
      let path = '';
      for (const edge of p.edges) { const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction); path += `M${x(a[0])},${y(a[1])}L${x(z[0])},${y(z[1])}`; }
      svg.append(svgNode('path', { d: path, fill: 'none', stroke: '#202521', 'stroke-width': 1.15, 'stroke-linecap': 'round' }));
      if (!selected) { const center = projectPoint(p.bounds.getCenter(new Vector3()), direction); const tx = x(center[0]), ty = y(center[1]); svg.append(svgNode('circle', { cx: tx, cy: ty, r: 11, fill: '#fffdf5', stroke: '#202521' })); text(tx, ty + 4, String(p.number), 11, 'middle'); }
    }
    const left = x(b.minX), right = x(b.maxX), top = y(b.minY), bottom = y(b.maxY);
    for (const xx of [left, right]) { line(xx, bottom + 5, xx, bottom + 43, '#777'); line(xx - 4, bottom + 26, xx + 4, bottom + 34); }
    line(left, bottom + 30, right, bottom + 30); text((left + right) / 2, bottom + 55, `投影幅 ${fmt(b.widthMM)}`, 14, 'middle');
    for (const yy of [top, bottom]) { line(right + 5, yy, right + 42, yy, '#777'); line(right + 26, yy - 4, right + 34, yy + 4); }
    line(right + 30, top, right + 30, bottom); text(right + 40, (top + bottom) / 2, `${fmt(b.heightMM)}`, 14);
    if (selected && selectedEdge >= 0) {
      const edge = selected.edges[selectedEdge];
      if (edge) { const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction); line(x(a[0]), y(a[1]), x(z[0]), y(z[1]), '#ad3c21', 3); text(35, 618, `辺 ${selectedEdge + 1}：3D実長 ${fmt(edge.lengthMM)} mm（赤線。視線方向の辺は点に重なります）`); }
    } else text(35, 618, selected ? `外接寸法 X ${fmt(selected.sizeMM.x)} × Z ${fmt(selected.sizeMM.z)} × Y ${fmt(selected.sizeMM.y)} mm` : '丸数字は部品番号。部品を選ぶと個別の寸法・辺長を確認できます。');
    text(35, 650, note, 12); text(35, 673, '曲面は線分近似 / 隠線処理なし / CAD公差・加工寸法の保証なし / 縮尺任意', 12);
    diagram.replaceChildren(svg);
    edgeSection.replaceChildren(el('h3', selected ? `${selected.number}. ${selected.name} — 辺の3D実長` : '部品ごとの辺長'));
    if (selected) {
      const label = el('label', '辺を選択（長い順・mm） '), edgeSelect = el('select'); edgeSelect.setAttribute('aria-label', '辺の3D実長');
      const empty = el('option', '辺を選ぶと図中に赤線表示'); empty.value = '-1'; edgeSelect.append(empty);
      selected.edges.forEach((edge, i) => { const option = el('option', `${i + 1}. ${fmt(edge.lengthMM)} mm`); option.value = String(i); edgeSelect.append(option); });
      edgeSelect.value = String(selectedEdge); edgeSelect.addEventListener('change', () => { selectedEdge = Number(edgeSelect.value); render(); }); label.append(edgeSelect); edgeSection.append(label);
      edgeSection.append(el('p', `${selected.edges.length} 本のメッシュ稜線。斜材は辺を選んで実長を確認してください。`));
    } else edgeSection.append(el('p', '部品選択または一覧の番号を押すと、斜材を含む各辺の3D実長を確認できます。'));
    tableBody.replaceChildren();
    for (const p of parts) {
      const row = el('tr'), cell = el('td'), button = el('button', `${p.number}. ${p.name}`); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === p));
      button.addEventListener('click', () => { part.value = String(p.number - 1); selectedEdge = -1; render(); }); cell.append(button); row.append(cell);
      for (const value of [p.sizeMM.x, p.sizeMM.z, p.sizeMM.y]) row.append(el('td', fmt(value)));
      tableBody.append(row);
    }
  }
  const change = () => { selectedEdge = -1; render(); };
  view.addEventListener('change', change); part.addEventListener('change', change);
  const open = () => { if (!parts) parts = model.bodies.map(measurePart); render(); dialog.showModal(); };
  trigger.addEventListener('click', open); close.addEventListener('click', () => dialog.close());
  download.addEventListener('click', () => {
    const svg = diagram.querySelector('svg'); if (!svg) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = `drawing-${view.value}-${part.value || 'all'}.svg`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = '現在の方向・部品のSVGを保存しました。';
  });
  print.addEventListener('click', () => {
    const popup = window.open('', '_blank');
    if (!popup) { status.textContent = '印刷画面を開けませんでした。ブラウザのポップアップ設定を確認してください。'; return; }
    popup.opener = null;
    const doc = popup.document; doc.title = `${title} 寸法図`;
    const style = doc.createElement('style'); style.textContent = 'body{font:12px sans-serif;color:#202521;margin:16px}svg{width:100%;height:auto;max-height:75vh}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:6px;text-align:left}button{border:0;background:none;color:inherit;font:inherit;text-align:left}section{margin-top:16px}select{max-width:100%}@media print{svg{max-height:none}tr{break-inside:avoid}button{padding:0}}'; doc.head.append(style);
    const copy = doc.importNode(sheet, true); copy.querySelectorAll('select').forEach(node => node.replaceWith(doc.createTextNode(node.selectedOptions[0]?.textContent || ''))); doc.body.append(copy);
    const printButton = doc.createElement('button'); printButton.textContent = '印刷 / PDFを保存'; printButton.addEventListener('click', () => popup.print()); doc.body.prepend(printButton);
    popup.focus(); popup.setTimeout(() => popup.print(), 250);
  });
  return () => { trigger.removeEventListener('click', open); dialog.remove(); };
}
