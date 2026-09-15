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
  loadBaseline,
  loadMeta,
  loadResults,
  loadRules,
  saveBaseline,
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

/** live：本页档案变更即时对账；catchup：打开校验台时补算落后档案 */
export type RecomputeKind = 'live' | 'catchup';

export interface AutoRecomputeInfo {
  at: string;
  /** 本次实际重算的长椅条数（同一长椅连续改动只计一次） */
  benchCount: number;
  /** 本次评估到的规则条数 */
  ruleCount: number;
  reason: string;
  kind: RecomputeKind;
}

interface QualityState {
  rules: QualityRule[];
  results: ValidationResult[];
  meta: ValidationMeta;
  initialized: boolean;
  /** 当前规则集中检测到的环路（正常应为 null） */
  cycle: string[] | null;
  /** 最近一次自动重算信息，供界面提示 */
  lastAutoRecompute: AutoRecomputeInfo | null;
  /** 档案基线：benchId -> updatedAt，表示结果已覆盖到的档案版本 */
  baseline: Record<string, string>;

  initialize: () => void;
  /** 打开校验台时调用：按基线挑出落后档案补算，返回补算条数（0 表示无落后） */
  catchUpIfNeeded: () => number;
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

function buildBaseline(benches: Bench[]): Record<string, string> {
  return Object.fromEntries(benches.map((b) => [b.id, b.updatedAt]));
}

/** 与基线比对：removed=基线里有但档案已删；touched=新增或 updatedAt 落后 */
function diffAgainstBaseline(
  benches: Bench[],
  baseline: Record<string, string>
): { removed: string[]; touched: string[] } {
  const liveIds = new Set(benches.map((b) => b.id));
  const removed = Object.keys(baseline).filter((id) => !liveIds.has(id));
  const touched = benches
    .filter((b) => baseline[b.id] !== b.updatedAt)
    .map((b) => b.id);
  return { removed, touched };
}

/**
 * 档案对账（所有档案增删改路径的唯一入口）：
 * 按基线只重算「新增/修改」的档案，删除的档案清理结果，
 * 同一批内同一张长椅只算一次；不触碰其它档案的历史结果。
 * 返回重算的长椅条数。
 */
function reconcileBenches(kind: RecomputeKind, reason: string): number {
  const state = useQualityStore.getState();
  if (!state.initialized) return 0;
  const benches = useBenchStore.getState().benches;

  // 从未做过全量校验：不产生结果，也不推进基线（等用户一键校验）
  if (!state.meta.lastRunAt) return 0;

  const { removed, touched } = diffAgainstBaseline(benches, state.baseline);
  if (removed.length === 0 && touched.length === 0) return 0;

  let results = state.results;
  if (removed.length > 0) {
    results = pruneResults(results, { benchIds: new Set(removed) });
  }

  let ruleCount = 0;
  if (touched.length > 0) {
    const output = evaluateRules(state.rules, benches, { benchIds: touched });
    if (output.cycle) {
      useQualityStore.setState({ cycle: output.cycle });
      saveMeta(state.meta);
      return 0;
    }
    ruleCount = output.evaluatedRuleIds.length;
    results = mergeResults(results, output.results);
  }

  // 推进基线：删除的移除，重算的更新到当前 updatedAt
  const nextBaseline: Record<string, string> = { ...state.baseline };
  for (const id of removed) delete nextBaseline[id];
  for (const b of benches) {
    if (touched.includes(b.id)) nextBaseline[b.id] = b.updatedAt;
  }

  const meta: ValidationMeta = {
    ...recomputeMeta(state.rules, results, benches),
    lastRunAt: state.meta.lastRunAt,
    lastRecomputeCount: touched.length,
  };
  const info: AutoRecomputeInfo | null =
    touched.length > 0
      ? {
          at: new Date().toISOString(),
          benchCount: touched.length,
          ruleCount,
          reason,
          kind,
        }
      : state.lastAutoRecompute;

  useQualityStore.setState({
    results,
    baseline: nextBaseline,
    meta,
    cycle: null,
    lastAutoRecompute: info,
  });
  saveResults(results);
  saveBaseline(nextBaseline);
  saveMeta(meta);
  return touched.length;
}

/** 防抖句柄：合并一次保存动作引发的连续多次档案写入（如改档案+多条体验） */
let liveTimer: ReturnType<typeof setTimeout> | null = null;
const LIVE_DEBOUNCE_MS = 150;

function scheduleLiveReconcile() {
  if (liveTimer !== null) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    reconcileBenches('live', '档案数据变更');
  }, LIVE_DEBOUNCE_MS);
}

