// 今日の冴え（座る前の5段階の自己評価）とタグ（選択式・少数に絞る）

export const CONDITIONS = [
  { value: 1, label: '最悪' },
  { value: 2, label: '低め' },
  { value: 3, label: '普通' },
  { value: 4, label: '良い' },
  { value: 5, label: '冴えてる' },
];

/** 後から成績を見直したときに行動を変えられるものだけに絞っている */
export const TAGS = [
  { id: 'loose', label: 'ルース卓', hint: '甘い相手が多かった' },
  { id: 'tight', label: 'タイト卓', hint: '強い相手が多かった' },
  { id: 'tired', label: '疲れ・寝不足', hint: 'プレイ中に集中が落ちた' },
  { id: 'alcohol', label: '飲酒あり', hint: '1杯でも飲んだ' },
  { id: 'tilt', label: 'ティルト気味', hint: '感情的なプレイがあった' },
];
export const TAG_IDS = TAGS.map((t) => t.id);

export const conditionLabel = (v) => {
  const c = CONDITIONS.find((x) => x.value === v);
  return c ? `${c.value} ${c.label}` : '未入力';
};
export const tagLabel = (id) => (TAGS.find((t) => t.id === id) || { label: id }).label;

export function normalizeCondition(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}
export function normalizeTags(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return TAG_IDS.filter((id) => set.has(id));
}
