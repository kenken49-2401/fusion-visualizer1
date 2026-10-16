import {
  AmbientLight, Box3, Color, DirectionalLight, EdgesGeometry, GridHelper, Group,
  HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector3, WebGLRenderer, Scene,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LoadedModel } from './model-loader';

export type View = 'iso' | 'front' | 'right' | 'top';
const DIRECTIONS: Record<View, Vector3> = {
  iso: new Vector3(1.6, 0.9, 2.5).normalize(),
  front: new Vector3(0, 0, 1),
  right: new Vector3(1, 0, 0),
  top: new Vector3(0, 1, 0.0001).normalize(),
};

export function fitDistance(size: Vector3, aspect: number, fov: number): number {
  const halfFov = fov * Math.PI / 360;
  // Bounding sphere fits from every preset direction, including very wide and tall models.
  const radius = size.length() / 2;
  const limitingHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(aspect, 0.05)));
  return Math.max(radius / Math.sin(limitingHalfFov) * 1.2, 0.001);
}

export class ModelScene {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(36, 1, 0.001, 1000);
  readonly controls: OrbitControls;
  readonly scene = new Scene();
  private frame = 0;
  private grid?: GridHelper;
  private observer: ResizeObserver;
  private bounds = new Box3();
  private floor?: Mesh;
  private model?: Group;
  private fittedDirection = DIRECTIONS.iso.clone();
  private hasMoved = false;
  private contextLost = false;
  onCameraChange?: () => void;

  constructor(private viewport: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0xedf1e7, 0);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '3Dモデル表示');
    canvas.setAttribute('role', 'img');
    this.viewport.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.7;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => { this.hasMoved = true; this.onCameraChange?.(); });
    this.scene.add(new HemisphereLight(0xffffff, 0x9cae91, 2.6), new AmbientLight(0xffffff, 0.45));
    const key = new DirectionalLight(0xffffff, 3);
    key.position.set(3, 6, 5);
    const fill = new DirectionalLight(0xe4edff, 1.5);
    fill.position.set(-4, 2, -3);
    this.scene.add(key, fill);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true;
      this.viewport.dispatchEvent(new CustomEvent('viewer-error', { detail: '3D表示が中断されました。ページを再読み込みしてください。' }));
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(viewport);
    this.resize();
  }

  setModel(model: LoadedModel): void {
    this.model = model.object;
    this.bounds.copy(model.bounds);
    this.scene.add(model.object);
    const size = this.bounds.getSize(new Vector3());
    const span = Math.max(size.x, size.z, size.y * 0.75, 0.01);
    const gridSize = Math.pow(10, Math.floor(Math.log10(span))) * Math.ceil(span / Math.pow(10, Math.floor(Math.log10(span)))) * 3;
    this.grid = new GridHelper(gridSize, 24, 0xbbc7b2, 0xd6dece);
    this.grid.position.y = -span * 0.008;
    this.scene.add(this.grid);
    this.floor = new Mesh(new PlaneGeometry(gridSize * 2, gridSize * 2), new MeshBasicMaterial({ color: new Color('#edf1e7') }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -span * 0.01;
    this.scene.add(this.floor);
    model.bodies.forEach(body => body.meshes.forEach(mesh => {
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry, 25), new LineBasicMaterial({ color: 0x9cae99, transparent: true, opacity: 0.25 }));
      edges.name = '表示用輪郭';
      mesh.add(edges);
    }));
    this.setView('iso');
  }

  setView(view: View): void {
    this.fit(this.bounds, DIRECTIONS[view]);
    this.hasMoved = false;
  }

  fitAll(): void {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.fit(this.bounds, direction.lengthSq() ? direction : DIRECTIONS.iso);
    this.hasMoved = false;
  }

  focus(bounds: Box3): void {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.fit(bounds, direction.lengthSq() ? direction : DIRECTIONS.iso);
    this.hasMoved = true;
  }

  private fit(bounds: Box3, direction: Vector3): void {
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const distance = fitDistance(size, this.camera.aspect, this.camera.fov);
    this.fittedDirection.copy(direction);
    this.camera.near = Math.max(distance / 10000, 0.00001);
    this.camera.far = Math.max(distance * 100, 10);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(size.length() * 0.03, 0.0001);
    this.controls.maxDistance = Math.max(size.length() * 15, 1);
    // Remove residual damping before assigning a preset or the previous gesture can shift it.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.requestRender();
  }

  setGrid(visible: boolean): void {
    if (this.grid) this.grid.visible = visible;
    this.requestRender();
  }

  requestRender(): void {
    if (this.frame || this.contextLost) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const { width, height } = this.viewport.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.model && !this.hasMoved) this.fit(this.bounds, this.fittedDirection);
    this.requestRender();
  }

  dispose(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.scene.traverse(object => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(m => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
