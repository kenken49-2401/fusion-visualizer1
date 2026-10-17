import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGuide, stepBodies } from '../src/schema';
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
