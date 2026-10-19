import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { updateDesktop } from './desktop-update.mjs';

const log = (callback, message) => { try { callback(message); } catch { /* Logging must not affect migration. */ } };

/** Reconcile data once when an older launcher has just installed the new app code. */
export async function prepareDesktopEditor(guideRoot, { updateImpl = updateDesktop, onMessage = console.log } = {}) {
  const root = dirname(resolve(guideRoot));
  let bytes;
  try { bytes = await readFile(join(root, '.local/desktop-update.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'skipped', message: 'デスクトップ配布の更新履歴がないため、起動前のデータ更新は不要です。' };
    throw new Error('デスクトップの更新履歴を読み取れません。起動を中止しました。', { cause: error });
  }
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
    if (state?.schemaVersion !== 1 || typeof state.commit !== 'string' || !/^[a-f0-9]{40}$/.test(state.commit) ||
        !state.files || typeof state.files !== 'object' || Array.isArray(state.files) ||
        Object.values(state.files).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid state');
  } catch (error) { throw new Error('デスクトップの更新履歴が不正です。バックアップを確認してから起動してください。', { cause: error }); }
  if (state.dataMergeVersion === 1) return { status: 'current', message: 'モデル追加の更新処理は適用済みです。', commit: state.commit };
  log(onMessage, '以前の起動方法で更新されたモデル一覧を確認しています。PC内で編集したモデル・制作手順は保持します。');
  const result = await updateImpl(root, { onMessage });
  if (result?.fatal) {
    const error = new Error(result.message || 'データ更新の復旧が必要なため、起動を中止しました。');
    error.fatal = true;
    throw error;
  }
  return result;
}
