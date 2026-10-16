import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validateColors } from './config.ts';

const children = (node: Element, name: string): Element[] => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name);
const child = (node: Element, name: string) => children(node, name)[0];

/** Bake colors into material resources, isolating repeated assembly occurrences. */
export function bakeColors(input: Uint8Array, requested: Record<string, string>): Uint8Array {
  const colors = validateColors(requested);
  if (!Object.keys(colors).length) return input;
  const files = unzipSync(input);
  const parse = (data: Uint8Array | undefined) => {
    if (!data) throw new Error('3MF のモデル参照が不正です。');
    const source = strFromU8(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('3MF XML の宣言には対応していません。');
    return new DOMParser().parseFromString(source, 'application/xml');
  };
  const rels = parse(files['_rels/.rels']);
  const rel = Array.from(rels.getElementsByTagNameNS('*', 'Relationship')).find(n => n.getAttribute('Type')?.endsWith('/3dmodel'));
  const path = rel?.getAttribute('Target')?.replace(/^\//, '');
  if (!path || rel?.getAttribute('TargetMode') === 'External' || Object.keys(files).filter(p => p.endsWith('.model')).length !== 1) throw new Error('3MF のモデル参照が不正です。');
  const doc = parse(files[path]);
  const root = doc.documentElement!;
  const resources = child(root, 'resources');
  const build = child(root, 'build');
  if (!resources || !build) throw new Error('3MF の構造が不正です。');
  const objects = new Map(children(resources, 'object').map(n => [n.getAttribute('id')!, n]));
  let next = Math.max(0, ...Array.from(resources.childNodes).filter((n): n is Element => n.nodeType === 1).map(n => Number(n.getAttribute('id')) || 0)) + 1;
  const counts = new Map<string, number>();
  const known = new Set<string>();
  function scan(id: string, path: string, depth: number): void {
    if (depth > 64) throw new Error('モデル階層が深すぎます。');
    const object = objects.get(id);
    if (!object) throw new Error('3MF 内の部品参照が不正です。');
    counts.set(id, (counts.get(id) || 0) + 1);
    if (child(object, 'mesh')) known.add(path);
    const components = child(object, 'components');
    if (components) children(components, 'component').forEach((ref, i) => scan(ref.getAttribute('objectid')!, `${path}/component:${i}/object:${ref.getAttribute('objectid')}`, depth + 1));
  }
  const items = children(build, 'item');
  items.forEach((ref, i) => scan(ref.getAttribute('objectid')!, `build:${i}/object:${ref.getAttribute('objectid')}`, 0));
  if (Object.keys(colors).some(id => !known.has(id))) throw new Error('存在しないボディの色設定です。再読み込みしてください。');
  const targets = Object.keys(colors);
  function update(id: string, path: string): string {
    if (!targets.some(key => key === path || key.startsWith(`${path}/`))) return id;
    let object = objects.get(id)!;
    if ((counts.get(id) || 0) > 1) {
      object = object.cloneNode(true) as Element;
      object.setAttribute('id', String(next++));
      resources.appendChild(object);
    }
    if (colors[path]) {
      const materialId = String(next++);
      const materials = doc.createElementNS(root.namespaceURI, 'basematerials');
      materials.setAttribute('id', materialId);
      const base = doc.createElementNS(root.namespaceURI, 'base');
      base.setAttribute('name', 'Body color'); base.setAttribute('displaycolor', `${colors[path]}ff`);
      materials.appendChild(base); resources.appendChild(materials);
      object.setAttribute('pid', materialId); object.setAttribute('pindex', '0');
      const triangles = child(child(object, 'mesh')!, 'triangles')!;
      children(triangles, 'triangle').forEach(triangle => ['pid', 'p1', 'p2', 'p3'].forEach(name => triangle.removeAttribute(name)));
    } else {
      children(child(object, 'components')!, 'component').forEach((ref, i) => {
        const originalId = ref.getAttribute('objectid')!;
        ref.setAttribute('objectid', update(originalId, `${path}/component:${i}/object:${originalId}`));
      });
    }
    return object.getAttribute('id')!;
  }
  items.forEach((ref, i) => {
    const id = ref.getAttribute('objectid')!;
    ref.setAttribute('objectid', update(id, `build:${i}/object:${id}`));
  });
  files[path] = strToU8(new XMLSerializer().serializeToString(doc));
  return zipSync(files);
}
