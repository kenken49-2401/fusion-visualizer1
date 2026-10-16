import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { Box3, MeshPhongMaterial, Vector3 } from 'three';
import { Appearance } from '../../src/appearance';
import { parseConfig, validateColors } from '../../src/config';
import { parseModel } from '../../src/model-loader';
import { fitDistance } from '../../src/scene';

const orientation = { upAxis: 'Y', frontAxis: 'Y' } as const;
const configuredOrientation = { upAxis: 'Z', frontAxis: 'X' } as const;
const validConfig = {
  schemaVersion: 1, model: 'models/figure-stand.3mf', title: 'Figure stand',
  description: '', updatedAt: '2026-10-16', ...configuredOrientation, colors: {},
};
const mesh = `<object id="1" type="model" name="Duplicate"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>
  <vertex x="0" y="2" z="0"/><vertex x="0" y="0" z="3"/>
  </vertices><triangles><triangle v1="0" v2="2" v3="1"/>
  <triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/>
  <triangle v1="1" v2="2" v3="3"/></triangles></mesh></object>`;
const translated = '1 0 0 0 1 0 0 0 1 10 0 0';

function fixture(options: { unit?: string; components?: boolean; repeated?: boolean } = {}): ArrayBuffer {
  const components = options.components ? `<object id="2" type="model"><components>
    <component objectid="1"/><component objectid="1" transform="${translated}"/>
    </components></object>` : '';
  const build = options.components ? '<item objectid="2"/>' : `<item objectid="1"/>
    ${options.repeated ? `<item objectid="1" transform="${translated}"/>` : ''}`;
  const zipped = zipSync({
    '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/model.model"/>
      </Relationships>`),
    '3D/model.model': strToU8(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="${options.unit ?? 'millimeter'}">
      <resources>${mesh}${components}</resources><build>${build}</build></model>`),
  });
  return Uint8Array.from(zipped).buffer;
}

function actualModel() {
  const file = readFileSync(resolve('public/models/figure-stand.3mf'));
  return parseModel(Uint8Array.from(file).buffer, configuredOrientation);
}

describe('3MF geometry and assembly identity', () => {
  it('parses the shipped Fusion model with its source name, stable ID and triangle count', () => {
    const model = actualModel();
    expect(model.sourceUnit).toBe('millimeter');
    expect(model.triangles).toBe(68);
    expect(model.bodies).toHaveLength(1);
    expect(model.bodies[0]).toMatchObject({ id: 'build:0/object:1', name: 'ボディ2', triangles: 68 });
  });

  it('orients millimeter dimensions into meters, centers X/Z and places the bottom on the floor', () => {
    const model = actualModel();
    const size = model.bounds.getSize(new Vector3());
    [1000, 1500, 40].forEach((value, axis) => expect(model.sizeMM.getComponent(axis)).toBeCloseTo(value, 5));
    [1, 1.5, 0.04].forEach((value, axis) => expect(size.getComponent(axis)).toBeCloseTo(value, 7));
    expect(model.bounds.min.y).toBeCloseTo(0, 10);
    const center = model.bounds.getCenter(new Vector3());
    expect(center.x).toBeCloseTo(0, 10);
    expect(center.z).toBeCloseTo(0, 10);
  });

  it('converts inch coordinates to meters exactly once', () => {
    const model = parseModel(fixture({ unit: 'inch' }), orientation);
    expect(model.sourceUnit).toBe('inch');
    [0.0254, 0.0508, 0.0762].forEach((value, axis) => {
      expect(model.bounds.getSize(new Vector3()).getComponent(axis)).toBeCloseTo(value, 8);
      expect(model.sizeMM.getComponent(axis)).toBeCloseTo(value * 1000, 6);
    });
  });

  it('preserves repeated build instances, their offsets and distinct IDs despite equal names', () => {
    const model = parseModel(fixture({ repeated: true }), orientation);
    expect(model.bodies.map(b => b.id)).toEqual(['build:0/object:1', 'build:1/object:1']);
    expect(model.bodies.map(b => b.name)).toEqual(['Duplicate', 'Duplicate']);
    expect(model.triangles).toBe(8);
    const centers = model.bodies.map(b => new Box3().setFromObject(b.object).getCenter(new Vector3()));
    expect(centers[1].x - centers[0].x).toBeCloseTo(0.01, 9);
    expect(model.sizeMM.x).toBeCloseTo(11, 6);
  });

  it('preserves component references and component transforms in assembly bounds', () => {
    const model = parseModel(fixture({ components: true }), orientation);
    expect(model.bodies.map(b => b.id)).toEqual([
      'build:0/object:2/component:0/object:1', 'build:0/object:2/component:1/object:1',
    ]);
    const bounds = model.bodies.map(b => new Box3().setFromObject(b.object));
    expect(bounds[1].min.x - bounds[0].min.x).toBeCloseTo(0.01, 9);
    expect(model.sizeMM.x).toBeCloseTo(11, 6);
  });

  it('recreates stable identities and dimensions on reload without cumulative scaling', () => {
    const bytes = fixture({ unit: 'inch', components: true });
    const first = parseModel(bytes, configuredOrientation);
    const second = parseModel(bytes, configuredOrientation);
    expect(second.bodies.map(b => b.id)).toEqual(first.bodies.map(b => b.id));
    expect(second.bounds.equals(first.bounds)).toBe(true);
    expect(second.sizeMM.equals(first.sizeMM)).toBe(true);
    expect(second.object).not.toBe(first.object);
  });

  it('rejects nonarchives and unsupported source units', () => {
    expect(() => parseModel(strToU8('not a zip').buffer as ArrayBuffer, orientation)).toThrow(/展開/);
    expect(() => parseModel(fixture({ unit: 'parsec' }), orientation)).toThrow(/対応していない単位/);
  });
});

