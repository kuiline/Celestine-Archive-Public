import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, SlidersHorizontal } from 'lucide-react';

/** 默认整块折叠的模块（如新预览时仍折叠，用户可点开） */
const DEFAULT_COLLAPSED_MODULE_KEYS = new Set(['tagged_scrapbook']);

function CountTripletRow({ label, value, onChange, maxSummary = 60 }) {
  const patch = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 px-2 py-1.5 space-y-1">
      <div className="text-[8px] font-black tracking-widest text-slate-500 uppercase">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        <label className="flex flex-col gap-0.5">
          <span className="text-[7px] text-slate-400">原文</span>
          <input
            type="number"
            min={0}
            max={24}
            value={value.novel}
            onChange={(e) => patch('novel', parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-mono font-bold"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[7px] text-slate-400">手札</span>
          <input
            type="number"
            min={0}
            max={24}
            value={value.scrapbook}
            onChange={(e) => patch('scrapbook', parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-mono font-bold"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[7px] text-slate-400">摘要</span>
          <input
            type="number"
            min={0}
            max={maxSummary}
            value={value.summary}
            onChange={(e) => patch('summary', parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-mono font-bold"
          />
        </label>
      </div>
    </div>
  );
}

/**
 * @param {{ preview: object | null, fullSystemPrompt: string, referenceConfig: object, setReferenceConfig: function, inspirationSessionActive?: boolean }} props
 */
export default function ContextPreviewColumn({ preview, fullSystemPrompt, referenceConfig, setReferenceConfig, inspirationSessionActive }) {
  const [openKey, setOpenKey] = useState(null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  /** 折叠后把纵向空间留给命中切片列表 */
  const [refSettingsOpen, setRefSettingsOpen] = useState(false);
  /** @type {[Record<string, boolean | undefined>, function]} 模块级展开；undefined 表示用默认规则 */
  const [moduleExpandedOverride, setModuleExpandedOverride] = useState({});

  useEffect(() => {
    setModuleExpandedOverride((prev) => {
      if (!('tagged_scrapbook' in prev)) return prev;
      const { tagged_scrapbook: _t, ...rest } = prev;
      return rest;
    });
  }, [preview?.updatedAt]);

  const isModuleExpanded = (key) => {
    if (Object.prototype.hasOwnProperty.call(moduleExpandedOverride, key)) {
      return !!moduleExpandedOverride[key];
    }
    return !DEFAULT_COLLAPSED_MODULE_KEYS.has(key);
  };

  const toggleModule = (key) => {
    setModuleExpandedOverride((prev) => {
      const cur = Object.prototype.hasOwnProperty.call(prev, key)
        ? !!prev[key]
        : !DEFAULT_COLLAPSED_MODULE_KEYS.has(key);
      return { ...prev, [key]: !cur };
    });
  };

  const modules = preview?.modules || [];

  const toggle = (key) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  const hasPrompt = useMemo(() => !!(fullSystemPrompt && String(fullSystemPrompt).trim()), [fullSystemPrompt]);

  const rc = referenceConfig || {};

  return (
    <div className="w-[min(400px,38vw)] min-w-[280px] sm:min-w-[300px] xl:min-w-[320px] xl:w-[min(440px,36vw)] shrink-0 border-r border-slate-200/60 bg-slate-50/50 backdrop-blur-sm hidden sm:flex flex-col min-h-0">
      <div className="px-2.5 py-2 border-b border-slate-200/60 bg-white/60 shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-black tracking-widest text-slate-800 uppercase">
          <Layers size={14} className="text-slate-500 shrink-0" />
          本轮上下文注入
        </div>
        {setReferenceConfig && (
          <div className="rounded-lg border border-amber-200/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setRefSettingsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left bg-amber-50/40 hover:bg-amber-50/80 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[9px] font-black text-amber-900/90">
                <SlidersHorizontal size={12} className="shrink-0 opacity-70" />
                参考与检索设置
              </span>
              <span className="text-slate-500 shrink-0">{refSettingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            </button>
            {refSettingsOpen && (
              <div className="px-2 pb-2 pt-0.5 space-y-2 border-t border-amber-100/60 bg-amber-50/30">
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-[9px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3 rounded border-slate-300 text-amber-700"
                      checked={rc.useStructuredContext !== false}
                      onChange={(e) => setReferenceConfig({ ...rc, useStructuredContext: e.target.checked })}
                    />
                    结构化参考（标签手札）
                  </label>
                  <label className="flex items-center gap-1.5 text-[9px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3 rounded border-slate-300 text-amber-700"
                      checked={rc.useRagContext !== false}
                      onChange={(e) => setReferenceConfig({ ...rc, useRagContext: e.target.checked })}
                    />
                    对话 RAG
                  </label>
                  <label className="flex items-center gap-1.5 text-[9px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3 rounded border-slate-300 text-amber-700"
                      checked={rc.useRagForImageTag !== false}
                      onChange={(e) => setReferenceConfig({ ...rc, useRagForImageTag: e.target.checked })}
                    />
                    生图 Tag 阶段 RAG
                  </label>
                </div>
                <label className="flex flex-col gap-0.5 text-[9px] text-slate-600">
                  发往 LLM 的对话条数（0=本会话尽量全带，最多 200 条）
                  <input
                    type="number"
                    min={0}
                    max={256}
                    value={rc.chatWindowMessages ?? 0}
                    onChange={(e) =>
                      setReferenceConfig({ ...rc, chatWindowMessages: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-full rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold"
                  />
                </label>
                <div className="rounded border border-amber-100/80 bg-white/50 px-1.5 py-1 space-y-1">
                  <div className="text-[8px] font-bold text-slate-600">主对话 RAG · 检索句构成</div>
                  <label className="flex items-center gap-1.5 text-[9px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3 h-3 rounded border-slate-300 text-amber-700"
                      checked={rc.chatRagUserMessageOnly === true}
                      onChange={(e) => setReferenceConfig({ ...rc, chatRagUserMessageOnly: e.target.checked })}
                    />
                    仅用本轮用户输入（不带会话历史）
                  </label>
                  <label className="flex flex-col gap-0.5 text-[9px] text-slate-600">
                    历史中最近 N 轮并入检索句（0=不带历史）
                    <input
                      type="number"
                      min={0}
                      max={20}
                      disabled={rc.chatRagUserMessageOnly === true}
                      value={rc.chatRagHistoryMessages ?? 8}
                      onChange={(e) =>
                        setReferenceConfig({ ...rc, chatRagHistoryMessages: parseInt(e.target.value, 10) || 0 })
                      }
                      className="w-full rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold disabled:opacity-40"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[9px] text-slate-600">
                    历史片段最多字数（0=不截断，建议 800～2500 减轻「会话定死」）
                    <input
                      type="number"
                      min={0}
                      max={50000}
                      disabled={rc.chatRagUserMessageOnly === true}
                      value={rc.chatRagHistoryMaxChars ?? 0}
                      onChange={(e) =>
                        setReferenceConfig({ ...rc, chatRagHistoryMaxChars: parseInt(e.target.value, 10) || 0 })
                      }
                      className="w-full rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold disabled:opacity-40"
                    />
                  </label>
                </div>
                <CountTripletRow
                  label="主对话 · 向量条数"
                  value={rc.chatRagCounts || { novel: 4, scrapbook: 4, summary: 4 }}
                  onChange={(next) => setReferenceConfig({ ...rc, chatRagCounts: next })}
                />
                <CountTripletRow
                  label="生图 Tag · 向量条数"
                  value={rc.imageTagRagCounts || { novel: 4, scrapbook: 4, summary: 4 }}
                  onChange={(next) => setReferenceConfig({ ...rc, imageTagRagCounts: next })}
                />
                <label className="flex flex-col gap-0.5 text-[9px] text-slate-600">
                  生图“场景回顾”条数（0=关闭；建议 3-8）
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={rc.imageSceneHistoryCount ?? 5}
                    onChange={(e) =>
                      setReferenceConfig({ ...rc, imageSceneHistoryCount: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-full rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold"
                  />
                </label>
                <div className={`space-y-1.5 ${inspirationSessionActive ? '' : 'opacity-80'}`}>
                  <div className="text-[8px] font-bold text-slate-500">灵感室 · 每轮追加检索（{inspirationSessionActive ? '当前为灵感会话' : '进入灵感室后生效'}）</div>
                  <CountTripletRow
                    label="首轮"
                    value={rc.inspirationRagFirst || { novel: 6, scrapbook: 8, summary: 6 }}
                    onChange={(next) => setReferenceConfig({ ...rc, inspirationRagFirst: next })}
                  />
                  <CountTripletRow
                    label="后续轮"
                    value={rc.inspirationRagFollow || { novel: 4, scrapbook: 5, summary: 4 }}
                    onChange={(next) => setReferenceConfig({ ...rc, inspirationRagFollow: next })}
                  />
                  <label className="flex flex-col gap-0.5 text-[9px] text-slate-600">
                    角色资料命中上限
                    <input
                      type="number"
                      min={0}
                      max={48}
                      value={rc.inspirationCharMax ?? 12}
                      onChange={(e) => setReferenceConfig({ ...rc, inspirationCharMax: parseInt(e.target.value, 10) || 0 })}
                      className="w-full rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
        {preview?.summaryLine ? (
          <p className="mt-1.5 text-[10px] font-bold text-slate-600 leading-snug">{preview.summaryLine}</p>
        ) : (
          <p className="mt-1.5 text-[10px] text-slate-400">发送一条对话后，此处会按模块列出实际注入的内容与 RAG 切片。</p>
        )}
        {(preview?.requiredTags || []).length > 0 && (
          <div className="mt-1.5 text-[9px] font-mono text-slate-500 truncate" title={(preview.requiredTags || []).join(' · ')}>
            手札标签域：{(preview.requiredTags || []).join(' · ')}
          </div>
        )}
        {preview?.mode === 'inspiration' ? (
          <div className="mt-1 text-[8px] font-bold text-amber-800/80">
            灵感交流 · 每轮检索并入 chunkMap；下方为本次请求前的 system / user 与累积切片分类
            <span className="mx-1 opacity-40">|</span>
            检索 {preview?.useRagContext ? '开' : '关'}
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] font-bold text-slate-400">
            <span>档案对谈</span>
            <span className="opacity-30">|</span>
            <span>结构化 {preview?.useStructuredContext ? '开' : '关'}</span>
            <span className="opacity-30">|</span>
            <span>RAG {preview?.useRagContext ? '开' : '关'}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-2 space-y-2">
        {!preview && (
          <div className="rounded-xl border border-dashed border-slate-200/80 bg-white/40 px-3 py-8 text-center text-[10px] text-slate-400 leading-relaxed">
            尚无预览数据。
            <br />
            在主聊天区发送消息后，可在此查看各来源条目与条数。
          </div>
        )}

        {modules.map((mod) => {
          const dim = !mod.enabled && mod.count === 0;
          const modOpen = isModuleExpanded(mod.key);
          return (
            <section
              key={mod.key}
              className={`rounded-xl border overflow-hidden ${dim ? 'border-slate-100/80 bg-white/30 opacity-70' : 'border-slate-200/70 bg-white/70 shadow-sm'}`}
            >
              <button
                type="button"
                onClick={() => toggleModule(mod.key)}
                className="w-full px-2.5 py-2 bg-slate-100/40 border-b border-slate-100/80 text-left hover:bg-slate-100/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-start gap-1 min-w-0">
                    <span className="mt-0.5 text-slate-500 shrink-0">{modOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                    <span className="text-[10px] font-black text-slate-800 tracking-tight leading-tight">{mod.label}</span>
                  </span>
                  <span className={`text-[9px] font-mono font-bold shrink-0 px-1.5 py-0.5 rounded ${mod.count ? 'bg-slate-800 text-white' : 'bg-slate-200/80 text-slate-500'}`}>
                    {mod.count} 条
                  </span>
                </div>
                {mod.hint ? <p className="mt-1 pl-4 text-[8px] text-slate-500 leading-snug">{mod.hint}</p> : null}
              </button>
              {modOpen && (
              <ul className="divide-y divide-slate-100/80">
                {(mod.items || []).length === 0 ? (
                  <li className="px-2.5 py-2 text-[9px] text-slate-400 italic">无条目</li>
                ) : (
                  (mod.items || []).map((it) => {
                    const rowKey = `${mod.key}:${it.id}`;
                    const open = openKey === rowKey;
                    return (
                      <li key={rowKey} className="bg-white/50">
                        <button
                          type="button"
                          onClick={() => toggle(rowKey)}
                          className="w-full flex items-start gap-1.5 px-2 py-2 text-left hover:bg-amber-50/40 transition-colors"
                        >
                          <span className="mt-0.5 text-slate-400 shrink-0">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] font-bold text-slate-800 break-words">{it.title}</span>
                              {typeof it.score === 'number' && Number.isFinite(it.score) ? (
                                <span className="shrink-0 text-[8px] font-mono font-bold text-amber-900 bg-amber-100/90 border border-amber-200/70 px-1 py-0 rounded">
                                  {it.score.toFixed(4)}
                                </span>
                              ) : null}
                            </span>
                            {it.meta ? (
                              <span className="block text-[8px] text-slate-400 mt-0.5 leading-snug break-words">{it.meta}</span>
                            ) : null}
                          </span>
                        </button>
                        {open && (
                          <div className="px-2 pb-2 pl-7 space-y-1.5 animate-fade-in">
                            {(it.tags || []).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(it.tags || []).map((t) => (
                                  <span key={t} className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-100/90 text-amber-900 font-bold border border-amber-200/60">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                            <pre className="text-[9px] text-slate-700 font-serif leading-relaxed whitespace-pre-wrap break-words max-h-[min(70vh,22rem)] min-h-[4rem] overflow-y-auto custom-scrollbar bg-stone-50/80 rounded-lg p-2 border border-stone-100">
                              {it.body}
                            </pre>
                          </div>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-slate-200/60 bg-white/50 px-2 py-2">
        <button
          type="button"
          onClick={() => setShowFullPrompt((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[9px] font-black text-slate-600 hover:bg-slate-100/80 transition-colors uppercase tracking-widest"
        >
          <span>完整系统提示拼接</span>
          <span className="font-mono opacity-60">{showFullPrompt ? '−' : '+'}</span>
        </button>
        {showFullPrompt && (
          <pre className="mt-1 max-h-36 overflow-y-auto custom-scrollbar text-[8px] text-slate-600 leading-relaxed whitespace-pre-wrap break-words bg-stone-50 rounded-lg p-2 border border-stone-100">
            {hasPrompt ? fullSystemPrompt : '（空）'}
          </pre>
        )}
      </div>
    </div>
  );
}
