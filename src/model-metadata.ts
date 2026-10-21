export interface ModelMetadata {
  status: 'known' | 'local-change' | 'unknown';
  uploadedAt?: string;
  sha256?: string;
  commit?: string;
}

/** Only a content hash match can connect this model to a recorded upload. */
export function metadataForModel(value: unknown, modelPath: string, expectedFingerprint?: string): ModelMetadata {
  const unknown: ModelMetadata = { status: 'unknown' };
  if (!value || typeof value !== 'object' || !expectedFingerprint || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) return unknown;
  const manifest = value as { schemaVersion?: unknown; models?: unknown };
  if (manifest.schemaVersion !== 1 || !manifest.models || typeof manifest.models !== 'object' || Array.isArray(manifest.models) || !Object.hasOwn(manifest.models, modelPath)) return unknown;
  const entry = (manifest.models as Record<string, unknown>)[modelPath];
  if (!entry || typeof entry !== 'object') return unknown;
  const record = entry as Record<string, unknown>;
  if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) || typeof record.uploadedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.uploadedAt) ||
      !Number.isFinite(Date.parse(record.uploadedAt)) || new Date(record.uploadedAt).toISOString() !== record.uploadedAt ||
      (record.commit !== undefined && (typeof record.commit !== 'string' || !/^[a-f0-9]{40,64}$/.test(record.commit)))) return unknown;
  if (record.sha256 !== expectedFingerprint) return { status: 'local-change' };
  return { status: 'known', uploadedAt: record.uploadedAt, sha256: record.sha256, ...(typeof record.commit === 'string' ? { commit: record.commit } : {}) };
}

export async function fetchModelMetadata(modelPath: string, expectedFingerprint?: string, publishedURL?: string): Promise<ModelMetadata> {
  if (!expectedFingerprint || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) return { status: 'unknown' };
  const read = async (url: string): Promise<ModelMetadata> => {
    try {
      const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
      return response.ok ? metadataForModel(await response.json(), modelPath, expectedFingerprint) : { status: 'unknown' };
    } catch { return { status: 'unknown' }; }
  };
  const local = await read(`${import.meta.env?.BASE_URL ?? '/'}model-metadata.json`);
  if (local.status === 'known') return local;
  const allowed = ['https://kenken49-2401.github.io/fusion-visualizer1/model-metadata.json', 'https://kenken49-2401.github.io/fusion-visualizer1/assembly-guide/model-metadata.json'];
  if (publishedURL && allowed.includes(publishedURL)) {
    const published = await read(publishedURL);
    if (published.status === 'known') return published;
  }
  return local;
}
