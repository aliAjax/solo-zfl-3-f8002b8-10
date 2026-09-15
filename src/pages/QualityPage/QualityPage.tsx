import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Plus,
  Download,
  Upload,
  Pencil,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  Link2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import { useQualityStore } from '@/store/useQualityStore';
import type { SaveRuleInput } from '@/store/useQualityStore';
import type { ImportPreview } from '@/utils/ruleSet';
import { buildRuleSet, parseRuleSet, remapImportedRules } from '@/utils/ruleSet';
import type { QualityRule, SeverityType } from '@/types/quality';
import {
  SEVERITY_DOT_STYLES,
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  describeCondition,
} from '@/types/quality';
import RuleEditor from '@/components/Quality/RuleEditor';
import ImportDialog from '@/components/Quality/ImportDialog';
import ResultsView from '@/components/Quality/ResultsView';

type ResultMode = 'byRule' | 'byBench';

export default function QualityPage() {
  const benchStore = useBenchStore();
  const quality = useQualityStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QualityRule | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [resultMode, setResultMode] = useState<ResultMode>('byRule');
  const [severityFilter, setSeverityFilter] = useState<SeverityType | 'all'>('all');
  const [onlyHits, setOnlyHits] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!benchStore.initialized) benchStore.initialize();
    quality.initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const orderedRules = useMemo(
    () => [...quality.rules].sort((a, b) => a.order - b.order),
    [quality.rules]
  );

  const ruleNameById = useMemo(() => new Map(quality.rules.map((r) => [r.id, r])), [quality.rules]);

  const cycleNames = quality.cycle
    ? quality.cycle.map((id) => ruleNameById.get(id)?.name ?? id)
    : null;

  // ---- 规则操作 ----
  const openCreate = () => {
    setEditingRule(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: QualityRule) => {
    setEditingRule(rule);
    setEditorOpen(true);
  };

  const handleSubmitRule = (input: SaveRuleInput) => {
    const res = input.id
      ? quality.updateRule(input.id, input)
      : quality.addRule(input);
    if (!res.ok && res.cycle) {
      // 编辑器内展示环路，不关闭弹窗
      return;
    }
    setEditorOpen(false);
    setEditingRule(null);
    showToast(input.id ? '规则已保存，受影响结果已重算' : '规则已创建');
  };

  const handleDelete = (rule: QualityRule) => {
    if (!window.confirm(`确定删除规则「${rule.name}」吗？引用它的规则将不再受其约束。`)) return;
    quality.deleteRule(rule.id);
    showToast('规则已删除');
  };

  // ---- 校验 / 导入导出 ----
  const handleRunAll = () => {
    const res = quality.runAll();
    if (res.cycle) {
      showToast('存在循环引用，请先解除环路再校验');
    } else {
      showToast(`已校验全部 ${benchStore.benches.length} 张长椅档案`);
    }
  };

  const handleExport = () => {
    const blob = new Blob([buildRuleSet(quality.rules)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bench-quality-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmImport = (preview: ImportPreview) => {
    const maxOrder = quality.rules.reduce((m, r) => Math.max(m, r.order), -1);
    const imported = remapImportedRules(preview.rules, maxOrder + 1);
    quality.replaceAllRules([...quality.rules, ...imported]);
    setImportOpen(false);
    showToast(`已导入 ${imported.length} 条规则${preview.upgraded ? '（旧版已升级）' : ''}，请重新执行一键校验`);
  };

  const enabledCount = orderedRules.filter((r) => r.enabled).length;
  const hasRun = !!quality.meta.lastRunAt;
  const hitCount = quality.meta.hitCount;
  const hitBenchCount = useMemo(
    () =>
      new Set(
        quality.results.filter((r) => r.hit && r.ruleEnabled).map((r) => r.benchId)
      ).size,
    [quality.results]
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-moss-green" />
            数据质量校验台
          </h2>
          <p className="text-ink-light text-sm">
            自建规则检查长椅档案，{orderedRules.length} 条规则（{enabledCount} 启用）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunAll}
            className="flex items-center gap-1.5 px-4 py-2 bg-moss-green text-white rounded-lg text-sm font-medium hover:bg-moss-light shadow-md"
          >
            <Play className="w-4 h-4" />
            一键校验全部档案
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-ochre text-white rounded-lg text-sm font-medium hover:bg-ochre-light"
          >
            <Plus className="w-4 h-4" />
            新建规则
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/60 border border-deep-brown/10 text-deep-brown rounded-lg text-sm hover:bg-white"
          >
            <Download className="w-4 h-4" />
            导出
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/60 border border-deep-brown/10 text-deep-brown rounded-lg text-sm hover:bg-white"
          >
            <Upload className="w-4 h-4" />
            导入
          </button>
        </div>
      </div>

      {cycleNames && (
        <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium mb-0.5">规则引用存在循环，校验已停止</div>
            <div className="break-all">环路：{cycleNames.join(' → ')}</div>
            <div className="text-red-600/80 text-xs mt-1">请编辑环路中的规则，移除某条引用以打破循环。</div>
          </div>
        </div>
      )}

      {quality.lastAutoRecompute && !quality.cycle && (
        <div className="mb-5 flex items-start gap-3 bg-moss-green/5 border border-moss-green/20 rounded-xl px-4 py-3 text-sm text-deep-brown">
          <RefreshCw className="w-4 h-4 flex-shrink-0 mt-0.5 text-moss-green" />
          <div>
            {quality.lastAutoRecompute.reason}：已自动重算{' '}
            <span className="font-semibold text-moss-green">
              {quality.lastAutoRecompute.benchCount}
            </span>{' '}
            张受影响长椅、{quality.lastAutoRecompute.ruleCount} 条相关规则，其余结果保持不变。
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="档案总数" value={benchStore.benches.length} />
        <StatCard label="启用规则" value={enabledCount} />
        <StatCard label="命中条目" value={hasRun ? hitCount : '—'} alert={hitCount > 0} />
        <StatCard label="涉及长椅" value={hasRun ? hitBenchCount : '—'} alert={hitBenchCount > 0} />
      </div>

      {/* 规则列表 */}
      <section className="mb-8">
        <h3 className="font-serif text-lg font-semibold text-deep-brown mb-3">规则集</h3>
        {orderedRules.length === 0 ? (
          <div className="paper-texture rounded-xl shadow-paper p-10 text-center text-sm text-ink-light">
            还没有规则，点击「新建规则」开始，或导入一份规则集。
          </div>
        ) : (
          <div className="space-y-2">
            {orderedRules.map((rule, index) => {
              const brokenRefs = rule.references.filter((id) => !ruleNameById.has(id));
              return (
                <div
                  key={rule.id}
                  className={`paper-texture rounded-xl shadow-paper px-4 py-3 flex items-center gap-3 ${
                    !rule.enabled ? 'opacity-55' : ''
                  }`}
                >
                  <div className="flex flex-col">
                    <button
                      onClick={() => quality.reorderRule(rule.id, 'up')}
                      disabled={index === 0}
                      className="text-ink-light hover:text-deep-brown disabled:opacity-25"
                      title="上移"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => quality.reorderRule(rule.id, 'down')}
                      disabled={index === orderedRules.length - 1}
                      className="text-ink-light hover:text-deep-brown disabled:opacity-25"
                      title="下移"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={rule.enabled}
                      onChange={(e) => quality.toggleRule(rule.id, e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-deep-brown/20 rounded-full peer-checked:bg-moss-green transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  </label>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${SEVERITY_STYLES[rule.severity]}`}>
                        {SEVERITY_LABELS[rule.severity]}
                      </span>
                      <span className="font-medium text-deep-brown text-sm">{rule.name}</span>
                      {rule.references.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-moss-green bg-moss-green/10 rounded px-1.5 py-0.5">
                          <Link2 className="w-3 h-3" />
                          引用 {rule.references.length}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-light mt-0.5 truncate">
                      {describeCondition(rule)}
                      {rule.references.length > 0 && (
                        <>
                          {' '}且同时命中：
                          {rule.references.map((id) => (
                            <span key={id} className="ml-1">
                              {ruleNameById.get(id)?.name ?? (
                                <span className="text-red-500">已失效引用</span>
                              )}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                    {brokenRefs.length > 0 && (
                      <div className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        存在 {brokenRefs.length} 个失效引用，请编辑清理
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(rule)}
                      className="p-2 text-ink-light hover:text-moss-green hover:bg-moss-green/10 rounded-lg"
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => quality.duplicateRule(rule.id)}
                      className="p-2 text-ink-light hover:text-deep-brown hover:bg-deep-brown/5 rounded-lg"
                      title="复制"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      className="p-2 text-ink-light hover:text-red-500 hover:bg-red-50 rounded-lg"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 校验结果 */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-serif text-lg font-semibold text-deep-brown">
            校验结果
            {hasRun && (
              <span className="ml-2 text-xs font-normal text-ink-light">
                最近校验：{new Date(quality.meta.lastRunAt!).toLocaleString('zh-CN')}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-warm-beige rounded-lg p-0.5">
              {(['byRule', 'byBench'] as ResultMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setResultMode(m)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    resultMode === m ? 'bg-white text-deep-brown shadow-sm' : 'text-ink-light'
                  }`}
                >
                  {m === 'byRule' ? '按规则看' : '按长椅看'}
                </button>
              ))}
            </div>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as SeverityType | 'all')}
              className="px-2.5 py-1.5 text-sm bg-white/60 border border-deep-brown/10 rounded-lg text-deep-brown cursor-pointer"
            >
              <option value="all">全部级别</option>
              <option value="high">严重</option>
              <option value="medium">警告</option>
              <option value="low">提示</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-ink-light cursor-pointer">
              <input
                type="checkbox"
                checked={onlyHits}
                onChange={(e) => setOnlyHits(e.target.checked)}
                className="text-moss-green focus:ring-moss-green"
              />
              只看命中
            </label>
          </div>
        </div>

        <ResultsView
          rules={orderedRules}
          benches={benchStore.benches}
          results={quality.results}
          mode={resultMode}
          onlyHits={onlyHits}
          severityFilter={severityFilter}
        />
      </section>

      <RuleEditor
        open={editorOpen}
        rule={editingRule}
        allRules={orderedRules}
        onClose={() => {
          setEditorOpen(false);
          setEditingRule(null);
        }}
        onSubmit={handleSubmitRule}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirm={handleConfirmImport}
        parseFile={parseRuleSet}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-deep-brown text-warm-cream text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT_STYLES.low}`} />
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="paper-texture rounded-xl shadow-paper px-4 py-3">
      <div className={`text-2xl font-serif font-bold ${alert ? 'text-red-500' : 'text-deep-brown'}`}>
        {value}
      </div>
      <div className="text-xs text-ink-light mt-0.5">{label}</div>
    </div>
  );
}
