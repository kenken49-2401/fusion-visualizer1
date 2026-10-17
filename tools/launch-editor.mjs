import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = 5273;
const URL = `http://127.0.0.1:${PORT}/`;
const message = (value) => console.log(`[Fusion Editor] ${value}`);

export function isLivePID(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export async function acquireLock(root) {
  const filename = path.join(root, '.local/updater/launcher.lock');
  await mkdir(path.dirname(filename), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    let handle;
    try {
      handle = await open(filename, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.close();
      return () => {
        try {
          if (JSON.parse(readFileSync(filename, 'utf8')).token === token) unlinkSync(filename);
        } catch { /* Already released or superseded. */ }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = readFileSync(filename, 'utf8'); }
      catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
      let owner;
      try { owner = JSON.parse(previous); }
      catch {
        if (Date.now() - statSync(filename).mtimeMs > 30_000) {
          if (readFileSync(filename, 'utf8') === previous) unlinkSync(filename);
          continue;
        }
        throw new Error('起動ロックを確認できません。30秒ほど待ってから再試行してください。');
      }
      if (isLivePID(owner.pid)) throw new Error('別のエディター起動処理が実行中です。完了をお待ちください。');
      // Never remove a lock that changed while checking its owner.
      if (readFileSync(filename, 'utf8') === previous) unlinkSync(filename);
    }
  }
  throw new Error('起動ロックを取得できませんでした。');
}

export function probeRuntime(port = PORT) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('error', (error) => { socket.destroy(); resolve(error.code === 'ECONNREFUSED' ? 'free' : 'other'); });
    socket.once('timeout', () => { socket.destroy(); resolve('other'); });
    socket.once('connect', () => {
      socket.destroy();
      let finished = false;
      const finish = (status) => { if (!finished) { finished = true; resolve(status); } };
      const request = http.get({ hostname: '127.0.0.1', port, path: '/__guide/runtime', timeout: 1000 }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; if (data.length > 4096) { request.destroy(); finish('other'); } });
        response.on('end', () => {
          try {
            const runtime = JSON.parse(data);
            finish(response.statusCode === 200 && runtime.app === 'fusion-assembly-guide' && runtime.mode === 'admin' ? 'editor' : 'other');
          } catch { finish('other'); }
        });
        response.on('error', () => finish('other'));
      });
      request.on('timeout', () => { request.destroy(); finish('other'); });
      request.on('error', () => finish('other'));
    });
  });
}

export function dependencyFingerprint(lockfile, nodeMajor = Number(process.versions.node.split('.')[0])) {
  return { lockSHA256: createHash('sha256').update(lockfile).digest('hex'), nodeMajor };
}

export function findNpmCLI(execPath = process.execPath) {
  const binaryDirectories = [...new Set([path.dirname(execPath), path.dirname(realpathSync(execPath))])];
  const candidates = binaryDirectories.flatMap((directory) => [
    path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
    path.resolve(directory, '../share/nodejs/npm/bin/npm-cli.js'),
  ]);
  return candidates.find((candidate) => existsSync(candidate));
}

