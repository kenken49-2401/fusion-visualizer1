import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGuide, parseGroups, groupStepBodies, stepBodies } from '../src/schema';
const sample = () => JSON.parse(readFileSync('public/guides/pillar-decoration.json', 'utf8'));
describe('hand-authored guides', () => {
    it('adds only current bodies in red and keeps previous bodies visible', () => { const guide = parseGuide(sample()), first = stepBodies(guide, 0), third = stepBodies(guide, 2); expect(first.visible.size).toBe(1); expect(third.visible.size).toBe(3); expect(third.current.size).toBe(1); expect(third.visible.has(guide.steps[0].bodyIds[0])).toBe(true); expect(third.current.has(guide.steps[0].bodyIds[0])).toBe(false); });
    it('keeps all sample guides as drafts rather than invented production instructions', () => { for (const name of ['figure-stand', 'pillar-decoration', 'signage']) {
        const guide = parseGuide(JSON.parse(readFileSync(`public/guides/${name}.json`, 'utf8')));
        expect(guide.status).toBe('draft');
        expect(guide.summary).toContain('未設定');
        expect(guide.steps.flatMap(s => s.bodyIds).length).toBeGreaterThan(0);
    } });
    it('rejects repeated and missing body assignments', () => { const raw = sample(), ids = raw.steps.flatMap((s: {
        bodyIds: string[];
    }) => s.bodyIds); raw.steps[1].bodyIds = raw.steps[0].bodyIds; expect(() => parseGuide(raw, ids)).toThrow('複数'); const other = sample(); other.steps[0].bodyIds = ['build:999/object:1']; expect(() => parseGuide(other, ids)).toThrow('存在しない'); });
    it('rejects dangling material references, duplicate steps and unknown marker types', () => { const raw = sample(); raw.steps[0].materials[0].materialId = 'missing'; expect(() => parseGuide(raw)).toThrow('物資'); const duplicate = sample(); duplicate.steps[1].id = duplicate.steps[0].id; expect(() => parseGuide(duplicate)).toThrow('ステップID'); const marker = sample(); marker.steps[0].markers[0].type = 'script'; expect(() => parseGuide(marker)).toThrow('種類'); });
    it('requires finite positions, nonzero direction and positive screw length', () => { for (const [field, value] of [['position', [Infinity, 0, 0]], ['direction', [0, 0, 0]], ['lengthMM', 0]] as const) {
        const raw = sample();
        raw.steps[0].markers[0][field] = value;
        expect(() => parseGuide(raw)).toThrow();
    } });
    it('requires complete assignments and explanations before author confirmation', () => { const raw = sample(), ids = raw.steps.flatMap((s: {
        bodyIds: string[];
    }) => s.bodyIds); raw.status = 'ready'; expect(parseGuide(raw, ids).status).toBe('ready'); raw.steps[0].description = ''; expect(() => parseGuide(raw, ids)).toThrow('説明'); const partial = sample(); partial.status = 'ready'; partial.steps.pop(); expect(() => parseGuide(partial, ids)).toThrow('未配置'); });
    it('retains plain Japanese and markup as text data without executing or dropping it', () => { const raw = sample(); raw.steps[0].description = '日本語の説明\n<img src=x onerror=alert(1)>'; expect(parseGuide(raw).steps[0].description).toBe(raw.steps[0].description); });
});


