import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, writeFile, mkdir, rename, unlink, realpath, readdir } from 'node:fs/promises';
import { resolve, dirname, join, parse, sep } from 'node:path';
import { unpackArchive } from './archive.mjs';

export const DEFAULT_MANIFEST_URL = 'https://kenken49-2401.github.io/fusion-visualizer1/downloads/editor-update.json';
const REPOSITORY = 'kenken49-2401/fusion-visualizer1';
const DOWNLOADS = 'https://kenken49-2401.github.io/fusion-visualizer1/downloads/';
const STATE = '.local/desktop-update.json';
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const protectedParts = new Set(['.git', '.local', 'node_modules', 'dist', 'test-results', 'playwright-report', 'coverage', '.vite', '.cache', '.aws', '.ssh', '.codex', '.agents']);
const digest = data => createHash('sha256').update(data).digest('hex');
const runFile = promisify(execFile);
class FatalUpdateError extends Error { fatal = true; }
const sameBytes = (a, b) => a === undefined ? b === undefined : b !== undefined && a.equals(b);
const fileHash = bytes => bytes === undefined ? null : digest(bytes);

function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || path.includes('\\') || path.startsWith('/') || /[\x00-\x1f<>:"|?*]/.test(path)) throw new Error('更新ファイルのパスが不正です。');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('更新ファイルのパスが不正です。');
  return path;
}
const protectedPath = path => path.split('/').some(part => protectedParts.has(part.toLowerCase()));
function bundle(path) {
  if (/^public\/(?:catalog\.json$|viewer\.json$|models(?:\/|$))/.test(path)) return 'viewer';
  if (/^assembly-guide\/public\/(?:catalog\.json$|viewer\.json$|models(?:\/|$)|guides(?:\/|$))/.test(path)) return 'guide';
  return undefined;
}
const bundleRoots = ['public/catalog.json', 'public/viewer.json', 'public/models', 'assembly-guide/public/catalog.json', 'assembly-guide/public/viewer.json', 'assembly-guide/public/models', 'assembly-guide/public/guides'];
const say = (callback, message) => { try { callback(message); } catch { /* A UI logger cannot affect an update transaction. */ } };
const result = (status, message, onMessage, commit) => { say(onMessage, message); return { status, message, ...(commit ? { commit } : {}) }; };

async function inspect(root, path) {
  safePath(path);
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = await lstat(current); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    if (stat.isSymbolicLink()) throw new Error('リンクされたパスには自動更新しません。通常のフォルダーで起動してください。');
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('更新先のフォルダー構造が異なります。');
    if (i === parts.length - 1) return stat;
  }
}
async function bytesAt(root, path) {
  const stat = await inspect(root, path);
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error('更新先に通常のファイル以外が存在します。');
  return readFile(join(root, path));
}
function stateFrom(data) {
  const value = JSON.parse(data.toString('utf8'));
  if (value?.schemaVersion !== 1 || (typeof value.commit !== 'string' || !COMMIT.test(value.commit)) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files) || Object.keys(value.files).length > 10000) throw new Error('更新履歴の形式が不正です。');
  const seen = new Set();
  for (const [path, hash] of Object.entries(value.files)) {
    safePath(path);
    const key = path.normalize('NFC').toLowerCase();
    if (protectedPath(path) || (typeof hash !== 'string' || !HASH.test(hash)) || seen.has(key)) throw new Error('更新履歴のファイル一覧が不正です。');
    seen.add(key);
  }
  return value;
}
async function listBundle(root, path, found) {
  const stat = await inspect(root, path);
  if (!stat) return;
  if (stat.isFile()) { found.add(path); return; }
  if (!stat.isDirectory()) throw new Error('モデルフォルダーに通常のファイル以外があります。');
  for (const name of await readdir(join(root, path))) {
    const next = `${path}/${name}`;
    safePath(next);
    if (!protectedPath(next)) await listBundle(root, next, found);
  }
}