function openBrowser() {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browser = spawn(command, [URL], { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => message(`ブラウザーで ${URL} を開いてください。`));
  browser.unref();
}

export async function launch({ root = ROOT, noUpdate = false, noBrowser = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 LTS 以降をインストールしてください。');
  let existing = await probeRuntime();
  if (existing === 'editor') {
    message('起動中のエディターを開きます。編集中の内容はそのままです。');
    if (!noBrowser) openBrowser();
    return;
  }
  if (existing === 'other') throw new Error(`ポート ${PORT} は別のアプリが使用中です。自動では停止しません。`);
  const release = await acquireLock(root);
  let child;
  let cancelled = false;
  const stop = () => { cancelled = true; if (child && child.exitCode === null) child.kill('SIGTERM'); };
  const exitCleanup = () => { stop(); release(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.once('exit', exitCleanup);
  const checkCancelled = () => { if (cancelled) throw new Error('起動を中止しました。'); };
  const run = (command, args, cwd) => new Promise((resolve, reject) => {
    checkCancelled();
    child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0) resolve();
      else reject(new Error(`依存パッケージのインストールに失敗しました (${signal || code})。ネット接続を確認して再起動してください。`));
    });
  });
  try {
    // Check again under the lock before modifying installed files.
    existing = await probeRuntime();
    if (existing === 'editor') { if (!noBrowser) openBrowser(); return; }
    if (existing === 'other') throw new Error(`ポート ${PORT} は別のアプリが使用中です。`);
    if (!noUpdate) {
      message('GitHub の更新を確認しています…');
      let updateResult;
      try {
        const { updateDesktop } = await import('./desktop-update.mjs');
        updateResult = await updateDesktop(root, { onMessage: message });
      } catch (error) { message(`更新を確認できませんでした。現在のアプリで続行します: ${error.message}`); }
      // A failed recovery can leave a mixed installation; do not load that app.
      if (updateResult?.fatal) throw new Error(updateResult.message || '更新を安全に復旧できないため、起動を中止しました。バックアップを確認してください。');
      if (['offline', 'conflict', 'skipped'].includes(updateResult?.status)) message('更新を適用せず、現在のアプリで起動を続けます。');
    } else message('今回は自動更新を省略します。');
    checkCancelled();
    const guide = path.join(root, 'assembly-guide');
    const vite = path.join(guide, 'node_modules/vite/bin/vite.js');
    const stampPath = path.join(root, '.local/updater/dependencies.json');
    const fingerprint = dependencyFingerprint(await readFile(path.join(guide, 'package-lock.json')));
    let stamp;
    try { stamp = JSON.parse(await readFile(stampPath, 'utf8')); } catch { /* First launch. */ }
    if (!existsSync(vite) || stamp?.lockSHA256 !== fingerprint.lockSHA256 || stamp?.nodeMajor !== fingerprint.nodeMajor) {
      message('必要なパッケージを準備しています。初回は数分かかることがあります…');
      const npm = findNpmCLI();
      if (npm) await run(process.execPath, [npm, 'ci'], guide);
      else if (process.platform === 'win32') await run('cmd.exe', ['/d', '/s', '/c', 'npm ci'], guide);
      else await run('npm', ['ci'], guide);
      checkCancelled();
      if (!existsSync(vite)) throw new Error('Vite が見つかりません。インストール結果を確認してください。');
      await writeFile(stampPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
    }
    checkCancelled();
    if (await probeRuntime() !== 'free') throw new Error(`起動前にポート ${PORT} が使用されました。再起動してください。`);
    message(`エディターを起動しています: ${URL}`);
    child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--mode', 'admin', '--port', String(PORT), '--strictPort'], { cwd: guide, stdio: 'inherit', windowsHide: false });
    let serverEnded = false;
    const serverDone = new Promise((resolve) => {
      child.once('error', (error) => { serverEnded = true; resolve({ error }); });
      child.once('exit', (code, signal) => { serverEnded = true; resolve({ code, signal }); });
    });
    let ready = false;
    for (let attempt = 0; attempt < 120 && !serverEnded; attempt++) {
      checkCancelled();
      if (await probeRuntime() === 'editor') { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('エディターの起動を確認できませんでした。上のエラーをご確認ください。');
    message('起動しました。この画面を閉じるとエディターも終了します。終了するには Ctrl+C。');
    if (!noBrowser) openBrowser();
    const result = await serverDone;
    if (!cancelled && (result.error || result.code !== 0)) throw result.error || new Error(`エディターが終了しました (${result.signal || result.code})。`);
  } finally {
    // Keep the lock until our own child has actually stopped.
    const remaining = child;
    const closed = remaining?.pid && remaining.exitCode === null && remaining.signalCode === null
      ? new Promise((resolve) => remaining.once('close', resolve)) : Promise.resolve();
    stop();
    await closed;
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.off('exit', exitCleanup);
    release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--no-update', '--no-browser'].includes(arg))) {
    console.error('使用方法: node tools/launch-editor.mjs [--no-update] [--no-browser]');
    process.exitCode = 1;
  } else {
    launch({ noUpdate: args.includes('--no-update'), noBrowser: args.includes('--no-browser') }).catch((error) => {
      console.error(`\n[Fusion Editor] ${error.message}`);
      process.exitCode = 1;
    });
  }
}
