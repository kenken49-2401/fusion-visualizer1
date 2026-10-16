const icon = (name: string, size = 18): string => {
  const paths: Record<string, string> = {
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path d="m8 8 4-2 4 2v8l-4 2-4-2V8Z"/>',
    share: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    orbit: '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><path d="m18 3 2 3-4 1"/><circle cx="12" cy="12" r="2"/>',
    hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v7c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2"/>',
    zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;
};

export function mountShell(container: HTMLElement): void {
  container.innerHTML = `
    <a class="skip-link" id="skip-to-model" href="#viewport">3Dモデルへ移動</a>
    <header class="site-header">
      <a class="brand" href="./" aria-label="Fusion Visualizer ホーム"><span class="brand-mark">${icon('cube', 25)}</span><span class="brand-type">FUSION<span class="brand-divider">/</span><span class="brand-light">VISUALIZER</span></span></a>
      <div class="header-note"><span class="live-dot"></span>ブラウザで、かたちを確かめる。</div>
      <span class="header-badge">3D MODEL VIEWER</span>
    </header>

    <main class="workspace">
      <div class="breadcrumb"><span>Fusion</span>${icon('chevron', 11)}<span>3Dプレビュー</span></div>
      <div class="page-heading">
        <div><div class="eyebrow">MODEL PREVIEW</div><h1 id="model-name">人形立て</h1><p class="page-description">角度を変えて、細部まで。</p></div>
        <button id="share" class="button button-share" type="button">${icon('share', 16)}<span>共有する</span></button>
      </div>

      <div class="model-switcher"><label for="model-select">モデルを選択</label><select id="model-select" aria-label="閲覧するモデル" disabled><option>読み込み中…</option></select><span class="model-switcher-note">選択したモデルのリンクを共有できます</span></div>

      <div class="viewer-layout">
        <section class="viewer-card" aria-label="インタラクティブ3Dビューア">
          <div class="viewport-toolbar"><div class="viewport-label"><span class="live-dot"></span><span>3D ビュー</span><span class="readonly-tag">閲覧専用</span></div><button class="fit-button" id="fit" type="button" title="モデル全体を表示">${icon('fit', 17)}<span>全体を表示</span></button></div>
          <div class="viewer-tools"><button id="measurement-shortcut" type="button" aria-pressed="false" disabled>2点間を測る</button><button id="drawing-shortcut" type="button" disabled>寸法付き図面</button><span>測定結果は端末内に保持</span></div>
          <div class="viewport-stage">
            <div id="viewport" tabindex="0" role="region" aria-label="人形立ての3Dモデル。ドラッグで回転、ピンチまたはスクロールで拡大縮小。"></div>
            <div id="loading" class="loading-overlay" role="status"><span class="loading-symbol">${icon('cube', 30)}</span><span class="loading-title">モデルを読み込んでいます</span><span class="loading-caption">かたちを、もうすぐ目の前に。</span><span class="loading-line"></span></div>
            <div id="error" class="error-panel" role="alert" hidden></div>
            <div class="view-controls" role="group" aria-label="表示する方向"><button type="button" data-view="iso" class="is-active" aria-pressed="true" title="アイソメトリック表示">${icon('cube', 15)}<span>立体</span></button><button type="button" data-view="front" aria-pressed="false">正面</button><button type="button" data-view="right" aria-pressed="false">右側面</button><button type="button" data-view="top" aria-pressed="false">上面</button></div>
          </div>
          <div class="viewport-footer"><span id="status" role="status" aria-live="polite">モデルを準備中</span><label class="grid-control"><input id="show-grid" type="checkbox" checked><span class="checkbox-visual" aria-hidden="true"></span>グリッド</label></div>
        </section>

        <aside class="inspection-panel" aria-label="モデルの詳細">
          <section class="inspector-section model-section"><div class="section-kicker">ABOUT THE MODEL</div><h2>モデル情報</h2><div class="file-card"><span class="file-icon">${icon('cube', 24)}</span><div><span class="file-name">人形立て.3mf</span><span class="file-type">3D Manufacturing Format</span></div><span class="file-extension">3MF</span></div><dl class="model-facts"><div><dt>作成ツール</dt><dd>Autodesk Fusion</dd></div><div><dt>単位</dt><dd id="model-unit">—</dd></div><div><dt>ボディ数</dt><dd id="model-body-count">—</dd></div><div><dt>サイズ <span class="fact-hint">W × D × H</span></dt><dd id="model-size">—</dd></div></dl></section>
          <section class="inspector-section bodies-section"><div class="section-title-row"><h2>${icon('layers', 17)}ボディ</h2><span class="section-caption">表示 / 非表示</span></div><p class="section-description">各パーツの色と構成を確認できます。</p><ul id="body-list" class="body-list" aria-label="ボディ一覧"></ul><div class="color-note"><span class="note-dot"></span>カラーはモデルに設定された表示色です</div></section>
          <section class="inspector-section drawing-section"><div class="section-kicker">DIMENSIONED VIEWS</div><h2>寸法付き図面</h2><p class="feature-description">正面・側面・上面の投影図と、各ボディの寸法を確認します。</p><button id="open-drawings" type="button" class="button feature-button" disabled>図面・部品寸法を見る</button></section>
          <section id="measurement-panel" class="inspector-section measurement-section" aria-label="2点間の測定"></section>
          <section class="inspector-section interaction-section"><div class="section-kicker">EXPLORE IN 3D</div><h2>操作ガイド</h2><div class="gesture-list"><div>${icon('orbit', 19)}<span>回転</span><span>ドラッグ / 指1本</span></div><div>${icon('hand', 19)}<span>移動</span><span>右ドラッグ / 指2本</span></div><div>${icon('zoom', 19)}<span>拡大・縮小</span><span>スクロール / ピンチ</span></div></div></section>
          <div class="inspector-bottom"><a id="download-model" class="download-link" download>${icon('download', 15)}元の3MFファイル<span>↓</span></a><p class="updated-line">更新 <span id="updated-at">—</span></p></div>
        </aside>
      </div>
      <footer class="page-footer"><span>DESIGNED IN FUSION. EXPLORED IN YOUR BROWSER.</span><span>Fusion / 3MF <span class="footer-separator">·</span> Web 3D Viewer</span></footer>
    </main>`;
}
