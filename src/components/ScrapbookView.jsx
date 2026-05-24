import React, { useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Book, Camera, X, Upload, Database, Search, RefreshCw, FileText,
  Sparkles, Play, Square, ChevronDown, ChevronUp
} from 'lucide-react';
import { generateRollingSummaries } from '../appHelpers';

const normalizeEntryTitle = (title) => String(title || '').replace(/\s*·\s*片段\s*\d+\s*$/u, '').trim();

/** 与 novelChunks useMemo 一致：供清空摘要后立即重跑时直接用接口返回列表，避免 React state 未刷新 */
function sortNovelChunksForRoll(ragList) {
  return (Array.isArray(ragList) ? ragList : [])
    .filter(chunk => chunk.type === 'novel')
    .sort((a, b) => {
      const aKey = String(a.chapterKey || '');
      const bKey = String(b.chapterKey || '');
      const aOrder = Number((aKey.match(/^ch(\d+)_/i) || [])[1] || Number.MAX_SAFE_INTEGER);
      const bOrder = Number((bKey.match(/^ch(\d+)_/i) || [])[1] || Number.MAX_SAFE_INTEGER);
      if (aOrder !== bOrder) return aOrder - bOrder;
      const byChapter = String(a.chapterTitle || normalizeEntryTitle(a.title || ''))
        .localeCompare(String(b.chapterTitle || normalizeEntryTitle(b.title || '')), 'zh-Hans-CN');
      if (byChapter !== 0) return byChapter;
      return Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
    });
}

