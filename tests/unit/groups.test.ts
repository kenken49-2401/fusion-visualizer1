import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseConfig, validateGroups } from '../../src/config';
import { bakeColors, readBodyIds } from '../../src/three-mf-colors';
import { mountGroups } from '../../src/groups';
import { mountGroupEditor } from '../../src/group-editor';
import type { Body } from '../../src/model-loader';

const a = 'build:0/object:1', b = 'build:1/object:1';
const group = { id: 'group-one', name: '支持部', bodyIds: [a] };
const config = { schemaVersion: 1, model: 'models/fixture.3mf', title: 'Fixture', description: '', updatedAt: '2026-10-19', upAxis: 'Z', frontAxis: 'X', colors: {} };
const body = (id: string): Body => ({ id, name: '同じ名前', object: new Group(), meshes: [], triangles: 0 });

describe('body group schema', () => {
  it('defaults legacy configurations to no groups and trims names', () => {
    expect(parseConfig(config).groups).toEqual([]);
    expect(validateGroups([{ ...group, name: '  支持部  ' }], [a])).toEqual([group]);
    const source = [group]; const result = validateGroups(source);
    result[0].bodyIds.push(b); expect(source[0].bodyIds).toEqual([a]);
  });
  it.each([
    null, {}, [null], [{ ...group, id: '' }], [{ ...group, id: '__proto__' }],
    [{ ...group, name: '  ' }], [{ ...group, name: 'x'.repeat(161) }],
    [{ ...group, bodyIds: [] }], [{ ...group, bodyIds: [''] }],
    [{ ...group, bodyIds: [a, a] }], [group, { ...group, name: '別名', bodyIds: [b] }],
    [group, { id: 'two', name: ' 支持部 ', bodyIds: [b] }],
    [group, { id: 'two', name: '別名', bodyIds: [a] }],
    [{ ...group, bodyIds: [{ id: a }] }],
  ])('rejects malformed, duplicate, or nested membership: %j', value => {
    expect(() => validateGroups(value)).toThrow();
  });
  it('rejects unknown members against the selected model', () => {
    expect(() => validateGroups([group], [b])).toThrow(/存在しない/);
    expect(validateGroups([group], [a])).toEqual([group]);
  });
  it('retains occurrence identity through resource IDs cloned by color baking', () => {
    const files = unzipSync(new Uint8Array(readFileSync('public/models/figure-stand.3mf')));
    const path = Object.keys(files).find(name => name.endsWith('.model'))!;
    let source = strFromU8(files[path]);
    source = source.replace(/<build\b[^>]*>[\s\S]*?<\/build>/, '<build><item objectid="1"/><item objectid="1"/></build>');
    files[path] = strToU8(source);
    const before = zipSync(files), beforeIds = readBodyIds(before);
    const after = bakeColors(before, { [beforeIds[0]]: '#123456' });
    const afterIds = readBodyIds(after);
    expect(beforeIds).toEqual([a, b]);
    expect(afterIds).toHaveLength(2);
    expect(afterIds[0]).not.toBe(beforeIds[0]);
    expect(afterIds[1]).toBe(beforeIds[1]);
    expect(validateGroups([{ ...group, bodyIds: [afterIds[0]] }], afterIds)).toHaveLength(1);
  });
});

describe('public group controls', () => {
  it('toggles and focuses actual bodies, exposes mixed state and never merges objects', () => {
    document.body.innerHTML = '<section id="bodies"></section>';
    const bodies = [body(a), body(b)]; const changed = vi.fn(), focus = vi.fn();
    const ui = mountGroups(document.querySelector('#bodies')!, bodies, changed, focus);
    ui.setGroups([{ ...group, bodyIds: [a, b] }]);
    const toggle = document.querySelector<HTMLButtonElement>('.group-toggle')!;
    toggle.click(); expect(bodies.map(item => item.object.visible)).toEqual([false, false]);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    document.querySelector<HTMLButtonElement>('.group-focus')!.click();
    expect(bodies.map(item => item.object.visible)).toEqual([true, true]); expect(focus).toHaveBeenCalledWith(bodies);
    bodies[0].object.visible = false; ui.update(); expect(toggle.getAttribute('aria-pressed')).toBe('mixed');
    expect(bodies.map(item => item.object.children.length)).toEqual([0, 0]);
    ui.setGroups([]); expect(document.querySelector<HTMLElement>('.public-groups')!.hidden).toBe(true);
  });
});

describe('developer group form', () => {
  it('uses IDs for duplicate labels, preserves pending edits, enforces disjoint members, and reverts', () => {
    document.body.innerHTML = '<section id="editor"></section>';
    const paint = vi.fn(); const editor = mountGroupEditor(document.querySelector('#editor')!, [body(a), body(b)], [], vi.fn(), paint);
    const name = document.querySelector<HTMLInputElement>('[aria-label="グループ名"]')!;
    const checks = [...document.querySelectorAll<HTMLInputElement>('.group-member input')];
    expect(checks.map(input => input.value)).toEqual([a, b]);
    expect(document.querySelector('.group-member')!.textContent).toContain('同じ名前 · 01');
    name.value = ' 支持部 '; name.dispatchEvent(new Event('input')); checks[0].checked = true; checks[0].dispatchEvent(new Event('change'));
    expect(editor.pending()).toBe(true);
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const saved = editor.groups(); expect(saved[0]).toMatchObject({ name: '支持部', bodyIds: [a] }); expect(editor.pending()).toBe(false);
    expect(checks[0].disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('[aria-label="支持部を編集"]')!.click();
    expect(checks[0].disabled).toBe(false); expect(checks[0].checked).toBe(true);
    name.value = '新しい名前'; name.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('[aria-label="支持部を削除"]')!.click();
    expect(editor.groups()).toEqual(saved); expect(editor.pending()).toBe(true);
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(editor.groups()[0].name).toBe('新しい名前');
    document.querySelector<HTMLButtonElement>('[aria-label="新しい名前に色を一括適用"]')!.click();
    expect(paint).toHaveBeenCalledWith([a], '#78957d');
    editor.reset(saved); expect(editor.groups()).toEqual(saved); expect(editor.pending()).toBe(false);
    document.querySelector<HTMLButtonElement>('[aria-label="支持部を削除"]')!.click(); expect(editor.groups()).toEqual([]);
  });
});
