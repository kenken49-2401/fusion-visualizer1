import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const safeModel = path => typeof path === 'string' && /^models\/[\w./-]+\.3mf$/i.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');

/** Find the most recent byte-content change; a rename or chmod alone is not an upload. */
function contentChange(log) {
  const tokens = log.split('\0'); let commit, date;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].trim();
    const header = /^([a-f0-9]{40,64})\t(.+)$/.exec(token);
    if (header) { commit = header[1]; date = header[2]; continue; }
    const record = /^:[0-7]{6} [0-7]{6} ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) ([A-Z][0-9]*)$/.exec(token);
    if (!record) continue;
    index += /^[RC]/.test(record[3]) ? 2 : 1;
    if ((record[1] !== record[2] || record[3].startsWith('C')) && commit && date && !/^0+$/.test(record[2])) {
      const parsed = new Date(date);
      if (!Number.isFinite(parsed.valueOf())) throw new Error('Invalid Git content-change date.');
      return { uploadedAt: parsed.toISOString(), commit };
    }
  }
  return undefined;
}

/** Entries describe committed bytes. Browser SHA matching rejects local unsaved/unpushed byte differences. */
export async function generateModelMetadata({ root, publicDir = 'public' }) {
  root = await realpath(root);
  const publicRoot = await realpath(resolve(root, publicDir));
  if (!inside(root, publicRoot)) throw new Error('Public directory must be inside the repository.');
  const git = async (args, binary = false) => (await exec('git', ['-C', root, ...args], { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 80 * 1024 * 1024 })).stdout;
  if ((await git(['rev-parse', '--is-shallow-repository'])).trim() === 'true') throw new Error('Full Git history is required for accurate model upload dates (fetch-depth: 0).');
  const catalog = JSON.parse(await readFile(resolve(publicRoot, 'catalog.json'), 'utf8'));
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.models) || catalog.models.length > 100) throw new Error('Invalid model catalog.');
  const models = {};
  for (const entry of catalog.models) {
    if (typeof entry?.config !== 'string' || !/^(viewer\.json|models\/[a-z0-9-]+\.json)$/.test(entry.config)) throw new Error('Invalid model config path.');
    const configFile = await realpath(resolve(publicRoot, entry.config));
    if (!inside(publicRoot, configFile)) throw new Error('Config escapes public directory.');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    if (!safeModel(config.model)) throw new Error('Invalid 3MF path.');
    const modelFile = await realpath(resolve(publicRoot, config.model));
    if (!inside(publicRoot, modelFile)) throw new Error('Model escapes public directory.');
    const path = relative(root, modelFile).split(sep).join('/');
    const committed = (await git(['ls-tree', '-z', 'HEAD', '--', path])).split('\0').filter(Boolean);
    if (!committed.length) continue; // A new, uncommitted local model has no upload record.
    if (committed.length !== 1 || !/^100(?:644|755) blob [a-f0-9]+\t/.test(committed[0])) throw new Error('Model must be a regular tracked file.');
    const bytes = await git(['show', `HEAD:${path}`], true);
    const log = await git(['log', '--follow', '--no-abbrev', '--format=%H%x09%cI', '--raw', '-z', '--', path]);
    const change = contentChange(log);
    if (!change) continue;
    models[config.model] = { sha256: sha256(bytes), ...change };
  }
  return { schemaVersion: 1, models };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let root = dirname(dirname(fileURLToPath(import.meta.url))), publicDir = 'public';
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      const key = args[index], value = args[++index];
      if (!value || value.startsWith('--') || !['--root', '--public-dir'].includes(key)) throw new Error('Usage: node tools/model-metadata.mjs [--root <repository>] [--public-dir <directory>]');
      if (key === '--root') root = resolve(value); else publicDir = value;
    }
    const metadata = await generateModelMetadata({ root, publicDir });
    const output = resolve(root, publicDir, 'model-metadata.json');
    await writeFile(output, JSON.stringify(metadata, null, 2) + '\n');
    console.log(`Wrote model content metadata: ${output} (${Object.keys(metadata.models).length} models)`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
