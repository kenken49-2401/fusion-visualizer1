import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { bakeColors } from '../../src/three-mf-colors';
import { parseModel } from '../../src/model-loader';
import { Appearance } from '../../src/appearance';
import { syncSelected, type GitRunner } from '../../admin-server';

const orientation = { upAxis: 'Z', frontAxis: 'X' } as const;
const parse = (bytes: Uint8Array) => parseModel(Uint8Array.from(bytes).buffer, orientation);
const actual = () => new Uint8Array(readFileSync('public/models/figure-stand.3mf'));

describe('3MF persisted body colors', () => {
  it('replaces black vertex colors with a material while preserving geometry, names and ZIP parts', () => {
    const input = actual(); const before = parse(input);
    const saved = bakeColors(input, { [before.bodies[0].id]: '#78957d' });
    const after = parse(saved);
    expect(after.bodies.map(b => [b.id, b.name, b.triangles])).toEqual(before.bodies.map(b => [b.id, b.name, b.triangles]));
    expect(after.sizeMM.toArray()).toEqual(before.sizeMM.toArray());
    expect(new Appearance(after.bodies).swatch(after.bodies[0])).toBe('#78957d');
    const a = unzipSync(input); const b = unzipSync(saved);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const path of Object.keys(a).filter(p => !p.endsWith('.model'))) expect(b[path]).toEqual(a[path]);
    const positions = (model: ReturnType<typeof parse>) => model.bodies.flatMap(body => body.meshes.flatMap(mesh => Array.from(mesh.geometry.getAttribute('position').array)));
    expect(positions(after).sort()).toEqual(positions(before).sort());
    expect(bakeColors(input, {})).toBe(input);
  });

  it('isolates nested shared objects and repeated build instances without moving other bodies', () => {
    const original = unzipSync(actual());
    const path = Object.keys(original).find(p => p.endsWith('.model'))!;
    let source = strFromU8(original[path]);
    source = source.replace('</resources>', '<object id="100" name="Assembly" type="model"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2000 0 0"/></components></object></resources>');
    source = source.replace(/<build\b[^>]*>[\s\S]*?<\/build>/, '<build><item objectid="100"/><item objectid="100" transform="1 0 0 0 1 0 0 0 1 0 3000 0"/></build>');
    original[path] = strToU8(source);
    const input = zipSync(original); const before = parse(input);
    expect(before.bodies).toHaveLength(4);
    const saved = bakeColors(input, { [before.bodies[0].id]: '#ee7733', [before.bodies[3].id]: '#123456' });
    const after = parse(saved); const appearance = new Appearance(after.bodies);
    expect(after.sizeMM.toArray()).toEqual(before.sizeMM.toArray());
    expect(after.bodies.map(b => b.name)).toEqual(before.bodies.map(b => b.name));
    expect(after.bodies.map(b => appearance.swatch(b))).toEqual(['#ee7733', '#000000', '#000000', '#123456']);
    expect(after.triangles).toBe(before.triangles);
    after.bodies.forEach((b, i) => expect(b.object.matrixWorld.elements).toEqual(before.bodies[i].object.matrixWorld.elements));
  });

  it('rejects unknown body identifiers before modifying anything', () => {
    expect(() => bakeColors(actual(), { 'build:999/object:1': '#123456' })).toThrow(/存在しない/);
  });
});

describe('selected model Git sync', () => {
  it('stages and commits only selected paths and pushes without force using the current branch', async () => {
    const calls: string[][] = [];
    const paths = ['public/models/figure-stand.3mf', 'public/viewer.json'];
    const git: GitRunner = async args => {
      calls.push(args);
      if (args[0] === 'symbolic-ref') return 'main\n';
      if (args[0] === 'remote') return 'https://github.com/kenken49-2401/fusion-visualizer1.git\n';
      if (args[0] === 'diff') return calls.some(c => c[0] === 'add') ? `${paths[0]}\0` : '';
      return '';
    };
    await expect(syncSelected(git, paths)).resolves.toEqual({ committed: true });
    expect(calls).toContainEqual(['add', '--', ...paths]);
    expect(calls).toContainEqual(['commit', '-m', 'Update model body colors', '--only', '--', ...paths]);
    expect(calls.at(-1)).toEqual(['push', 'origin', 'HEAD:refs/heads/main']);
  });
  it('refuses unrelated staged changes and unexpected origins before git add', async () => {
    for (const origin of ['https://github.com/other/repo.git', 'https://github.com/kenken49-2401/fusion-visualizer1.git']) {
      const calls: string[][] = [];
      const git: GitRunner = async args => {
        calls.push(args);
        return args[0] === 'symbolic-ref' ? 'main' : args[0] === 'remote' ? origin : 'src/main.ts\0';
      };
      await expect(syncSelected(git, ['public/viewer.json'])).rejects.toThrow();
      expect(calls.some(c => c[0] === 'add' || c[0] === 'push')).toBe(false);
    }
  });
});


it('syncs a real selected-file commit into a disposable local bare repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'model-sync-test-'));
  const run = promisify(execFile);
  const repository = join(directory, 'working');
  const remote = join(directory, 'remote.git');
  await mkdir(repository);
  const gitLocal = async (args: string[], cwd = repository) => (await run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
  try {
    await gitLocal(['init', '--bare', remote]);
    await gitLocal(['init', '-b', 'test-colors']);
    await gitLocal(['config', 'user.name', 'Color Test']);
    await gitLocal(['config', 'user.email', 'test@example.invalid']);
    await gitLocal(['remote', 'add', 'origin', remote]);
    await writeFile(join(repository, 'selected.3mf'), 'initial');
    await writeFile(join(repository, 'viewer.json'), '{}');
    await writeFile(join(repository, 'unrelated.ts'), 'initial');
    await gitLocal(['add', '.']); await gitLocal(['commit', '-m', 'Initial fixture']);
    await writeFile(join(repository, 'selected.3mf'), 'saved color');
    await writeFile(join(repository, 'viewer.json'), '{"colors":{}}');
    await writeFile(join(repository, 'unrelated.ts'), 'uncommitted source edit');
    // Only the origin identity probe is substituted; every mutation uses this disposable repo.
    const git: GitRunner = args => args[0] === 'remote' ? Promise.resolve('https://github.com/kenken49-2401/fusion-visualizer1.git') : gitLocal(args);
    await expect(syncSelected(git, ['selected.3mf', 'viewer.json'])).resolves.toEqual({ committed: true });
    expect((await gitLocal(['show', 'HEAD:unrelated.ts'])).trim()).toBe('initial');
    expect(await readFile(join(repository, 'unrelated.ts'), 'utf8')).toBe('uncommitted source edit');
    expect((await gitLocal(['show', 'refs/heads/test-colors:selected.3mf'], remote)).trim()).toBe('saved color');
    await expect(syncSelected(git, ['selected.3mf', 'viewer.json'])).resolves.toEqual({ committed: false });
    await gitLocal(['add', 'unrelated.ts']);
    await expect(syncSelected(git, ['selected.3mf', 'viewer.json'])).rejects.toThrow(/ステージ/);
    await gitLocal(['reset', '--', 'unrelated.ts']);
    await gitLocal(['checkout', '--detach']);
    await expect(syncSelected(git, ['selected.3mf', 'viewer.json'])).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
