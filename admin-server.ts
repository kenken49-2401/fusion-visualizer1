import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseConfig, validateColors } from './src/config.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function localAdmin(): Plugin {
  return {
    name: 'local-body-colors',
    apply: 'serve',
    configureServer(server) {
      const path = `${server.config.root}/public/viewer.json`;
      let writing = false;
      server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next) => {
        const route = request.url?.split('?')[0];
        if (route !== '/__admin/config' && route !== '/__admin/colors') return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const send = (status: number, data: unknown) => { response.statusCode = status; response.end(JSON.stringify(data)); };
        const host = request.headers.host || '';
        const address = request.socket.remoteAddress;
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) {
          return send(403, { error: '色の管理画面は開発者のPC内だけで使用できます。' });
        }
        if (route === '/__admin/config' && request.method === 'GET') {
          try {
            const source = await readFile(path, 'utf8');
            return send(200, { config: parseConfig(JSON.parse(source)), revision: digest(source) });
          } catch { return send(500, { error: '表示設定を読み取れません。public/viewer.json を確認してください。' }); }
        }
        if (route !== '/__admin/colors' || request.method !== 'POST') return send(405, { error: 'この操作には対応していません。' });
        if (request.headers.origin !== `http://${host}` || request.headers['content-type']?.split(';')[0] !== 'application/json') {
          return send(403, { error: '管理画面と同じオリジンから保存してください。' });
        }
        if (writing) return send(409, { error: '別の保存処理が進行中です。少し待ってから保存してください。' });
        writing = true;
        const temporary = `${path}.pending`;
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            const value = Buffer.from(chunk); length += value.byteLength;
            if (length > 65536) return send(413, { error: '色設定が大きすぎます。' });
            chunks.push(value);
          }
          let body: { colors: unknown; revision: unknown };
          let colors: Record<string, string>;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            colors = validateColors(body.colors);
          } catch { return send(400, { error: '色設定の形式が不正です。' }); }
          const source = await readFile(path, 'utf8');
          const config = parseConfig(JSON.parse(source));
          if (body.revision !== digest(source)) return send(409, { error: '表示設定が別の画面で更新されています。ページを再読み込みしてください。' });
          const text = `${JSON.stringify({ ...config, colors, updatedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) }, null, 2)}\n`;
          await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
          await rename(temporary, path);
          send(200, { config: JSON.parse(text), revision: digest(text) });
        } catch {
          send(500, { error: '保存できませんでした。ファイルの書き込み権限を確認してください。' });
        } finally {
          await unlink(temporary).catch(() => {});
          writing = false;
        }
      });
    },
  };
}
