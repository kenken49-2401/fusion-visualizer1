import {
  AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, Material, Mesh,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { Body } from './model-loader';

/** Independent resources and absolute mesh transforms; never clone viewer adornments. */
export function cloneBodyForPreview(body: Body): Group {
  const group = new Group();
  for (const source of body.meshes) {
    source.updateWorldMatrix(true, false);
    const materials = Array.isArray(source.material) ? source.material.map(material => material.clone()) : source.material.clone();
    const mesh = new Mesh(source.geometry.clone(), materials);
    mesh.matrix.copy(source.matrixWorld); mesh.matrixAutoUpdate = false; mesh.matrixWorldNeedsUpdate = true;
    mesh.name = source.name; mesh.visible = true;
    group.add(mesh);
  }
  return group;
}

/** Dispose only resources created by cloneBodyForPreview, never the source body. */
export function disposeBodyPreview(group: Group): void {
  const materials = new Set<Material>();
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  materials.forEach(material => material.dispose());
  group.clear();
}

/** One temporary context for the entire batch, released before returning PNG images. */
export async function createBodyThumbnails(bodies: Body[], options: { size?: number } = {}): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  if (!bodies.length) return images;
  const size = Math.max(96, Math.min(256, Math.round(options.size ?? 128)));
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  renderer.setClearColor(0xf1f4eb, 1); renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.00001, 1000);
  scene.add(new HemisphereLight(0xffffff, 0x879979, 2.5), new AmbientLight(0xffffff, 0.8));
  const key = new DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
  const direction = new Vector3(1.6, 1.15, 2.5).normalize();
  let preview: Group | undefined;
  try {
    for (const [index, body] of bodies.entries()) {
      preview = cloneBodyForPreview(body); scene.add(preview);
      const box = new Box3().setFromObject(preview);
      if (!box.isEmpty()) {
        const center = box.getCenter(new Vector3());
        const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.000001);
        const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.13;
        camera.near = Math.max(distance / 10000, 0.00000001); camera.far = distance * 100;
        camera.position.copy(center).addScaledVector(direction, distance); camera.lookAt(center); camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        images.set(body.id, renderer.domElement.toDataURL('image/png'));
      }
      scene.remove(preview); disposeBodyPreview(preview); preview = undefined;
      if (index % 4 === 3) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  } finally {
    if (preview) { scene.remove(preview); disposeBodyPreview(preview); }
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  return images;
}
