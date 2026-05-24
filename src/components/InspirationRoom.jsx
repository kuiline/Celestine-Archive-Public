import { useEffect, useRef, useState } from 'react';
import { Send, RefreshCw, Sparkles, Layers, MessageCircle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  parseIdeaDraftMessage,
  getReadableText,
  normalizeTags
} from '../appHelpers';
import {
  INSPIRATION_FIRST_COUNTS,
  INSPIRATION_FOLLOW_COUNTS,
  INSPIRATION_CHAR_MAX,
  collectInspirationHits,
  buildInspirationUserPayload,
  mergeInspirationChunkMap,
  buildInspirationRagQuery
} from '../inspirationRoomApi';
import { mergeChatCompletionThinking } from '../llmThinking.js';
import { buildInspirationContextPreview } from '../chatContextPreview';

function buildInspirationSystemPrompt(ideaCultivatePrompt) {
  return [
    ideaCultivatePrompt,
    '输出必须是 JSON，不要 Markdown，不要解释。',
    'JSON 结构固定为 {"title":"","text":"","question":"","references":[],"rationale":""}。',
    'references 要列出本次确实参考的内容来源，简短字符串数组。',
    'rationale 只写可审计的推演摘要，不要展示私有思维链。'
  ].join('\n');
}

function formatAssistantBubble(draft) {
  const title = String(draft?.title || '').trim();
  const text = String(draft?.text || '').trim();
  const q = String(draft?.question || '').trim();
  const lines = [];
  if (title) lines.push(title);
  if (text) lines.push(text);
  if (q) lines.push(`追问：${q}`);
  return lines.join('\n\n');
}

function messageDisplayText(msg) {
  if (msg?.inspirationPayload) return formatAssistantBubble(msg.inspirationPayload);
  const parsed = parseIdeaDraftMessage(typeof msg?.content === 'string' ? msg.content : '');
  if (parsed) return formatAssistantBubble(parsed);
  return getReadableText(msg?.content) || '';
}

function getPayloadForSave(msg) {
  if (msg?.inspirationPayload) return msg.inspirationPayload;
  const parsed = parseIdeaDraftMessage(typeof msg?.content === 'string' ? msg.content : '');
  return parsed || null;
}

