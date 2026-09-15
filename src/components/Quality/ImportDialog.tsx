import { useRef, useState } from 'react';
import { X, Upload, FileCheck2, AlertTriangle, Download } from 'lucide-react';
import type { ImportPreview } from '@/utils/ruleSet';
import { SEVERITY_LABELS } from '@/types/quality';
import { describeCondition } from '@/types/quality';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (preview: ImportPreview) => void;
  parseFile: (text: string) => ImportPreview;
}

export default function ImportDialog({ open, onClose, onConfirm, parseFile }: ImportDialogProps) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setPreview(null);
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setPreview(parseFile(text));
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="paper-texture rounded-xl shadow-paper-hover w-full max-w-2xl max-h-[90vh] overflow-y-auto fade-in">
        <div className="sticky top-0 paper-texture border-b border-deep-brown/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="font-serif text-lg font-semibold text-deep-brown">导入规则集</h3>
          <button
            onClick={handleClose}
            className="p-1.5 text-ink-light hover:text-deep-brown hover:bg-deep-brown/5 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-deep-brown/20 rounded-xl p-8 text-center cursor-pointer hover:border-moss-green hover:bg-moss-green/5 transition-colors"
          >
            <Upload className="w-8 h-8 text-ink-light mx-auto mb-2" />
            <p className="text-sm text-deep-brown font-medium">
              {fileName || '点击选择规则集 JSON 文件'}
            </p>
            <p className="text-xs text-ink-light mt-1">导入前会先检查格式、版本与引用字段</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>

          {preview && (
            <div className="space-y-3">
              <div
                className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm border ${
                  preview.ok
                    ? 'bg-moss-green/10 text-moss-green border-moss-green/30'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}
              >
                {preview.ok ? <FileCheck2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <div>
                  {preview.ok
                    ? `校验通过：共 ${preview.count} 条规则，版本 v${preview.version}${preview.upgraded ? '（已自动升级到当前版本）' : ''}。导入将作为新规则追加，不会覆盖现有规则。`
                    : `校验未通过（版本${preview.version !== null ? ` v${preview.version}` : '未知'}），整批拒绝导入，现有规则不会被改动。`}
                </div>
              </div>

              {preview.issues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-deep-brown">检查详情</p>
                  {preview.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 ${
                        issue.level === 'error'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-ochre/10 text-ochre'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {preview.ok && preview.rules.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-deep-brown mb-2">规则预览</p>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {preview.rules.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 bg-warm-cream/70 rounded-md px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-deep-brown truncate">{r.name}</span>
                        <span className="text-ink-light truncate flex-1 text-center">
                          {describeCondition(r)}
                        </span>
                        <span className="text-ink-light flex-shrink-0">{SEVERITY_LABELS[r.severity]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 bg-warm-beige text-deep-brown rounded-lg font-medium text-sm hover:bg-warm-beige/80"
            >
              {preview && !preview.ok ? '关闭' : '取消'}
            </button>
            <button
              disabled={!preview?.ok}
              onClick={() => {
                if (preview) {
                  onConfirm(preview);
                  reset();
                }
              }}
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 text-white ${
                preview?.ok
                  ? 'bg-moss-green hover:bg-moss-light shadow-md'
                  : 'bg-deep-brown/20 cursor-not-allowed'
              }`}
            >
              <Download className="w-4 h-4" />
              确认导入（追加 {preview?.count ?? 0} 条）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
