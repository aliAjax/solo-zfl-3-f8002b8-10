import { create } from 'zustand';
import type { Bench } from '@/types';
import type { QualityRule, ValidationMeta, ValidationResult } from '@/types/quality';
import { findCycle } from '@/types/quality';
import { useBenchStore } from '@/store/useBenchStore';
import {
  affectedRuleIds,
  evaluateRules,
  mergeResults,
  pruneResults,
  syncResultMeta,
} from '@/utils/validation';
import {
  getDefaultRules,
  loadMeta,
  loadResults,
  loadRules,
  saveMeta,
  saveResults,
  saveRules,
} from '@/utils/qualityStorage';
import { generateId } from '@/utils/comfort';

export interface SaveRuleInput {
  id?: string;
  name: string;
  description?: string;
  field: QualityRule['field'];
  operator: QualityRule['operator'];
  value?: string | number;
  value2?: string | number;
  severity: QualityRule['severity'];
  enabled: boolean;
  references: string[];
}

export interface SaveRuleResult {
  ok: boolean;
  cycle: string[] | null;
}

interface QualityState {
  rules: QualityRule[];
  results: ValidationResult[];
  meta: ValidationMeta;
  initialized: boolean;
  /** 当前规则集中检测到的环路（正常应为 null） */
  cycle: string[] | null;
  /** 最近一次（自动）重算信息，供界面提示 */
  lastAutoRecompute: {
    at: string;
    benchCount: number;
    ruleCount: number;
    reason: string;
  } | null;

  initialize: () => void;
  addRule: (input: Omit<SaveRuleInput, 'id'>) => SaveRuleResult;
  updateRule: (id: string, input: Partial<SaveRuleInput>) => SaveRuleResult;
  deleteRule: (id: string) => void;
  duplicateRule: (id: string) => void;
  toggleRule: (id: string, enabled: boolean) => SaveRuleResult;
  reorderRule: (id: string, direction: 'up' | 'down') => void;
  moveRule: (id: string, targetIndex: number) => void;
  replaceAllRules: (rules: QualityRule[]) => void;
  runAll: () => { cycle: string[] | null };
  clearResults: () => void;
}

type QualityStore = QualityState;

function sortedRules(rules: QualityRule[]): QualityRule[] {
  return [...rules].sort((a, b) => a.order - b.order);
}

function recomputeMeta(rules: QualityRule[], results: ValidationResult[], benches: Bench[]): ValidationMeta {
  const enabledRuleIds = new Set(rules.filter((r) => r.enabled).map((r) => r.id));
  const benchIds = new Set(benches.map((b) => b.id));
  const hitResults = results.filter(
    (r) => r.hit && r.ruleEnabled && enabledRuleIds.has(r.ruleId) && benchIds.has(r.benchId)
  );
  const coveredBenchIds = new Set(
    results.filter((r) => r.ruleEnabled && benchIds.has(r.benchId)).map((r) => r.benchId)
  );
  const coveredRuleIds = new Set(results.filter((r) => r.ruleEnabled).map((r) => r.ruleId));
  return {
    lastRunAt: null,
    checkedBenchCount: coveredBenchIds.size,
    checkedRuleCount: coveredRuleIds.size,
    hitCount: hitResults.length,
    lastRecomputeCount: 0,
  };
}

