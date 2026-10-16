export interface ViewerConfig {
  schemaVersion: 1;
  model: string;
  title: string;
  description: string;
  updatedAt: string;
  upAxis: 'Y' | 'Z';
  frontAxis: 'X' | 'Y';
  colors: Record<string, string>;
}

export function validateColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('色設定の形式が不正です。');
  const entries = Object.entries(value);
  if (entries.length > 2000) throw new Error('色設定が多すぎます。');
  const result: Record<string, string> = Object.create(null);
  for (const [key, color] of entries) {
    if (!/^[\w:/.-]{1,180}$/.test(key) || key === '__proto__' || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error('ボディの色は #RRGGBB 形式で指定してください。');
    }
    result[key] = color.toLowerCase();
  }
  return result;
}

export function parseConfig(value: unknown): ViewerConfig {
  if (!value || typeof value !== 'object') throw new Error('表示設定を読み取れません。');
  const c = value as Partial<ViewerConfig>;
  if (c.schemaVersion !== 1) throw new Error('対応していない設定バージョンです。');
  if (typeof c.model !== 'string' || !/^models\/[\w./-]+\.3mf$/i.test(c.model) || c.model.split('/').includes('..')) {
    throw new Error('モデルはこのサイト内の models フォルダーに配置してください。');
  }
  if (typeof c.title !== 'string' || !c.title.trim() || c.title.length > 160) throw new Error('モデル名が不正です。');
  if (c.upAxis !== 'Y' && c.upAxis !== 'Z') throw new Error('上方向は Y または Z を指定してください。');
  if (c.frontAxis !== 'X' && c.frontAxis !== 'Y') throw new Error('正面方向は X または Y を指定してください。');
  if (typeof c.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.updatedAt)) throw new Error('更新日が不正です。');
  if (typeof c.description !== 'string' || c.description.length > 2000) throw new Error('モデルの説明が不正です。');
  return { ...c, colors: validateColors(c.colors) } as ViewerConfig;
}

export async function fetchConfig(): Promise<ViewerConfig> {
  const response = await fetch(`${import.meta.env.BASE_URL}viewer.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`表示設定を取得できませんでした（${response.status}）。`);
  return parseConfig(await response.json());
}
