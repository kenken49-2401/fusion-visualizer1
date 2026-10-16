import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { measurePart, mountDrawings, projectedBounds, projectPoint } from '../../src/drawings';
import type { Body, LoadedModel } from '../../src/model-loader';

function body(geometry: BufferGeometry = new BoxGeometry(1, 2, 3)): Body {
  const object = new Group(), mesh = new Mesh(geometry, new MeshBasicMaterial());
  object.add(mesh);
  return { id: 'instance:1', name: '<img src=x onerror=alert(1)>', object, meshes: [mesh], triangles: 12 };
}

describe('drawing measurements', () => {
  it('projects consistent front, right and top directions without changing 3D data', () => {
    const point = new Vector3(2, 3, 4);
    expect(projectPoint(point, 'front')).toEqual([2, -3]);
    expect(projectPoint(point, 'back')).toEqual([-2, -3]);
    expect(projectPoint(point, 'right')).toEqual([-4, -3]);
    expect(projectPoint(point, 'left')).toEqual([4, -3]);
    expect(projectPoint(point, 'top')).toEqual([2, 4]);
    expect(projectPoint(point, 'bottom')).toEqual([2, -4]);
    expect(point.toArray()).toEqual([2, 3, 4]);
    const box = new Box3(new Vector3(-1, 0, -2), new Vector3(2, 4, 3));
    expect(projectedBounds(box, 'front')).toMatchObject({ widthMM: 3000, heightMM: 4000 });
    expect(projectedBounds(box, 'right')).toMatchObject({ widthMM: 5000, heightMM: 4000 });
    expect(projectedBounds(box, 'top')).toMatchObject({ widthMM: 3000, heightMM: 5000 });
    expect(projectedBounds(box, 'back')).toMatchObject({ minX: -2, maxX: 1, widthMM: 3000, heightMM: 4000 });
    expect(projectedBounds(box, 'left')).toMatchObject({ minX: -2, maxX: 3, widthMM: 5000, heightMM: 4000 });
    expect(projectedBounds(box, 'bottom')).toMatchObject({ minY: -3, maxY: 2, widthMM: 3000, heightMM: 5000 });
  });

  it('uses nested scale, translation and rotation, including hidden instance bodies', () => {
    const part = body();
    const parent = new Group(); parent.scale.setScalar(0.001); parent.position.set(5, 2, 1); parent.add(part.object);
    part.object.scale.set(2, 3, 4); part.object.rotation.z = Math.PI / 2; part.object.visible = false;
    const result = measurePart(part, 3);
    expect(result.number).toBe(4); expect(result.id).toBe(part.id);
    [6, 2, 12].forEach((v, i) => expect(result.sizeMM.getComponent(i)).toBeCloseTo(v, 4));
    expect(result.bounds.getCenter(new Vector3()).toArray()).toEqual([5, 2, 1]);
    const lengths = [...new Set(result.edges.map(e => Math.round(e.lengthMM)))].sort((a,b) => a-b);
    expect(lengths).toEqual([2, 6, 12]);
    expect(result.edges).toHaveLength(12); // coplanar triangle diagonals are excluded
    expect(part.meshes[0].geometry.getAttribute('position').getX(0)).toBe(0.5);
  });

  it('measures diagonal mesh edges in 3D rather than their shorter projection', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, 0.003,0.004,0.012, 0.003,0,0], 3));
    const part = body(geometry);
    const measured = measurePart(part, 0);
    expect(measured.edges[0].lengthMM).toBeCloseTo(13, 5);
    const edge = measured.edges[0];
    const start = projectPoint(edge.start, 'front'), end = projectPoint(edge.end, 'front');
    expect(Math.hypot(end[0]-start[0], end[1]-start[1]) * 1000).toBeCloseTo(5, 5);
    expect(projectedBounds(measured.bounds, 'front').heightMM).toBeCloseTo(4, 5);
  });
});

describe('drawing dialog', () => {
  it('disambiguates repeated names, renders names as text and disposes its trigger', () => {
    const first = body(), second = body(); second.id = 'instance:2'; second.object.position.x = 2;
    const object = new Group(); object.add(first.object, second.object); object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    const model: LoadedModel = { object, bodies: [first, second], bounds, sizeMM: bounds.getSize(new Vector3()).multiplyScalar(1000), sourceUnit: 'meter', triangles: 24 };
    const trigger = document.createElement('button'); document.body.append(trigger);
    const original = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    try {
      const dispose = mountDrawings({ model, title: '<script>unsafe</script>', trigger });
      trigger.click();
      const dialog = document.querySelector('.drawings-dialog')!;
      expect(dialog.querySelector('script,img')).toBeNull();
      expect(dialog.querySelectorAll('tbody tr')).toHaveLength(2);
      const select = dialog.querySelector<HTMLSelectElement>('select[aria-label="図面の部品"]')!;
      expect(select.options[1].textContent).toBe(`1. ${first.name}`);
      expect(select.options[2].textContent).toBe(`2. ${second.name}`);
      select.value = '1'; select.dispatchEvent(new Event('change'));
      expect(dialog.querySelector('select[aria-label="辺の3D実長"]')).not.toBeNull();
      expect(dialog.querySelector('[data-selected-edge]')).not.toBeNull();
      expect(dialog.querySelector('[data-edge-label]')?.textContent).toContain('3D実長');
      dispose(); trigger.click(); expect(document.querySelector('.drawings-dialog')).toBeNull();
    } finally { HTMLDialogElement.prototype.showModal = original; trigger.remove(); }
  });
});