const pathKey = path => path.normalize('NFC').toLowerCase();
function catalogFrom(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (value?.schemaVersion !== 1 || !Array.isArray(value.models) || value.models.length > 100) throw new Error('Invalid catalog');
  const ids = new Set(), configs = new Set();
  for (const entry of value.models) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(entry.id) ||
        typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 160 ||
        typeof entry.config !== 'string' || !/^(viewer\.json|models\/[a-z0-9-]+\.json)$/.test(entry.config) ||
        ids.has(entry.id) || configs.has(pathKey(entry.config))) throw new Error('Invalid catalog entry');
    safePath(entry.config); ids.add(entry.id); configs.add(pathKey(entry.config));
  }
  return value;
}
function configFrom(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (value?.schemaVersion !== 1 || typeof value.model !== 'string' || !/^models\/[\w./-]+\.3mf$/i.test(value.model) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 ||
      !['Y', 'Z'].includes(value.upAxis) || !['X', 'Y'].includes(value.frontAxis) ||
      typeof value.description !== 'string' || value.description.length > 2000 ||
      typeof value.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.updatedAt) ||
      !value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors)) throw new Error('Invalid model config');
  safePath(value.model);
  const colors = Object.entries(value.colors);
  if (colors.length > 2000 || colors.some(([key, color]) => !/^[\w:/.-]{1,180}$/.test(key) || key === '__proto__' || typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))) throw new Error('Invalid colors');
  return value;
}

/** Preserve the edited bundle; only install complete, previously unshipped model pairs. */
function additiveModels(group, previous, incoming, files, current) {
  if (!previous) return [];
  const prefix = group === 'guide' ? 'assembly-guide/public/' : 'public/';
  const catalogPath = `${prefix}catalog.json`;
  let local, upstream;
  const reserved = new Set();
  try {
    local = catalogFrom(current.get(catalogPath)); upstream = catalogFrom(files.get(catalogPath));
    // Even a missing local model remains reserved by its user's catalog entry.
    for (const entry of local.models) {
      const configPath = `${prefix}${entry.config}`;
      const config = configFrom(current.get(configPath));
      reserved.add(pathKey(configPath)); reserved.add(pathKey(`${prefix}${config.model}`));
      if (group === 'guide') reserved.add(pathKey(`${prefix}guides/${entry.id}.json`));
    }
    // Do not merge a release whose catalog/config references cannot be understood safely.
    upstream.models.forEach(entry => configFrom(files.get(`${prefix}${entry.config}`)));
  } catch { return []; }
  const oldPaths = new Set(Object.keys(previous.files).map(pathKey));
  const localPaths = new Set([...current].filter(([, bytes]) => bytes !== undefined).map(([path]) => pathKey(path)));
  const ids = new Set(local.models.map(entry => entry.id));
  const additions = [], operations = [];
  for (const entry of upstream.models) {
    if (ids.has(entry.id) || local.models.length + additions.length >= 100) continue;
    const configPath = `${prefix}${entry.config}`;
    const config = configFrom(files.get(configPath));
    const paired = [configPath, `${prefix}${config.model}`];
    if (group === 'guide') paired.push(`${prefix}guides/${entry.id}.json`);
    if (paired.some(path => !files.get(path)?.length || !incoming.files[path] || oldPaths.has(pathKey(path)) || localPaths.has(pathKey(path)) || reserved.has(pathKey(path)))) continue;
    if (group === 'guide') {
      try {
        const guide = JSON.parse(files.get(paired[2]).toString('utf8'));
        if (guide?.schemaVersion !== 1 || guide.productId !== entry.id) continue;
      } catch { continue; }
    }
    additions.push(entry); ids.add(entry.id);
    for (const path of paired) {
      reserved.add(pathKey(path)); operations.push({ path, bytes: files.get(path), expected: undefined });
    }
  }
  if (!additions.length) return [];
  operations.push({ path: catalogPath, bytes: Buffer.from(`${JSON.stringify({ ...local, models: [...local.models, ...additions] }, null, 2)}\n`), expected: current.get(catalogPath) });
  return operations;
}

