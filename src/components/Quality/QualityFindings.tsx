import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ShieldCheck, ChevronRight } from 'lucide-react';
import { useQualityStore } from '@/store/useQualityStore';
import type { Bench } from '@/types';
import { FIELD_DEF_MAP, SEVERITY_DOT_STYLES, SEVERITY_LABELS, formatFieldValue } from '@/types/quality';

/** 长椅详情页：展示该档案在最近一次校验中的命中项 */
export default function QualityFindings({ bench }: { bench: Bench }) {
  const { initialize, initialized, results, rules, meta } = useQualityStore();

  useEffect(() => {
    if (!initialized) initialize();
  }, [initialized, initialize]);

  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

  const hits = useMemo(
    () =>
      results
        .filter((r) => r.benchId === bench.id && r.hit && r.ruleEnabled)
        .filter((r) => ruleById.has(r.ruleId))
        .sort((a, b) => {
          const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
          return order[a.severity] - order[b.severity];
        }),
    [results, bench.id, ruleById]
  );

  if (!meta.lastRunAt) return null;

  return (
    <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg font-semibold text-deep-brown flex items-center gap-2">
          {hits.length > 0 ? (
            <ShieldAlert className="w-5 h-5 text-red-500" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-moss-green" />
          )}
          质量校验
        </h2>
        <Link to="/quality" className="text-xs text-moss-green hover:underline flex items-center">
          校验台
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {hits.length === 0 ? (
        <p className="text-sm text-ink-light">最近一次校验中，该档案没有命中任何规则。</p>
      ) : (
        <div className="space-y-2">
          {hits.map((hit) => {
            const rule = ruleById.get(hit.ruleId)!;
            const fieldDef = FIELD_DEF_MAP[hit.field];
            return (
              <div key={`${hit.ruleId}-${hit.field}`} className="p-3 bg-warm-cream/70 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT_STYLES[hit.severity]}`} />
                  <span className="text-sm font-medium text-deep-brown">{rule.name}</span>
                  <span className="text-xs text-ink-light ml-auto">{SEVERITY_LABELS[hit.severity]}</span>
                </div>
                <div className="text-xs text-ink-light pl-4">
                  命中字段「{fieldDef.label}」，当前值：
                  <span className="text-deep-brown font-medium">
                    {formatFieldValue(bench, hit.field)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