export const useQualityStore = create<QualityStore>((set, get) => {
  const persist = (patch: Partial<QualityStore>) => {
    const state = { ...get(), ...patch };
    saveRules(state.rules);
    saveResults(state.results);
    saveMeta(state.meta);
  };

  /** 在给定范围执行增量校验并合并结果 */
  const runScoped = (
    opts: { ruleIds?: string[]; benchIds?: string[]; reason: string },
    patchRules?: QualityRule[]
  ) => {
    const state = get();
    const rules = patchRules ?? state.rules;
    const benches = useBenchStore.getState().benches;
    if (!state.meta.lastRunAt) return; // 从未执行过全量校验，不自动跑

    const output = evaluateRules(rules, benches, {
      ruleIds: opts.ruleIds,
      benchIds: opts.benchIds,
    });

    if (output.cycle) {
      set({ cycle: output.cycle });
      persist({ cycle: output.cycle });
      return;
    }

    const results = mergeResults(state.results, output.results);
    const meta = recomputeMeta(rules, results, benches);
    const preserved = state.meta;
    const nextMeta: ValidationMeta = {
      ...meta,
      lastRunAt: preserved.lastRunAt,
      lastRecomputeCount: opts.benchIds ? opts.benchIds.length : benches.length,
    };
    set({
      ...(patchRules ? { rules } : {}),
      results,
      meta: nextMeta,
      cycle: null,
      lastAutoRecompute: {
        at: new Date().toISOString(),
        benchCount: opts.benchIds ? opts.benchIds.length : benches.length,
        ruleCount: output.evaluatedRuleIds.length,
        reason: opts.reason,
      },
    });
    persist({
      ...(patchRules ? { rules } : {}),
      results,
      meta: nextMeta,
      cycle: null,
    });
  };

  /** 保存（新增/编辑）规则前做环路拦截 */
  const checkCycle = (candidate: QualityRule[]): string[] | null => findCycle(candidate);

  return {
    rules: [],
    results: [],
    meta: {
      lastRunAt: null,
      checkedBenchCount: 0,
      checkedRuleCount: 0,
      hitCount: 0,
      lastRecomputeCount: 0,
    },
    initialized: false,
    cycle: null,
    lastAutoRecompute: null,

    initialize: () => {
      if (get().initialized) return;
      // 确保长椅数据先就绪，避免加载时把全部档案误判为新增
      if (!useBenchStore.getState().initialized) {
        useBenchStore.getState().initialize();
      }
      const stored = loadRules();
      const rules = stored === null ? getDefaultRules() : stored;
      const results = loadResults();
      const meta = loadMeta();
      const benches = useBenchStore.getState().benches;
      prevBenches = benches;
      const cycle = findCycle(rules);
      set({
        rules: sortedRules(rules),
        results,
        meta: {
          ...meta,
          ...recomputeMeta(rules, results, benches),
          lastRunAt: meta.lastRunAt,
          lastRecomputeCount: meta.lastRecomputeCount,
        },
        cycle,
        initialized: true,
      });
      saveRules(sortedRules(rules));
      saveResults(results);
      saveMeta(meta);
    },

    addRule: (input) => {
      const state = get();
      const now = new Date().toISOString();
      const maxOrder = state.rules.reduce((m, r) => Math.max(m, r.order), -1);
      const rule: QualityRule = {
        id: generateId(),
        name: input.name.trim(),
        description: input.description?.trim() || '',
        field: input.field,
        operator: input.operator,
        value: input.value,
        value2: input.value2,
        severity: input.severity,
        enabled: input.enabled,
        references: [...new Set(input.references.filter((r) => r !== ''))],
        order: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      };
      const next = sortedRules([...state.rules, rule]);
      const cycle = checkCycle(next);
      if (cycle) return { ok: false, cycle };

      set({ rules: next, cycle: null });
      persist({ rules: next });
      if (input.enabled) {
        runScoped({ ruleIds: [rule.id], reason: '新增规则' }, next);
      }
      return { ok: true, cycle: null };
    },

    updateRule: (id, input) => {
      const state = get();
      const existing = state.rules.find((r) => r.id === id);
      if (!existing) return { ok: false, cycle: null };

      const updated: QualityRule = {
        ...existing,
        ...Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined)
        ),
        references: input.references
          ? [...new Set(input.references.filter((r) => r !== '' && r !== id))]
          : existing.references,
        updatedAt: new Date().toISOString(),
      } as QualityRule;

      const next = state.rules.map((r) => (r.id === id ? updated : r));
      const cycle = checkCycle(next);
      if (cycle) return { ok: false, cycle };

      const structuralChanged =
        updated.field !== existing.field ||
        updated.operator !== existing.operator ||
        JSON.stringify(updated.value) !== JSON.stringify(existing.value) ||
        JSON.stringify(updated.value2) !== JSON.stringify(existing.value2) ||
        JSON.stringify([...updated.references].sort()) !==
          JSON.stringify([...existing.references].sort()) ||
        updated.enabled !== existing.enabled;

      const results = syncResultMeta(state.results, next);
      set({ rules: sortedRules(next), results, cycle: null });
      persist({ rules: sortedRules(next), results });

      if (structuralChanged) {
        const affected = affectedRuleIds(
          next.filter((r) => r.enabled),
          [id]
        );
        // 停用的规则不参与重算，但结果保留并标记
        runScoped(
          { ruleIds: updated.enabled ? affected : affected.filter((rid) => rid !== id), reason: '规则定义变更' },
          sortedRules(next)
        );
      }
      return { ok: true, cycle: null };
    },

    deleteRule: (id) => {
      const state = get();
      const remaining = state.rules.filter((r) => r.id !== id);
      // 下游引用了被删规则：引用边自动消失，需要重算
      const downstream = state.rules
        .filter((r) => r.enabled && r.references.includes(id))
        .map((r) => r.id);
      const affected = affectedRuleIds(
        remaining.filter((r) => r.enabled),
        downstream
      );
      let results = pruneResults(state.results, { ruleIds: new Set([id]) });
      results = syncResultMeta(results, remaining);
      set({ rules: sortedRules(remaining), results });
      persist({ rules: sortedRules(remaining), results });
      if (affected.length > 0) {
        runScoped({ ruleIds: affected, reason: '删除被引用规则' }, sortedRules(remaining));
      }
    },

    duplicateRule: (id) => {
      const state = get();
      const existing = state.rules.find((r) => r.id === id);
      if (!existing) return;
      const now = new Date().toISOString();
      const maxOrder = state.rules.reduce((m, r) => Math.max(m, r.order), -1);
      const copy: QualityRule = {
        ...existing,
        id: generateId(),
        name: `${existing.name}（副本）`,
        references: [],
        order: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      };
      const next = sortedRules([...state.rules, copy]);
      set({ rules: next });
      persist({ rules: next });
      if (copy.enabled) {
        runScoped({ ruleIds: [copy.id], reason: '复制规则' }, next);
      }
    },

    toggleRule: (id, enabled) => {
      return get().updateRule(id, { enabled });
    },

    reorderRule: (id, direction) => {
      const state = get();
      const ordered = sortedRules(state.rules);
      const index = ordered.findIndex((r) => r.id === id);
      const swap = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || swap < 0 || swap >= ordered.length) return;
      const a = ordered[index];
      const b = ordered[swap];
      const next = state.rules.map((r) => {
        if (r.id === a.id) return { ...r, order: b.order };
        if (r.id === b.id) return { ...r, order: a.order };
        return r;
      });
      set({ rules: sortedRules(next) });
      persist({ rules: sortedRules(next) });
    },

    moveRule: (id, targetIndex) => {
      const state = get();
      const ordered = sortedRules(state.rules);
      const from = ordered.findIndex((r) => r.id === id);
      if (from < 0) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(Math.max(0, Math.min(targetIndex, ordered.length)), 0, moved);
      const next = state.rules.map((r) => {
        const idx = ordered.findIndex((x) => x.id === r.id);
        return { ...r, order: idx };
      });
      set({ rules: next });
      persist({ rules: next });
    },

    replaceAllRules: (rules) => {
      const ordered = sortedRules(rules);
      set({ rules: ordered, cycle: findCycle(ordered) });
      persist({ rules: ordered });
    },

    runAll: () => {
      const state = get();
      const benches = useBenchStore.getState().benches;
      const output = evaluateRules(state.rules, benches, {});
      if (output.cycle) {
        set({ cycle: output.cycle });
        persist({ cycle: output.cycle });
        return { cycle: output.cycle };
      }
      // 停用规则不参与校验，但其历史结果保留（置灰、不计入命中），
      // 清理掉已不存在长椅的孤立条目。
      const liveBenchIds = new Set(benches.map((b) => b.id));
      const disabledResults = syncResultMeta(
        state.results.filter((r) => !r.ruleEnabled).filter((r) => liveBenchIds.has(r.benchId)),
        state.rules
      );
      const merged = [...disabledResults, ...output.results];
      const meta: ValidationMeta = {
        ...recomputeMeta(state.rules, merged, benches),
        lastRunAt: new Date().toISOString(),
        lastRecomputeCount: benches.length,
      };
      set({ results: merged, meta, cycle: null, lastAutoRecompute: null });
      persist({ results: merged, meta, cycle: null });
      return { cycle: null };
    },

    clearResults: () => {
      const meta: ValidationMeta = {
        ...get().meta,
        lastRunAt: null,
        checkedBenchCount: 0,
        checkedRuleCount: 0,
        hitCount: 0,
        lastRecomputeCount: 0,
      };
      set({ results: [], meta, lastAutoRecompute: null });
      persist({ results: [], meta });
    },
  };
});

