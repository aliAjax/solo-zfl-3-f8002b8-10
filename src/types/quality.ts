import type { Bench } from '@/types';

/** 严重级别 */
export type SeverityType = 'high' | 'medium' | 'low';

/** 字段值类型 */
export type FieldValueType = 'number' | 'string' | 'enum' | 'boolean';

/** 比较方式（操作符） */
export type OperatorType =
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'eq'
  | 'neq'
  | 'between'
  | 'outside'
  | 'empty'
  | 'notEmpty'
  | 'contains'
  | 'notContains';

/** 规则可引用的字段（含两个衍生字段） */
export type QualityFieldKey =
  | 'name'
  | 'location'
  | 'review'
  | 'lat'
  | 'lng'
  | 'rating'
  | 'material'
  | 'orientation'
  | 'shadeLevel'
  | 'noiseLevel'
  | 'stayDuration'
  | 'hasBackrest'
  | 'experienceCount';

export interface QualityRule {
  id: string;
  name: string;
  description?: string;
  field: QualityFieldKey;
  operator: OperatorType;
  /** 主阈值（枚举/布尔存字符串，数字存数字，文本存字符串） */
  value?: string | number;
  /** 第二阈值（between / outside 的另一端） */
  value2?: string | number;
  severity: SeverityType;
  enabled: boolean;
  /** 引用的其它规则 id：本规则命中需被引用规则也命中 */
  references: string[];
  /** 列表排序，越小越靠前 */
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 一条「规则 × 长椅」的校验结论 */
export interface ValidationResult {
  ruleId: string;
  benchId: string;
  hit: boolean;
  field: QualityFieldKey;
  severity: SeverityType;
  /** 命中时的实际值（展示用） */
  actualValue?: string;
  /** 规则当前是否启用（停用后结果仍保留，置灰展示） */
  ruleEnabled: boolean;
}

/** 一次（全量或增量）校验的元信息 */
export interface ValidationMeta {
  lastRunAt: string | null;
  checkedBenchCount: number;
  checkedRuleCount: number;
  hitCount: number;
  /** 最近一次执行重算的长椅条数 */
  lastRecomputeCount: number;
}

export interface FieldDef {
  key: QualityFieldKey;
  label: string;
  type: FieldValueType;
  /** enum 类型的可选项 */
  options?: { value: string; label: string }[];
}

export interface OperatorDef {
  key: OperatorType;
  label: string;
  appliesTo: FieldValueType[];
  /** 需要几个阈值输入 */
  valueInputs: 0 | 1 | 2;
  /** 阈值输入类型，默认与字段类型一致 */
  valueType?: 'number' | 'text' | 'enum' | 'boolean';
}

export const SEVERITY_LABELS: Record<SeverityType, string> = {
  high: '严重',
  medium: '警告',
  low: '提示',
};

export const SEVERITY_STYLES: Record<SeverityType, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-ochre/15 text-ochre border-ochre/30',
  low: 'bg-moss-green/10 text-moss-green border-moss-green/30',
};

export const SEVERITY_DOT_STYLES: Record<SeverityType, string> = {
  high: 'bg-red-500',
  medium: 'bg-ochre',
  low: 'bg-moss-green',
};

import {
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
} from '@/types';

function toOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'name', label: '名称', type: 'string' },
  { key: 'location', label: '位置描述', type: 'string' },
  { key: 'review', label: '评价文字', type: 'string' },
  { key: 'lat', label: '纬度', type: 'number' },
  { key: 'lng', label: '经度', type: 'number' },
  { key: 'rating', label: '综合评分', type: 'number' },
  { key: 'experienceCount', label: '时段体验条数', type: 'number' },
  { key: 'material', label: '材质', type: 'enum', options: toOptions(MATERIAL_LABELS) },
  { key: 'orientation', label: '朝向', type: 'enum', options: toOptions(ORIENTATION_LABELS) },
  { key: 'shadeLevel', label: '遮阴情况', type: 'enum', options: toOptions(SHADE_LABELS) },
  { key: 'noiseLevel', label: '噪音等级', type: 'enum', options: toOptions(NOISE_LABELS) },
  { key: 'stayDuration', label: '适合停留时长', type: 'enum', options: toOptions(STAY_DURATION_LABELS) },
  { key: 'hasBackrest', label: '是否有靠背', type: 'boolean' },
];

