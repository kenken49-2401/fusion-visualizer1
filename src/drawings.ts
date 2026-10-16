import { Box3, EdgesGeometry, Vector3 } from 'three';
import type { Body, LoadedModel } from './model-loader';
import './drawings.css';

export type DrawingView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export interface DrawingEdge { start: Vector3; end: Vector3; lengthMM: number }
export interface DrawingPart { id: string; number: number; name: string; bounds: Box3; sizeMM: Vector3; edges: DrawingEdge[] }
const viewNames: Record<DrawingView, string> = {
  front: '正面（前）', back: '背面（後）', left: '左側面', right: '右側面', top: '上面（平面）', bottom: '下面',
};
const note = '3MFメッシュから作成 / 全ボディ対象 / 単位 mm / 外接寸法・辺長は近似値';
const detail = '外接寸法は配置後の X幅・Z奥行・Y高さ。辺長は3D実長（投影寸法とは異なります）。曲面は線分近似、稜線は角度1°以上。隠線処理・CAD公差・加工寸法の保証はありません。';
const fmt = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Coordinates remain in world meters; SVG uses an inverted vertical axis. */
export function projectPoint(point: Vector3, view: DrawingView): [number, number] {
  if (view === 'back') return [-point.x, -point.y];
  if (view === 'left') return [point.z, -point.y];
  if (view === 'right') return [-point.z, -point.y];
  if (view === 'top') return [point.x, point.z];
  if (view === 'bottom') return [point.x, -point.z];
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

  let disposed = false;
  let observedWidth = 0;
  let resizeFrame = 0;
  let viewportWidth = window.innerWidth;
  let revealAfterResize = false;
  const revealDiagram = () => {
    const top = diagram.offsetTop - header.offsetHeight - 12;
    dialog.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
  };
  const choosePart = (index: number) => { part.value = String(index); selectedEdge = -1; render(); diagram.querySelector<SVGElement>('svg')?.focus({ preventScroll: true }); revealDiagram(); };
  const chooseEdge = (index: number) => { selectedEdge = index; render(); revealDiagram(); };
  const keyboardClick = (node: SVGElement, label: string, action: () => void) => {
    node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); node.setAttribute('aria-label', label);
    node.addEventListener('click', action);
    node.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') { event.preventDefault(); action(); const next = diagram.querySelector<SVGElement>('[data-drawing-edge="' + selectedEdge + '"]'); next?.focus({ preventScroll: true }); }
    });
  };

  function render() {
    if (!parts || disposed) return;
    status.textContent = '';
    const allBounds = new Box3(); parts.forEach(p => allBounds.union(p.bounds));
    const selected = part.value === '' ? undefined : parts[Number(part.value)];
    const shown = selected ? [selected] : parts;
    const direction = view.value as DrawingView;
    const b = projectedBounds(selected?.bounds ?? allBounds, direction);
    const width = Math.max(260, Math.round(diagram.clientWidth || dialog.clientWidth - 44 || 760));
    observedWidth = diagram.clientWidth;
    const height = Math.max(190, Math.min(700, window.innerHeight - header.offsetHeight - 82));
    const compact = height < 500;
    const plot = { left: 26, top: compact ? 64 : 122, width: width - 90, height: Math.max(35, height - (compact ? 140 : 315)) };
    const spanX = Math.max(b.maxX - b.minX, 0.000001), spanY = Math.max(b.maxY - b.minY, 0.000001);
    const scale = Math.min(plot.width / spanX, plot.height / spanY);
    const x = (v: number) => plot.left + (plot.width - spanX * scale) / 2 + (v - b.minX) * scale;
    const y = (v: number) => plot.top + (plot.height - spanY * scale) / 2 + (v - b.minY) * scale;
    // Edges are sorted by true length. Skip view-parallel edges for the initial annotation.
    if (selected && selectedEdge < 0) selectedEdge = selected.edges.findIndex(edge => {
      const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction);
      return Math.hypot(a[0] - z[0], a[1] - z[1]) * scale >= 3;
    });
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': `${title} ${viewNames[direction]} 寸法図`, 'data-drawing-view': direction, tabindex: -1 });
    svg.append(svgNode('title', {}, `${title} — ${selected ? selected.name : '全ボディ'} — ${viewNames[direction]}`));
    svg.append(svgNode('rect', { width, height, fill: '#fffdf5' }));
    const text = (tx: number, ty: number, value: string, size = 13, anchor = 'start', target: SVGElement = svg) => {
      const node = svgNode('text', { x: tx, y: ty, fill: '#202521', 'font-family': 'sans-serif', 'font-size': size, 'text-anchor': anchor }, value);
      target.append(node); return node;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, color = '#202521', thickness = 1, target: SVGElement = svg) => {
      const node = svgNode('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': thickness }); target.append(node); return node;
    };
    const wrapped = (value: string, top: number, size = 13, maxLines = 2) => {
      // Conservative full-width glyph budgeting preserves readable text on narrow screens.
      const count = Math.max(8, Math.floor((width - 32) / size));
      const chars = Array.from(value);
      for (let n = 0; n < maxLines && n * count < chars.length; n++) {
        const end = (n + 1) * count;
        const content = chars.slice(n * count, end).join('') + (n === maxLines - 1 && end < chars.length ? '…' : '');
        text(16, top + n * (size + 5), content, size);
      }
    };
    const labelWidth = (value: string, size = 13) => Math.min(width - 24, Array.from(value).reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? size : size * 0.62), 0) + 18);
    const pill = (cx: number, cy: number, value: string, color: string, target: SVGElement, vertical = false) => {
      const size = 13, boxWidth = labelWidth(value, size);
      const group = svgNode('g', { transform: `translate(${cx} ${cy})${vertical ? ' rotate(-90)' : ''}` });
      group.append(svgNode('rect', { x: -boxWidth / 2, y: -13, width: boxWidth, height: 26, rx: 7, fill: '#ffffff', stroke: color, 'stroke-width': 1.4 }));
      const label = text(0, 4, value, size, 'middle', group); label.setAttribute('fill', color);
      target.append(group); return { group, boxWidth };
    };
    wrapped(title, 23, 15, compact ? 1 : 2);
    wrapped(`${viewNames[direction]} / ${selected ? `${selected.number}. ${selected.name}` : '全体・全ボディ'}`, compact ? 46 : 66, 13, compact ? 1 : 2);
    if (!compact) text(16, 109, selected ? '辺をタップ → 2点間の3D実長を表示' : '部品の線・番号をタップ → 個別寸法', 12);
    const badges: [number, number][] = [];
    for (const p of shown) {
      let path = '';
      p.edges.forEach(edge => { const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction); path += `M${x(a[0])},${y(a[1])}L${x(z[0])},${y(z[1])}`; });
      svg.append(svgNode('path', { d: path, fill: 'none', stroke: '#202521', 'stroke-width': 1.25, 'stroke-linecap': 'round' }));
      if (!selected) {
        const hit = svgNode('path', { d: path, fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke', 'data-drawing-part': p.number - 1, class: 'drawing-hit' });
        keyboardClick(hit, `${p.number}. ${p.name} の寸法を表示`, () => choosePart(p.number - 1)); svg.append(hit);
        const center = projectPoint(p.bounds.getCenter(new Vector3()), direction), tx = x(center[0]), ty = y(center[1]);
        // Sparse badges keep the assembly legible; every body remains selectable by its lines.
        if (badges.length < 10 && !badges.some(([bx, by]) => Math.hypot(bx - tx, by - ty) < 28)) {
          badges.push([tx, ty]);
          const badge = svgNode('g', { 'data-drawing-part': p.number - 1, class: 'drawing-part-badge' });
          badge.append(svgNode('circle', { cx: tx, cy: ty, r: 12, fill: '#fffdf5', stroke: '#202521' })); text(tx, ty + 4, String(p.number), 12, 'middle', badge);
          keyboardClick(badge, `${p.number}. ${p.name} の寸法を表示`, () => choosePart(p.number - 1)); svg.append(badge);
        }
      } else {
        p.edges.forEach((edge, index) => {
          const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction);
          const hit = line(x(a[0]), y(a[1]), x(z[0]), y(z[1]), 'transparent', 16);
          hit.setAttribute('data-drawing-edge', String(index)); hit.setAttribute('data-length-mm', String(edge.lengthMM)); hit.setAttribute('pointer-events', 'stroke'); hit.setAttribute('class', 'drawing-hit');
          keyboardClick(hit, `辺 ${index + 1}、3D実長 ${fmt(edge.lengthMM)} mm`, () => chooseEdge(index));
        });
      }
    }
    const left = x(b.minX), right = x(b.maxX), top = y(b.minY), bottom = y(b.maxY);
    const axes = direction === 'front' || direction === 'back' ? ['X', 'Y']
      : direction === 'right' || direction === 'left' ? ['Z', 'Y'] : ['X', 'Z'];
    const dimension = (horizontal: boolean) => {
      const group = svgNode('g', { 'data-projected-dimension': horizontal ? 'width' : 'height' }); svg.append(group);
      const ax = horizontal ? left : right + 29, ay = horizontal ? bottom + 35 : top;
      const bx = horizontal ? right : right + 29, by = horizontal ? bottom + 35 : bottom;
      if (horizontal) { line(left, bottom, left, ay + 6, '#859083', 1, group); line(right, bottom, right, by + 6, '#859083', 1, group); }
      else { line(right, top, ax + 6, top, '#859083', 1, group); line(right, bottom, bx + 6, bottom, '#859083', 1, group); }
      line(ax, ay, bx, by, '#53634f', 1.2, group);
      for (const [cx, cy] of [[ax, ay], [bx, by]]) group.append(svgNode('circle', { cx, cy, r: 3, fill: '#53634f', 'data-dimension-endpoint': '' }));
      const value = `投影${axes[horizontal ? 0 : 1]} ${fmt(horizontal ? b.widthMM : b.heightMM)} mm`;
      pill((ax + bx) / 2, (ay + by) / 2, value, '#53634f', group, !horizontal);
    };
    dimension(true); dimension(false);
    if (selected && selectedEdge >= 0) {
      const edge = selected.edges[selectedEdge];
      if (edge) {
        const a = projectPoint(edge.start, direction), z = projectPoint(edge.end, direction);
        const ax = x(a[0]), ay = y(a[1]), bx = x(z[0]), by = y(z[1]);
        const selectedLine = line(ax, ay, bx, by, '#d45b20', 4); selectedLine.setAttribute('data-selected-edge', String(selectedEdge)); selectedLine.setAttribute('data-length-mm', String(edge.lengthMM)); selectedLine.setAttribute('pointer-events', 'none');
        for (const [cx, cy, name] of [[ax, ay, 'start'], [bx, by, 'end']] as const) svg.append(svgNode('circle', { cx, cy, r: 5, fill: '#ffffff', stroke: '#d45b20', 'stroke-width': 2.5, 'data-edge-endpoint': name, 'pointer-events': 'none' }));
        const midpointX = (ax + bx) / 2, midpointY = (ay + by) / 2;
        const length = Math.hypot(bx - ax, by - ay);
        const label = `3D実長 ${fmt(edge.lengthMM)} mm`;
        const boxWidth = labelWidth(label);
        const labelX = Math.max(boxWidth / 2 + 8, Math.min(width - boxWidth / 2 - 8, midpointX + (length ? -(by - ay) / length * 34 : 0)));
        const labelY = Math.max(plot.top + 17, Math.min(bottom + 4, midpointY + (length ? (bx - ax) / length * 34 : -34)));
        const group = svgNode('g', { 'data-edge-label': '', 'data-length-mm': edge.lengthMM, 'pointer-events': 'none' });
        line(midpointX, midpointY, labelX, labelY, '#d45b20', 1.5, group);
        pill(labelX, labelY, label, '#b4430d', group); svg.append(group);
        if (!compact) text(16, height - 119, `辺 ${selectedEdge + 1}：オレンジの2点間（3D実長）`, 12);
      }
    }
    if (!compact && selected) wrapped(`外接寸法 X ${fmt(selected.sizeMM.x)} × Z ${fmt(selected.sizeMM.z)} × Y ${fmt(selected.sizeMM.y)} mm`, height - 96, 12, 2);
    else if (!compact) wrapped('部品番号は重なりを避け一部表示。すべての部品は線または一覧から選択できます。', height - 119, 12, 3);
    if (!compact) wrapped('3MFメッシュ / 全ボディ対象 / mm / 外接寸法・辺長は近似値', height - 54, 11, 2);
    wrapped(compact ? 'mm / 3MF近似 / 隠線・CAD公差保証なし' : '隠線処理・CAD公差の保証なし / 縮尺任意', height - 18, 11, 1);
    diagram.replaceChildren(svg);
    edgeSection.replaceChildren(el('h3', selected ? `${selected.number}. ${selected.name} — 辺の3D実長` : '部品ごとの辺長'));
    if (selected) {
      const label = el('label', '辺の一覧（長い順・mm） '), edgeSelect = el('select'); edgeSelect.setAttribute('aria-label', '辺の3D実長');
      selected.edges.forEach((edge, i) => { const option = el('option', `${i + 1}. ${fmt(edge.lengthMM)} mm`); option.value = String(i); edgeSelect.append(option); });
      edgeSelect.value = String(selectedEdge); edgeSelect.addEventListener('change', () => { chooseEdge(Number(edgeSelect.value)); edgeSection.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true }); }); label.append(edgeSelect); edgeSection.append(label);
      const currentEdge = selected.edges[selectedEdge];
      if (currentEdge) { const a = projectPoint(currentEdge.start, direction), z = projectPoint(currentEdge.end, direction); if (Math.hypot(a[0] - z[0], a[1] - z[1]) * scale < 3) edgeSection.append(el('p', 'この方向では両端が重なります。方向を変えると辺を確認できます。')); }
      edgeSection.append(el('p', `${selected.edges.length} 本のメッシュ稜線。図の線をタップすると、両端点と実長をその場に表示します。`));
    } else edgeSection.append(el('p', '部品の線・番号・一覧から選択すると、その部品の長い辺を自動で寸法表示します。'));
    tableBody.replaceChildren();
    for (const p of parts) {
      const row = el('tr'), cell = el('td'), button = el('button', `${p.number}. ${p.name}`); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === p)); button.setAttribute('data-part-row', String(p.number - 1));
      button.addEventListener('click', () => choosePart(p.number - 1)); cell.append(button); row.append(cell);
      for (const value of [p.sizeMM.x, p.sizeMM.z, p.sizeMM.y]) row.append(el('td', fmt(value)));
      tableBody.append(row);
    }
  }
  const change = () => { selectedEdge = -1; render(); revealDiagram(); };
  view.addEventListener('change', () => { render(); revealDiagram(); }); part.addEventListener('change', change);
  const scheduleResize = (reveal = false) => {
    revealAfterResize ||= reveal;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (dialog.open && !disposed) { render(); if (revealAfterResize) revealDiagram(); }
      revealAfterResize = false;
    });
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (!dialog.open || disposed || Math.abs(diagram.clientWidth - observedWidth) < 1) return;
    scheduleResize();
  });
  const open = () => {
    if (!parts) parts = model.bodies.map(measurePart);
    dialog.showModal(); render(); observer?.observe(diagram);
  };
  const onResize = () => {
    const widthChanged = window.innerWidth !== viewportWidth;
    viewportWidth = window.innerWidth;
    if (!dialog.open || disposed) return;
    // Restore the diagram after orientation changes; browser toolbar height changes must not interrupt scrolling.
    scheduleResize(widthChanged);
  };
  window.addEventListener('resize', onResize);
  const onClose = () => { observer?.disconnect(); cancelAnimationFrame(resizeFrame); revealAfterResize = false; };
  dialog.addEventListener('close', onClose);
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
  return () => { disposed = true; window.removeEventListener('resize', onResize); observer?.disconnect(); cancelAnimationFrame(resizeFrame); trigger.removeEventListener('click', open); dialog.removeEventListener('close', onClose); dialog.remove(); };
}
