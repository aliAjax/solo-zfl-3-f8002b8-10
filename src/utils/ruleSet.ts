import type { QualityRule, QualityFieldKey, SeverityType, OperatorType } from '@/types/quality';
import { FIELD_DEF_MAP, OPERATOR_DEF_MAP, findCycle } from '@/types/quality';
import { generateId } from '@/utils/comfort';

export const RULESET_FORMAT = 'bench-quality-ruleset';
export const RULESET_VERSION = 1;

export interface RuleSetFile {
  format: string;
  version: number;
  exportedAt?: string;
  rules: unknown[];
}

export interface ImportIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface ImportPreview {
  ok: boolean;
  version: number | null;
  upgraded: boolean;
  count: number;
  rules: QualityRule[];
  issues: ImportIssue[];
}

/** v0 旧版字段名 → 现字段名 */
const LEGACY_FIELD_MAP: Record<string, QualityFieldKey> = {
  score: 'rating',
  comment: 'review',
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 解析并校验导入文件。
 * 任何致命错误都会返回 ok=false —— 调用方应整批拒绝、不动现有规则。
 * 升级（v0 → v1）不视为错误，upgraded=true 提示用户。
 */
export function parseRuleSet(rawText: string): ImportPreview {
  const issues: ImportIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      version: null,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: '文件不是合法的 JSON，无法识别为规则集。' }],
    };
  }

  if (!isObject(parsed) || parsed.format !== RULESET_FORMAT) {
    return {
      ok: false,
      version: null,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: `格式不符：缺少 "${RULESET_FORMAT}" 标识，可能不是本工具导出的规则集。` }],
    };
  }

  const file = parsed as Partial<RuleSetFile>;
  const version = typeof file.version === 'number' ? file.version : null;

  if (version === null) {
    return {
      ok: false,
      version: null,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: '缺少版本号信息，无法判断规则集版本。' }],
    };
  }
  if (version > RULESET_VERSION) {
    return {
      ok: false,
      version,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: `规则集版本 v${version} 高于当前支持的 v${RULESET_VERSION}，请先升级应用。` }],
    };
  }
  if (!Array.isArray(file.rules)) {
    return {
      ok: false,
      version,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: '规则集缺少 rules 数组。' }],
    };
  }
  if (file.rules.length === 0) {
    return {
      ok: false,
      version,
      upgraded: false,
      count: 0,
      rules: [],
      issues: [{ level: 'error', message: '规则集为空，没有可导入的规则。' }],
    };
  }

  const upgraded = version < RULESET_VERSION;
  if (upgraded) {
    issues.push({
      level: 'warning',
      message: `检测到旧版规则集 v${version}，将升级为 v${RULESET_VERSION}（旧字段 score→rating、comment→review，缺失的引用列表置空）。`,
    });
  }

  const rules: QualityRule[] = [];
  const now = new Date().toISOString();

  file.rules.forEach((rawRule, idx) => {
    const where = `第 ${idx + 1} 条规则`;
    if (!isObject(rawRule)) {
      issues.push({ level: 'error', message: `${where}：不是有效的规则对象。` });
      return;
    }

    const name = typeof rawRule.name === 'string' && rawRule.name.trim() ? rawRule.name.trim() : `未命名规则 ${idx + 1}`;
    const id = typeof rawRule.id === 'string' && rawRule.id ? rawRule.id : `imported-${idx}-${generateId()}`;

    // 字段（含旧版迁移）
    let field = rawRule.field as string;
    if (version === 0 && LEGACY_FIELD_MAP[field]) {
      field = LEGACY_FIELD_MAP[field];
    }
    if (!FIELD_DEF_MAP[field as QualityFieldKey]) {
      issues.push({ level: 'error', message: `规则「${name}」：引用了不存在或已下线的字段 "${field}"。` });
      return;
    }
    const fieldDef = FIELD_DEF_MAP[field as QualityFieldKey];

    // 比较方式
    const operator = rawRule.operator as OperatorType;
    const opDef = OPERATOR_DEF_MAP[operator];
    if (!opDef) {
      issues.push({ level: 'error', message: `规则「${name}」：比较方式 "${rawRule.operator}" 无法识别。` });
      return;
    }
    if (!opDef.appliesTo.includes(fieldDef.type)) {
      issues.push({
        level: 'error',
        message: `规则「${name}」：比较方式「${opDef.label}」不适用于字段「${fieldDef.label}」（${fieldDef.type}）。`,
      });
      return;
    }

    // 阈值
    const value = rawRule.value;
    const value2 = rawRule.value2;
    if (opDef.valueInputs >= 1 && (value === undefined || value === null || value === '')) {
      issues.push({ level: 'error', message: `规则「${name}」：缺少阈值。` });
      return;
    }
    const expectNumber = opDef.valueType === 'number' || (opDef.valueInputs >= 1 && fieldDef.type === 'number');
    if (expectNumber && (Number.isNaN(Number(value)))) {
      issues.push({ level: 'error', message: `规则「${name}」：阈值 "${value}" 不是有效数字。` });
      return;
    }
    if (opDef.valueInputs === 2) {
      if (value2 === undefined || value2 === null || value2 === '' || Number.isNaN(Number(value2))) {
        issues.push({ level: 'error', message: `规则「${name}」：区间上限缺失或不是数字。` });
        return;
      }
    }
    if (opDef.valueInputs === 0 && value !== undefined) {
      // 宽容处理，不报错
    }
    if (fieldDef.type === 'enum' && !fieldDef.options?.some((o) => o.value === String(value))) {
      issues.push({ level: 'error', message: `规则「${name}」：阈值 "${value}" 不是字段「${fieldDef.label}」的合法取值。` });
      return;
    }
    if (fieldDef.type === 'boolean' && value !== 'true' && value !== 'false' && value !== true && value !== false) {
      issues.push({ level: 'error', message: `规则「${name}」：布尔阈值必须为 true/false。` });
      return;
    }

    // 严重级别
    const severity = rawRule.severity as SeverityType;
    if (!['high', 'medium', 'low'].includes(severity)) {
      issues.push({ level: 'error', message: `规则「${name}」：严重级别 "${rawRule.severity}" 无效。` });
      return;
    }

    // 引用（v0 可能没有该字段）
    let references: string[] = [];
    if (Array.isArray(rawRule.references)) {
      references = rawRule.references.filter((r): r is string => typeof r === 'string');
    }

    rules.push({
      id,
      name,
      description: typeof rawRule.description === 'string' ? rawRule.description : '',
      field: field as QualityFieldKey,
      operator,
      value: value as string | number | undefined,
      value2: value2 as string | number | undefined,
      severity,
      enabled: typeof rawRule.enabled === 'boolean' ? rawRule.enabled : true,
      references,
      order: typeof rawRule.order === 'number' ? rawRule.order : idx,
      createdAt: typeof rawRule.createdAt === 'string' ? rawRule.createdAt : now,
      updatedAt: now,
    });
  });

  if (rules.length !== file.rules.length) {
    return { ok: false, version, upgraded, count: rules.length, rules, issues };
  }

  // 引用必须在文件内闭环
  const ids = new Set(rules.map((r) => r.id));
  for (const rule of rules) {
    for (const ref of rule.references) {
      if (!ids.has(ref)) {
        issues.push({
          level: 'error',
          message: `规则「${rule.name}」引用了规则集之外的规则（${ref}），整批导入会断链，请连同被引用规则一起导出。`,
        });
      }
    }
  }

  // 自引用 / 循环引用
  for (const rule of rules) {
    if (rule.references.includes(rule.id)) {
      issues.push({ level: 'error', message: `规则「${rule.name}」引用了自身，形成自循环。` });
    }
  }
  const cycle = findCycle(rules);
  if (cycle) {
    const namePath = cycle.map((id) => rules.find((r) => r.id === id)?.name ?? id).join(' → ');
    issues.push({ level: 'error', message: `规则引用存在循环：${namePath}。` });
  }

  // 重名仅警告
  const nameCounts = new Map<string, number>();
  rules.forEach((r) => nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1));
  nameCounts.forEach((count, name) => {
    if (count > 1) issues.push({ level: 'warning', message: `规则「${name}」在文件中出现了 ${count} 次。` });
  });

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, version, upgraded, count: rules.length, rules, issues };
}

export function buildRuleSet(rules: QualityRule[]): string {
  const payload: RuleSetFile = {
    format: RULESET_FORMAT,
    version: RULESET_VERSION,
    exportedAt: new Date().toISOString(),
    rules,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 提交导入：为所有规则分配新 id（绝不覆盖现有规则），
 * 同步改写内部引用边；order 从 startOrder 顺延。
 */
export function remapImportedRules(rules: QualityRule[], startOrder: number): QualityRule[] {
  const idMap = new Map<string, string>();
  const now = new Date().toISOString();
  rules.forEach((rule) => idMap.set(rule.id, generateId()));
  return rules.map((rule, idx) => ({
    ...rule,
    id: idMap.get(rule.id)!,
    references: rule.references.map((ref) => idMap.get(ref) ?? ref),
    order: startOrder + idx,
    createdAt: now,
    updatedAt: now,
  }));
}
