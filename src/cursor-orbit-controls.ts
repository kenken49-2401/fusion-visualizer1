import type { Camera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Three.js 0.186.1 sends page coordinates for pinch zoom, but its cursor zoom
// calculation expects client coordinates. Keep the native dolly/pan gestures and
// normalize this one input boundary so a scrolled page uses the finger midpoint.
const updateZoomParameters = Reflect.get(OrbitControls.prototype, '_updateZoomParameters') as
  (this: OrbitControls, x: number, y: number) => void;

export class CursorOrbitControls extends OrbitControls {
  private touchZoom = false;
  private readonly trackPointer = (event: PointerEvent) => { this.touchZoom = event.pointerType === 'touch'; };
  private readonly trackWheel = () => { this.touchZoom = false; };

  constructor(camera: Camera, private readonly canvas: HTMLElement) {
    super(camera, canvas);
    this.zoomToCursor = true;
    canvas.addEventListener('pointermove', this.trackPointer, true);
    canvas.addEventListener('wheel', this.trackWheel, { capture: true, passive: true });
  }

  _updateZoomParameters(x: number, y: number): void {
    const view = this.canvas.ownerDocument.defaultView;
    updateZoomParameters.call(this,
      x - (this.touchZoom ? view?.scrollX ?? 0 : 0),
      y - (this.touchZoom ? view?.scrollY ?? 0 : 0));
  }

  override dispose(): void {
    this.canvas.removeEventListener('pointermove', this.trackPointer, true);
    this.canvas.removeEventListener('wheel', this.trackWheel, true);
    super.dispose();
  }
}