describe('body appearance', () => {
  it('reads the actual black vertex color and applies a visible override', () => {
    const model = actualModel();
    const body = model.bodies[0];
    const appearance = new Appearance(model.bodies);
    expect(appearance.swatch(body)).toBe('#000000');
    appearance.set(body, '#ee7733');
    expect(appearance.swatch(body)).toBe('#ee7733');
    body.meshes.forEach(m => expect((m.material as MeshPhongMaterial).vertexColors).toBe(false));
  });

  it('restores the exact original materials and black source color after reset', () => {
    const model = actualModel();
    const body = model.bodies[0];
    const originals = body.meshes.map(m => m.material);
    const appearance = new Appearance(model.bodies);
    appearance.set(body, '#00ff00');
    appearance.set(body);
    body.meshes.forEach((m, i) => expect(m.material).toBe(originals[i]));
    expect(appearance.swatch(body)).toBe('#000000');
  });

  it('changes only the selected instance when source geometry and materials are shared', () => {
    const model = parseModel(fixture({ components: true }), orientation);
    const [first, second] = model.bodies;
    const appearance = new Appearance(model.bodies);
    const source = second.meshes.map(m => m.material);
    appearance.apply({ [first.id]: '#ff0000' });
    expect(appearance.swatch(first)).toBe('#ff0000');
    second.meshes.forEach((m, i) => expect(m.material).toBe(source[i]));
    expect(appearance.swatch(second)).not.toBe('#ff0000');
  });

  it('keeps hidden state independent of color changes and resets', () => {
    const model = parseModel(fixture({ repeated: true }), orientation);
    const [first, second] = model.bodies;
    const appearance = new Appearance(model.bodies);
    first.object.visible = false;
    appearance.apply({ [first.id]: '#123456', [second.id]: '#abcdef' });
    appearance.apply({});
    expect(first.object.visible).toBe(false);
    expect(second.object.visible).toBe(true);
  });
});

describe('configuration validation', () => {
  it('accepts local models and normalizes colors without losing assembly paths', () => {
    const id = 'build:0/object:2/component:1/object:1';
    const config = parseConfig({ ...validConfig, colors: { [id]: '#Aa22CC' } });
    expect(config.model).toBe(validConfig.model);
    expect(config.colors[id]).toBe('#aa22cc');
    expect(Object.getPrototypeOf(config.colors)).toBeNull();
  });

  it('rejects external URLs, absolute paths, traversal and encoded traversal', () => {
    for (const model of ['https://example.com/x.3mf', '//example.com/x.3mf', '/models/x.3mf',
      'models/../x.3mf', 'models/a/../../x.3mf', 'models/%2e%2e/x.3mf', 'models/a\\x.3mf']) {
      expect(() => parseConfig({ ...validConfig, model }), model).toThrow(/models/);
    }
  });

  it('rejects unsupported schemas, invalid axes and missing required metadata', () => {
    for (const changes of [{ schemaVersion: 2 }, { schemaVersion: '1' }, { upAxis: 'X' },
      { frontAxis: 'Z' }, { title: ' ' }, { title: 'x'.repeat(161) }, { description: null },
      { updatedAt: 'October 16' }]) {
      expect(() => parseConfig({ ...validConfig, ...changes })).toThrow();
    }
    expect(() => parseConfig(null)).toThrow();
  });

  it('rejects malformed colors, unsafe body keys and excessive override maps', () => {
    for (const colors of [null, [], { body: '#fff' }, { body: '#12345g' }, { body: 'red' },
      { body: 123456 }, { '<script>': '#123456' }, JSON.parse('{"__proto__":"#123456"}')]) {
      expect(() => validateColors(colors)).toThrow();
    }
    const excessive = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`body:${i}`, '#000000']));
    expect(() => validateColors(excessive)).toThrow(/多すぎ/);
  });
});

describe('camera fit', () => {
  it('fits the entire bounding sphere in portrait and landscape viewports', () => {
    const size = new Vector3(10, 2, 0.2);
    const radius = size.length() / 2;
    for (const aspect of [0.4, 1, 2.5]) {
      const distance = fitDistance(size, aspect, 36);
      const halfVertical = 18 * Math.PI / 180;
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance * Math.sin(Math.min(halfVertical, halfHorizontal))).toBeGreaterThan(radius);
    }
    expect(fitDistance(size, 0.4, 36)).toBeGreaterThan(fitDistance(size, 2.5, 36));
  });

  it('produces finite positive distances for empty sizes and transient zero width', () => {
    expect(fitDistance(new Vector3(), 1, 36)).toBeGreaterThan(0);
    const distance = fitDistance(new Vector3(1, 2, 3), 0, 36);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
  });
});