export const useQualityStore = create<QualityState>((set, get) => {
  const persist = (patch: Partial<QualityState>) => {
    const state = { ...get(), ...patch };
    saveRules(state.rules);
    saveResults(state.results);
    saveMeta(state.meta);
    saveBaseline(state.baseline);
  };

  /**
   * 规则侧增量校验（新增/编辑/复制/启停规则）：
   * 只重算受影响规则（自身+下游），档案范围为全部；
   * 不推进档案基线——基线只由档案对账与全量校验负责。
   */
  const runScopedRules = (
    ruleIds: string[],
    reason: string,
    patchRules?: QualityRule[]
  ) => {
    const state = get();
    const rules = patchRules ?? state.rules;
    const benches = useBenchStore.getState().benches;
    if (!state.meta.lastRunAt) return;

    const output = evaluateRules(rules, benches, { ruleIds });
    if (output.cycle) {
      set({ cycle: output.cycle });
      persist({ cycle: output.cycle });
      return;
    }

    const results = mergeResults(state.results, output.results);
    const meta: ValidationMeta = {
      ...recomputeMeta(rules, results, benches),
      lastRunAt: state.meta.lastRunAt,
      lastRecomputeCount: benches.length,
    };
    set({
      ...(patchRules ? { rules } : {}),
      results,
      meta,
      cycle: null,
      lastAutoRecompute: {
        at: new Date().toISOString(),
        benchCount: benches.length,
        ruleCount: output.evaluatedRuleIds.length,
        reason,
        kind: 'live',
      },
    });
    persist({
      ...(patchRules ? { rules } : {}),
      results,
      meta,
      cycle: null,
    });
  };

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
    baseline: {},

    initialize: () => {
      if (get().initialized) return;
      // 确保长椅数据先就绪
      if (!useBenchStore.getState().initialized) {
        useBenchStore.getState().initialize();
      }
      const stored = loadRules();
      const rules = stored === null ? getDefaultRules() : stored;
      const results = loadResults();
      const meta = loadMeta();
      const benches = useBenchStore.getState().benches;

      // 基线迁移：
      // - 键存在：直接读取（可能落后于档案，交给 catchUp/对账处理，绝不在此采纳当前值掩盖差异）
      // - 键缺失且从未全量校验：采纳当前档案为基线（空基线）
      // - 键缺失但有旧版历史结果：无法得知旧时间戳，基线置空，
      //   打开校验台时一次性补算全部档案（仅此一次，之后基线持续维护）
      const hasBaselineKey = localStorage.getItem('bench-quality-bench-baseline') !== null;
      const baseline = hasBaselineKey
        ? loadBaseline()
        : meta.lastRunAt
          ? {}
          : buildBaseline(benches);

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
        baseline,
        initialized: true,
      });
      saveRules(sortedRules(rules));
      saveResults(results);
      saveMeta(meta);
      saveBaseline(baseline);
    },

    catchUpIfNeeded: () => {
      // 立刻执行，取消防抖中的即时对账，避免同一批改动重复计数
      if (liveTimer !== null) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
      return reconcileBenches('catchup', '打开校验台补算落后档案');
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
        runScopedRules([rule.id], '新增规则', next);
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
        const scope = updated.enabled ? affected : affected.filter((rid) => rid !== id);
        if (scope.length > 0) {
          runScopedRules(scope, '规则定义变更', sortedRules(next));
        }
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
        runScopedRules(affected, '删除被引用规则', sortedRules(remaining));
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
        runScopedRules([copy.id], '复制规则', next);
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
      const baseline = buildBaseline(benches);
      const meta: ValidationMeta = {
        ...recomputeMeta(state.rules, merged, benches),
        lastRunAt: new Date().toISOString(),
        lastRecomputeCount: benches.length,
      };
      // 全量校验后没有“待补算”内容，清掉自动重算提示
      set({ results: merged, meta, cycle: null, baseline, lastAutoRecompute: null });
      saveResults(merged);
      saveMeta(meta);
      saveBaseline(baseline);
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
      set({ results: [], meta, lastAutoRecompute: null, baseline: {} });
      saveResults([]);
      saveMeta(meta);
      saveBaseline({});
    },
  };
});

/**
 * 订阅长椅档案变化（任意页面写入都会触发）：
 * 质量 store 可能尚未初始化（用户没进过校验台），先静默初始化
 * 载入规则/结果/基线，本身不做任何补算；随后用防抖合并
 * 短时间内的连续写入（编辑页保存时 updateBench + 多条 addExperience），
 * 同一张长椅以最后一次写入的 updatedAt 为准，只重算一次。
 */
let initializing = false;
useBenchStore.subscribe(() => {
  if (initializing) return;
  if (!useQualityStore.getState().initialized) {
    initializing = true;
    try {
      useQualityStore.getState().initialize();
    } finally {
      initializing = false;
    }
  }
  scheduleLiveReconcile();
});
