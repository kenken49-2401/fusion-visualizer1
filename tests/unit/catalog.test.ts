import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCatalog, parseConfig } from '../../src/config';
import { parseModel } from '../../src/model-loader';

describe('published model catalog', () => {
  it('resolves all three originals with their actual body counts, triangles and dimensions', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('public/catalog.json', 'utf8')));
    expect(catalog.map(entry => entry.id)).toEqual(['figure-stand', 'pillar-decoration', 'signage']);
    const counts = [1, 4, 31], triangles = [68, 348, 1876];
    const sizes = [[1000, 1500, 40], [975, 1990, 845], [940, 2141.856384, 930]];
    catalog.forEach((entry, index) => {
      const config = parseConfig(JSON.parse(readFileSync(`public/${entry.config}`, 'utf8')));
      const model = parseModel(Uint8Array.from(readFileSync(`public/${config.model}`)).buffer, config);
      expect(model.bodies).toHaveLength(counts[index]); expect(model.triangles).toBe(triangles[index]);
      model.sizeMM.toArray().forEach((size, axis) => expect(size).toBeCloseTo(sizes[index][axis], 2));
      expect(new Set(model.bodies.map(body => body.id)).size).toBe(counts[index]);
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
