import { unzipSync, strFromU8 } from 'fflate';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { Box3, Group, Mesh, Vector3 } from 'three';
import type { ViewerConfig } from './config';

const METERS_PER_UNIT: Record<string, number> = {
  micron: 0.000001, millimeter: 0.001, centimeter: 0.01,
  inch: 0.0254, foot: 0.3048, meter: 1,
};

export interface Body {
  id: string;
  name: string;
  object: Group;
  meshes: Mesh[];
  triangles: number;
}

export interface LoadedModel {
  object: Group;
  bodies: Body[];
  sourceUnit: string;
  sizeMM: Vector3;
  bounds: Box3;
  triangles: number;
  fingerprint?: string;
}

const children = (node: Element, name: string) => Array.from(node.children).filter(n => n.localName === name);
const child = (node: Element, name: string) => children(node, name)[0];

function xml(data: Uint8Array | undefined): Document {
  if (!data) throw new Error('3MF 内のモデルデータが見つかりません。');
  const result = new DOMParser().parseFromString(strFromU8(data), 'application/xml');
  if (result.getElementsByTagName('parsererror').length) throw new Error('3MF 内の XML が破損しています。');
  return result;
}

export function parseModel(data: ArrayBuffer, config: Pick<ViewerConfig, 'upAxis' | 'frontAxis'>): LoadedModel {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(data)); } catch { throw new Error('3MF ファイルを展開できません。ファイル形式を確認してください。'); }
  const relationships = xml(files['_rels/.rels']);
  const relationship = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).find(
    n => n.getAttribute('Type')?.endsWith('/3dmodel'),
  );
  if (!relationship || relationship.getAttribute('TargetMode') === 'External') throw new Error('3MF のモデル参照が不正です。');
  const path = (relationship.getAttribute('Target') || '').replace(/^\//, '');
  const modelXML = xml(files[path]);
  if (Object.keys(files).filter(name => name.endsWith('.model')).length !== 1) {
    throw new Error('複数モデル部品を参照する3MFには未対応です。Fusionから通常の3MFとして書き出してください。');
  }
  const root = modelXML.documentElement;
  const sourceUnit = root.getAttribute('unit') || 'millimeter';
  const scale = METERS_PER_UNIT[sourceUnit];
  if (!scale) throw new Error(`対応していない単位です: ${sourceUnit}`);
  const resources = child(root, 'resources');
  const build = child(root, 'build');
  if (!resources || !build) throw new Error('3MF の構造が不正です。');
  const objects = new Map(children(resources, 'object').map(n => [n.getAttribute('id'), n]));
  const loaded = new ThreeMFLoader().parse(data);
  const bodies: Body[] = [];
  // Match the loader's build/component order to original resource IDs, independent of display names.
  function visit(element: Element, sceneObject: Group, id: string, depth: number): void {
    if (depth > 64) throw new Error('モデル階層が深すぎます。');
    if (child(element, 'mesh')) {
      const meshes: Mesh[] = [];
      sceneObject.traverse(o => { if (o instanceof Mesh) meshes.push(o); });
      const triangles = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, 0);
      bodies.push({ id, name: element.getAttribute('name') || `ボディ ${element.getAttribute('id')}`, object: sceneObject, meshes, triangles });
    } else {
      const components = child(element, 'components');
      if (!components) return;
      children(components, 'component').forEach((component, i) => {
        const objectId = component.getAttribute('objectid');
        const target = objects.get(objectId);
        if (!target || !sceneObject.children[i]) throw new Error('3MF 内の部品参照が不正です。');
        visit(target, sceneObject.children[i] as Group, `${id}/component:${i}/object:${objectId}`, depth + 1);
      });
    }
  }
  children(build, 'item').forEach((item, i) => {
    const objectId = item.getAttribute('objectid');
    const target = objects.get(objectId);
    if (!target || !loaded.children[i]) throw new Error('3MF 内のボディ参照が不正です。');
    visit(target, loaded.children[i] as Group, `build:${i}/object:${objectId}`, 0);
  });
  if (!bodies.length || bodies.some(body => !body.meshes.length)) throw new Error('表示できるボディがありません。');
  // ThreeMFLoader r186 reads the unit but leaves coordinates unscaled. Apply it exactly once here.
  const oriented = new Group();
  oriented.add(loaded);
  loaded.scale.setScalar(scale);
  if (config.upAxis === 'Z') loaded.rotation.x = -Math.PI / 2;
  if (config.frontAxis === 'X') oriented.rotation.y = Math.PI / 2;
  const container = new Group();
  container.add(oriented);
  container.updateMatrixWorld(true);
  const sourceBounds = new Box3().setFromObject(container);
  const size = sourceBounds.getSize(new Vector3());
  if (sourceBounds.isEmpty() || !size.toArray().every(Number.isFinite) || size.length() === 0) throw new Error('モデルの寸法を計算できません。');
  const center = sourceBounds.getCenter(new Vector3());
  // Translate the complete assembly. Never recenter individual bodies.
  oriented.position.set(-center.x, -sourceBounds.min.y, -center.z);
  container.updateMatrixWorld(true);
  return {
    object: container, bodies, sourceUnit,
    sizeMM: size.clone().multiplyScalar(1000),
    bounds: new Box3().setFromObject(container),
    triangles: bodies.reduce((n, body) => n + body.triangles, 0),
  };
}

export async function loadModel(config: ViewerConfig): Promise<LoadedModel> {
  const response = await fetch(`${import.meta.env.BASE_URL}${config.model}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`3Dモデルを取得できませんでした（${response.status}）。`);
  const data = await response.arrayBuffer();
  const model = parseModel(data, config);
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    model.fingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    let hash = 2166136261;
    for (const byte of new Uint8Array(data)) hash = Math.imul(hash ^ byte, 16777619);
    model.fingerprint = `${data.byteLength}-${hash >>> 0}`;
  }
  return model;
}