const InspirationRoom = ({
  onClose,
  activeSessionId,
  messages,
  inspirationChunkMap,
  inspirationFirstSeed,
  patchSession,
  activeTextEndpoint,
  ragConfig,
  referenceConfig,
  ideaCultivatePrompt,
  resolvedChar,
  safeCharacters,
  onSaveToScrapbook,
  setShowAiSettings,
  generateTitle,
  onInspirationPreviewUpdate,
  setReferenceConfig
}) => {
  const chunkMap = inspirationChunkMap || {};
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ragPanelOpen, setRagPanelOpen] = useState(true);
  const firstSeedRef = useRef(inspirationFirstSeed || '');
  const bottomRef = useRef(null);

  useEffect(() => {
    firstSeedRef.current = inspirationFirstSeed || '';
  }, [inspirationFirstSeed, activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const runAssistantModel = async (sys, userPayload, mapForRefs) => {
    const res = await fetch(activeTextEndpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeTextEndpoint.key}` },
      body: JSON.stringify(
        mergeChatCompletionThinking(activeTextEndpoint, {
          model: activeTextEndpoint.model,
          temperature: 0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userPayload }
          ]
        })
      )
    });
    if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = {};
    }
    const sliceRefs = Object.values(mapForRefs || {})
      .slice(0, 8)
      .map((h) => `${h.type || 'slice'}:${h.title || h.id || ''}`);
    const defaultRefs = [`角色设定:${resolvedChar?.name || '未知角色'}`, ...sliceRefs].filter(Boolean);
    return {
      title: String(parsed.title || '新设定草稿').trim(),
      text: String(parsed.text || '').trim(),
      question: String(parsed.question || '这个细节更偏地理设定，还是仪式遗留？').trim(),
      references: Array.isArray(parsed.references) && parsed.references.length > 0 ? parsed.references.map((v) => String(v)) : defaultRefs,
      rationale: String(parsed.rationale || '基于底层切片库进行扩写，并保留可继续迭代的开放问题。').trim()
    };
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!activeTextEndpoint?.key) {
      alert('请先配置文本模型 API Key！');
      setShowAiSettings?.(true);
      return;
    }

    const prevMsgs = messages || [];
    const isFirstRound = prevMsgs.length === 0;
    if (isFirstRound) firstSeedRef.current = text;

    const userMsg = { role: 'user', content: text };
    const nextAfterUser = [...prevMsgs, userMsg];
    setInput('');
    setLoading(true);
    patchSession({ messages: nextAfterUser, inspirationFirstSeed: firstSeedRef.current || text });

    if (isFirstRound && generateTitle && activeTextEndpoint?.key) {
      generateTitle(activeSessionId, text, activeTextEndpoint);
    }

    try {
      let mergedMap = { ...chunkMap };
      const existingIds = Object.keys(mergedMap);
      if (referenceConfig?.useRagContext) {
        const counts = isFirstRound
          ? (referenceConfig.inspirationRagFirst || INSPIRATION_FIRST_COUNTS)
          : (referenceConfig.inspirationRagFollow || INSPIRATION_FOLLOW_COUNTS);
        const charMax = referenceConfig.inspirationCharMax ?? INSPIRATION_CHAR_MAX;
        const q = buildInspirationRagQuery(firstSeedRef.current, nextAfterUser, '');
        const hits = await collectInspirationHits(q, ragConfig, counts, existingIds, charMax);
        mergedMap = mergeInspirationChunkMap(mergedMap, hits);
      }

      const userPayload = buildInspirationUserPayload({
        chunkMap: mergedMap,
        messages: nextAfterUser.slice(0, -1),
        resolvedChar,
        safeCharacters,
        mode: 'chat',
        userLine: text,
        refineFeedback: '',
        refineDraftText: ''
      });

      const sys = buildInspirationSystemPrompt(ideaCultivatePrompt);
      onInspirationPreviewUpdate?.({
        preview: buildInspirationContextPreview({
          systemPrompt: sys,
          userPayload,
          chunkMap: mergedMap,
          safeCharacters,
          useRagContext: !!referenceConfig?.useRagContext
        }),
        fullPrompt: `${sys}\n\n────────────  user  ────────────\n\n${userPayload}`
      });

      const draft = await runAssistantModel(sys, userPayload, mergedMap);
      const roleTag = resolvedChar?.name ? `角色:${resolvedChar.name}` : '';
      const draftPayload = { ...draft, seedText: firstSeedRef.current, tags: normalizeTags([roleTag]) };
      const displayText = formatAssistantBubble(draftPayload);
      const assistantMsg = {
        role: 'assistant',
        content: displayText,
        inspirationPayload: draftPayload
      };
      const finalMsgs = [...nextAfterUser, assistantMsg];
      patchSession({
        messages: finalMsgs,
        inspirationChunkMap: mergedMap,
        inspirationFirstSeed: firstSeedRef.current
      });
    } catch (e) {
      patchSession({
        messages: [...nextAfterUser, { role: 'assistant', content: `[发生错误] ${e.message}` }],
        inspirationChunkMap: chunkMap,
        inspirationFirstSeed: firstSeedRef.current
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (!confirm('清空本会话对话与底层切片？')) return;
    firstSeedRef.current = '';
    onInspirationPreviewUpdate?.({ preview: null, fullPrompt: '' });
    patchSession({ messages: [], inspirationChunkMap: {}, inspirationFirstSeed: '' });
  };

  const sliceCount = Object.keys(chunkMap || {}).length;
  const list = messages || [];
  const rc = referenceConfig || {};
  const patchRef = (patch) => setReferenceConfig?.({ ...rc, ...patch });
  const firstCounts = rc.inspirationRagFirst || INSPIRATION_FIRST_COUNTS;
  const followCounts = rc.inspirationRagFollow || INSPIRATION_FOLLOW_COUNTS;
  const patchTriplet = (key, field, raw) => {
    const n = Math.max(0, Math.min(field === 'summary' ? 60 : 24, parseInt(String(raw), 10) || 0));
    const cur = { ...(key === 'first' ? firstCounts : followCounts) };
    cur[field] = n;
    patchRef(key === 'first' ? { inspirationRagFirst: cur } : { inspirationRagFollow: cur });
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#fefcf8]/95 font-serif ring-1 ring-amber-100/60">
      <div className="shrink-0 px-4 py-3 border-b border-amber-100/80 bg-gradient-to-r from-amber-50/90 to-stone-50/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={18} className="text-amber-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-black tracking-widest text-stone-800 truncate">灵感交流室</div>
            <div className="text-[9px] font-bold text-stone-500 flex items-center gap-2 mt-0.5">
              <Layers size={11} className="shrink-0" />
              <span>底层切片 {sliceCount} 条（去重累计）</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
          >
            清空
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            title="返回档案对谈"
          >
            <MessageCircle size={14} />
            返回对谈
          </button>
        </div>
      </div>

      {setReferenceConfig && (
        <div className="shrink-0 border-b border-amber-100/70 bg-amber-50/40">
          <button
            type="button"
            onClick={() => setRagPanelOpen((o) => !o)}
            className="w-full px-4 py-2 flex items-center justify-between gap-2 text-left hover:bg-amber-50/90 transition-colors"
          >
            <span className="text-[11px] font-black tracking-widest text-amber-900/90 flex items-center gap-1.5">
              {ragPanelOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
              向量检索条数（与左侧预览列同步）
            </span>
            <span className="text-[9px] font-bold text-stone-500 truncate max-w-[45%]">
              首轮 {firstCounts.novel}/{firstCounts.scrapbook}/{firstCounts.summary} · 后续 {followCounts.novel}/{followCounts.scrapbook}/{followCounts.summary}
            </span>
          </button>
          {ragPanelOpen && (
            <div className="px-4 pb-3 space-y-3">
              <label className="flex items-center gap-2 text-[11px] font-bold text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-stone-300 text-amber-700"
                  checked={rc.useRagContext !== false}
                  onChange={(e) => patchRef({ useRagContext: e.target.checked })}
                />
                启用每轮向量检索（关闭则不再追加切片，仅保留已有 chunkMap）
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-amber-100 bg-white/80 p-3 shadow-sm">
                  <div className="text-[9px] font-black uppercase tracking-wider text-stone-500 mb-2">首轮（尚无消息时）</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['novel', '剧情原文'],
                      ['scrapbook', '手札'],
                      ['summary', '剧情摘要'],
                    ].map(([field, lab]) => (
                      <label key={field} className="flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-stone-400">{lab}</span>
                        <input
                          type="number"
                          min={0}
                          max={field === 'summary' ? 60 : 24}
                          value={firstCounts[field]}
                          onChange={(e) => patchTriplet('first', field, e.target.value)}
                          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-1.5 py-1 text-xs font-mono font-bold text-center"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-100 bg-white/80 p-3 shadow-sm">
                  <div className="text-[9px] font-black uppercase tracking-wider text-stone-500 mb-2">后续轮</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['novel', '剧情原文'],
                      ['scrapbook', '手札'],
                      ['summary', '剧情摘要'],
                    ].map(([field, lab]) => (
                      <label key={field} className="flex flex-col gap-0.5">
                        <span className="text-[8px] font-bold text-stone-400">{lab}</span>
                        <input
                          type="number"
                          min={0}
                          max={field === 'summary' ? 60 : 24}
                          value={followCounts[field]}
                          onChange={(e) => patchTriplet('follow', field, e.target.value)}
                          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-1.5 py-1 text-xs font-mono font-bold text-center"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <label className="flex flex-col gap-1 max-w-xs">
                <span className="text-[10px] font-bold text-stone-600">角色资料命中上限（姓名匹配档案，0 表示不检索）</span>
                <input
                  type="number"
                  min={0}
                  max={48}
                  value={rc.inspirationCharMax ?? INSPIRATION_CHAR_MAX}
                  onChange={(e) => patchRef({ inspirationCharMax: parseInt(e.target.value, 10) || 0 })}
                  className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-mono font-bold w-24"
                />
              </label>
              <p className="text-[9px] text-stone-500 leading-relaxed">
                修改后立即生效；会与存档中的「参考配置」一并保存（Ctrl+S 或关闭前保存）。
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar">
        {list.length === 0 && (
          <div className="text-center text-stone-500 text-sm py-10 px-4 leading-relaxed">
            与档案对谈<strong className="text-stone-700">同级</strong>的对话模式：按轮检索并累积底层切片，回复以自然段落展示。
          </div>
        )}
        {list.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              {isUser ? (
                <div className="max-w-[88%] p-4 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap bg-slate-900 text-white shadow-lg font-sans">
                  {getReadableText(msg.content)}
                </div>
              ) : (
                <div className="max-w-[92%] p-4 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-stone-800 bg-white/70 backdrop-blur-md border border-stone-200/80 shadow-sm whitespace-pre-wrap">
                  {messageDisplayText(msg)}
                  {getPayloadForSave(msg) && (
                    <button
                      type="button"
                      onClick={() =>
                        onSaveToScrapbook?.({
                          title: getPayloadForSave(msg).title,
                          text: getPayloadForSave(msg).text,
                          tagsText: ''
                        })
                      }
                      className="mt-3 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500"
                    >
                      存入手札
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800/80">
            <RefreshCw size={14} className="animate-spin" />
            检索并思考中…
          </div>
        )}
        <div ref={bottomRef} className="h-1" />
      </div>

      <div className="shrink-0 p-3 sm:p-4 border-t border-amber-100/80 bg-white/90 backdrop-blur-md">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入想法，Enter 发送…"
            rows={2}
            disabled={loading}
            className="flex-1 min-h-[48px] max-h-36 py-3 px-4 bg-stone-50 border border-stone-200 outline-none rounded-2xl text-sm resize-y custom-scrollbar font-sans shadow-inner focus:border-amber-300 placeholder-stone-400"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-12 h-12 shrink-0 bg-amber-700 text-white rounded-2xl flex items-center justify-center hover:bg-amber-800 disabled:opacity-35 transition-all shadow-md active:scale-95"
            title="发送"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InspirationRoom;