describe('edge annotations use actual model coordinates', () => {
  it('auto-labels a selected part, selects the tapped edge, and keeps endpoints and true length together across views', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, .003, .004, .012, .003, 0, 0], 3));
    const part = body(geometry), object = new Group(); object.add(part.object); object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    const model: LoadedModel = { object, bodies: [part], bounds, sizeMM: bounds.getSize(new Vector3()).multiplyScalar(1000), sourceUnit: 'meter', triangles: 1 };
    const trigger = document.createElement('button'); document.body.append(trigger);
    const originalModal = HTMLDialogElement.prototype.showModal;
    const originalScroll = Element.prototype.scrollIntoView;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    Element.prototype.scrollIntoView = () => {};
    let dispose = () => {};
    try {
      dispose = mountDrawings({ model, title: '3D diagonal', trigger }); trigger.click();
      const dialog = document.querySelector('.drawings-dialog')!;
      // The overview's numbered body itself opens the part and labels a visible edge.
      dialog.querySelector<SVGElement>('[data-drawing-part="0"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="図面の部品"]')!.value).toBe('0');
      const edges = measurePart(part, 0).edges;
      const check = (index: number, view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom') => {
        const line = dialog.querySelector<SVGLineElement>('[data-selected-edge]')!;
        expect(line).not.toBeNull();
        expect(Number(line.getAttribute('data-length-mm'))).toBeCloseTo(edges[index].lengthMM, 5);
        expect(dialog.querySelectorAll('[data-edge-endpoint]')).toHaveLength(2);
        for (const [name, x, y] of [['start', 'x1', 'y1'], ['end', 'x2', 'y2']]) {
          const marker = dialog.querySelector(`[data-edge-endpoint="${name}"]`)!;
          expect(Number(marker.getAttribute('cx'))).toBeCloseTo(Number(line.getAttribute(x)), 8);
          expect(Number(marker.getAttribute('cy'))).toBeCloseTo(Number(line.getAttribute(y)), 8);
        }
        const start = projectPoint(edges[index].start, view), end = projectPoint(edges[index].end, view);
        const dx = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
        const dy = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
        // Matching cross products proves the annotation follows this edge's projection.
        expect(dx * (end[1] - start[1]) - dy * (end[0] - start[0])).toBeCloseTo(0, 5);
        const formatted = edges[index].lengthMM.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        expect(dialog.querySelector('[data-edge-label]')?.textContent).toContain(formatted);
      };
      check(0, 'front');
      expect(Number(dialog.querySelector('[data-selected-edge]')!.getAttribute('data-length-mm'))).toBeCloseTo(13, 5);
      expect(dialog.querySelector('[data-edge-label]')?.textContent).toContain('3D実長');
      // Click a different real edge instead of changing the edge dropdown.
      dialog.querySelector<SVGElement>('[data-drawing-edge="1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="辺の3D実長"]')!.value).toBe('1'); check(1, 'front');
      const direction = dialog.querySelector<HTMLSelectElement>('select[aria-label="図面の方向"]')!;
      const frontCoordinates = dialog.querySelector('[data-selected-edge]')!.outerHTML;
      direction.value = 'right'; direction.dispatchEvent(new Event('change'));
      expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="辺の3D実長"]')!.value).toBe('1'); check(1, 'right');
      expect(dialog.querySelector('[data-selected-edge]')!.outerHTML).not.toBe(frontCoordinates);
      direction.value = 'top'; direction.dispatchEvent(new Event('change')); check(1, 'top');
      expect(Array.from(direction.options).map(option => option.value).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
      for (const view of ['back', 'left', 'bottom', 'front', 'right', 'top'] as const) {
        direction.value = view; direction.dispatchEvent(new Event('change'));
        expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="辺の3D実長"]')!.value).toBe('1');
        check(1, view);
      }
    } finally {
      dispose(); trigger.remove(); HTMLDialogElement.prototype.showModal = originalModal; Element.prototype.scrollIntoView = originalScroll;
      geometry.dispose(); (part.meshes[0].material as MeshBasicMaterial).dispose();
    }
  });
});