const ScrapbookView = ({
  scrapbook, isEditMode,
  updateScrapbookItem, deleteScrapbookItem,
  setScrapbook,
  triggerScrapbookImageUpload,
  activeScrapbookId,
  scrapbookFileInputRef,
  handleImageUpload,
  activeTextEndpoint
}) => {
  const [tagDrafts, setTagDrafts] = useState({});
  const [isDragOver, setIsDragOver] = useState(false);
  const [quickEditItemId, setQuickEditItemId] = useState(null);
  const [showRagChunks, setShowRagChunks] = useState(false);
  const [isRagLoading, setIsRagLoading] = useState(false);
  const [ragError, setRagError] = useState('');
  const [ragChunks, setRagChunks] = useState([]);
  const [ragTypeFilter, setRagTypeFilter] = useState('all');
  const [ragEntryFilter, setRagEntryFilter] = useState('all');
  const [ragQuery, setRagQuery] = useState('');
  const [showAiSummaryPanel, setShowAiSummaryPanel] = useState(false);
  const [aiSummaryEntryFilter, setAiSummaryEntryFilter] = useState('all');
  const [aiSummaryQuery, setAiSummaryQuery] = useState('');
  const [aiSummaryStatus, setAiSummaryStatus] = useState('尚未开始生成');
  const [aiSummaryProgress, setAiSummaryProgress] = useState({ current: 0, total: 0 });
  const [isAiSummaryRunning, setIsAiSummaryRunning] = useState(false);
  const [summaryExpandedMap, setSummaryExpandedMap] = useState({});
  const summaryAbortRef = useRef(null);
  const itemCardRefs = useRef({});
  const titleInputRefs = useRef({});

  const loadRagChunks = async () => {
    setIsRagLoading(true);
    setRagError('');
    try {
      const res = await fetch('/api/rag/chunks');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const list = Array.isArray(data?.chunks) ? data.chunks : [];
      setRagChunks(list);
      return list;
    } catch (e) {
      setRagError(`读取 RAG 切片失败：${e.message}`);
      return [];
    } finally {
      setIsRagLoading(false);
    }
  };

  const openRagChunks = async () => {
    setShowRagChunks(true);
    setRagTypeFilter('all');
    setRagEntryFilter('all');
    setRagQuery('');
    await loadRagChunks();
  };

  const openAiSummaryPanel = async () => {
    setShowAiSummaryPanel(true);
    setAiSummaryEntryFilter('all');
    setAiSummaryQuery('');
    if (!ragChunks.length) await loadRagChunks();
    const novelCount = ragChunks.filter(c => c.type === 'novel').length;
    setAiSummaryProgress({ current: 0, total: novelCount });
  };

  const ragEntryOptions = useMemo(() => {
    const filteredByType = ragChunks.filter(chunk => ragTypeFilter === 'all' || chunk.type === ragTypeFilter);
    const map = new Map();
    filteredByType.forEach(chunk => {
      const key = chunk.type === 'novel'
        ? `novel:${chunk.chapterKey || chunk.chapterTitle || normalizeEntryTitle(chunk.title) || 'unknown'}`
        : `scrapbook:${chunk.scrapbookId || normalizeEntryTitle(chunk.title) || 'unknown'}`;
      const label = chunk.type === 'novel'
        ? (chunk.workType === 'prequel' && chunk.prequelTitle
          ? `${chunk.characterName ? `${chunk.characterName} · ` : ''}${chunk.prequelTitle}`
          : (chunk.chapterTitle || normalizeEntryTitle(chunk.title) || '未命名章节'))
        : (normalizeEntryTitle(chunk.title) || '未命名笔记');
      if (!map.has(key)) map.set(key, { key, label, type: chunk.type });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  }, [ragChunks, ragTypeFilter]);

  const filteredRagChunks = useMemo(() => {
    const q = ragQuery.trim().toLowerCase();
    return ragChunks
      .filter(chunk => ragTypeFilter === 'all' || chunk.type === ragTypeFilter)
      .filter(chunk => {
        if (ragEntryFilter === 'all') return true;
        if (chunk.type === 'novel') {
          const key = `novel:${chunk.chapterKey || chunk.chapterTitle || normalizeEntryTitle(chunk.title) || 'unknown'}`;
          return key === ragEntryFilter;
        }
        const key = `scrapbook:${chunk.scrapbookId || normalizeEntryTitle(chunk.title) || 'unknown'}`;
        return key === ragEntryFilter;
      })
      .filter(chunk => {
        if (!q) return true;
        const haystack = `${chunk.title || ''}\n${chunk.characterName || ''}\n${chunk.prequelTitle || ''}\n${chunk.text || ''}\n${chunk.id || ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        const aEntry = a.type === 'novel'
          ? (a.chapterTitle || normalizeEntryTitle(a.title))
          : normalizeEntryTitle(a.title);
        const bEntry = b.type === 'novel'
          ? (b.chapterTitle || normalizeEntryTitle(b.title))
          : normalizeEntryTitle(b.title);
        const byEntry = String(aEntry || '').localeCompare(String(bEntry || ''), 'zh-Hans-CN');
        if (byEntry !== 0) return byEntry;
        return Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
      });
  }, [ragChunks, ragTypeFilter, ragEntryFilter, ragQuery]);

  const novelChunks = useMemo(() => sortNovelChunksForRoll(ragChunks), [ragChunks]);

  const aiSummaryChapterOptions = useMemo(() => {
    const map = new Map();
    novelChunks.forEach(chunk => {
      const key = chunk.chapterKey || chunk.chapterTitle || normalizeEntryTitle(chunk.title) || 'unknown';
      const label = chunk.chapterTitle || normalizeEntryTitle(chunk.title) || '未命名章节';
      if (!map.has(key)) map.set(key, { key, label });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  }, [novelChunks]);

  const filteredNovelChunks = useMemo(() => {
    const q = aiSummaryQuery.trim().toLowerCase();
    return novelChunks.filter(chunk => {
      if (aiSummaryEntryFilter !== 'all') {
        const key = chunk.chapterKey || chunk.chapterTitle || normalizeEntryTitle(chunk.title) || 'unknown';
        if (key !== aiSummaryEntryFilter) return false;
      }
      if (!q) return true;
      const haystack = `${chunk.title || ''}\n${chunk.text || ''}\n${chunk.id || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [novelChunks, aiSummaryEntryFilter, aiSummaryQuery]);

  const handleStartSummary = async () => {
    return handleStartSummaryInternal(false);
  };

  const handleRerunAllSummary = async () => {
    if (!confirm('将删除磁盘上全部已生成摘要并从头重跑，是否继续？')) return;
    try {
      const res = await fetch('/api/rag/clear-novel-summaries', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    } catch (e) {
      alert(`清空摘要失败：${e.message}`);
      return;
    }
    const fresh = await loadRagChunks();
    const workNovel = sortNovelChunksForRoll(fresh);
    return handleStartSummaryInternal(true, workNovel);
  };

  const handleStartSummaryInternal = async (forceRegenerate = false, novelListOverride = null) => {
    if (isAiSummaryRunning) return;
    if (!activeTextEndpoint?.url || !activeTextEndpoint?.key || !activeTextEndpoint?.model) {
      setAiSummaryStatus('缺少可用文本模型，请先在 AI 设置中配置');
      alert('请先配置并选择可用文本模型节点');
      return;
    }
    const workNovel = Array.isArray(novelListOverride) ? novelListOverride : novelChunks;
    if (!workNovel.length) {
      setAiSummaryStatus('没有可处理的小说切片，请先重建 RAG');
      return;
    }
    const pendingCount = forceRegenerate
      ? workNovel.length
      : workNovel.filter(d => !String(d?.ai_metadata?.summary || '').trim()).length;
    if (pendingCount === 0) {
      setAiSummaryStatus('全部切片都已生成摘要，无需重复处理');
      setAiSummaryProgress({ current: workNovel.length, total: workNovel.length });
      return;
    }

    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setIsAiSummaryRunning(true);
    setAiSummaryStatus(forceRegenerate ? `准备全局重跑，共 ${pendingCount} 条切片` : `准备开始，待处理 ${pendingCount} 条切片`);
    setAiSummaryProgress({ current: 0, total: workNovel.length });

    try {
      const result = await generateRollingSummaries(workNovel, (p) => {
        setAiSummaryProgress({ current: p.current || 0, total: p.total || workNovel.length });
        if (p.status === 'generated') {
          setAiSummaryStatus(
            forceRegenerate
              ? `全局重跑中 ${p.current}/${p.total}（已重算 ${p.processed}）`
              : `正在处理 ${p.current}/${p.total}（新增 ${p.processed}，跳过 ${p.skipped}）`
          );
          if (p.doc?.id) {
            setRagChunks(prev => prev.map(item => (item.id === p.doc.id ? p.doc : item)));
          }
        } else if (p.status === 'skipped') {
          setAiSummaryStatus(`正在处理 ${p.current}/${p.total}（跳过已完成切片）`);
        }
      }, {
        endpoint: activeTextEndpoint,
        signal: controller.signal,
        forceRegenerate
      });

      setRagChunks(prev => prev.map(item => {
        const next = result.updatedDocs.find(d => d.id === item.id);
        return next || item;
      }));
      setAiSummaryStatus(
        forceRegenerate
          ? `全局重跑完成：共重算 ${result.processed} 条`
          : `完成：新增 ${result.processed} 条，跳过 ${result.skipped} 条`
      );
      setAiSummaryProgress({ current: result.total, total: result.total });
    } catch (e) {
      if (e?.name === 'AbortError') {
        setAiSummaryStatus('已手动停止，已完成结果已保留');
      } else {
        setAiSummaryStatus(`生成失败：${e.message}`);
        alert(`摘要生成失败：${e.message}`);
      }
    } finally {
      setIsAiSummaryRunning(false);
      summaryAbortRef.current = null;
      await loadRagChunks();
    }
  };

  const handleStopSummary = () => {
    if (!isAiSummaryRunning) return;
    summaryAbortRef.current?.abort?.();
    setAiSummaryStatus('正在停止...');
  };

  const toggleSummaryExpand = (id) => {
    setSummaryExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const enterQuickEdit = (id) => {
    setQuickEditItemId(id);
    requestAnimationFrame(() => {
      const inputEl = titleInputRefs.current[id];
      if (inputEl?.focus) inputEl.focus({ preventScroll: true });
    });
  };

  const commitDraftTags = (id) => {
    const text = tagDrafts[id];
    if (text === undefined) return;
    const tags = text.split(/[,，、\s]+/).map(t => t.trim()).filter(Boolean);
    updateScrapbookItem(id, 'tags', tags);
    const next = { ...tagDrafts };
    delete next[id];
    setTagDrafts(next);
  };

  const getDraftText = (item) => {
    if (tagDrafts[item.id] !== undefined) return tagDrafts[item.id];
    return (item.tags || []).join(', ');
  };

  const renderTags = (tags) => {
    const arr = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (arr.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-stone-100">
        {arr.map(tag => (
          <span key={tag} className="px-2 py-0.5 rounded-sm bg-red-50 text-red-800 text-[10px] font-bold border border-red-100/50 shadow-sm transition-transform hover:scale-105 active:scale-95">
            # {tag}
          </span>
        ))}
      </div>
    );
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!isEditMode) return;
    const file = Array.from(e.dataTransfer?.files || []).find(f => String(f.type || '').startsWith('image/'));
    if (!file) return;

    const targetId = activeScrapbookId || scrapbook?.[0]?.id;
    if (!targetId) {
      setScrapbook(prev => [{ id: Date.now(), title: '', content: '', image: null, tags: [] }, ...(Array.isArray(prev) ? prev : [])]);
      return;
    }

    triggerScrapbookImageUpload(targetId);
    setTimeout(() => {
      if (scrapbookFileInputRef?.current) {
        const dt = new DataTransfer();
        dt.items.add(file);
        scrapbookFileInputRef.current.files = dt.files;
        scrapbookFileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 0);
  };

  return (
    <div
      className="w-full h-full max-w-[1440px] mx-auto flex flex-col pt-8 px-8 overflow-y-auto custom-scrollbar relative z-20 pb-32 animate-fade-in text-stone-800"
      onDragOver={(e) => {
        if (!isEditMode) return;
        const hasImage = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file' && String(item.type || '').startsWith('image/'));
        if (!hasImage) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextTarget = e.relatedTarget;
        if (nextTarget && e.currentTarget.contains(nextTarget)) return;
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {isEditMode && isDragOver && (
        <div className="absolute inset-6 z-30 rounded-3xl border-2 border-dashed border-amber-400 bg-amber-50/85 backdrop-blur-sm flex items-center justify-center pointer-events-none shadow-inner">
          <div className="flex flex-col items-center gap-3 text-amber-700">
            <Upload size={34} className="animate-bounce" />
            <div className="text-xs font-black tracking-[0.25em] uppercase">释放以添加笔记图片</div>
            <div className="text-[10px] font-bold text-amber-600">会添加到当前选中的笔记条目</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-end mb-10 border-b-2 border-stone-800/10 pb-6 gap-4">
        <div className="relative">
          <h2 className="text-4xl font-serif font-black tracking-[0.2em] text-stone-900 drop-shadow-sm">资料卡</h2>
          <div className="absolute -bottom-1 left-0 w-12 h-1 bg-stone-800"></div>
          <p className="text-stone-500 text-[10px] font-bold tracking-[0.3em] mt-4 uppercase opacity-60 font-serif italic">灵感片段、参考图录与零散设定</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAiSummaryPanel}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/80 hover:bg-white text-stone-700 rounded-full text-[11px] font-bold tracking-widest shadow-md transition-all hover:scale-105 active:scale-95 border border-stone-200"
          >
            <Sparkles size={14} /> AI摘要
          </button>
          <button
            onClick={openRagChunks}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/80 hover:bg-white text-stone-700 rounded-full text-[11px] font-bold tracking-widest shadow-md transition-all hover:scale-105 active:scale-95 border border-stone-200"
          >
            <Database size={14} /> RAG切片
          </button>
          {isEditMode && (
            <button
              onClick={() => setScrapbook(prev => [{ id: Date.now(), title: '', content: '', image: null, tags: [] }, ...(Array.isArray(prev) ? prev : [])])}
              className="flex items-center gap-2 px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-full text-xs font-bold tracking-widest shadow-xl transition-all hover:scale-105 active:scale-95 border border-stone-700"
            >
              <Plus size={14} /> 新增灵感记录
            </button>
          )}
        </div>
      </div>

      {(!Array.isArray(scrapbook) || scrapbook.length === 0) ? (
        <div className="w-full flex-1 flex flex-col items-center justify-center text-stone-400 font-serif pb-20 opacity-40">
          <Book size={64} strokeWidth={1} className="mb-6" />
          <p className="tracking-widest text-sm font-bold">笔记空空如也</p>
          {isEditMode && <p className="mt-4 text-[10px] tracking-widest">点击上方按钮或拖入图片</p>}
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-8 space-y-8">
          {scrapbook.map((item, idx) => (
            <div key={item.id}
              ref={(el) => { itemCardRefs.current[item.id] = el; }}
              onDoubleClick={() => { if (!isEditMode) enterQuickEdit(item.id); }}
              className="break-inside-avoid bg-white/70 backdrop-blur-md border border-white shadow-sm hover:shadow-2xl transition-all duration-500 rounded-2xl overflow-hidden group relative ring-1 ring-black/5 hover:-translate-y-1"
              style={{ transform: `rotate(${(idx % 2 === 0 ? 0.5 : -0.5)}deg)` }}>
              <input
                type="file" accept="image/*" className="hidden"
                ref={activeScrapbookId === item.id ? scrapbookFileInputRef : null}
                onChange={(e) => handleImageUpload(e, 'scrapbook_update')}
              />
              {item.image ? (
                <div className="relative overflow-hidden">
                  <img src={item.image} alt="scrapbook" className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105" />
                  {isEditMode && (
                    <button
                      onClick={() => updateScrapbookItem(item.id, 'image', null)}
                      className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm hover:bg-red-500 text-stone-700 hover:text-white p-2 rounded-full shadow-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ) : (
                isEditMode && (
                  <div
                    onClick={() => triggerScrapbookImageUpload(item.id)}
                    className="w-full h-40 bg-stone-100/30 border-b border-stone-200/50 flex flex-col items-center justify-center text-stone-400 cursor-pointer hover:bg-stone-100/60 hover:text-stone-700 transition-all"
                  >
                    <Camera size={24} className="mb-2" />
                    <span className="text-[10px] font-bold tracking-widest uppercase opacity-60">添加视觉参考</span>
                  </div>
                )
              )}
              <div className="p-6 relative">
                {isEditMode && (
                  <button onClick={() => deleteScrapbookItem(item.id)} className="absolute top-6 right-6 text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                )}
                {isEditMode ? (
                  <>
                    <input
                      value={item.title || ''}
                      onChange={(e) => updateScrapbookItem(item.id, 'title', e.target.value)}
                      placeholder="灵感命题..."
                      className="w-[90%] bg-transparent border-none outline-none font-serif font-black text-stone-900 text-xl mb-3 placeholder-stone-200"
                    />
                    <textarea
                      value={item.content || ''}
                      onChange={(e) => updateScrapbookItem(item.id, 'content', e.target.value)}
                      placeholder="在此处落笔记录灵感细节..."
                      className="w-full bg-transparent border-none outline-none font-serif text-stone-600 text-sm leading-relaxed resize-none placeholder-stone-200 min-h-[120px] custom-scrollbar"
                    />
                    <div className="mt-4 pt-4 border-t border-stone-100">
                      <div className="text-[10px] font-bold text-stone-400 mb-2 uppercase">关联标签</div>
                      <input
                        value={getDraftText(item)}
                        onChange={(e) => setTagDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => commitDraftTags(item.id)}
                        onKeyDown={(e) => e.key === 'Enter' && commitDraftTags(item.id)}
                        placeholder="逗号分隔多个标签"
                        className="w-full bg-stone-50/50 border border-stone-200/60 rounded-lg px-3 py-2 outline-none font-serif text-stone-600 text-[11px] focus:border-stone-400 transition-colors shadow-inner"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {item.title && <h3 className="font-serif font-black text-stone-900 text-xl mb-3 tracking-wide">{item.title}</h3>}
                    {item.content && <p className="font-serif text-stone-700 text-sm leading-relaxed whitespace-pre-line opacity-90">{item.content}</p>}
                    {renderTags(item.tags)}
                  </>
                )}
              </div>

              {!isEditMode && quickEditItemId === item.id && (
                <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm border border-amber-200 rounded-2xl p-6 shadow-2xl overflow-y-auto custom-scrollbar">
                  <button
                    onClick={() => setQuickEditItemId(null)}
                    className="absolute top-4 right-4 text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors"
                    title="结束快速编辑"
                  >
                    完成
                  </button>
                  <input
                    ref={(el) => { titleInputRefs.current[item.id] = el; }}
                    value={item.title || ''}
                    onChange={(e) => updateScrapbookItem(item.id, 'title', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setQuickEditItemId(null);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="灵感命题..."
                    className="w-[90%] bg-transparent border-none outline-none font-serif font-black text-stone-900 text-xl mb-3 placeholder-stone-200"
                  />
                  <textarea
                    value={item.content || ''}
                    onChange={(e) => updateScrapbookItem(item.id, 'content', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setQuickEditItemId(null);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="在此处落笔记录灵感细节..."
                    className="w-full bg-transparent border-none outline-none font-serif text-stone-600 text-sm leading-relaxed resize-none placeholder-stone-200 min-h-[160px] custom-scrollbar"
                  />
                  <div className="mt-4 pt-4 border-t border-stone-100">
                    <div className="text-[10px] font-bold text-stone-400 mb-2 uppercase">关联标签</div>
                    <input
                      value={getDraftText(item)}
                      onChange={(e) => setTagDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                      onBlur={() => commitDraftTags(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitDraftTags(item.id);
                        if (e.key === 'Escape') {
                          setQuickEditItemId(null);
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="逗号分隔多个标签"
                      className="w-full bg-stone-50/50 border border-stone-200/60 rounded-lg px-3 py-2 outline-none font-serif text-stone-600 text-[11px] focus:border-stone-400 transition-colors shadow-inner"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showRagChunks && (
        <div className="fixed inset-0 z-[90] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-6">
          <div className="w-full max-w-6xl h-[82vh] bg-[#fefcf8]/95 border border-stone-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-fade-in">
            <div className="px-6 py-4 border-b border-stone-200 bg-white/70 flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-black tracking-[0.2em] text-stone-900 font-serif">RAG 切片浏览</div>
                <div className="text-[10px] font-bold tracking-widest text-stone-500 mt-1">
                  当前共 {ragChunks.length} 条切片（小说 {ragChunks.filter(c => c.type === 'novel').length} / 笔记 {ragChunks.filter(c => c.type === 'scrapbook').length}）
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadRagChunks}
                  className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:border-stone-300 transition-all text-[11px] font-bold tracking-wider flex items-center gap-2"
                  disabled={isRagLoading}
                >
                  <RefreshCw size={14} className={isRagLoading ? 'animate-spin' : ''} /> 刷新
                </button>
                <button
                  onClick={() => setShowRagChunks(false)}
                  className="p-2 rounded-xl border border-stone-200 bg-white text-stone-500 hover:text-stone-900 hover:border-stone-300 transition-all"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-stone-200/80 bg-white/40 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={ragQuery}
                  onChange={(e) => setRagQuery(e.target.value)}
                  placeholder="搜索标题、切片内容或 ID..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-xs outline-none focus:border-amber-400 shadow-inner"
                />
              </div>
              <div className="md:col-span-3">
                <select
                  value={ragTypeFilter}
                  onChange={(e) => { setRagTypeFilter(e.target.value); setRagEntryFilter('all'); }}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs outline-none focus:border-amber-400 shadow-inner"
                >
                  <option value="all">全部类型</option>
                  <option value="novel">小说切片</option>
                  <option value="scrapbook">笔记切片</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <select
                  value={ragEntryFilter}
                  onChange={(e) => setRagEntryFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs outline-none focus:border-amber-400 shadow-inner"
                >
                  <option value="all">全部条目</option>
                  {ragEntryOptions.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.type === 'novel' ? `小说 · ${option.label}` : `笔记 · ${option.label}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
              {isRagLoading && (
                <div className="h-full flex items-center justify-center text-stone-500 text-sm font-serif">
                  正在读取切片...
                </div>
              )}
              {!isRagLoading && ragError && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{ragError}</div>
              )}
              {!isRagLoading && !ragError && filteredRagChunks.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-stone-400 font-serif opacity-70">
                  <FileText size={52} strokeWidth={1.2} className="mb-4" />
                  <p className="text-sm font-bold tracking-widest">没有匹配的切片</p>
                  <p className="text-[11px] mt-2">可尝试清空筛选条件或先执行 RAG 重建</p>
                </div>
              )}

              {!isRagLoading && !ragError && filteredRagChunks.length > 0 && (
                <div className="space-y-4">
                  {filteredRagChunks.map((chunk) => (
                    <div key={chunk.id} className="bg-white/80 border border-stone-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-[10px] font-black tracking-widest mb-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full border ${chunk.type === 'novel' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                              {chunk.type === 'novel' ? (chunk.workType === 'prequel' ? '前传' : '小说') : '笔记'}
                            </span>
                            {chunk.workType === 'prequel' && chunk.characterName && (
                              <span className="px-2 py-0.5 rounded-full border bg-rose-50 text-rose-800 border-rose-200" title="正文编辑里为该前传绑定的角色">
                                角色 {chunk.characterName}
                              </span>
                            )}
                            {chunk.workType === 'prequel' && chunk.prequelTitle && (
                              <span className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-900 border-amber-200">
                                {chunk.prequelTitle}
                              </span>
                            )}
                            <span className="text-stone-400">片段 #{Number(chunk.chunkIndex || 0) + 1}</span>
                          </div>
                          <div className="text-stone-900 font-black font-serif text-base leading-snug">
                            {chunk.type === 'novel'
                              ? (chunk.workType === 'prequel' ? (chunk.title || '未命名前传') : (chunk.chapterTitle || chunk.title || '未命名章节'))
                              : normalizeEntryTitle(chunk.title || '未命名笔记')}
                          </div>
                          <div className="text-[10px] text-stone-500 mt-1 tracking-wide break-all">{chunk.id}</div>
                        </div>
                        <div className="text-[10px] text-stone-400 font-bold tracking-wider whitespace-nowrap">{chunk.text?.length || 0} 字符</div>
                      </div>
                      <div className="mt-3 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap bg-stone-50/70 border border-stone-100 rounded-xl px-3 py-2">
                        {chunk.text || '（空内容）'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAiSummaryPanel && (
        <div className="fixed inset-0 z-[95] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-6">
          <div className="w-full max-w-[1280px] h-[84vh] bg-[#fefcf8]/95 border border-stone-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-fade-in">
            <div className="px-6 py-4 border-b border-stone-200 bg-white/70 flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-black tracking-[0.2em] text-stone-900 font-serif">AI 切片摘要</div>
                <div className="text-[10px] font-bold tracking-widest text-stone-500 mt-1">
                  小说切片总数：{novelChunks.length} | 当前状态：{aiSummaryStatus}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadRagChunks}
                  className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:border-stone-300 transition-all text-[11px] font-bold tracking-wider flex items-center gap-2"
                  disabled={isRagLoading}
                >
                  <RefreshCw size={14} className={isRagLoading ? 'animate-spin' : ''} /> 刷新切片
                </button>
                <button
                  onClick={() => setShowAiSummaryPanel(false)}
                  className="p-2 rounded-xl border border-stone-200 bg-white text-stone-500 hover:text-stone-900 hover:border-stone-300 transition-all"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-stone-200/80 bg-white/40">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-5 relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    value={aiSummaryQuery}
                    onChange={(e) => setAiSummaryQuery(e.target.value)}
                    placeholder="搜索切片标题、正文或 ID..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-stone-200 text-xs outline-none focus:border-amber-400 shadow-inner"
                  />
                </div>
                <div className="lg:col-span-3">
                  <select
                    value={aiSummaryEntryFilter}
                    onChange={(e) => setAiSummaryEntryFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs outline-none focus:border-amber-400 shadow-inner"
                  >
                    <option value="all">全部章节</option>
                    {aiSummaryChapterOptions.map(option => (
                      <option key={option.key} value={option.key}>章节 · {option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-4 flex items-center justify-end gap-2">
                  <button
                    onClick={handleRerunAllSummary}
                    className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all text-[11px] font-black tracking-wider flex items-center gap-2"
                    disabled={isAiSummaryRunning || !novelChunks.length}
                    title="忽略已完成摘要，覆盖全部重跑"
                  >
                    <RefreshCw size={13} /> 全局重跑
                  </button>
                  <button
                    onClick={handleStartSummary}
                    className="px-4 py-2 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-all text-[11px] font-black tracking-wider flex items-center gap-2"
                    disabled={isAiSummaryRunning || !novelChunks.length}
                  >
                    <Play size={14} /> 开始生成摘要
                  </button>
                  <button
                    onClick={handleStopSummary}
                    className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-all text-[11px] font-black tracking-wider flex items-center gap-2"
                    disabled={!isAiSummaryRunning}
                  >
                    <Square size={13} /> 停止生成
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-stone-500 font-bold tracking-wider mb-1">
                  <span>进度：{aiSummaryProgress.current}/{Math.max(1, aiSummaryProgress.total || novelChunks.length || 1)}</span>
                  <span>{isAiSummaryRunning ? '运行中' : '空闲'}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-stone-200/70 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, ((aiSummaryProgress.current || 0) / Math.max(1, aiSummaryProgress.total || novelChunks.length || 1)) * 100))}%`
                    }}
                  ></div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
              {filteredNovelChunks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-stone-400 font-serif opacity-70">
                  <FileText size={52} strokeWidth={1.2} className="mb-4" />
                  <p className="text-sm font-bold tracking-widest">没有可展示的小说切片</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredNovelChunks.map((chunk) => {
                    const expanded = summaryExpandedMap[chunk.id] === true;
                    const meta = chunk.ai_metadata || null;
                    return (
                      <div key={chunk.id} className="bg-white/80 border border-stone-200 rounded-2xl p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[10px] font-black tracking-widest text-stone-400 mb-1">
                              {chunk.chapterTitle || normalizeEntryTitle(chunk.title) || '未命名章节'} · 片段 {Number(chunk.chunkIndex || 0) + 1}
                            </div>
                            <div className="text-[10px] text-stone-500">{chunk.id}</div>
                          </div>
                          <button
                            onClick={() => toggleSummaryExpand(chunk.id)}
                            className="px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-500 hover:text-stone-900 text-[10px] font-bold tracking-wider flex items-center gap-1"
                          >
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {expanded ? '折叠' : '展开'}
                          </button>
                        </div>

                        {expanded && (
                          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div className="bg-stone-50/80 border border-stone-100 rounded-xl p-3">
                              <div className="text-[10px] font-black tracking-widest text-stone-500 mb-2">RAW TEXT</div>
                              <div className="text-sm leading-relaxed text-stone-700 whitespace-pre-wrap max-h-[280px] overflow-y-auto custom-scrollbar">
                                {chunk.text || '（空内容）'}
                              </div>
                            </div>
                            <div className="bg-sky-50/40 border border-sky-100 rounded-xl p-3">
                              <div className="text-[10px] font-black tracking-widest text-sky-700 mb-2">AI METADATA</div>
                              {meta ? (
                                <div className="space-y-2 text-xs text-stone-700">
                                  <div><span className="font-black text-stone-900">摘要：</span>{meta.summary || '（空）'}</div>
                                  <div className="bg-amber-50/80 border border-amber-100 rounded-lg p-2">
                                    <div className="font-black text-amber-900 text-[10px] tracking-wider mb-1">参考溯源 reference_thinking</div>
                                    {(() => {
                                      const prose = String(meta.reference_thinking || '').trim();
                                      if (prose) {
                                        return (
                                          <p className="text-[11px] text-stone-800 leading-relaxed whitespace-pre-wrap">{prose}</p>
                                        );
                                      }
                                      if (Array.isArray(meta.reference_trace) && meta.reference_trace.length > 0) {
                                        return (
                                          <div className="text-[11px] text-stone-600 space-y-1">
                                            <div className="text-stone-500">（旧版数组格式，建议重跑本段摘要）</div>
                                            {meta.reference_trace.map((row, ri) => (
                                              <div key={ri} className="leading-snug border-t border-amber-100/80 pt-1 first:border-0 first:pt-0">
                                                {String(row?.inference || '').trim() || '—'}
                                                {Array.isArray(row?.sources) && row.sources.length
                                                  ? ` ← ${row.sources.join('、')}`
                                                  : ''}
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      }
                                      return (
                                        <div className="text-[11px] text-stone-500 leading-relaxed">
                                          暂无。请重新生成本段摘要；模型须输出自然语言字段 reference_thinking（说明综合了哪些材料、结论依据哪几处）。
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div><span className="font-black text-stone-900">时间定位：</span>{String(meta.story_time_note || '').trim() || '（空）'}</div>
                                  <div><span className="font-black text-stone-900">人物：</span>{Array.isArray(meta.characters_present) ? meta.characters_present.join('、') : '（空）'}</div>
                                  <div><span className="font-black text-stone-900">地点：</span>{Array.isArray(meta.locations) ? meta.locations.join('、') : '（空）'}</div>
                                  <div><span className="font-black text-stone-900">关键事件：</span>{Array.isArray(meta.key_events) ? meta.key_events.join('；') : '（空）'}</div>
                                  {meta.contextHints && (
                                    <div className="text-[10px] text-stone-600 leading-relaxed bg-white/60 border border-sky-100/80 rounded-lg p-2 mb-2">
                                      <div className="font-black text-stone-800 mb-1">本轮注入（摘要生成请求侧）</div>
                                      <div>
                                        前序已生成摘要：{meta.contextHints.prevSummariesNear?.length ?? meta.ragStats?.neighborPrevWithSummary ?? 0} 段 ·
                                        后续原文：{meta.contextHints.nextOriginalsNear?.length ?? meta.ragStats?.neighborNextOriginal ?? 0} 段
                                      </div>
                                      <div className="mt-1 text-stone-500">
                                        档案对谈左侧「上下文预览」只展示对话注入，不包含本摘要流水线。远距匹配说明见下「向量说明」或 meta.contextHints.vectorMatchDescription。
                                      </div>
                                    </div>
                                  )}
                                  {meta.contextHints?.vectorMatchDescription && (
                                    <div className="text-[10px] text-stone-500 leading-snug mb-2 whitespace-pre-wrap">
                                      <span className="font-black text-stone-700">向量说明：</span>
                                      {meta.contextHints.vectorMatchDescription}
                                    </div>
                                  )}
                                  <div className="pt-2 border-t border-sky-100">
                                    <span className="font-black text-stone-900">RAG命中：</span>
                                    {`${meta.ragStats?.total ?? (Array.isArray(meta.ragRefs) ? meta.ragRefs.length : 0)} 条`}
                                    {`（小说 ${meta.ragStats?.novel ?? ((meta.ragRefs || []).filter(r => r.type === 'novel').length)} / 笔记 ${meta.ragStats?.scrapbook ?? ((meta.ragRefs || []).filter(r => r.type === 'scrapbook').length)} / 强制梗概 ${meta.ragStats?.mandatoryChapterSummary ?? 0}）`}
                                  </div>
                                  {Array.isArray(meta.ragRefs) && meta.ragRefs.length > 0 && (
                                    <div className="max-h-28 overflow-y-auto custom-scrollbar bg-white/70 border border-sky-100 rounded-lg p-2">
                                      {meta.ragRefs.slice(0, 12).map((ref, idx) => (
                                        <div key={`${ref.id || idx}_${idx}`} className="text-[11px] leading-relaxed text-stone-600">
                                          {idx + 1}. [{ref.type}] {ref.title || ref.id || '未命名命中'}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-stone-500">尚未生成摘要</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScrapbookView;