export const FIELD_DEF_MAP: Record<QualityFieldKey, FieldDef> = FIELD_DEFS.reduce(
  (acc, def) => {
    acc[def.key] = def;
    return acc;
  },
  {} as Record<QualityFieldKey, FieldDef>
);

export const OPERATOR_DEFS: OperatorDef[] = [
  { key: 'lt', label: '小于', appliesTo: ['number'], valueInputs: 1, valueType: 'number' },
  { key: 'lte', label: '小于等于', appliesTo: ['number'], valueInputs: 1, valueType: 'number' },
  { key: 'gt', label: '大于', appliesTo: ['number'], valueInputs: 1, valueType: 'number' },
  { key: 'gte', label: '大于等于', appliesTo: ['number'], valueInputs: 1, valueType: 'number' },
  { key: 'eq', label: '等于', appliesTo: ['number', 'enum', 'boolean'], valueInputs: 1 },
  { key: 'neq', label: '不等于', appliesTo: ['number', 'enum', 'boolean'], valueInputs: 1 },
  { key: 'between', label: '介于区间', appliesTo: ['number'], valueInputs: 2, valueType: 'number' },
  { key: 'outside', label: '超出区间', appliesTo: ['number'], valueInputs: 2, valueType: 'number' },
  { key: 'empty', label: '为空', appliesTo: ['string'], valueInputs: 0 },
  { key: 'notEmpty', label: '不为空', appliesTo: ['string'], valueInputs: 0 },
  { key: 'contains', label: '包含', appliesTo: ['string'], valueInputs: 1, valueType: 'text' },
  { key: 'notContains', label: '不包含', appliesTo: ['string'], valueInputs: 1, valueType: 'text' },
];

export const OPERATOR_DEF_MAP: Record<OperatorType, OperatorDef> = OPERATOR_DEFS.reduce(
  (acc, def) => {
    acc[def.key] = def;
    return acc;
  },
  {} as Record<OperatorType, OperatorDef>
);

/** 取字段原始值 */
export function getFieldValue(bench: Bench, field: QualityFieldKey): string | number | boolean {
  if (field === 'experienceCount') return bench.experiences.length;
  return bench[field] as string | number | boolean;
}

/** 展示用字段当前值 */
export function formatFieldValue(bench: Bench, field: QualityFieldKey): string {
  const raw = getFieldValue(bench, field);
  const def = FIELD_DEF_MAP[field];
  if (def.type === 'boolean') return raw ? '是' : '否';
  if (def.type === 'enum') {
    return def.options?.find((o) => o.value === raw)?.label ?? String(raw);
  }
  if (def.type === 'string' && (raw === '' || raw === null || raw === undefined)) {
    return '（空）';
  }
  return String(raw);
}

export interface EvalOutcome {
  hit: boolean;
  actualValue: string;
}

/** 规则条件描述（不含引用部分） */
export function describeCondition(rule: Pick<QualityRule, 'field' | 'operator' | 'value' | 'value2'>): string {
  const field = FIELD_DEF_MAP[rule.field];
  const op = OPERATOR_DEF_MAP[rule.operator];
  const fmt = (v: string | number | undefined) => {
    if (v === undefined) return '?';
    if (field.type === 'enum') return field.options?.find((o) => o.value === v)?.label ?? String(v);
    if (field.type === 'boolean') return String(v) === 'true' ? '是' : '否';
    return String(v);
  };
  switch (rule.operator) {
    case 'empty':
    case 'notEmpty':
      return `${field.label} ${op.label}`;
    case 'between':
    case 'outside':
      return `${field.label} ${op.label} [${fmt(rule.value)}, ${fmt(rule.value2)}]`;
    default:
      return `${field.label} ${op.label} ${fmt(rule.value)}`;
  }
}

