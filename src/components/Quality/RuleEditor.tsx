import { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Link2 } from 'lucide-react';
import type {
  OperatorType,
  QualityFieldKey,
  QualityRule,
  SeverityType,
} from '@/types/quality';
import {
  FIELD_DEF_MAP,
  FIELD_DEFS,
  OPERATOR_DEFS,
  SEVERITY_LABELS,
  findCycle,
} from '@/types/quality';
import type { SaveRuleInput } from '@/store/useQualityStore';

interface RuleEditorProps {
  open: boolean;
  /** 传入规则为编辑，否则为新建 */
  rule: QualityRule | null;
  allRules: QualityRule[];
  onClose: () => void;
  onSubmit: (input: SaveRuleInput) => void;
}

interface FormState {
  name: string;
  description: string;
  field: QualityFieldKey;
  operator: OperatorType;
  value: string;
  value2: string;
  severity: SeverityType;
  enabled: boolean;
  references: string[];
}

function operatorsForField(field: QualityFieldKey) {
  const def = FIELD_DEF_MAP[field];
  return OPERATOR_DEFS.filter((op) => op.appliesTo.includes(def.type));
}

function ruleToForm(rule: QualityRule): FormState {
  return {
    name: rule.name,
    description: rule.description ?? '',
    field: rule.field,
    operator: rule.operator,
    value: rule.value === undefined ? '' : String(rule.value),
    value2: rule.value2 === undefined ? '' : String(rule.value2),
    severity: rule.severity,
    enabled: rule.enabled,
    references: [...rule.references],
  };
}

function blankForm(): FormState {
  return {
    name: '',
    description: '',
    field: 'rating',
    operator: 'lt',
    value: '3',
    value2: '',
    severity: 'medium',
    enabled: true,
    references: [],
  };
}

