import type { QualityRule, ValidationMeta, ValidationResult } from '@/types/quality';

const RULES_KEY = 'bench-quality-rules';
const RESULTS_KEY = 'bench-quality-results';
const META_KEY = 'bench-quality-meta';

/** 默认示例规则（固定 id，便于互相引用） */
export function getDefaultRules(): QualityRule[] {
  const now = new Date().toISOString();
  const base = {
    enabled: true,
    references: [] as string[],
    createdAt: now,
    updatedAt: now,
  };
  return [
    {
      ...base,
      id: 'qr-default-noisy',
      name: '周边嘈杂',
      description: '噪音等级为「嘈杂」的档案值得复核',
      field: 'noiseLevel',
      operator: 'eq',
      value: 'noisy',
      severity: 'medium',
      order: 0,
    },
    {
      ...base,
      id: 'qr-default-rating-low',
      name: '综合评分过低',
      description: '个人评分低于 2 分，检查是否记录有误',
      field: 'rating',
      operator: 'lt',
      value: 2,
      severity: 'high',
      order: 1,
    },
    {
      ...base,
      id: 'qr-default-review-empty',
      name: '评价文字为空',
      description: '没有评价文字的档案信息不完整',
      field: 'review',
      operator: 'empty',
      severity: 'low',
      order: 2,
    },
    {
      ...base,
      id: 'qr-default-lng-outside',
      name: '经度超出国内范围',
      description: '中国经度大致在 73~135 之间，超出可能填错',
      field: 'lng',
      operator: 'outside',
      value: 73,
      value2: 135,
      severity: 'medium',
      order: 3,
    },
    {
      ...base,
      id: 'qr-default-no-backrest-noisy',
      name: '嘈杂且无靠背',
      description: '引用「周边嘈杂」规则：既嘈杂又没有靠背，久坐体验差',
      field: 'hasBackrest',
      operator: 'eq',
      value: 'false',
      severity: 'low',
      references: ['qr-default-noisy'],
      order: 4,
    },
  ];
}

export function loadRules(): QualityRule[] | null {
  try {
    const data = localStorage.getItem(RULES_KEY);
    if (data === null) return null;
    return JSON.parse(data) as QualityRule[];
  } catch (error) {
    console.error('Failed to load quality rules:', error);
    return null;
  }
}

export function saveRules(rules: QualityRule[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch (error) {
    console.error('Failed to save quality rules:', error);
  }
}

export function loadResults(): ValidationResult[] {
  try {
    const data = localStorage.getItem(RESULTS_KEY);
    if (data) return JSON.parse(data) as ValidationResult[];
  } catch (error) {
    console.error('Failed to load quality results:', error);
  }
  return [];
}

export function saveResults(results: ValidationResult[]): void {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch (error) {
    console.error('Failed to save quality results:', error);
  }
}

const DEFAULT_META: ValidationMeta = {
  lastRunAt: null,
  checkedBenchCount: 0,
  checkedRuleCount: 0,
  hitCount: 0,
  lastRecomputeCount: 0,
};

export function loadMeta(): ValidationMeta {
  try {
    const data = localStorage.getItem(META_KEY);
    if (data) return { ...DEFAULT_META, ...(JSON.parse(data) as Partial<ValidationMeta>) };
  } catch (error) {
    console.error('Failed to load quality meta:', error);
  }
  return { ...DEFAULT_META };
}

export function saveMeta(meta: ValidationMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (error) {
    console.error('Failed to save quality meta:', error);
  }
}
