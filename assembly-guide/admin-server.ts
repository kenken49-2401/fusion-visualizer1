import { readFile, writeFile, rename, mkdir, unlink, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import type { Plugin } from 'vite';
import { parseCatalog, parseConfig } from './src/config.ts';
import { parseGuide } from './src/schema.ts';
const exec = promisify(execFile);
const hash = (...parts: (string | Uint8Array)[]) => { const h = createHash('sha256'); parts.forEach(p => h.update(p)); return h.digest('hex'); };
function bodyIds(data: Uint8Array): string[] {
    const files = unzipSync(data), path = Object.keys(files).find(p => p.endsWith('.model'));
    if (!path)
        throw new Error('モデルを読み取れません。');
    const doc = new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml');
    const all = (e: Element, name: string) => Array.from(e.childNodes).filter(n => n.nodeType === 1 && (n as Element).localName === name) as Element[];
    const root = doc.documentElement! as unknown as Element;
    const resources = all(root, 'resources')[0], build = all(root, 'build')[0], objects = new Map(all(resources, 'object').map(o => [o.getAttribute('id'), o]));
    const ids: string[] = [];
    function visit(id: string, path: string, depth: number) { if (depth > 64)
        throw new Error('階層が深すぎます。'); const o = objects.get(id); if (!o)
        throw new Error('部品参照が不正です。'); if (all(o, 'mesh').length)
        ids.push(path);
    else
        all(all(o, 'components')[0], 'component').forEach((c, i) => visit(c.getAttribute('objectid')!, `${path}/component:${i}/object:${c.getAttribute('objectid')}`, depth + 1)); }
    all(build, 'item').forEach((c, i) => visit(c.getAttribute('objectid')!, `build:${i}/object:${c.getAttribute('objectid')}`, 0));
    return ids;
}
export function guideAdmin(): Plugin {
    return { name: 'local-guide-editor', apply: 'serve', async configureServer(server) {
            const root = server.config.root;
            const preparation = resolve(root, '../tools/prepare-desktop.mjs');
            let hasPreparation = true;
            try { await access(preparation); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') hasPreparation = false; else throw error; }
            if (hasPreparation) {
                const { prepareDesktopEditor } = await import(pathToFileURL(preparation).href);
                await prepareDesktopEditor(root);
            }
            let busy = false;
            const git = async (args: string[], cwd = root) => (await exec('git', args, { cwd, timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } })).stdout;
            async function selected(id: unknown) {
                const catalog = parseCatalog(JSON.parse(await readFile(resolve(root, 'public/catalog.json'), 'utf8'))), entry = catalog.find(e => e.id === id);
                if (!entry)
                    throw new Error('制作物が見つかりません。');
                const configSource = await readFile(resolve(root, 'public', entry.config), 'utf8'), config = parseConfig(JSON.parse(configSource));
                const model = await readFile(resolve(root, 'public', config.model));
                const path = resolve(root, 'public/guides', `${entry.id}.json`), source = await readFile(path, 'utf8');
                return { id: entry.id, path, guide: parseGuide(JSON.parse(source), bodyIds(model)), source, revision: hash(source, configSource, model), modelFingerprint: hash(model), knownBodies: bodyIds(model) };
            }
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url || '/', 'http://localhost');
                if (!['/__guide/runtime', '/__guide/config', '/__guide/save', '/__guide/sync'].includes(url.pathname))
                    return next();
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
                const host = req.headers.host || '';
                if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''))
                    return send(403, { error: '編集画面は開発者のPC内だけで使用できます。' });
                if (url.pathname === '/__guide/runtime' && req.method === 'GET')
                    return send(200, { app: 'fusion-assembly-guide', mode: 'admin' });
                if (url.pathname === '/__guide/config' && req.method === 'GET') {
                    try {
                        const s = await selected(url.searchParams.get('product'));
                        return send(200, { guide: s.guide, revision: s.revision, modelFingerprint: s.modelFingerprint });
                    }
                    catch {
                        return send(400, { error: '手順データを読み取れません。' });
                    }
                }
                if (req.method !== 'POST' || !['/__guide/save', '/__guide/sync'].includes(url.pathname))
                    return send(405, { error: '対応していない操作です。' });
                if (req.headers.origin !== `http://${host}` || req.headers['content-type']?.split(';')[0] !== 'application/json')
                    return send(403, { error: '同じ編集画面から保存してください。' });
                if (busy)
                    return send(409, { error: '保存または同期が進行中です。' });
                busy = true;
                let temporary: string | undefined;
                try {
                    const chunks: Buffer[] = [];
                    let size = 0;
                    for await (const chunk of req) {
                        const b = Buffer.from(chunk);
                        size += b.length;
                        if (size > 2 * 1024 * 1024)
                            return send(413, { error: '手順データが大きすぎます。' });
                        chunks.push(b);
                    }
                    let body;
                    try {
                        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    }
                    catch {
                        return send(400, { error: 'JSONの形式が不正です。' });
                    }
                    if (!body || typeof body !== 'object')
                        return send(400, { error: 'データの形式が不正です。' });
                    const current = await selected(body.productId);
                    if (body.revision !== current.revision)
                        return send(409, { error: '別の画面で手順またはモデルが更新されました。再読み込みしてください。' });
                    if (url.pathname === '/__guide/sync') {
                        const gitRoot = (await git(['rev-parse', '--show-toplevel'])).trim();
                        const origin = (await git(['remote', 'get-url', 'origin'], gitRoot)).trim();
                        if (!/^(https:\/\/github\.com\/|git@github\.com:)kenken49-2401\/fusion-visualizer1(?:\.git)?$/.test(origin))
                            return send(400, { error: 'GitHubの同期先が想定と異なります。' });
                        const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], gitRoot)).trim(), path = relative(gitRoot, current.path);
                        const staged = (await git(['diff', '--cached', '--name-only', '-z'], gitRoot)).split('\0').filter(Boolean);
                        if (staged.some(p => p !== path))
                            return send(409, { error: 'ほかのファイルがステージされています。先に整理してください。' });
                        await git(['add', '--', path], gitRoot);
                        const changed = (await git(['diff', '--cached', '--name-only', '-z'], gitRoot)).split('\0').filter(Boolean);
                        if (changed.some(p => p !== path))
                            throw new Error('ステージ内容が変わりました。');
                        if (changed.length)
                            await git(['commit', '-m', 'Update assembly instructions', '--only', '--', path], gitRoot);
                        await git(['push', 'origin', `HEAD:refs/heads/${branch}`], gitRoot);
                        return send(200, { synced: true });
                    }
                    const guide = parseGuide(body.guide, current.knownBodies);
                    if (guide.productId !== current.id)
                        return send(400, { error: '制作物が一致しません。' });
                    const source = JSON.stringify(guide, null, 2) + '\n';
                    await mkdir(resolve(root, '.local/backups'), { recursive: true });
                    await writeFile(resolve(root, '.local/backups', `${current.id}-${current.revision}.json`), current.source, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST')
                        throw e; });
                    temporary = current.path + '.pending';
                    await writeFile(temporary, source, { flag: 'wx' });
                    await rename(temporary, current.path);
                    temporary = undefined;
                    const saved = await selected(current.id);
                    send(200, { guide: saved.guide, revision: saved.revision });
                }
                catch (e) {
                    send(400, { error: e instanceof Error && !('stderr' in e) ? e.message : '保存・同期に失敗しました。Git認証・接続・ファイルの状態を確認してください。' });
                }
                finally {
                    if (temporary)
                        await unlink(temporary).catch(() => { });
                    busy = false;
                }
            });
        } };
}