async function responseBytes(response, limit) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers?.get('content-length')) > limit) throw new Error('更新データが大きすぎます。');
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('更新データが大きすぎます。');
    return bytes;
  }
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) throw new Error('更新データが大きすぎます。');
      parts.push(Buffer.from(item.value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
async function fetchBytes(fetchImpl, url, limit, timeout) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (response.url && response.url !== url) throw new Error('更新先の転送には対応していません。');
  return responseBytes(response, limit);
}

async function atomicWrite(root, path, bytes, mode) {
  await inspect(root, path);
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await inspect(root, path);
  const temporary = `${destination}.updating-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: mode ?? 0o644 });
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
}

function livePID(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 2147483647) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function releaseLock(root, token) {
  const path = '.local/updater/update.lock';
  if (sameBytes(await bytesAt(root, path), token)) await unlink(join(root, path));
}
async function acquireLock(root) {
  const path = '.local/updater/update.lock';
  await inspect(root, path);
  await mkdir(join(root, '.local/updater'), { recursive: true });
  const token = Buffer.from(JSON.stringify({ pid: process.pid, token: randomUUID() }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(join(root, path), token, { flag: 'wx' }); return token; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previous = await bytesAt(root, path);
    if (!previous) continue;
    let pid;
    try { const value = JSON.parse(previous.toString('utf8')); pid = typeof value === 'number' ? value : value.pid; } catch { return undefined; }
    if (livePID(pid)) return undefined;
    // Each dead owner has a unique claim name. A second reaper cannot remove a
    // replacement owner's lock while the first reaper installs it.
    const claim = `.local/updater/reclaim-${digest(previous)}.lock`;
    let claimOwned = false;
    try {
      await inspect(root, claim);
      try { await writeFile(join(root, claim), token, { flag: 'wx' }); claimOwned = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const other = await bytesAt(root, claim);
        let owner; try { owner = JSON.parse(other?.toString('utf8')).pid; } catch { return undefined; }
        if (livePID(owner) || !sameBytes(await bytesAt(root, claim), other)) return undefined;
        await unlink(join(root, claim));
        try { await writeFile(join(root, claim), token, { flag: 'wx' }); claimOwned = true; } catch (error) { if (error.code === 'EEXIST') return undefined; throw error; }
      }
      if (!sameBytes(await bytesAt(root, path), previous)) continue;
      await unlink(join(root, path));
      try { await writeFile(join(root, path), token, { flag: 'wx' }); return token; } catch (error) { if (error.code === 'EEXIST') return undefined; throw error; }
    } finally {
      if (claimOwned && sameBytes(await bytesAt(root, claim), token)) await unlink(join(root, claim)).catch(() => {});
    }
  }
  return undefined;
}

async function recoverInterrupted(root, onMessage) {
  const directory = '.local/updater/backups';
  if (!await inspect(root, directory)) return;
  for (const name of (await readdir(join(root, directory))).sort()) {
    const folder = `${directory}/${name}`;
    safePath(folder);
    const journalPath = `${folder}/journal.json`;
    const journalBytes = await bytesAt(root, journalPath);
    // An orphan backup directory preceding the prepared journal never mutated files.
    if (!journalBytes) continue;
    let journal;
    try { journal = JSON.parse(journalBytes.toString('utf8')); } catch { throw new FatalUpdateError(`${folder} の更新履歴を確認してください。アプリの起動を停止しました。`); }
    if (journal.status === 'complete' || journal.status === 'rolled-back') continue;
    if (journal.status !== 'prepared' || journal.schemaVersion !== 1 || !Array.isArray(journal.files)) throw new FatalUpdateError(`${folder} のバックアップから手動で復旧してください。アプリの起動を停止しました。`);
    const actions = [];
    const seen = new Set();
    try {
      for (const entry of journal.files) {
        const path = safePath(entry.path);
        const key = path.normalize('NFC').toLowerCase();
        if (seen.has(key) || (protectedPath(path) && path !== STATE) || typeof entry.existed !== 'boolean' || !(entry.originalSha256 === null || HASH.test(entry.originalSha256)) || !(entry.targetSha256 === null || HASH.test(entry.targetSha256))) throw new Error('Invalid journal');
        seen.add(key);
        const original = entry.existed ? await bytesAt(root, `${folder}/files/${path}`) : undefined;
        if (fileHash(original) !== entry.originalSha256 || entry.existed !== (original !== undefined)) throw new Error('Invalid backup');
        const current = await bytesAt(root, path);
        if (sameBytes(current, original)) continue;
        if (fileHash(current) !== entry.targetSha256) throw new Error('New local changes after interruption');
        actions.push({ path, original, current, mode: entry.mode });
      }
      for (const action of actions.reverse()) {
        if (!sameBytes(await bytesAt(root, action.path), action.current)) throw new Error('File changed during recovery');
        if (action.original === undefined) await unlink(join(root, action.path));
        else await atomicWrite(root, action.path, action.original, action.mode);
      }
      await atomicWrite(root, journalPath, Buffer.from(JSON.stringify({ ...journal, status: 'rolled-back' }, null, 2)));
      say(onMessage, '前回中断された更新をバックアップから元に戻しました。');
    } catch { throw new FatalUpdateError(`${folder} のバックアップから復旧が必要です。ローカルの変更を保護するため、アプリの起動を停止しました。`); }
  }
}

async function transact(root, operations, state, expectedState) {
  const transaction = `.local/updater/backups/${Date.now()}-${randomUUID()}`;
  await inspect(root, `${transaction}/journal.json`);
  await mkdir(join(root, transaction, 'files'), { recursive: true });
  const originalState = await bytesAt(root, STATE);
  if ((originalState === undefined) !== (expectedState === undefined) || (originalState !== undefined && !originalState.equals(expectedState))) throw new Error('更新中に更新履歴が変更されました。');
  const originals = [];
  for (const operation of [...operations, { path: STATE, bytes: Buffer.from(`${JSON.stringify(state, null, 2)}\n`) }]) {
    const bytes = operation.path === STATE ? originalState : await bytesAt(root, operation.path);
    if (operation.path !== STATE && ((bytes === undefined) !== (operation.expected === undefined) || (bytes !== undefined && !bytes.equals(operation.expected)))) throw new Error('更新中にファイルが変更されました。');
    const stat = await inspect(root, operation.path);
    const entry = { ...operation, original: bytes, mode: stat?.mode };
    originals.push(entry);
    if (bytes !== undefined) {
      const backup = `${transaction}/files/${operation.path}`;
      await mkdir(dirname(join(root, backup)), { recursive: true });
      await writeFile(join(root, backup), bytes, { flag: 'wx' });
    }
  }
  const journal = { schemaVersion: 1, status: 'prepared', commit: state.commit, files: originals.map(({ path, original, bytes, mode }) => ({ path, existed: original !== undefined, originalSha256: fileHash(original), targetSha256: fileHash(bytes), mode })) };
  await atomicWrite(root, `${transaction}/journal.json`, Buffer.from(JSON.stringify(journal, null, 2)));
  const changed = [];
  try {
    for (const operation of originals) {
      // Fail safely if another program edited a planned file while the archive was checked.
      const now = await bytesAt(root, operation.path);
      if ((now === undefined) !== (operation.original === undefined) || (now !== undefined && !now.equals(operation.original))) throw new Error('更新中にファイルが変更されました。');
      if (operation.bytes === undefined) { await inspect(root, operation.path); await unlink(join(root, operation.path)); }
      else await atomicWrite(root, operation.path, operation.bytes, operation.mode);
      changed.push(operation);
    }
    await atomicWrite(root, `${transaction}/journal.json`, Buffer.from(JSON.stringify({ ...journal, status: 'complete' }, null, 2)));
  } catch (error) {
    const failures = [];
    for (const operation of changed.reverse()) {
      try {
        const current = await bytesAt(root, operation.path);
        if (sameBytes(current, operation.original)) continue;
        if (!sameBytes(current, operation.bytes)) throw new Error('File changed after updater write');
        if (operation.original === undefined) { await inspect(root, operation.path); await unlink(join(root, operation.path)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
        else await atomicWrite(root, operation.path, operation.original, operation.mode);
      } catch { failures.push(operation.path); }
    }
    await atomicWrite(root, `${transaction}/journal.json`, Buffer.from(JSON.stringify({ ...journal, status: failures.length ? 'rollback-incomplete' : 'rolled-back', failures }, null, 2))).catch(() => {});
    if (failures.length) throw new FatalUpdateError(`更新を戻せないファイルがあります。${transaction} のバックアップを確認してください。アプリの起動を停止しました。`);
    throw error;
  }
}

/** Git worktrees use Git's own merge protection; no stash, reset, clean, force or push. */
export async function updateGitCheckout(root, { git, onMessage = console.log } = {}) {
  const run = git ?? (async args => (await runFile('git', args, { cwd: root, timeout: 90000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } })).stdout.trim());
  try {
    const top = await realpath((await run(['rev-parse', '--show-toplevel'])).trim());
    if (top !== await realpath(root)) return result('skipped', 'このフォルダー自身のGit管理が確認できないため、更新を見送りました。', onMessage);
    const origin = (await run(['remote', 'get-url', 'origin'])).trim();
    if (!/^(https:\/\/github\.com\/|git@github\.com:)kenken49-2401\/fusion-visualizer1(?:\.git)?$/.test(origin)) return result('skipped', 'Gitの取得元が公式リポジトリと異なるため、更新を見送りました。', onMessage);
    const branch = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    if (branch !== 'main') return result('skipped', 'main以外のブランチのため、自動更新を見送りました。', onMessage);
    const before = (await run(['rev-parse', 'HEAD'])).trim();
    await run(['fetch', 'origin', 'main']);
    await run(['merge', '--ff-only', 'origin/main']);
    const commit = (await run(['rev-parse', 'HEAD'])).trim();
    return result(before === commit ? 'current' : 'updated', before === commit ? 'アプリは最新版です。' : 'アプリを最新版に更新しました。', onMessage, commit);
  } catch { return result('skipped', 'Gitの自動更新を見送りました。接続やローカルの変更を確認してください。変更の退避・削除は行いません。', onMessage); }
}

/** Update a downloaded desktop copy while retaining local model and guide bundles. */
export async function updateDesktop(root, { manifestURL = DEFAULT_MANIFEST_URL, fetchImpl = globalThis.fetch, onMessage = console.log } = {}) {
  let lock;
  root = resolve(root);
  try {
    let ancestor = parse(root).root;
    for (const part of root.slice(ancestor.length).split(sep).filter(Boolean)) {
      ancestor = join(ancestor, part);
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('リンク先のフォルダーには自動更新しません。');
    }
    const git = await inspect(root, '.git');
    if (git) return await updateGitCheckout(root, { onMessage });
    if (manifestURL !== DEFAULT_MANIFEST_URL) return result('skipped', '公式の更新先以外からは取得できません。', onMessage);
    lock = await acquireLock(root);
    if (!lock) return result('skipped', 'ほかの更新処理が進行中、または更新ロックを確認できません。', onMessage);
    await recoverInterrupted(root, onMessage);
    const stateBytes = await bytesAt(root, STATE);
    const previous = stateBytes ? stateFrom(stateBytes) : undefined;
    let manifestBytes;
    try { manifestBytes = await fetchBytes(fetchImpl, `${manifestURL}?t=${Date.now()}`, 65536, 20000); }
    catch { return result('offline', '更新を確認できませんでした。現在のアプリを起動します。', onMessage); }
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest?.schemaVersion !== 1 || manifest.repository !== REPOSITORY || (typeof manifest.commit !== 'string' || !COMMIT.test(manifest.commit)) || (typeof manifest.sha256 !== 'string' || !HASH.test(manifest.sha256)) || manifest.archive !== `${DOWNLOADS}fusion-editor-${manifest.commit}.zip`) return result('skipped', '更新情報を検証できないため、更新を見送りました。', onMessage);
    if (previous?.commit === manifest.commit && previous.dataMergeVersion === 1) return result('current', 'アプリは最新版です。', onMessage, manifest.commit);
    let archive;
    try { archive = await fetchBytes(fetchImpl, manifest.archive, 70 * 1024 * 1024, 90000); }
    catch { return result('offline', '更新ファイルを取得できませんでした。現在のアプリを起動します。', onMessage); }
    if (digest(archive) !== manifest.sha256) return result('skipped', '更新ファイルのチェックサムが一致しません。更新を見送りました。', onMessage);
    const unpacked = unpackArchive(archive);
    if (!unpacked.has(STATE)) return result('skipped', '更新ファイルに検証用の履歴がありません。', onMessage);
    const incoming = stateFrom(unpacked.get(STATE));
    if (incoming.commit !== manifest.commit) throw new Error('更新ファイルのバージョンが一致しません。');
    const files = new Map();
    for (const [path, bytes] of unpacked) {
      safePath(path);
      if (!protectedPath(path)) {
        if (incoming.files[path] !== digest(bytes)) throw new Error('更新ファイルの内容が検証用の履歴と一致しません。');
        files.set(path, bytes);
      }
    }
    if (Object.keys(incoming.files).some(path => !files.has(path))) throw new Error('更新履歴に必要なファイルがありません。');
    const paths = new Set([...Object.keys(previous?.files ?? {}), ...files.keys()]);
    const aliases = new Map();
    for (const path of paths) {
      const key = path.normalize('NFC').toLowerCase();
      if (aliases.has(key) && aliases.get(key) !== path) throw new Error('大文字・小文字や文字表記だけが異なるファイル名があります。安全のため自動更新を見送りました。');
      aliases.set(key, path);
    }
    for (const path of bundleRoots) await listBundle(root, path, paths);
    const current = new Map();
    for (const path of paths) current.set(path, await bytesAt(root, path));
    const preserved = new Set();
    for (const path of paths) {
      const group = bundle(path);
      if (!group) continue;
      const hash = current.get(path) === undefined ? undefined : digest(current.get(path));
      const baseline = previous ? previous.files[path] : incoming.files[path];
      if (hash !== baseline) preserved.add(group);
    }
    const next = { schemaVersion: 1, dataMergeVersion: 1, commit: incoming.commit, files: { ...incoming.files } };
    const operations = [];
    for (const path of paths) {
      const group = bundle(path);
      if (group && preserved.has(group)) {
        delete next.files[path];
        if (previous?.files[path]) next.files[path] = previous.files[path];
        continue;
      }
      const existing = current.get(path);
      const hash = existing === undefined ? undefined : digest(existing);
      const old = previous?.files[path];
      const target = incoming.files[path];
      if (hash === target) continue;
      // A local code edit is retained when the upstream file did not change.
      if (old === target) continue;
      if (hash !== old) return result('conflict', `ローカルで変更した ${path} と更新内容が競合するため、更新を見送りました。ファイルは変更していません。`, onMessage);
      operations.push({ path, bytes: files.get(path), expected: existing });
    }
    for (const group of preserved) {
      for (const operation of additiveModels(group, previous, incoming, files, current)) {
        operations.push(operation);
        next.files[operation.path] = incoming.files[operation.path];
      }
    }
    // Recheck originals in transact; every mutation has a backup and the state is written last.
    if (!sameBytes(await bytesAt(root, '.local/updater/update.lock'), lock)) throw new Error('更新処理の所有権が変更されたため、更新を中止しました。');
    await transact(root, operations, next, stateBytes);
    return result('updated', preserved.size ? 'アプリを更新しました。PC内で変更したモデル・ガイドはそのまま残しています。' : 'アプリを最新版に更新しました。', onMessage, incoming.commit);
  } catch (error) { return { ...result('skipped', error instanceof Error ? error.message : '自動更新を見送りました。', onMessage), ...(error?.fatal ? { fatal: true } : {}) }; }
  finally { if (lock) await releaseLock(root, lock).catch(() => {}); }
}
