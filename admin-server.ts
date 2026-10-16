import { readFile, writeFile, rename, unlink, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseConfig, validateColors } from './src/config.ts';
import { bakeColors } from './src/three-mf-colors.ts';

const exec = promisify(execFile);
const revisionOf = (config: string, model: Uint8Array) => createHash('sha256').update(config).update('\0').update(model).digest('hex');
export type GitRunner = (args: string[]) => Promise<string>;

/** This helper accepts fixed selected paths only; tests inject a disposable local Git runner. */
export async function syncSelected(git: GitRunner, paths: string[]): Promise<{ committed: boolean }> {
  const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  if (!branch || branch.startsWith('-')) throw new Error('ブランチ上で同期してください。');
  const origin = (await git(['remote', 'get-url', 'origin'])).trim();
  if (!/^(https:\/\/github\.com\/|git@github\.com:)kenken49-2401\/fusion-visualizer1(?:\.git)?$/.test(origin)) throw new Error('同期先の GitHub リポジトリが想定と異なります。');
  const staged = (await git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
  if (staged.some(path => !paths.includes(path))) throw new Error('ほかのファイルがステージされています。先にステージを解除してください。');
  await git(['add', '--', ...paths]);
  const changed = (await git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
  if (changed.some(path => !paths.includes(path))) throw new Error('ステージ内容が変更されました。同期を中止しました。');
  if (changed.length) await git(['commit', '-m', 'Update model body colors', '--only', '--', ...paths]);
  await git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  return { committed: changed.length > 0 };
}

export function localAdmin(): Plugin {
  return {
    name: 'local-body-colors', apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      let writing = false;
      const snapshots = new Map<string, { model: Uint8Array; modelPath: string }>();
      async function selected(id: unknown) {
        if (typeof id !== 'string') throw new Error('モデルを選択してください。');
        const catalog = JSON.parse(await readFile(resolve(root, 'public/catalog.json'), 'utf8'));
        const entry = catalog.models?.find((model: { id: string }) => model.id === id);
        if (!entry || typeof entry.config !== 'string' || !/^[\w./-]+\.json$/.test(entry.config) || entry.config.split('/').includes('..')) throw new Error('モデルが見つかりません。');
        const publicRoot = await realpath(resolve(root, 'public'));
        const configPath = await realpath(resolve(publicRoot, entry.config));
        if (!configPath.startsWith(`${publicRoot}/`)) throw new Error('設定のパスが不正です。');
        const source = await readFile(configPath, 'utf8');
        const config = parseConfig(JSON.parse(source));
        const modelPath = await realpath(resolve(publicRoot, config.model));
        if (!modelPath.startsWith(`${publicRoot}/models/`)) throw new Error('モデルのパスが不正です。');
        const model = await readFile(modelPath);
        return { source, config, model, configPath, modelPath, revision: revisionOf(source, model) };
      }
      server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        const route = url.pathname;
        if (!['/__admin/config', '/__admin/colors', '/__admin/sync'].includes(route)) return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
        const send = (status: number, data: unknown) => { response.statusCode = status; response.end(JSON.stringify(data)); };
        const host = request.headers.host || '';
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '')) return send(403, { error: '管理画面は開発者のPC内だけで使用できます。' });
        if (route === '/__admin/config' && request.method === 'GET') {
          try {
            const current = await selected(url.searchParams.get('model') || 'figure-stand');
            if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value!);
            snapshots.set(current.revision, { model: current.model, modelPath: current.modelPath });
            return send(200, { config: current.config, revision: current.revision });
          } catch { return send(400, { error: '表示設定を読み取れません。モデルを確認してください。' }); }
        }
        if (request.method !== 'POST' || route === '/__admin/config') return send(405, { error: 'この操作には対応していません。' });
        if (request.headers.origin !== `http://${host}` || request.headers['content-type']?.split(';')[0] !== 'application/json') return send(403, { error: '管理画面と同じオリジンから保存してください。' });
        if (writing) return send(409, { error: '保存または同期が進行中です。少し待ってください。' });
        writing = true;
        const temporary: string[] = [];
        try {
          const chunks: Buffer[] = []; let length = 0;
          for await (const chunk of request) {
            const value = Buffer.from(chunk); length += value.byteLength;
            if (length > 65536) return send(413, { error: '色設定が大きすぎます。' });
            chunks.push(value);
          }
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object') throw new Error(); } catch { return send(400, { error: '設定の形式が不正です。' }); }
          let current;
          try { current = await selected(body.modelId || 'figure-stand'); } catch { return send(400, { error: 'モデルが見つかりません。' }); }
          if (body.revision !== current.revision) return send(409, { error: 'モデルまたは設定が更新されています。ページを再読み込みしてください。' });
          if (route === '/__admin/sync') {
            const git: GitRunner = async args => (await exec('git', args, { cwd: root, timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } })).stdout;
            try {
              const result = await syncSelected(git, [relative(root, current.modelPath), relative(root, current.configPath)]);
              return send(200, { ...result, revision: current.revision });
            } catch (error) { return send(500, { error: error instanceof Error && !('stderr' in error) ? error.message : 'GitHubへの同期に失敗しました。既存のGit認証と接続、ブランチを確認してください。' }); }
          }
          let colors;
          try { colors = validateColors(body.colors); } catch { return send(400, { error: '色設定の形式が不正です。' }); }
          let model;
          try {
            const snapshot = body.baseRevision ? snapshots.get(body.baseRevision) : { model: current.model, modelPath: current.modelPath };
            if (!snapshot || snapshot.modelPath !== current.modelPath) return send(409, { error: '読込時のモデルが見つかりません。再読み込みしてください。' });
            model = bakeColors(snapshot.model, colors);
          } catch { return send(400, { error: 'ボディの色を保存できません。モデルと色設定を確認してください。' }); }
          const text = `${JSON.stringify({ ...current.config, colors: {}, updatedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) }, null, 2)}\n`;
          const backup = resolve(root, '.local/backups', `${current.revision}.3mf`);
          await mkdir(dirname(backup), { recursive: true });
          await writeFile(backup, current.model, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
          const modelTemp = `${current.modelPath}.pending`; const configTemp = `${current.configPath}.pending`;
          temporary.push(modelTemp, configTemp);
          await writeFile(modelTemp, model, { flag: 'wx' }); await writeFile(configTemp, text, { flag: 'wx' });
          await rename(modelTemp, current.modelPath);
          try { await rename(configTemp, current.configPath); } catch (error) {
            await writeFile(modelTemp, current.model); await rename(modelTemp, current.modelPath); throw error;
          }
          send(200, { config: JSON.parse(text), revision: revisionOf(text, model) });
        } catch { send(500, { error: '保存できませんでした。ファイルの書き込み権限を確認してください。' }); }
        finally { await Promise.all(temporary.map(path => unlink(path).catch(() => {}))); writing = false; }
      });
    },
  };
}
