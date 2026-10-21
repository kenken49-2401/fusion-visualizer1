import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshPhongMaterial } from 'three';
import type { Body } from '../../src/model-loader';

const state = vi.hoisted(() => ({ contexts: [] as { dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn>; setSize: ReturnType<typeof vi.fn> }[], fail: false, disposedGeometry: 0 }));
vi.mock('three', async importOriginal => {
  const real = await importOriginal<typeof import('three')>();
  return { ...real, WebGLRenderer: class {
    domElement = Object.assign(document.createElement('canvas'), { toDataURL: () => { if (state.fail) throw new Error('capture failed'); return 'data:image/png;base64,preview'; } });
    dispose = vi.fn(); forceContextLoss = vi.fn(); setSize = vi.fn();
    constructor() { state.contexts.push(this); }
    setPixelRatio() {} setClearColor() {}
    render(scene: import('three').Scene) { scene.traverse(object => { if (object instanceof real.Mesh) object.geometry.addEventListener('dispose', () => { state.disposedGeometry++; }); }); }
  } };
});
import { createBodyThumbnails } from '../../src/body-thumbnails';

function bodies(): Body[] {
  return ['one', 'two', 'three'].map(id => { const object = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshPhongMaterial()); object.add(mesh); object.updateMatrixWorld(true); return { id, name: id, object, meshes: [mesh], triangles: 12 }; });
}

describe('thumbnail renderer lifetime', () => {
  it('uses one context for the entire batch and releases clone resources and context after capture', async () => {
    state.contexts.length = 0; state.disposedGeometry = 0; state.fail = false;
    const source = bodies(); const disposals = source.map(body => vi.spyOn(body.meshes[0].geometry, 'dispose'));
    const result = await createBodyThumbnails(source);
    expect([...result.keys()]).toEqual(['one', 'two', 'three']); expect(state.contexts).toHaveLength(1);
    expect(state.contexts[0].setSize).toHaveBeenCalledWith(128, 128, false);
    expect(state.contexts[0].dispose).toHaveBeenCalledOnce(); expect(state.contexts[0].forceContextLoss).toHaveBeenCalledOnce();
    expect(state.disposedGeometry).toBe(3); disposals.forEach(dispose => expect(dispose).not.toHaveBeenCalled());
  });
  it('still releases the context and current clone after a failed PNG capture', async () => {
    state.contexts.length = 0; state.disposedGeometry = 0; state.fail = true;
    await expect(createBodyThumbnails(bodies())).rejects.toThrow('capture failed');
    expect(state.contexts).toHaveLength(1); expect(state.contexts[0].dispose).toHaveBeenCalledOnce(); expect(state.contexts[0].forceContextLoss).toHaveBeenCalledOnce(); expect(state.disposedGeometry).toBe(1);
    state.fail = false;
  });
});
