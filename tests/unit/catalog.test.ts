import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseGuide } from '../../assembly-guide/src/schema';
import { parseCatalog, parseConfig } from '../../src/config';
import { parseModel } from '../../src/model-loader';

describe('published model catalog', () => {
  it('resolves all five originals with their actual body counts, triangles and dimensions', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('public/catalog.json', 'utf8')));
    expect(catalog.map(entry => entry.id)).toEqual(['figure-stand', 'pillar-decoration', 'signage', 'standing-desk-large', 'standing-desk-small']);
    const counts = [1, 4, 31, 19, 13], triangles = [68, 348, 1876, 308, 428];
    const sizes = [[1000, 1500, 40], [975, 1990, 845], [940, 2141.856384, 930], [2300, 980, 880], [1820, 992, 910]];
    catalog.forEach((entry, index) => {
      const config = parseConfig(JSON.parse(readFileSync(`public/${entry.config}`, 'utf8')));
      const model = parseModel(Uint8Array.from(readFileSync(`public/${config.model}`)).buffer, config);
      expect(model.bodies).toHaveLength(counts[index]); expect(model.triangles).toBe(triangles[index]);
      model.sizeMM.toArray().forEach((size, axis) => expect(size).toBeCloseTo(sizes[index][axis], 2));
      expect(new Set(model.bodies.map(body => body.id)).size).toBe(counts[index]);
    });
  });
  it('publishes both attached desks byte-for-byte in the independent guide with complete draft body references', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('assembly-guide/public/catalog.json', 'utf8')));
    expect(catalog.map(entry => entry.id)).toEqual(['figure-stand', 'pillar-decoration', 'signage', 'standing-desk-large', 'standing-desk-small']);
    const originals: Record<string, string> = {
      'standing-desk-large': '819f6f80b2dd821e64b91604044ff49411d5e01696a4ecd466867fa90c9a1639',
      'standing-desk-small': 'a854f399ed372d4ec4420ac102cfd0fc5b9e120250ebf9fd5239c73f466918a1',
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
      expect(guide.productId).toBe(id); expect(guide.title).toBe(config.title); expect(guide.status).toBe('draft');
      expect(guide.steps).toHaveLength(1);
      expect(guide.steps[0].bodyIds).toEqual(ids);
      expect(guide.steps[0].tools).toEqual([]); expect(guide.steps[0].methods).toEqual([]); expect(guide.steps[0].markers).toEqual([]);
      expect(guide.summary).toContain('未確認');
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
    const counts = [1, 4, 31, 19, 13];
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
