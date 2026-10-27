import { describe, it, expect } from 'vitest';
import { guideBodyColor } from '../src/appearance';
describe('instructional body colors', () => {
  it('retains explicit group colors for current, previous and completed parts', () => {
    for (const current of [true, false]) for (const complete of [true, false]) {
      expect(guideBodyColor({ leg: '#3976c6', brace: '#e69a32' }, 'leg', current, complete)).toBe('#3976c6');
      expect(guideBodyColor({ leg: '#3976c6', brace: '#e69a32' }, 'brace', current, complete)).toBe('#e69a32');
    }
  });
  it('keeps the default current-step highlight for parts without explicit colors', () => {
    expect(guideBodyColor({}, 'part', true, false)).toBe('#df3b35');
    expect(guideBodyColor({}, 'part', false, false)).toBe('#8a9c88');
    expect(guideBodyColor({}, 'part', true, true)).toBe('#8a9c88');
  });
});
