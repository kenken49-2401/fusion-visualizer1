import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { packArchive } from './archive.mjs';
const exec = promisify(execFile);
const repository = 'kenken49-2401/fusion-visualizer1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const excludedDirectories = new Set(['.git', '.local', 'node_modules', 'dist', 'test-results', 'playwright-report', 'coverage', '.aws', '.ssh', '.codex', '.agents']);
function excluded(path) {
  const parts = path.split('/');
  return parts.some(part => excludedDirectories.has(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:\.npmrc|\.netrc|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}

/** Build from tracked paths only. CLI always uses its own repository root. */
export async function buildDesktopPackage({ root, output, commit }) {
  root = await realpath(root);
  const git = async args => (await exec('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  commit = commit || (await git(['rev-parse', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit must be a full lowercase SHA-1.');
  const tracked = (await git(['ls-files', '--stage', '-z'])).split('\0').filter(Boolean);
  const files = new Map(), hashes = {};
  for (const entry of tracked) {
    const match = /^(\d+) [a-f0-9]+ (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[2] !== '0') throw new Error('Resolve Git index conflicts before packaging.');
    const [, mode, , path] = match;
    if (excluded(path)) continue;
    if (mode !== '100644' && mode !== '100755') throw new Error(`Only regular tracked files can be packaged: ${path}`);
    const absolute = resolve(root, path);
    const actual = await realpath(absolute);
    if (!actual.startsWith(root + sep) || (await lstat(absolute)).isSymbolicLink() || !(await lstat(absolute)).isFile()) throw new Error(`Unsafe tracked file: ${path}`);
    const bytes = await readFile(absolute);
    files.set(path, bytes); hashes[path] = digest(bytes);
  }
  if (!files.size) throw new Error('No tracked source files to package.');
  files.set('.local/desktop-update.json', Buffer.from(JSON.stringify({ schemaVersion: 1, commit, dataMergeVersion: 1, files: hashes }, null, 2) + '\n'));
  const archive = packArchive(files);
  const metadata = { schemaVersion: 1, repository, commit, archive: `https://kenken49-2401.github.io/fusion-visualizer1/downloads/fusion-editor-${commit}.zip`, sha256: digest(archive) };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `fusion-editor-${commit}.zip`), archive);
  await writeFile(resolve(output, 'fusion-editor-windows.zip'), archive);
  await writeFile(resolve(output, 'editor-update.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); let output, commit;
    for (let index = 0; index < args.length; index++) {
      const name = args[index], value = args[++index];
      if (!value || value.startsWith('--') || !['--output', '--commit'].includes(name)) throw new Error('Usage: node tools/package-desktop.mjs --output <dir> [--commit <sha>]');
      if (name === '--output' && output === undefined) output = value;
      else if (name === '--commit' && commit === undefined) commit = value;
      else throw new Error('Duplicate option.');
    }
    if (!output) throw new Error('--output is required.');
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    console.log(JSON.stringify(await buildDesktopPackage({ root, output: resolve(output), commit }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