/** 对单条规则的字段条件求值（不考虑引用） */
export function evalCondition(
  bench: Bench,
  rule: Pick<QualityRule, 'field' | 'operator' | 'value' | 'value2'>
): EvalOutcome {
  const def = FIELD_DEF_MAP[rule.field];
  const raw = getFieldValue(bench, rule.field);
  const actual = formatFieldValue(bench, rule.field);

  let hit = false;
  switch (rule.operator) {
    case 'empty':
      hit = def.type === 'string' ? String(raw ?? '').trim() === '' : raw === null || raw === undefined;
      break;
    case 'notEmpty':
      hit = def.type === 'string' ? String(raw ?? '').trim() !== '' : raw !== null && raw !== undefined;
      break;
    case 'contains':
      hit = String(raw).includes(String(rule.value ?? ''));
      break;
    case 'notContains':
      hit = !String(raw).includes(String(rule.value ?? ''));
      break;
    case 'between': {
      const n = Number(raw);
      const a = Number(rule.value);
      const b = Number(rule.value2);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      hit = n >= lo && n <= hi;
      break;
    }
    case 'outside': {
      const n = Number(raw);
      const a = Number(rule.value);
      const b = Number(rule.value2);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      hit = n < lo || n > hi;
      break;
    }
    case 'eq':
      if (def.type === 'number') hit = Number(raw) === Number(rule.value);
      else hit = String(raw) === String(rule.value);
      break;
    case 'neq':
      if (def.type === 'number') hit = Number(raw) !== Number(rule.value);
      else hit = String(raw) !== String(rule.value);
      break;
    case 'lt':
      hit = Number(raw) < Number(rule.value);
      break;
    case 'lte':
      hit = Number(raw) <= Number(rule.value);
      break;
    case 'gt':
      hit = Number(raw) > Number(rule.value);
      break;
    case 'gte':
      hit = Number(raw) >= Number(rule.value);
      break;
  }
  return { hit, actualValue: actual };
}

/** 找到一条环路（DFS），返回环路上的规则 id 序列（首尾相同）；无环返回 null */
export function findCycle(rules: Pick<QualityRule, 'id' | 'references'>[]): string[] | null {
  const map = new Map(rules.map((r) => [r.id, r.references.filter((ref) => rules.some((x) => x.id === ref))]));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (id: string): string[] | null => {
    if (stack.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    stack.add(id);
    path.push(id);
    for (const ref of map.get(id) ?? []) {
      const cycle = dfs(ref);
      if (cycle) return cycle;
    }
    stack.delete(id);
    path.pop();
    return null;
  };

  for (const rule of rules) {
    const cycle = dfs(rule.id);
    if (cycle) return cycle;
  }
  return null;
}

/** 拓扑排序：被引用者排在前面；有环时抛出 */
export function topoSort(rules: QualityRule[]): QualityRule[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const result: QualityRule[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=访问中 2=完成

  const visit = (rule: QualityRule) => {
    const s = state.get(rule.id) ?? 0;
    if (s === 2) return;
    if (s === 1) {
      const cycle = findCycle(rules);
      throw new Error(cycle ? cycle.join(' -> ') : '规则引用存在循环');
    }
    state.set(rule.id, 1);
    for (const refId of rule.references) {
      const ref = byId.get(refId);
      if (ref) visit(ref);
    }
    state.set(rule.id, 2);
    result.push(rule);
  };

  // 先按 order 稳定排序，再拓扑
  [...rules]
    .sort((a, b) => a.order - b.order)
    .forEach((r) => visit(r));
  return result;
}

/** 规则名映射辅助 */
export function ruleNameMap(rules: QualityRule[]): Map<string, QualityRule> {
  return new Map(rules.map((r) => [r.id, r]));
}
