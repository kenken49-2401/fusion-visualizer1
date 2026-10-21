/** Reuse one generated image per stable body ID in every list and editor. */
export function bodyThumbnail(bodyId: string, name: string, thumbnails: ReadonlyMap<string, string>): HTMLElement {
    const source = thumbnails.get(bodyId);
    if (!source) {
        const fallback = document.createElement('span'); fallback.className = 'body-thumbnail body-thumbnail-missing'; fallback.textContent = '画像なし'; fallback.setAttribute('aria-hidden', 'true'); return fallback;
    }
    const image = document.createElement('img');
    image.className = 'body-thumbnail'; image.src = source; image.alt = `${name}の形状`; image.width = 64; image.height = 64; image.loading = 'lazy'; image.draggable = false; image.dataset.bodyId = bodyId;
    return image;
}
