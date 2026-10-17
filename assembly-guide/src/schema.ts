export type IconKind = 'part' | 'screw' | 'tool' | 'other';
export type MarkerKind = 'screw' | 'arrow' | 'point';
export interface Supply {
    id: string;
    name: string;
    quantity: string;
    unit: string;
    icon: IconKind;
    note: string;
}
export interface Requirement {
    materialId: string;
    quantity: string;
}
export interface FixingMarker {
    id: string;
    type: MarkerKind;
    label: string;
    position: [
        number,
        number,
        number
    ];
    direction: [
        number,
        number,
        number
    ];
    lengthMM: number;
}
export interface GuideStep {
    id: string;
    title: string;
    description: string;
    bodyIds: string[];
    materials: Requirement[];
    tools: string[];
    methods: string[];
    markers: FixingMarker[];
}
export interface Guide {
    schemaVersion: 1;
    productId: string;
    title: string;
    summary: string;
    status: 'draft' | 'ready';
    materials: Supply[];
    steps: GuideStep[];
}
const icons = ['part', 'screw', 'tool', 'other'];
const kinds = ['screw', 'arrow', 'point'];
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('項目の形式が不正です。'); return v as Record<string, unknown>; };
const string = (v: unknown, max = 5000) => { if (typeof v !== 'string' || v.length > max)
    throw new Error('文字列が長すぎるか形式が不正です。'); return v; };
const id = (v: unknown) => { const s = string(v, 180); if (!/^[\w:/.-]+$/.test(s) || ['__proto__', 'constructor', 'prototype'].includes(s))
    throw new Error('識別子が不正です。'); return s; };
const list = (v: unknown, max = 500): unknown[] => { if (!Array.isArray(v) || v.length > max)
    throw new Error('一覧の形式または件数が不正です。'); return v; };
const texts = (v: unknown) => list(v, 100).map(s => string(s, 1000));
const vector = (v: unknown): [
    number,
    number,
    number
] => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7))
    throw new Error('座標・方向は有限の数値で入力してください。'); return [...v] as [
    number,
    number,
    number
]; };
function unique(ids: string[], label: string) { if (new Set(ids).size !== ids.length)
    throw new Error(`${label}が重複しています。`); }
export function parseGuide(value: unknown, knownBodies?: Iterable<string>): Guide {
    const g = object(value);
    if (g.schemaVersion !== 1)
        throw new Error('対応していない手順データです。');
    const productId = id(g.productId);
    if (!/^[a-z0-9-]+$/.test(productId))
        throw new Error('制作物の識別子が不正です。');
    if (g.status !== 'draft' && g.status !== 'ready')
        throw new Error('手順の状態が不正です。');
    const materials = list(g.materials, 300).map(v => { const m = object(v); if (!icons.includes(String(m.icon)))
        throw new Error('物資のアイコンが不正です。'); return { id: id(m.id), name: string(m.name, 160), quantity: string(m.quantity, 80), unit: string(m.unit, 30), icon: m.icon as IconKind, note: string(m.note, 1000) }; });
    unique(materials.map(m => m.id), '物資ID');
    const supplies = new Set(materials.map(m => m.id));
    const assigned = new Set<string>(), bodies = knownBodies ? new Set(knownBodies) : undefined;
    const steps = list(g.steps, 200).map(v => {
        const s = object(v), bodyIds = list(s.bodyIds, 2000).map(id);
        unique(bodyIds, '同じステップの部品');
        for (const body of bodyIds) {
            if (assigned.has(body))
                throw new Error('同じ部品を複数のステップで追加できません。');
            if (bodies && !bodies.has(body))
                throw new Error('モデルに存在しない部品があります。');
            assigned.add(body);
        }
        const requirements = list(s.materials, 300).map(v => { const r = object(v), materialId = id(r.materialId); if (!supplies.has(materialId))
            throw new Error('一覧に存在しない物資が指定されています。'); return { materialId, quantity: string(r.quantity, 80) }; });
        unique(requirements.map(r => r.materialId), 'ステップの物資');
        const markers = list(s.markers, 100).map(v => { const m = object(v); if (!kinds.includes(String(m.type)))
            throw new Error('固定記号の種類が不正です。'); const direction = vector(m.direction); if (Math.hypot(...direction) < 1e-8)
            throw new Error('固定記号の方向はゼロにできません。'); if (typeof m.lengthMM !== 'number' || !Number.isFinite(m.lengthMM) || m.lengthMM <= 0 || m.lengthMM > 10000)
            throw new Error('ビス長さは0より大きく10000mm以下にしてください。'); return { id: id(m.id), type: m.type as MarkerKind, label: string(m.label, 300), position: vector(m.position), direction, lengthMM: m.lengthMM }; });
        unique(markers.map(m => m.id), '固定記号ID');
        const title = string(s.title, 160);
        if (!title.trim())
            throw new Error('ステップの見出しを入力してください。');
        return { id: id(s.id), title, description: string(s.description), bodyIds, materials: requirements, tools: texts(s.tools), methods: texts(s.methods), markers };
    });
    if (!steps.length)
        throw new Error('手順は1ステップ以上必要です。');
    unique(steps.map(s => s.id), 'ステップID');
    const title = string(g.title, 160);
    if (!title.trim())
        throw new Error('制作物の名前を入力してください。');
    if (g.status === 'ready' && bodies && assigned.size !== bodies.size)
        throw new Error('未配置の部品があります。確認済みにする前に全ての部品を手順に割り当ててください。');
    if (g.status === 'ready' && steps.some(s => !s.description.trim()))
        throw new Error('確認済みの手順には各ステップの説明が必要です。');
    return { schemaVersion: 1, productId, title, summary: string(g.summary, 2000), status: g.status, materials, steps };
}
export function stepBodies(guide: Guide, index: number) { const current = new Set(guide.steps[index]?.bodyIds ?? []); const visible = new Set(guide.steps.slice(0, index + 1).flatMap(s => s.bodyIds)); return { current, visible }; }
export const newId = () => `id-${crypto.randomUUID()}`;