/**
 * 订阅长椅档案变化（基于 zustand 的状态引用，每次变更都会产生新数组/对象）：
 * 档案增改（含分时段体验增改）→ 只重算受影响长椅；
 * 删除 → 清理对应结果；
 * 从未执行过全量校验时不自动跑。
 */
let prevBenches: Bench[] | null = null;

useBenchStore.subscribe((state) => {
  const quality = useQualityStore.getState();
  if (!quality.initialized) {
    prevBenches = state.benches;
    return;
  }
  const previous = prevBenches;
  prevBenches = state.benches;
  if (previous === state.benches || previous === null) return;
  if (!quality.meta.lastRunAt) return;

  const prevMap = new Map(previous.map((b) => [b.id, b]));
  const nextMap = new Map(state.benches.map((b) => [b.id, b]));

  const removed = [...prevMap.keys()].filter((id) => !nextMap.has(id));
  const added = [...nextMap.keys()].filter((id) => !prevMap.has(id));
  const changed = [...nextMap.keys()].filter((id) => {
    const p = prevMap.get(id);
    const n = nextMap.get(id);
    return p && n && p !== n;
  });

  if (removed.length === 0 && added.length === 0 && changed.length === 0) return;

  if (removed.length > 0) {
    const pruned = pruneResults(quality.results, { benchIds: new Set(removed) });
    useQualityStore.setState({ results: pruned });
    saveResults(pruned);
  }

  const affectedIds = [...added, ...changed];
  if (affectedIds.length === 0) {
    // 仅删除：刷新统计
    const meta = {
      ...quality.meta,
      ...recomputeMeta(quality.rules, useQualityStore.getState().results, state.benches),
      lastRunAt: quality.meta.lastRunAt,
    };
    useQualityStore.setState({ meta });
    saveMeta(meta);
    return;
  }

  const output = evaluateRules(quality.rules, state.benches, { benchIds: affectedIds });
  if (output.cycle) {
    useQualityStore.setState({ cycle: output.cycle });
    return;
  }
  const results = mergeResults(useQualityStore.getState().results, output.results);
  const meta: ValidationMeta = {
    ...recomputeMeta(quality.rules, results, state.benches),
    lastRunAt: quality.meta.lastRunAt,
    lastRecomputeCount: affectedIds.length,
  };
  useQualityStore.setState({
    results,
    meta,
    cycle: null,
    lastAutoRecompute: {
      at: new Date().toISOString(),
      benchCount: affectedIds.length,
      ruleCount: output.evaluatedRuleIds.length,
      reason: '档案数据变更',
    },
  });
  saveResults(results);
  saveMeta(meta);
});