export default function RuleEditor({ open, rule, allRules, onClose, onSubmit }: RuleEditorProps) {
  const [form, setForm] = useState<FormState>(blankForm());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(rule ? ruleToForm(rule) : blankForm());
      setError(null);
    }
  }, [open, rule]);

  const fieldDef = FIELD_DEF_MAP[form.field];
  const opDef = useMemo(
    () => OPERATOR_DEFS.find((o) => o.key === form.operator)!,
    [form.operator]
  );

  // 实时环路检测：把表单当前引用当作一条候选规则并入图
  const editingId = rule?.id ?? '__new-rule__';
  const liveCycle = useMemo(() => {
    const saved = allRules.filter((r) => r.id !== rule?.id);
    if (form.references.includes(editingId)) return [editingId, editingId];
    return findCycle([
      ...saved,
      { id: editingId, references: form.references } as QualityRule,
    ]);
  }, [allRules, rule, form.references, editingId]);

  if (!open) return null;

  const update = <K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const changeField = (field: QualityFieldKey) => {
    const ops = operatorsForField(field);
    const nextOp = ops.some((o) => o.key === form.operator) ? form.operator : ops[0].key;
    setForm((prev) => ({ ...prev, field, operator: nextOp, value: '', value2: '' }));
  };

  const changeOperator = (operator: OperatorType) => {
    setForm((prev) => ({ ...prev, operator }));
  };

  const toggleReference = (id: string) => {
    setForm((prev) => ({
      ...prev,
      references: prev.references.includes(id)
        ? prev.references.filter((r) => r !== id)
        : [...prev.references, id],
    }));
  };

  const referenceChoices = allRules.filter((r) => r.id !== rule?.id);

  const cycleText = liveCycle
    ? liveCycle.map((id) =>
        id === editingId ? form.name.trim() || '当前规则' : allRules.find((r) => r.id === id)?.name ?? id
      ).join(' → ')
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('请填写规则名称');
      return;
    }
    if (opDef.valueInputs >= 1 && form.value === '') {
      setError('请填写阈值');
      return;
    }
    if (opDef.valueInputs === 2 && form.value2 === '') {
      setError('请填写区间的第二个值');
      return;
    }

    const numericValue = (v: string) => {
      const fieldIsNumber = fieldDef.type === 'number';
      const opWantsNumber = opDef.valueType === 'number';
      if (fieldIsNumber || opWantsNumber) return Number(v);
      return v;
    };

    if (liveCycle) {
      setError('当前引用会形成循环，请移除造成环路的引用');
      return;
    }

    onSubmit({
      id: rule?.id,
      name: form.name.trim(),
      description: form.description.trim(),
      field: form.field,
      operator: form.operator,
      value: opDef.valueInputs === 0 ? undefined : numericValue(form.value),
      value2: opDef.valueInputs === 2 ? Number(form.value2) : undefined,
      severity: form.severity,
      enabled: form.enabled,
      references: form.references,
    });
  };

  const inputClass =
    'w-full px-3 py-2 bg-white/60 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white transition-colors text-sm';
  const labelClass = 'block text-sm font-medium text-deep-brown mb-1.5';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="paper-texture rounded-xl shadow-paper-hover w-full max-w-2xl max-h-[90vh] overflow-y-auto fade-in">
        <div className="sticky top-0 paper-texture border-b border-deep-brown/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="font-serif text-lg font-semibold text-deep-brown">
            {rule ? '编辑规则' : '新建规则'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-light hover:text-deep-brown hover:bg-deep-brown/5 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className={labelClass}>规则名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="例如：评分过低、经度超出范围"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>说明（可选）</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="这条规则用来发现什么问题？"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>校验字段</label>
              <select
                value={form.field}
                onChange={(e) => changeField(e.target.value as QualityFieldKey)}
                className={`${inputClass} cursor-pointer`}
              >
                {FIELD_DEFS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>比较方式</label>
              <select
                value={form.operator}
                onChange={(e) => changeOperator(e.target.value as OperatorType)}
                className={`${inputClass} cursor-pointer`}
              >
                {operatorsForField(form.field).map((op) => (
                  <option key={op.key} value={op.key}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {opDef.valueInputs > 0 && (
            <div>
              <label className={labelClass}>
                阈值{opDef.valueInputs === 2 ? '（区间两端，顺序不限）' : ''}
              </label>
              {opDef.valueInputs === 2 ? (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="any"
                    value={form.value}
                    onChange={(e) => update('value', e.target.value)}
                    className={inputClass}
                  />
                  <span className="text-ink-light text-sm">至</span>
                  <input
                    type="number"
                    step="any"
                    value={form.value2}
                    onChange={(e) => update('value2', e.target.value)}
                    className={inputClass}
                  />
                </div>
              ) : fieldDef.type === 'enum' ? (
                <select
                  value={form.value}
                  onChange={(e) => update('value', e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">请选择…</option>
                  {fieldDef.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : fieldDef.type === 'boolean' ? (
                <select
                  value={form.value}
                  onChange={(e) => update('value', e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="true">是</option>
                  <option value="false">否</option>
                </select>
              ) : opDef.valueType === 'number' || fieldDef.type === 'number' ? (
                <input
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(e) => update('value', e.target.value)}
                  className={inputClass}
                />
              ) : (
                <input
                  type="text"
                  value={form.value}
                  onChange={(e) => update('value', e.target.value)}
                  placeholder="包含的文本"
                  className={inputClass}
                />
              )}
            </div>
          )}

          <div>
            <label className={labelClass}>严重级别</label>
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as SeverityType[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('severity', s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.severity === s
                      ? s === 'high'
                        ? 'bg-red-100 text-red-700 border-red-300'
                        : s === 'medium'
                          ? 'bg-ochre/15 text-ochre border-ochre/40'
                          : 'bg-moss-green/10 text-moss-green border-moss-green/40'
                      : 'bg-white/50 text-ink-light border-deep-brown/10 hover:bg-white'
                  }`}
                >
                  {SEVERITY_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {referenceChoices.length > 0 && (
            <div>
              <label className={`${labelClass} flex items-center gap-1.5`}>
                <Link2 className="w-4 h-4" />
                引用其它规则
              </label>
              <p className="text-xs text-ink-light mb-2">
                勾选后，本规则仅在被引用规则也命中同一张长椅时才命中（全部满足）。
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto bg-warm-cream/60 rounded-lg p-3">
                {referenceChoices.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={form.references.includes(r.id)}
                      onChange={() => toggleReference(r.id)}
                      className="text-moss-green focus:ring-moss-green"
                    />
                    <span className="text-deep-brown">{r.name}</span>
                    {!r.enabled && <span className="text-xs text-ink-light">（已停用）</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="text-moss-green focus:ring-moss-green"
            />
            <span className="text-sm text-deep-brown">启用此规则（停用后不参与校验，结果保留并置灰）</span>
          </label>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {cycleText && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 font-medium mb-1">
                <AlertTriangle className="w-4 h-4" />
                检测到循环引用，已拦截保存
              </div>
              <div className="text-red-600 break-all">环路：{cycleText}</div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-warm-beige text-deep-brown rounded-lg font-medium text-sm hover:bg-warm-beige/80"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-moss-green text-white rounded-lg font-medium text-sm hover:bg-moss-light shadow-md"
            >
              {rule ? '保存修改' : '创建规则'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