describe('named body groups', () => {
    const withGroups = () => {
        const raw = sample();
        const bodies = raw.steps.flatMap((step: { bodyIds: string[] }) => step.bodyIds) as string[];
        raw.groups = [{ id: 'group-frame', name: ' 支柱と天板 ', bodyIds: bodies.slice(0, 2) }];
        return { raw, bodies };
    };
    it('loads old guides as ungrouped and retains named groups through JSON round trips', () => {
        const legacy = sample(); delete legacy.groups;
        expect(parseGuide(legacy).groups).toEqual([]);
        const { raw, bodies } = withGroups(), guide = parseGuide(raw, bodies);
        expect(guide.groups[0]).toEqual({ id: 'group-frame', name: '支柱と天板', bodyIds: bodies.slice(0, 2) });
        expect(parseGuide(JSON.parse(JSON.stringify(guide)), bodies)).toEqual(guide);
        expect(guide.steps).toEqual(parseGuide(sample()).steps);
    });
    it('rejects empty, invalid, repeated and overlapping group memberships', () => {
        for (const groups of [null, {}, [{ id: '', name: 'まとまり', bodyIds: ['build:0/object:1'] }], [{ id: 'a', name: ' ', bodyIds: ['build:0/object:1'] }], [{ id: 'a', name: 'まとまり', bodyIds: [] }], [{ id: 'a', name: 'まとまり', bodyIds: ['build:0/object:1', 'build:0/object:1'] }], [{ id: 'a', name: '前', bodyIds: ['build:0/object:1'] }, { id: 'b', name: '後', bodyIds: ['build:0/object:1'] }], [{ id: 'a', name: '前', bodyIds: ['build:0/object:1'] }, { id: 'a', name: '後', bodyIds: ['build:1/object:1'] }], [{ id: 'a', name: '前', bodyIds: ['build:0/object:1'] }, { id: 'b', name: ' 前 ', bodyIds: ['build:1/object:1'] }]]) {
            expect(() => parseGroups(groups)).toThrow();
        }
    });
    it('rejects unknown body IDs using the selected model without changing raw steps', () => {
        const { raw, bodies } = withGroups();
        const before = JSON.stringify(raw.steps);
        raw.groups[0].bodyIds = ['build:999/object:missing'];
        expect(() => parseGuide(raw, bodies)).toThrow('存在しない');
        expect(JSON.stringify(raw.steps)).toBe(before);
    });
    it('bounds total group references and preserves case-sensitive names', () => {
        expect(parseGroups([{ id: 'a', name: 'Frame', bodyIds: ['build:0/object:1'] }, { id: 'b', name: 'frame', bodyIds: ['build:1/object:1'] }])).toHaveLength(2);
        const large = Array.from({ length: 1001 }, (_, index) => ({ id: `g-${index}`, name: `G ${index}`, bodyIds: [`build:${index * 2}/object:1`, `build:${index * 2 + 1}/object:1`] }));
        expect(() => parseGroups(large)).toThrow('多すぎ');
        expect(() => parseGroups([{ id: 'a', name: 'あ'.repeat(161), bodyIds: ['build:0/object:1'] }])).toThrow();
    });
    it('group add and removal never steal another step or modify membership', () => {
        const { raw, bodies } = withGroups(), guide = parseGuide(raw, bodies), before = JSON.stringify(guide);
        const groupId = guide.groups[0].id;
        const add = groupStepBodies(guide, 1, groupId, 'add');
        expect(add.blockedBodyIds).toContain(bodies[0]);
        expect(add.bodyIds).not.toContain(bodies[0]);
        expect(add.bodyIds).toContain(bodies[1]);
        expect(JSON.stringify(guide)).toBe(before);
        guide.steps[0].bodyIds = groupStepBodies(guide, 0, groupId, 'remove').bodyIds;
        guide.steps[1].bodyIds = groupStepBodies(guide, 1, groupId, 'add').bodyIds;
        expect(guide.steps[1].bodyIds).toContain(bodies[0]);
        expect(guide.groups[0].bodyIds).toEqual(bodies.slice(0, 2));
        expect(() => parseGuide(guide, bodies)).not.toThrow();
        const state = stepBodies(guide, 1);
        expect(state.current.has(bodies[0])).toBe(true);
        expect(state.current.has(bodies[1])).toBe(true);
    });
    it('editing or deleting groups leaves all existing step assignments intact', () => {
        const { raw, bodies } = withGroups(), guide = parseGuide(raw, bodies), assigned = guide.steps.map(step => [...step.bodyIds]);
        guide.groups[0].name = '別のまとまり';
        guide.groups[0].bodyIds = [bodies[2]];
        expect(parseGuide(guide, bodies).steps.map(step => step.bodyIds)).toEqual(assigned);
        guide.groups = [];
        expect(parseGuide(guide, bodies).steps.map(step => step.bodyIds)).toEqual(assigned);
    });
});
