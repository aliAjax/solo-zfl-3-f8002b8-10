import type { Bench } from '@/types';
import type { QualityRule, ValidationResult } from '@/types/quality';
import { evalCondition, findCycle, topoSort } from '@/types/quality';

export interface EvalScope {
  /** 只评估这些规则（缺省为全部启用规则） */
  ruleIds?: string[];
  /** 只评估这些长椅（缺省为全部） */
  benchIds?: string[];
}

export interface EvalOutput {
  results: ValidationResult[];
  cycle: string[] | null;
  evaluatedRuleIds: string[];
}

/**
 * 对给定范围执行校验。
 * - 仅评估启用的规则；
 * - 规则按引用拓扑排序（被引用者先算）；
 * - 命中 = 字段条件命中 且 所有「存在且启用」的被引用规则也命中；
 * - 停用或已删除的引用视为不附加条件（不阻断）。
 */
export function evaluateRules(rules: QualityRule[], benches: Bench[], scope: EvalScope = {}): EvalOutput {
  const enabled = rules.filter((r) => r.enabled);
  const scopedRules = scope.ruleIds
    ? enabled.filter((r) => scope.ruleIds!.includes(r.id))
    : enabled;
  const scopedBenches = scope.benchIds
    ? benches.filter((b) => scope.benchIds!.includes(b.id))
    : benches;

  // 范围规则可能引用范围外规则，拓扑需要完整图
  const cycle = findCycle(enabled);
  if (cycle) {
    return { results: [], cycle, evaluatedRuleIds: [] };
  }

  const ordered = topoSort(enabled);
  const orderedScoped = ordered.filter((r) => scopedRules.some((s) => s.id === r.id));
  const ruleById = new Map(enabled.map((r) => [r.id, r]));

  // hitLookup: ruleId -> Set<benchId>
  const hitLookup = new Map<string, Set<string>>();
  const results: ValidationResult[] = [];

  for (const rule of ordered) {
    const ownHits = new Set<string>();
    for (const bench of scopedBenches) {
      const outcome = evalCondition(bench, rule);
      if (outcome.hit) ownHits.add(bench.id);
    }

    // 引用过滤：只考虑存在且启用的引用
    const activeRefs = rule.references.filter((ref) => ruleById.has(ref));
    let hits = ownHits;
    if (activeRefs.length > 0) {
      hits = new Set([...ownHits].filter((benchId) =>
        activeRefs.every((ref) => hitLookup.get(ref)?.has(benchId))
      ));
    }
    hitLookup.set(rule.id, hits);

    if (orderedScoped.some((r) => r.id === rule.id)) {
      for (const bench of scopedBenches) {
        results.push({
          ruleId: rule.id,
          benchId: bench.id,
          hit: hits.has(bench.id),
          field: rule.field,
          severity: rule.severity,
          actualValue: hits.has(bench.id)
            ? evalCondition(bench, rule).actualValue
            : undefined,
          ruleEnabled: true,
        });
      }
    }
  }

  return {
    results,
    cycle: null,
    evaluatedRuleIds: orderedScoped.map((r) => r.id),
  };
}

/** 计算受影响规则：变更规则本身 + 所有（直接/间接）依赖它的下游规则，仅启用 */
export function affectedRuleIds(rules: QualityRule[], changedRuleIds: string[]): string[] {
  const affected = new Set(changedRuleIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const rule of rules) {
      if (affected.has(rule.id)) continue;
      if (rule.references.some((ref) => affected.has(ref))) {
        affected.add(rule.id);
        grew = true;
      }
    }
  }
  return [...affected];
}

/**
 * 将一次（可能是范围的）校验结果合并进已有结果：
 * 覆盖本次评估到的「规则 × 长椅」组合，其余保留。
 */
export function mergeResults(
  existing: ValidationResult[],
  incoming: ValidationResult[]
): ValidationResult[] {
  const incomingKeys = new Set(incoming.map((r) => `${r.ruleId}::${r.benchId}`));
  const kept = existing.filter((r) => !incomingKeys.has(`${r.ruleId}::${r.benchId}`));
  return [...kept, ...incoming];
}

/** 删除规则 / 长椅后清理孤立结果 */
export function pruneResults(
  results: ValidationResult[],
  opts: { ruleIds?: Set<string>; benchIds?: Set<string> }
): ValidationResult[] {
  return results.filter((r) => {
    if (opts.ruleIds && opts.ruleIds.has(r.ruleId)) return false;
    if (opts.benchIds && opts.benchIds.has(r.benchId)) return false;
    return true;
  });
}

/** 结果与规则当前状态同步：严重级别/字段/启停 */
export function syncResultMeta(
  results: ValidationResult[],
  rules: QualityRule[]
): ValidationResult[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return results.map((r) => {
    const rule = byId.get(r.ruleId);
    if (!rule) return r;
    return {
      ...r,
      severity: rule.severity,
      field: rule.field,
      ruleEnabled: rule.enabled,
    };
  });
}
