import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseGuide } from '../../assembly-guide/src/schema';
import { parseCatalog, parseConfig } from '../../src/config';
import { parseModel } from '../../src/model-loader';

describe('published model catalog', () => {
  it('resolves all published models with their actual body counts, triangles and dimensions', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('public/catalog.json', 'utf8')));
    expect(catalog.map(entry => entry.id)).toEqual(['standing-desk-large', 'standing-desk-small', 'menu-sign']);
    const counts = [23, 14, 9], triangles = [636, 444, 188];
    const sizes = [[2730.000064, 992, 910], [1820, 992, 910], [1820, 2800, 480]];
    catalog.forEach((entry, index) => {
      const config = parseConfig(JSON.parse(readFileSync(`public/${entry.config}`, 'utf8')));
      const model = parseModel(Uint8Array.from(readFileSync(`public/${config.model}`)).buffer, config);
      expect(model.bodies).toHaveLength(counts[index]); expect(model.triangles).toBe(triangles[index]);
      model.sizeMM.toArray().forEach((size, axis) => expect(size).toBeCloseTo(sizes[index][axis], 2));
      expect(new Set(model.bodies.map(body => body.id)).size).toBe(counts[index]);
    });
  });
  it('publishes attached models byte-for-byte in the independent guide with complete body references', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('assembly-guide/public/catalog.json', 'utf8')));
    expect(catalog.map(entry => entry.id)).toEqual(['standing-desk-large', 'standing-desk-small', 'menu-sign']);
    const originals: Record<string, string> = {
      'menu-sign': 'b69b7fd61f1ea616178bd98db919b6471b7dc7168822f11176bf7d05aa4ec93a',
      'standing-desk-large': '56b674d6e6fb53ef5c18b110f193a4e805e28deddad8d9127c269457065bb180',
      'standing-desk-small': 'a0f125705d14596c80aef17c944c1e8ccbf6f91836fc51123bd9098451748f4e',
    };
    for (const [id, fingerprint] of Object.entries(originals)) {
      const entry = catalog.find(entry => entry.id === id)!;
      const config = parseConfig(JSON.parse(readFileSync(`assembly-guide/public/${entry.config}`, 'utf8')));
      expect(config).toEqual(parseConfig(JSON.parse(readFileSync(`public/${entry.config}`, 'utf8'))));
      const bytes = readFileSync(`assembly-guide/public/${config.model}`);
      expect(bytes.equals(readFileSync(`public/${config.model}`))).toBe(true);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fingerprint);
      expect(config.upAxis).toBe('Z'); expect(config.frontAxis).toBe('Y');
      const model = parseModel(Uint8Array.from(bytes).buffer, config);
      const ids = model.bodies.map(body => body.id);
      const guide = parseGuide(JSON.parse(readFileSync(`assembly-guide/public/guides/${id}.json`, 'utf8')), ids);
      expect(guide.productId).toBe(id); expect(guide.title).toBe(config.title);
      if (id === 'standing-desk-large') {
        expect(guide.status).toBe('ready'); expect(guide.steps.map(step => step.bodyIds.length)).toEqual([1, 6, 14, 2]);
        expect(new Set(guide.steps.flatMap(step => step.bodyIds))).toEqual(new Set(ids));
        const names = new Map(model.bodies.map(body => [body.id, body.name]));
        expect(guide.steps.map(step => step.bodyIds.map(id => names.get(id)))).toEqual([
          ['天板支え'], ['足1', '足2', '足3', '足4', 'P3_1', 'P3_2'],
          ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], ['天板大', '天板小'],
        ]);
        for (const [index, split] of [[1, 4], [2, 6]]) {
          const colors = guide.steps[index].bodyIds.map(id => config.colors[id]);
          expect(new Set(colors.slice(0, split)).size).toBe(1); expect(new Set(colors.slice(split)).size).toBe(1);
          expect(colors[0]).not.toBe(colors[split]);
        }
        expect(guide.steps.every(step => !step.tools.length && !step.methods.length && !step.markers.length)).toBe(true);
        continue;
      }
      expect(guide.status).toBe('ready');
      expect(new Set(guide.steps.flatMap(step => step.bodyIds))).toEqual(new Set(ids));
      if (id === 'standing-desk-small') {
        expect(guide.steps.map(step => step.bodyIds.length)).toEqual([1, 4, 8, 1]);
        const names = new Map(model.bodies.map(body => [body.id, body.name]));
        expect(guide.steps.map(step => step.bodyIds.map(id => names.get(id)))).toEqual([
          ['天板支え'], ['足1', '足2', '足3', '足4'],
          ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'], ['天板'],
        ]);
        const colors = guide.steps[2].bodyIds.map(id => config.colors[id]);
        expect(new Set(colors.slice(0, 4)).size).toBe(1); expect(new Set(colors.slice(4)).size).toBe(1);
        expect(colors[0]).not.toBe(colors[4]);
      } else {
        expect(guide.steps.map(step => step.title)).toEqual(['人形立てを用意する', 'メニュー看板を上に載せる', '固定する', '立てる', 'テントに紐で固定する']);
        expect(guide.steps.map(step => step.bodyIds.length)).toEqual([8, 1, 0, 0, 0]);
        expect(guide.steps[1].bodyIds).toEqual(['build:0/object:1']);
        expect(guide.steps[4].materials).toEqual([{ materialId: 'tie-rope', quantity: '未指定' }]);
      }
      expect(guide.steps.every(step => !step.markers.length && !step.tools.length)).toBe(true);
    }
  });
  it('resolves every independent guide catalog entry against its complete model body IDs', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('assembly-guide/public/catalog.json', 'utf8')));
    for (const entry of catalog) {
      const config = parseConfig(JSON.parse(readFileSync(`assembly-guide/public/${entry.config}`, 'utf8')));
      const bytes = readFileSync(`assembly-guide/public/${config.model}`);
      const model = parseModel(Uint8Array.from(bytes).buffer, config);
      const ids = model.bodies.map(body => body.id);
      const guide = parseGuide(JSON.parse(readFileSync(`assembly-guide/public/guides/${entry.id}.json`, 'utf8')), ids);
      expect(guide.productId).toBe(entry.id); expect(guide.title).toBe(config.title);
      expect(new Set(guide.steps.flatMap(step => step.bodyIds))).toEqual(new Set(ids));
    }
  });
  it('maps every shipped part material to its actual body instance in loaded order without mapping fasteners or tools', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('assembly-guide/public/catalog.json', 'utf8')));
    const counts = [23, 14, 9];
    catalog.forEach((entry, index) => {
      const config = parseConfig(JSON.parse(readFileSync(`assembly-guide/public/${entry.config}`, 'utf8')));
      const bytes = readFileSync(`assembly-guide/public/${config.model}`);
      const ids = parseModel(Uint8Array.from(bytes).buffer, config).bodies.map(body => body.id);
      const raw = JSON.parse(readFileSync(`assembly-guide/public/guides/${entry.id}.json`, 'utf8'));
      const guide = parseGuide(raw, ids);
      const materials = guide.materials.filter(material => /^part-\d+$/.test(material.id));
      expect(materials).toHaveLength(counts[index]);
      expect(materials.map(material => material.id)).toEqual(ids.map((_, i) => `part-${i + 1}`));
      expect(materials.map(material => material.bodyId)).toEqual(ids);
      expect(new Set(materials.map(material => material.bodyId)).size).toBe(ids.length);
      // Unknown source keys must not hide accidental mappings stripped by parsing.
      expect(raw.materials.filter((material: { id: string }) => !/^part-\d+$/.test(material.id))
        .every((material: { bodyId?: string }) => material.bodyId === undefined)).toBe(true);
      expect(guide.materials.filter(material => !/^part-\d+$/.test(material.id))
        .every(material => material.bodyId === undefined)).toBe(true);
      expect(materials.every(material => material.icon === 'part')).toBe(true);
    });
  });
  it('rejects duplicate IDs, arbitrary config URLs and traversal', () => {
    const entry = { id: 'model', title: 'model', config: 'viewer.json' };
    expect(() => parseCatalog({ schemaVersion: 1, models: [entry, entry] })).toThrow();
    for (const config of ['../viewer.json', 'https://example.com/model.json', 'models/../viewer.json']) {
      expect(() => parseCatalog({ schemaVersion: 1, models: [{ ...entry, config }] })).toThrow();
    }
  });
});
