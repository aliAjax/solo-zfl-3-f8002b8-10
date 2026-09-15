import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, MapPin, AlertOctagon, Inbox } from 'lucide-react';
import type { Bench } from '@/types';
import type { QualityRule, QualityFieldKey, SeverityType, ValidationResult } from '@/types/quality';
import { FIELD_DEF_MAP, SEVERITY_DOT_STYLES, describeCondition, formatFieldValue } from '@/types/quality';

interface ResultsViewProps {
  rules: QualityRule[];
  benches: Bench[];
  results: ValidationResult[];
  /** 按规则还是按长椅视角 */
  mode: 'byRule' | 'byBench';
  onlyHits: boolean;
  severityFilter: SeverityType | 'all';
}

interface HitItem {
  result: ValidationResult;
  rule?: QualityRule;
  bench?: Bench;
}

function HitRow({ item, mode }: { item: HitItem; mode: 'byRule' | 'byBench' }) {
  const navigate = useNavigate();
  const { result, rule, bench } = item;
  const fieldLabel = FIELD_DEF_MAP[result.field as QualityFieldKey]?.label ?? result.field;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-warm-cream/70 rounded-lg text-sm">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT_STYLES[result.severity]}`} />
      <div className="flex-1 min-w-0">
        <span className="text-deep-brown font-medium">{fieldLabel}</span>
        <span className="text-ink-light"> 当前值：</span>
        <span className="text-deep-brown font-medium">
          {bench ? formatFieldValue(bench, result.field as QualityFieldKey) : result.actualValue}
        </span>
      </div>
      {mode === 'byRule' && bench && (
        <button
          onClick={() => navigate(`/bench/${bench.id}`)}
          className="flex items-center gap-1 text-xs text-moss-green hover:underline flex-shrink-0"
        >
          <MapPin className="w-3 h-3" />
          <span className="max-w-[12rem] truncate">{bench.name}</span>
        </button>
      )}
      {mode === 'byBench' && rule && (
        <span className="text-xs text-ink-light flex-shrink-0 max-w-[14rem] truncate">
          {rule.name}
        </span>
      )}
    </div>
  );
}

export default function ResultsView({ rules, benches, results, mode, onlyHits, severityFilter }: ResultsViewProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const benchById = useMemo(() => new Map(benches.map((b) => [b.id, b])), [benches]);

  // 有效命中：启用规则、字段未消失、长椅仍存在
  const hits = useMemo(() => {
    return results
      .filter((r) => r.hit && r.ruleEnabled)
      .filter((r) => ruleById.has(r.ruleId) && benchById.has(r.benchId))
      .filter((r) => severityFilter === 'all' || r.severity === severityFilter);
  }, [results, ruleById, benchById, severityFilter]);

  // 分组
  const groups = useMemo(() => {
    const map = new Map<string, HitItem[]>();
    for (const result of hits) {
      const key = mode === 'byRule' ? result.ruleId : result.benchId;
      const items = map.get(key) ?? [];
      items.push({
        result,
        rule: ruleById.get(result.ruleId),
        bench: benchById.get(result.benchId),
      });
      map.set(key, items);
    }
    // “全部”视角下补齐零命中的规则/长椅
    if (!onlyHits) {
      const baseKeys =
        mode === 'byRule'
          ? rules.filter((r) => r.enabled).map((r) => r.id)
          : benches.map((b) => b.id);
      for (const key of baseKeys) {
        if (!map.has(key)) map.set(key, []);
      }
    }
    const out = [...map.entries()].map(([key, items]) => ({ key, items }));
    if (mode === 'byRule') {
      out.sort((a, b) => {
        // 有命中的排在前面，其次按规则 order
        if ((a.items.length > 0) !== (b.items.length > 0)) return a.items.length > 0 ? -1 : 1;
        const ra = ruleById.get(a.key);
        const rb = ruleById.get(b.key);
        return (ra?.order ?? 0) - (rb?.order ?? 0);
      });
    } else {
      out.sort((a, b) => {
        if ((a.items.length > 0) !== (b.items.length > 0)) return a.items.length > 0 ? -1 : 1;
        return (benchById.get(a.key)?.name ?? '').localeCompare(benchById.get(b.key)?.name ?? '', 'zh-CN');
      });
    }
    return out;
  }, [hits, onlyHits, mode, rules, benches, ruleById, benchById]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (results.length === 0) {
    return (
      <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
        <Inbox className="w-10 h-10 text-ink-light/40 mx-auto mb-3" />
        <p className="text-deep-brown font-medium mb-1">还没有校验结果</p>
        <p className="text-sm text-ink-light">点击上方「一键校验全部档案」生成结果</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
        <div className="w-12 h-12 rounded-full bg-moss-green/10 flex items-center justify-center mx-auto mb-3">
          <AlertOctagon className="w-6 h-6 text-moss-green" />
        </div>
        <p className="text-deep-brown font-medium">当前筛选下没有命中</p>
        <p className="text-sm text-ink-light mt-1">所有启用规则在此级别下全部通过 ✓</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const rule = ruleById.get(group.key);
        const bench = benchById.get(group.key);
        const isCollapsed = collapsed.has(group.key);
        const sevOrder: Record<SeverityType, number> = { high: 0, medium: 1, low: 2 };
        const topSev = [...group.items]
          .map((i) => i.result.severity)
          .sort((a, b) => sevOrder[a] - sevOrder[b])[0];
        const clean = group.items.length === 0;

        return (
          <div key={group.key} className="paper-texture rounded-xl shadow-paper overflow-hidden">
            <button
              onClick={() => toggle(group.key)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-warm-cream/50 transition-colors text-left"
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4 text-ink-light" /> : <ChevronDown className="w-4 h-4 text-ink-light" />}
              <span className={`w-2.5 h-2.5 rounded-full ${clean ? 'bg-moss-green/50' : SEVERITY_DOT_STYLES[topSev]}`} />
              <div className="flex-1 min-w-0">
                {mode === 'byRule' && rule && (
                  <>
                    <div className="font-medium text-deep-brown text-sm truncate">{rule.name}</div>
                    <div className="text-xs text-ink-light truncate">{describeCondition(rule)}</div>
                  </>
                )}
                {mode === 'byBench' && bench && (
                  <>
                    <div className="font-medium text-deep-brown text-sm truncate">{bench.name}</div>
                    <div className="text-xs text-ink-light truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {bench.location}
                    </div>
                  </>
                )}
              </div>
              {clean ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-moss-green/10 text-moss-green flex-shrink-0">
                  无命中
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 flex-shrink-0">
                  {group.items.length} 项命中
                </span>
              )}
              {mode === 'byBench' && bench && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/bench/${bench.id}`);
                  }}
                  className="text-xs text-moss-green hover:underline flex-shrink-0"
                >
                  查看档案
                </button>
              )}
            </button>

            {!isCollapsed && (
              <div className="px-4 pb-3 space-y-1.5">
                {mode === 'byRule' && rule?.description && (
                  <p className="text-xs text-ink-light px-1 pb-1">{rule.description}</p>
                )}
                {clean ? (
                  <p className="text-xs text-moss-green px-1 py-1">
                    {mode === 'byRule' ? '没有档案命中此规则' : '该档案在当前级别筛选下没有命中项'}
                  </p>
                ) : (
                  group.items
                    .sort((a, b) => sevOrder[a.result.severity] - sevOrder[b.result.severity])
                    .map((item) => (
                      <HitRow
                        key={`${item.result.ruleId}-${item.result.benchId}-${item.result.field}`}
                        item={item}
                        mode={mode}
                      />
                    ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
