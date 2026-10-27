import { Color, Material, MeshPhongMaterial, SRGBColorSpace } from 'three';
import type { Body } from './model-loader';

export class Appearance {
  private originals = new Map<Body, Map<Body['meshes'][number], Material | Material[]>>();
  private overrides = new Map<Body, MeshPhongMaterial>();

  constructor(private bodies: Body[]) {
    bodies.forEach(body => this.originals.set(body, new Map(body.meshes.map(mesh => [mesh, mesh.material]))));
  }

  set(body: Body, hex?: string): void {
    this.overrides.get(body)?.dispose();
    this.overrides.delete(body);
    if (hex) {
      // Vertex colors may be black; replace the material rather than multiply by the source colors.
      const material = new MeshPhongMaterial({ color: hex, shininess: 28, specular: 0x333333 });
      body.meshes.forEach(mesh => { mesh.material = material; });
      this.overrides.set(body, material);
    } else {
      this.originals.get(body)!.forEach((material, mesh) => { mesh.material = material; });
    }
  }

  apply(colors: Record<string, string>): void {
    this.bodies.forEach(body => this.set(body, colors[body.id]));
  }

  swatch(body: Body): string {
    const first = body.meshes[0];
    const material = (Array.isArray(first.material) ? first.material[0] : first.material) as MeshPhongMaterial;
    const color = material.color?.clone() ?? new Color(0xffffff);
    const vertexColor = first.geometry.getAttribute('color');
    if (material.vertexColors && vertexColor) color.multiply(new Color().fromBufferAttribute(vertexColor, 0));
    return `#${color.getHexString(SRGBColorSpace)}`;
  }
}

/** Explicit instructional colors remain visible in both current and previous steps. */
export function guideBodyColor(colors: Record<string, string>, bodyId: string, current: boolean, complete: boolean): string {
  return colors[bodyId] || (!complete && current ? '#df3b35' : '#8a9c88');
}
