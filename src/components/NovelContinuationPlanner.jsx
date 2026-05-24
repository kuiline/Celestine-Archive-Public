import React, { useEffect, useMemo, useState } from 'react';
import { X, Send, Sparkles, Loader2, Check, BookOpen, GitBranch, Circle, RotateCcw } from 'lucide-react';
import {
  NOVEL_PLANNER_STORAGE_PREFIX,
  mergeChunkMap,
  formatSummaryHitsBlock,
  formatScrapbookHitsBlock,
  formatCharacterHitsBlock,
  formatTempScrapbookBlocks,
  buildPhase1SystemPrompt,
  buildPhase1UserPayload,
  buildPhase2SystemPrompt,
  buildPhase3SystemPrompt,
  buildPhase3UserPayload,
  callTextModelJson,
  callPhase2Messages,
  extractFeedbackKeywords,
  loadPlannerDraft,
  savePlannerDraft,
  clearPlannerDraft,
  fetchPlannerCollect,
  getChunkIdsForRagExclude,
  slicePlannerSilentAnchor
} from '../novelPlannerApi';
import { buildPlannerCollectPayload } from '../novelPlannerSettings';
import { mergeChatCompletionThinking } from '../llmThinking.js';

function splitLocalParagraphs(beforeText, afterText) {
  const left = String(beforeText || '').slice(-1200);
  const right = String(afterText || '').slice(0, 600);
  const center = [left, right].filter(Boolean).join('\n');
  const parts = center
    .split(/\n{2,}|[。！？!?]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(-3);
}

function extractKeywordBundleFromParagraphs(paragraphs) {
  const text = (paragraphs || []).join(' ');
  const stop = new Set(['然后', '但是', '因为', '我们', '你们', '他们', '已经', '这个', '那个', '这里', '那里', '如果', '不是', '就是', '以及', '一个', '一种']);
  const names = [...new Set((text.match(/[\u4e00-\u9fa5]{2,4}/g) || []).filter((w) => !stop.has(w)))].slice(0, 10);
  const words = [...new Set((text.match(/[\u4e00-\u9fa5]{2,6}/g) || []).filter((w) => !stop.has(w)))].slice(0, 16);
  return {
    summary: text.slice(0, 320),
    names,
    words
  };
}

function buildFocusedVectorQuery(chapterTitle, beforeText, afterText) {
  const paragraphs = splitLocalParagraphs(beforeText, afterText);
  const bundle = extractKeywordBundleFromParagraphs(paragraphs);
  return [
    `章节:${chapterTitle || '未命名章节'}`,
    `焦点段落摘要:${bundle.summary || String(beforeText || '').slice(-180) || '（空）'}`,
    `角色候选:${bundle.names.join('、') || '（未识别）'}`,
    `核心关键词:${bundle.words.join('、') || '（未识别）'}`
  ].join('\n');
}

function formatRecursiveThinking(recursiveThinking) {
  if (!recursiveThinking) return '';
  if (typeof recursiveThinking === 'string') return recursiveThinking;
  try {
    const rt = recursiveThinking || {};
    const roles = Array.isArray(rt.involved_characters)
      ? rt.involved_characters
          .map((c) => `${c?.name || '未知角色'}：${c?.persona || '性格未填'}；当前动机=${c?.current_motivation || '未填'}`)
          .join('\n')
      : '';
    const focus = Array.isArray(rt.dictionary_focus) ? rt.dictionary_focus.join('、') : '';
    return [
      `时间节点：${rt.timeline_checkpoint || '（未填）'}`,
      `当前动作：${rt.current_action || '（未填）'}`,
      `前序动作：${rt.previous_action || '（未填）'}`,
      `续写截断点：${rt.cut_point || '（未填）'}`,
      `涉及角色：\n${roles || '（未填）'}`,
      `设定焦点词：${focus || '（未填）'}`,
      `上轮失败原因：${rt.why_previous_versions_failed || '（未填）'}`
    ].join('\n');
  } catch (e) {
    return String(recursiveThinking);
  }
}

function toDebugCollectPayload(body, chapterTitle) {
  const raw = String(body?.novelContent || '');
  return {
    chapterTitle: chapterTitle || '',
    chapterIndex: body?.chapterIndex,
    chapterIndex1Based: body?.chapterIndex1Based,
    chapterScopeType: body?.chapterScopeType || 'main',
    chapterWorkId: body?.chapterWorkId || 'main',
    cursorInChapter: body?.cursorInChapter,
    referenceChars: body?.referenceChars,
    plannerCollect: body?.plannerCollect,
    existingChunkIdsCount: Array.isArray(body?.existingChunkIds) ? body.existingChunkIds.length : 0,
    phase: body?.phase,
    vectorQuery: body?.vectorQuery,
    feedbackText: body?.feedbackText || '',
    feedbackKeywords: body?.feedbackKeywords || [],
    novelContentPreview: {
      length: raw.length,
      head: raw.slice(0, 260),
      tail: raw.slice(-260)
    }
  };
}

function extractXmlBlock(text, tag) {
  const raw = String(text || '');
  const m = raw.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
  return m ? String(m[1] || '').trim() : '';
}

function countByRegex(text, pattern) {
  const src = String(text || '');
  const matches = src.match(pattern);
  return Array.isArray(matches) ? matches.length : 0;
}

function clipText(text, limit = 180) {
  const s = String(text || '').trim();
  if (!s) return '（空）';
  return s.length > limit ? `${s.slice(0, limit)}...` : s;
}

/** 与发往 LLM 的 messages 一致：按条累加各 role 的 content 字符数 */
function sumChatMessagesCharLength(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let total = 0;
  let system = 0;
  let user = 0;
  let assistant = 0;
  for (const m of list) {
    const n = String(m?.content ?? '').length;
    total += n;
    const r = m?.role;
    if (r === 'system') system += n;
    else if (r === 'user') user += n;
    else if (r === 'assistant') assistant += n;
  }
  return { total, system, user, assistant, messageCount: list.length };
}

function MessagesLengthBadge({ messages, className = '' }) {
  const s = sumChatMessagesCharLength(messages);
  if (!s.messageCount) {
    return (
      <div className={`text-[10px] text-stone-400 mb-1 ${className}`}>长度：尚无 messages</div>
    );
  }
  return (
    <div
      className={`text-[10px] text-amber-900/85 mb-1 font-mono tabular-nums leading-relaxed ${className}`}
      title="各条 message 的 content 字符数之和（与 API 请求体中的文本量一致；非 token）"
    >
      长度：合计 {s.total.toLocaleString()} 字 · system {s.system.toLocaleString()} · user {s.user.toLocaleString()} ·
      assistant {s.assistant.toLocaleString()} · 条数 {s.messageCount}
    </div>
  );
}

function simplifyHits(list) {
  return (Array.isArray(list) ? list : []).map((h) => ({
    id: h?.id || '',
    title: h?.title || '',
    name: h?.name || '',
    chapterKey: h?.chapterKey || '',
    pieceIndex: Number.isFinite(h?.pieceIndex) ? h.pieceIndex : null,
    score: Number.isFinite(h?.score) ? Number(h.score) : null
  }));
}

function toReadableHitLine(hit, idx) {
  const no = String(idx + 1).padStart(2, '0');
  const chapter = hit?.chapterKey ? `章:${hit.chapterKey}` : '';
  const piece = Number.isFinite(hit?.pieceIndex) ? `段:${hit.pieceIndex + 1}` : '';
  const title = String(hit?.title || '').trim();
  const name = String(hit?.name || '').trim();
  const label = title || name || hit?.id || '未命名';
  const meta = [chapter, piece].filter(Boolean).join(' · ');
  const score = Number.isFinite(hit?.score) ? ` · score=${Number(hit.score).toFixed(4)}` : '';
  return `#${no} ${label}${meta ? ` [${meta}]` : ''}${score}\n    id=${hit?.id || '未知'}`;
}

export default function NovelContinuationPlanner({
  open,
  onClose,
  activeTextEndpoint,
  ragConfig,
  scrapbook,
  chapterIndex1Based,
  chapterIndex0,
  chapterScopeType = 'main',
  chapterWorkId = 'main',
  chapterId,
  chapterTitle,
  novelContent,
  cursorInChapter,
  beforeText,
  afterText,
  referenceChars,
  /** 星辰续写设置中的展示名（打开规划时快照，与简单续写模式无关） */
  plannerLabel = '',
  /** 服务端 planner/collect 的摘要/笔记条数与候选池等（打开面板时快照） */
  plannerCollect = {},
  targetLength,
  cursorPos,
  onGenerateComplete,
  isBusy,
  setBusy,
  /** 可选：返回当前编辑器下光标前全文（含跨章补足），用于阶段 2 静默锚点；不传则用打开面板时的 beforeText */
  getSilentAnchorBeforeText
}) {
  const effectiveCollect = useMemo(
    () => buildPlannerCollectPayload(plannerCollect || {}),
    [JSON.stringify(plannerCollect || {})]
  );

  const [error, setError] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [chunkMap, setChunkMap] = useState({});
  const [neighborSummaryMap, setNeighborSummaryMap] = useState({});
  const [feedback, setFeedback] = useState('');
  const [selectedVid, setSelectedVid] = useState('v1');
  const [phase, setPhase] = useState('idle');
  const [flowEvents, setFlowEvents] = useState([]);
  const [liveStep, setLiveStep] = useState(null);
  const [debugPayloads, setDebugPayloads] = useState({
    collectPhase1: null,
    collectPhase1Response: null,
    modelPhase1: null,
    keywordExtraction: null,
    collectPhase2: null,
    collectPhase2Response: null,
    modelPhase2: null,
    modelPhase3: null
  });
  /** 递增则强制跳过草稿、重新执行阶段 1（与 storageKey 组合，避免误恢复） */
  const [restartNonce, setRestartNonce] = useState(0);

  const pushFlow = (title, detail) => {
    setFlowEvents((prev) => [...prev, { ts: Date.now(), title, detail: detail || '' }]);
  };

  const storageKey = useMemo(
    () => (chapterId != null ? `${NOVEL_PLANNER_STORAGE_PREFIX}:${chapterId}:${Math.floor(Number(cursorPos) / 64)}` : ''),
    [chapterId, cursorPos]
  );

  const vectorQuery = useMemo(
    () => buildFocusedVectorQuery(chapterTitle, beforeText, afterText),
    [chapterTitle, beforeText, afterText]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRounds([]);
    setChunkMap({});
    setNeighborSummaryMap({});
    setFeedback('');
    setSelectedVid('v1');
    setError(null);
    setFlowEvents([]);
    setLiveStep(null);
    setPhase('idle');
    setDebugPayloads({
      collectPhase1: null,
      collectPhase1Response: null,
      modelPhase1: null,
      keywordExtraction: null,
      collectPhase2: null,
      collectPhase2Response: null,
      modelPhase2: null,
      modelPhase3: null
    });

    const draft = loadPlannerDraft(storageKey);
    if (
      draft &&
      draft.chapterId === chapterId &&
      Array.isArray(draft.rounds) &&
      draft.rounds.length > 0 &&
      draft.chunkMap
    ) {
      setChunkMap(draft.chunkMap);
      setNeighborSummaryMap(draft.neighborSummaryMap || {});
      setRounds(draft.rounds);
      setPhase('loop');
      setFlowEvents([
        {
          ts: Date.now(),
          title: '恢复会话',
          detail: '已从本机草稿恢复规划状态（未重新执行检索与审题）。'
        }
      ]);
      return;
    }

    (async () => {
      if (!activeTextEndpoint?.key) {
        setError('请先在设置中配置文本模型 API Key');
        return;
      }
      setBusy(true);
      setPhase('init');
      pushFlow(
        '阶段 1 · 审题',
        `卷录 ${chapterIndex1Based} · 星辰参数「${String(plannerLabel || '默认').trim() || '默认'}」· 光标前参考 ${referenceChars} 字（含跨章补足）`
      );
      try {
        setLiveStep(
          `服务端聚合：摘要 RAG 目标 ${effectiveCollect.phase1Summary} + 笔记向量 ${effectiveCollect.phase1Scrapbook}（候选池 ${effectiveCollect.phase1SearchPool}）+ 角色 + 梗概…`
        );
        const collectPhase1Body = {
          novelContent: String(novelContent || ''),
          chapterIndex: chapterIndex0 ?? 0,
          cursorInChapter: Number(cursorInChapter) || 0,
          referenceChars,
          vectorQuery,
          ragConfig,
          phase: 1,
          chapterScopeType,
          chapterWorkId,
          chapterIndex1Based,
          plannerCollect: effectiveCollect,
          existingChunkIds: []
        };
        setDebugPayloads((prev) => ({ ...prev, collectPhase1: toDebugCollectPayload(collectPhase1Body, chapterTitle) }));
        const col = await fetchPlannerCollect(collectPhase1Body);
        setDebugPayloads((prev) => ({
          ...prev,
          collectPhase1Response: {
            summaryHits: simplifyHits(col?.summaryHits || col?.novelHits),
            mandatoryOutlineHits: simplifyHits(col?.mandatoryOutlineHits),
            scrapbookHits: simplifyHits(col?.scrapbookHits),
            characterHits: simplifyHits(col?.characterHits),
            feedbackKeywords: col?.feedbackKeywords || []
          }
        }));
        if (cancelled) return;

        const { excludeIds, summaryHits, novelHits, mandatoryOutlineHits, scrapbookHits, characterHits } = col;
        const summaryRows = summaryHits || novelHits || [];
        pushFlow('续写窗排除', `与光标前 ${referenceChars} 字重叠片段 id：${excludeIds.length} 个`);
        pushFlow('摘要切片', `摘要 RAG 命中 ${summaryRows?.length || 0} 片（目标 ${effectiveCollect.phase1Summary}）`);
        pushFlow(
          '笔记',
          `必选梗概块 ${mandatoryOutlineHits?.length || 0}；补充向量 ${scrapbookHits?.length || 0} 片（目标 ${effectiveCollect.phase1Scrapbook}）`
        );
        pushFlow('角色资料', `命中 ${characterHits?.length || 0} 名角色（背景/展示短句等）`);

        const merged = mergeChunkMap(
          {},
          [...(mandatoryOutlineHits || []), ...(summaryRows || []), ...(scrapbookHits || []), ...(characterHits || [])]
        );
        setChunkMap(merged);
        const nmap = {};
        setNeighborSummaryMap({});

        const mandatoryOutlineBlock = formatScrapbookHitsBlock(mandatoryOutlineHits);
        const summaryBlock = formatSummaryHitsBlock(summaryRows);
        const scrapbookBlock = formatScrapbookHitsBlock(scrapbookHits);
        const characterBlock = formatCharacterHitsBlock(characterHits);

        const userPayload = buildPhase1UserPayload({
          beforeText,
          referenceChars,
          mandatoryOutlineBlock,
          summaryBlock,
          scrapbookBlock,
          characterBlock
        });

        const sys = buildPhase1SystemPrompt();
        setDebugPayloads((prev) => ({
          ...prev,
          modelPhase1: {
            model: activeTextEndpoint?.model,
            temperature: 0.65,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: userPayload }
            ]
          }
        }));
        setLiveStep('调用文本模型：JSON（局势摘要 + 三版四段节拍）…');
        const payload = await callTextModelJson(activeTextEndpoint, sys, userPayload, 0.65);
        if (cancelled) return;
        setRounds([{ type: 'assistant', payload }]);
        setPhase('loop');
        pushFlow('审题完成', `载荷约 ${userPayload.length} 字符`);
        savePlannerDraft(storageKey, {
          chapterId,
          cursorBucket: Math.floor(Number(cursorPos) / 64),
          chunkMap: merged,
          neighborSummaryMap: nmap,
          rounds: [{ type: 'assistant', payload }]
        });
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e));
          setPhase('idle');
          pushFlow('错误', String(e.message || e));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          setLiveStep(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    storageKey,
    chapterId,
    activeTextEndpoint,
    ragConfig,
    chapterIndex1Based,
    chapterIndex0,
    chapterScopeType,
    chapterWorkId,
    chapterTitle,
    beforeText,
    referenceChars,
    plannerLabel,
    JSON.stringify(plannerCollect || {}),
    cursorPos,
    cursorInChapter,
    novelContent,
    vectorQuery,
    setBusy,
    restartNonce
  ]);

  const handleRestartSession = () => {
    if (!storageKey || isBusy) return;
    clearPlannerDraft(storageKey);
    setRestartNonce((n) => n + 1);
  };

  const latestAssistant = useMemo(() => {
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].type === 'assistant') return rounds[i].payload;
    }
    return null;
  }, [rounds]);

  const handleSendFeedback = async () => {
    const text = feedback.trim();
    if (!text || !activeTextEndpoint?.key) return;
    if (!latestAssistant) return;
    setBusy(true);
    setError(null);
    pushFlow(
      '阶段 2 · 轮回',
      `意见 ${text.length} 字；摘要目标 ${effectiveCollect.phase2Summary}、笔记 ${effectiveCollect.phase2Scrapbook}（向量池 ${effectiveCollect.phase2SearchPool}，关键词补 ${effectiveCollect.phase2KeywordExtra}）+ 静默锚点`
    );
    try {
      setLiveStep('轻量模型提取反馈关键词…');
      let feedbackKeywords = [];
      try {
        feedbackKeywords = await extractFeedbackKeywords(activeTextEndpoint, text);
        setDebugPayloads((prev) => ({
          ...prev,
          keywordExtraction: {
            model: activeTextEndpoint?.keywordModel || activeTextEndpoint?.lightweightModel || activeTextEndpoint?.model,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  '你是关键词提取器。只输出 JSON。\n从用户反馈中提取可用于设定检索的关键词，优先保留：角色名、地点、组织、能力、事件、情绪诉求、纠错意图。'
              },
              {
                role: 'user',
                content: `请输出结构：{"keywords":["词1","词2"],"why_failed":"一句话说明用户为什么不满意上轮方案"}\nkeywords 数量 4-10，去重，不要短于2个字，不要废话。\n用户反馈：${text}`
              }
            ],
            extracted_keywords: feedbackKeywords
          }
        }));
      } catch (kwErr) {
        pushFlow('关键词提取回退', String(kwErr?.message || kwErr));
        feedbackKeywords = [];
      }

      setLiveStep('planner/collect phase=2…');
      const collectPhase2Body = {
        novelContent: String(novelContent || ''),
        chapterIndex: chapterIndex0 ?? 0,
        cursorInChapter: Number(cursorInChapter) || 0,
        referenceChars,
        vectorQuery,
        ragConfig,
        phase: 2,
        chapterScopeType,
        chapterWorkId,
        feedbackText: text,
        feedbackKeywords,
        chapterIndex1Based,
        plannerCollect: effectiveCollect,
        existingChunkIds: getChunkIdsForRagExclude(chunkMap)
      };
      setDebugPayloads((prev) => ({ ...prev, collectPhase2: toDebugCollectPayload(collectPhase2Body, chapterTitle) }));
      const col = await fetchPlannerCollect(collectPhase2Body);
      setDebugPayloads((prev) => ({
        ...prev,
        collectPhase2Response: {
          summaryHits: simplifyHits(col?.summaryHits || col?.novelHits),
          mandatoryOutlineHits: simplifyHits(col?.mandatoryOutlineHits),
          scrapbookHits: simplifyHits(col?.scrapbookHits),
          characterHits: simplifyHits(col?.characterHits),
          feedbackKeywords: col?.feedbackKeywords || []
        }
      }));

      const novelHits = col.summaryHits || col.novelHits || [];
      const scrapHits = col.scrapbookHits || [];
      const characterHits = col.characterHits || [];

      pushFlow('轮回检索', `关键词 ${feedbackKeywords.length} 个；摘要 ${novelHits.length} 片；笔记 ${scrapHits.length} 片；角色 ${characterHits.length}`);

      const merged = mergeChunkMap(chunkMap, [...novelHits, ...scrapHits, ...characterHits]);
      setChunkMap(merged);
      const mergedNeighborMap = {};
      const fullDictionary = formatTempScrapbookBlocks(merged);

      const anchorFull =
        typeof getSilentAnchorBeforeText === 'function' ? getSilentAnchorBeforeText() : beforeText;
      const silentAnchor = slicePlannerSilentAnchor(anchorFull, referenceChars);

      const nextRounds = [...rounds, { type: 'user', text }];
      const msgs = [{ role: 'system', content: buildPhase2SystemPrompt() }];
      const lastIdx = nextRounds.length - 1;
      for (let i = 0; i < nextRounds.length; i++) {
        const r = nextRounds[i];
        if (r.type === 'assistant') {
          msgs.push({ role: 'assistant', content: JSON.stringify(r.payload) });
        } else {
          let u = `<User_Round>\n<User_Absolute_Command>\n${r.text}\n</User_Absolute_Command>`;
          if (i === lastIdx) {
            u += `\n\n${fullDictionary}\n\n<Silent_Anchor>\n${silentAnchor || '（空）'}\n</Silent_Anchor>`;
          }
          u += '\n</User_Round>';
          msgs.push({ role: 'user', content: u });
        }
      }

      setDebugPayloads((prev) => ({
        ...prev,
        modelPhase2: {
          model: activeTextEndpoint?.model,
          temperature: 0.65,
          response_format: { type: 'json_object' },
          messages: msgs
        }
      }));
      setLiveStep('调用文本模型：吸收意见并重出 JSON…');
      const payload = await callPhase2Messages(activeTextEndpoint, msgs, 0.65);
      const finalRounds = [...nextRounds, { type: 'assistant', payload }];
      setRounds(finalRounds);
      setFeedback('');

      const nextNeighbor = mergedNeighborMap;
      setNeighborSummaryMap(nextNeighbor);

      savePlannerDraft(storageKey, {
        chapterId,
        cursorBucket: Math.floor(Number(cursorPos) / 64),
        chunkMap: merged,
        neighborSummaryMap: nextNeighbor,
        rounds: finalRounds
      });
      pushFlow('轮回完成', `用户轮次 ${finalRounds.filter((r) => r.type === 'user').length}`);
    } catch (e) {
      setError(e.message || String(e));
      pushFlow('错误', String(e.message || e));
    } finally {
      setBusy(false);
      setLiveStep(null);
    }
  };

  const handleGenerate = async () => {
    if (!latestAssistant?.versions || !activeTextEndpoint?.key) return;
    const ver = latestAssistant.versions.find((v) => v.id === selectedVid) || latestAssistant.versions[0];
    if (!ver) return;
    setBusy(true);
    setError(null);
    setPhase('generate');
    pushFlow('阶段 3 · 正文', `选用 ${ver.id}；累积切片 ${Object.keys(chunkMap).length}；摘要键 ${Object.keys(neighborSummaryMap).length}`);
    try {
      const sys = buildPhase3SystemPrompt(targetLength);
      const user = buildPhase3UserPayload({
        chunkMap,
        neighborSummaryMap,
        selectedVersion: ver,
        styleAnchor: beforeText.slice(-Math.max(200, Number(referenceChars) || 1000))
      });
      setDebugPayloads((prev) => ({
        ...prev,
        modelPhase3: {
          model: activeTextEndpoint?.model,
          temperature: 0.75,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ]
        }
      }));
      setLiveStep('终局请求：仅输出正文…');
      pushFlow('终局载荷', `约 ${user.length} 字符`);
      const res = await fetch(activeTextEndpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeTextEndpoint.key}` },
        body: JSON.stringify(
          mergeChatCompletionThinking(activeTextEndpoint, {
            model: activeTextEndpoint.model,
            temperature: 0.75,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: user }
            ]
          })
        )
      });
      if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const prose = String(data.choices?.[0]?.message?.content || '').trim();
      if (!prose) throw new Error('模型未返回正文');
      pushFlow('生成完毕', `正文约 ${prose.length} 字`);
      clearPlannerDraft(storageKey);
      onGenerateComplete?.(prose);
      onClose?.();
    } catch (e) {
      setError(e.message || String(e));
      pushFlow('错误', String(e.message || e));
    } finally {
      setBusy(false);
      setPhase('loop');
      setLiveStep(null);
    }
  };

  if (!open) return null;

  const phase1UserContent = String(debugPayloads?.modelPhase1?.messages?.[1]?.content || '');
  const phase1Mandatory = extractXmlBlock(phase1UserContent, 'Mandatory_Outline');
  const phase1Summary = extractXmlBlock(phase1UserContent, 'Summary_RAG');
  const phase1Scrap = extractXmlBlock(phase1UserContent, 'Scrapbook_Support');
  const phase1Chars = extractXmlBlock(phase1UserContent, 'Character_Profiles');
  const phase1Anchor = extractXmlBlock(phase1UserContent, 'Silent_Anchor');

  return (
    <div className="fixed z-[100] inset-0 flex items-center justify-center p-6 bg-stone-900/40 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-3xl max-h-[88vh] bg-[#fefcf8] border border-stone-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-black/5">
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 bg-white/90">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-600" />
            <span className="text-xs font-black tracking-[0.2em] text-stone-800 uppercase">星辰续写规划</span>
            <span className="text-[10px] text-stone-500 font-bold max-w-[min(22rem,56vw)] leading-snug">
              {String(plannerLabel || '').trim()
                ? `「${String(plannerLabel).trim()}」· `
                : ''}
              光标前 {Number(referenceChars) || 0} 字 · 目标约 {Number(targetLength) || 0} 字 · 剧情+笔记
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRestartSession}
              disabled={isBusy || !storageKey}
              className="p-2 rounded-xl text-stone-400 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-30"
              title="清空本机草稿并重新审题（阶段 1）"
            >
              <RotateCcw size={18} />
            </button>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="p-2 rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}

          <details className="group rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden" open>
            <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer list-none text-[10px] font-black tracking-widest text-slate-600 uppercase select-none hover:bg-slate-100/80">
              <GitBranch size={14} className="text-indigo-500 shrink-0" />
              执行流程（透明）
              <span className="ml-auto text-[9px] font-bold text-slate-400 normal-case tracking-normal">
                {flowEvents.length} 步
              </span>
            </summary>
            <div className="px-4 pb-3 pt-0 border-t border-slate-100/80 max-h-48 overflow-y-auto custom-scrollbar">
              {liveStep && (
                <div className="flex gap-2 py-2 text-[11px] text-indigo-700 border-b border-indigo-100/60 mb-1">
                  <Loader2 size={14} className="animate-spin shrink-0 mt-0.5 text-indigo-500" />
                  <span className="leading-relaxed">{liveStep}</span>
                </div>
              )}
              {flowEvents.length === 0 && !liveStep ? (
                <p className="text-[11px] text-slate-400 py-2">尚无记录；开始审题后将逐步显示。</p>
              ) : (
                <ul className="space-y-2 pt-2">
                  {flowEvents.map((ev, idx) => (
                    <li key={`${ev.ts}-${idx}`} className="flex gap-2 text-[11px] leading-relaxed">
                      <span className="text-slate-300 shrink-0 pt-0.5">
                        <Circle size={6} className="fill-indigo-400 text-indigo-400" />
                      </span>
                      <div>
                        <div className="font-bold text-slate-700">{ev.title}</div>
                        {ev.detail ? <div className="text-slate-500 mt-0.5 whitespace-pre-wrap break-words">{ev.detail}</div> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details className="group rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
            <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer list-none text-[10px] font-black tracking-widest text-amber-800 uppercase select-none hover:bg-amber-100/70">
              <BookOpen size={14} className="text-amber-600 shrink-0" />
              API Messages 可视化
              <span className="ml-auto text-[9px] font-bold text-amber-500 normal-case tracking-normal">
                Phase1 / Phase2 / Phase3
              </span>
            </summary>
            <div className="px-4 pb-3 pt-0 border-t border-amber-100/80 max-h-72 overflow-y-auto custom-scrollbar space-y-3">
              <div className="pt-2">
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Collect · Phase 1</div>
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.collectPhase1 || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Collect · Phase 1（模块化命中）</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">摘要切片</div>
                    <div>数量：{debugPayloads.collectPhase1Response?.summaryHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase1Response?.summaryHits || []).slice(0, 4).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">笔记切片</div>
                    <div>数量：{debugPayloads.collectPhase1Response?.scrapbookHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase1Response?.scrapbookHits || []).slice(0, 4).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">章节梗概（必选）</div>
                    <div>数量：{debugPayloads.collectPhase1Response?.mandatoryOutlineHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase1Response?.mandatoryOutlineHits || []).slice(0, 3).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">角色资料</div>
                    <div>数量：{debugPayloads.collectPhase1Response?.characterHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase1Response?.characterHits || []).slice(0, 4).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Model · Phase 1</div>
                <MessagesLengthBadge messages={debugPayloads.modelPhase1?.messages} />
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.modelPhase1 || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Model · Phase 1（模块拆解）</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">Summary_RAG</div>
                    <div>Chunk 数：{countByRegex(phase1Summary, /<Chunk\b/g)}</div>
                    <div className="mt-1">{clipText(phase1Summary)}</div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">Scrapbook_Support</div>
                    <div>Chunk 数：{countByRegex(phase1Scrap, /<Chunk\b/g)}</div>
                    <div className="mt-1">{clipText(phase1Scrap)}</div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">Character_Profiles</div>
                    <div>Profile 数：{countByRegex(phase1Chars, /<Profile\b/g)}</div>
                    <div className="mt-1">{clipText(phase1Chars)}</div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">Silent_Anchor</div>
                    <div>长度：{phase1Anchor.length}</div>
                    <div className="mt-1">{clipText(phase1Anchor, 220)}</div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700 md:col-span-2">
                    <div className="font-black text-amber-700 mb-1">Mandatory_Outline</div>
                    <div>Chunk 数：{countByRegex(phase1Mandatory, /<Chunk\b/g)}</div>
                    <div className="mt-1">{clipText(phase1Mandatory, 240)}</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Keyword Extraction</div>
                <MessagesLengthBadge messages={debugPayloads.keywordExtraction?.messages} />
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.keywordExtraction || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Collect · Phase 2</div>
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.collectPhase2 || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Collect · Phase 2（模块化命中）</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">摘要切片</div>
                    <div>数量：{debugPayloads.collectPhase2Response?.summaryHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase2Response?.summaryHits || []).slice(0, 4).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                  <div className="bg-white border border-amber-100 rounded-lg p-2 text-[10px] text-stone-700">
                    <div className="font-black text-amber-700 mb-1">笔记切片</div>
                    <div>数量：{debugPayloads.collectPhase2Response?.scrapbookHits?.length || 0}</div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {(debugPayloads.collectPhase2Response?.scrapbookHits || []).slice(0, 4).map((h, i) => toReadableHitLine(h, i)).join('\n') || '（无）'}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Model · Phase 2</div>
                <MessagesLengthBadge messages={debugPayloads.modelPhase2?.messages} />
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.modelPhase2 || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] font-black tracking-widest text-amber-700 uppercase mb-1">Model · Phase 3</div>
                <MessagesLengthBadge messages={debugPayloads.modelPhase3?.messages} />
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-white border border-amber-100 rounded-lg p-2 text-stone-700">
                  {JSON.stringify(debugPayloads.modelPhase3 || { hint: '尚未发送' }, null, 2)}
                </pre>
              </div>
            </div>
          </details>

          {phase === 'init' && isBusy && !latestAssistant && (
            <div className="flex items-center gap-3 text-stone-600 text-sm py-6 justify-center border border-dashed border-stone-200 rounded-xl bg-stone-50/50">
              <Loader2 className="animate-spin text-indigo-600" size={22} />
              <span>阶段 1 进行中…</span>
            </div>
          )}

          {latestAssistant && (
            <>
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="text-[10px] font-black text-stone-500 uppercase tracking-widest mb-2">递归思考（显式推演）</div>
                <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap">{formatRecursiveThinking(latestAssistant.recursive_thinking)}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {latestAssistant.versions?.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVid(v.id)}
                    className={`text-left p-4 rounded-xl border-2 transition-all flex flex-col gap-2 ${
                      selectedVid === v.id ? 'border-amber-500 bg-amber-50/80 shadow-md' : 'border-stone-100 bg-white hover:border-stone-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-amber-800 uppercase">{v.id}</span>
                      {selectedVid === v.id && <Check size={14} className="text-amber-600 shrink-0" />}
                    </div>
                    <div className="text-xs font-bold text-stone-900 leading-snug">{v.title}</div>
                    <ul className="text-[11px] text-stone-600 space-y-1.5 list-decimal pl-4">
                      {(v.plot_beats || []).map((line, i) => (
                        <li key={i} className="leading-relaxed">{line}</li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </>
          )}

          {rounds.filter((r) => r.type === 'user').length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-black text-stone-400 uppercase tracking-widest">修改轮次</div>
              {rounds.map((r, idx) =>
                r.type === 'user' ? (
                  <div key={idx} className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs text-stone-700 whitespace-pre-wrap">
                    {r.text}
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 p-4 bg-white/95 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-stone-500">
            <BookOpen size={14} />
            轮回探讨（仅发送意见；临时载荷见流程）
          </div>
          <div className="flex gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="写下对续写方案的修改意见…"
              disabled={isBusy || phase === 'init'}
              className="flex-1 min-h-[72px] max-h-32 p-3 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400 resize-none bg-stone-50/50"
            />
            <button
              type="button"
              disabled={isBusy || !feedback.trim() || !latestAssistant}
              onClick={handleSendFeedback}
              className="self-end px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[10px] font-black tracking-widest flex items-center gap-2"
            >
              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              发送
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-[10px] text-stone-400">
              累积切片 id：{Object.keys(chunkMap).length} · 摘要条目：{Object.keys(neighborSummaryMap).length}
            </div>
            <button
              type="button"
              disabled={isBusy || !latestAssistant}
              onClick={handleGenerate}
              className="px-6 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white text-[10px] font-black tracking-[0.2em] uppercase"
            >
              生成正文（阶段 3）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
