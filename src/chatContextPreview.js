import { normalizeTags, buildCharacterSettingContext, extractMentionedCharacters } from './appHelpers';

/** 与 novelPlannerApi.formatMergedChunkMapForPhase3 分组一致 */
export function groupInspirationChunks(chunkMap) {
  const rows = Object.values(chunkMap || {});
  return {
    novel: rows.filter((r) => r.type === 'novel'),
    summary: rows.filter((r) => r.type === 'novel_summary'),
    characters: rows.filter((r) => r.type === 'character'),
    scrap: rows.filter((r) => r.type !== 'novel' && r.type !== 'novel_summary' && r.type !== 'character'),
  };
}

function parseHitScore(h) {
  if (h == null) return null;
  const n = Number(h.score);
  return Number.isFinite(n) ? n : null;
}

const sliceToPreviewItem = (r, idx) => {
  const sc = parseHitScore(r);
  const tail = [r?.id != null ? `id: ${r.id}` : null, sc != null ? `相关度 ${sc.toFixed(4)}` : null].filter(Boolean).join(' · ');
  return {
    id: String(r?.id ?? `slice_${idx}`),
    title: r.title || '未命名切片',
    tags: [String(r.type || 'slice')].filter(Boolean),
    body: String(r.text || '').trim() || '（无正文）',
    score: sc != null ? sc : undefined,
    meta: tail,
  };
};

/**
 * 灵感室：系统 JSON 指令 + 用户拼装 payload + 累积 chunkMap（小说/摘要/手札/角色资料）
 */
export function buildInspirationContextPreview({
  systemPrompt,
  userPayload,
  chunkMap,
  safeCharacters,
  useRagContext,
}) {
  const blob = String(userPayload || '');
  const mentionedList = extractMentionedCharacters(blob, safeCharacters || []);
  const mentionedItems = mentionedList.map((c, i) => ({
    id: String(c?.id ?? `ins_men_${i}`),
    title: c?.name || '未命名角色',
    tags: c?.title ? [String(c.title)] : [],
    body: buildCharacterSettingContext([c]).trim() || '（无设定文本）',
    meta: '从本轮 user 拼装文本中解析',
  }));

  const { novel, summary, scrap, characters } = groupInspirationChunks(chunkMap);
  const total = novel.length + summary.length + scrap.length + characters.length;

  const modules = [
    {
      key: 'inspiration_system',
      label: '灵感室 · 系统指令',
      hint: 'ideaCultivatePrompt + JSON 输出固定约束',
      count: 1,
      enabled: true,
      items: [
        {
          id: 'insp_sys',
          title: '模型 system 消息',
          tags: ['JSON'],
          body: String(systemPrompt || '').trim() || '（空）',
          meta: 'temperature 等由端点侧配置',
        },
      ],
    },
    {
      key: 'inspiration_mentioned',
      label: '涉及角色 · 设定块',
      hint: '与 user 拼装内文一致，由角色名命中后注入',
      count: mentionedItems.length,
      enabled: mentionedItems.length > 0,
      items: mentionedItems,
    },
    {
      key: 'inspiration_novel_slices',
      label: '底层切片 · 小说正文',
      hint: 'chunkMap 累积 · 向量检索 novel',
      count: novel.length,
      enabled: !!useRagContext || novel.length > 0,
      items: novel.map(sliceToPreviewItem),
    },
    {
      key: 'inspiration_summary_slices',
      label: '底层切片 · 剧情摘要',
      hint: 'chunkMap 累积 · novel_summary',
      count: summary.length,
      enabled: !!useRagContext || summary.length > 0,
      items: summary.map(sliceToPreviewItem),
    },
    {
      key: 'inspiration_scrap_slices',
      label: '底层切片 · 手札等',
      hint: '手札向量及其它非 novel/摘要/角色类型',
      count: scrap.length,
      enabled: !!useRagContext || scrap.length > 0,
      items: scrap.map(sliceToPreviewItem),
    },
    {
      key: 'inspiration_char_profiles',
      label: '底层切片 · 角色资料命中',
      hint: '/api/rag/character-hits 写入 chunkMap',
      count: characters.length,
      enabled: characters.length > 0,
      items: characters.map(sliceToPreviewItem),
    },
    {
      key: 'inspiration_user_payload',
      label: '用户侧 · 完整拼装',
      hint: '实际发给模型的单条 user 文本（含切片库 XML）',
      count: 1,
      enabled: true,
      items: [
        {
          id: 'insp_user',
          title: '本轮 user 消息',
          tags: ['user'],
          body: blob || '（空）',
          meta: '',
        },
      ],
    },
  ];

  const summaryLine = `灵感室 · 累积切片 ${total} 条（小说 ${novel.length} · 摘要 ${summary.length} · 手札/其它 ${scrap.length} · 角色资料 ${characters.length}） · 检索 ${useRagContext ? '开' : '关'}`;

  return {
    mode: 'inspiration',
    updatedAt: Date.now(),
    summaryLine,
    requiredTags: [],
    useStructuredContext: false,
    useRagContext: !!useRagContext,
    modules,
  };
}

/** @param {Array<{ type?: string }>} refs */
export function splitRagHitsByType(refs) {
  const novel = [];
  const scrapbook = [];
  const summary = [];
  for (const h of refs || []) {
    const t = String(h?.type || 'novel').toLowerCase();
    if (t === 'scrapbook' || t === 'title') scrapbook.push(h);
    else if (t === 'novel_summary') summary.push(h);
    else novel.push(h);
  }
  return { novel, scrapbook, summary };
}

/**
 * 供 AI 面板中间栏展示：分模块、可展开条目，与 handleAiSendMessage 注入顺序对齐。
 */
export function buildChatContextPreview({
  referenceConfig,
  mentionedChars,
  selectedScrapbook,
  rag,
  requiredTags,
  sessionId,
}) {
  const useStruct = !!referenceConfig?.useStructuredContext;
  const useRag = !!referenceConfig?.useRagContext;

  let novelHits = Array.isArray(rag?.novelRefs) ? rag.novelRefs : [];
  let scrapbookHits = Array.isArray(rag?.scrapbookRefs) ? rag.scrapbookRefs : [];
  let summaryHits = Array.isArray(rag?.summaryRefs) ? rag.summaryRefs : [];

  if (useRag && !novelHits.length && !scrapbookHits.length && !summaryHits.length && Array.isArray(rag?.refs) && rag.refs.length) {
    const split = splitRagHitsByType(rag.refs);
    novelHits = split.novel;
    scrapbookHits = split.scrapbook;
    summaryHits = split.summary;
  }

  const hitToItem = (h, idx) => {
    const sc = parseHitScore(h);
    const meta = [
      sc != null ? `相关度 ${sc.toFixed(4)}` : null,
      h.type ? `向量类型: ${h.type}` : null,
      h.chapterKey ? `章节键: ${h.chapterKey}` : null,
      h.workId && h.workId !== 'main' ? `卷: ${h.workId}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: String(h.id ?? `rag_${idx}`),
      title: h.title || '未命名切片',
      tags: [],
      body: String(h.text || '').trim() || '（无正文）',
      score: sc != null ? sc : undefined,
      meta,
    };
  };

  const taggedItems = (selectedScrapbook || []).map((s) => ({
    id: String(s.id ?? s.title),
    title: s.title || '未命名手札',
    tags: normalizeTags(s.tags),
    body: String(s.content || '').trim() || '（空）',
    meta: `结构化注入 · 标签: ${normalizeTags(s.tags).join('、') || '无'}`,
  }));

  const mentionedList = Array.isArray(mentionedChars) ? mentionedChars : [];
  const mentionedItems = mentionedList.map((c, i) => ({
    id: String(c?.id ?? `men_${i}`),
    title: c?.name || '未命名角色',
    tags: c?.title ? [String(c.title)] : [],
    body: buildCharacterSettingContext([c]).trim() || '（无设定文本）',
    meta: '由对话文本命中角色名后拉取设定',
  }));

  const modules = [
    {
      key: 'tagged_scrapbook',
      label: '标签匹配 · 手札全文',
      hint: '仅在「结构化参考」开启时注入；按标签从手札表筛选全文（非向量检索）',
      count: taggedItems.length,
      enabled: useStruct,
      items: taggedItems,
    },
    {
      key: 'mentioned_characters',
      label: '提及角色 · 设定块',
      hint: '从历史消息中解析到的角色名，并拼装为 ===MENTIONED_CHARACTERS===',
      count: mentionedItems.length,
      enabled: mentionedItems.length > 0,
      items: mentionedItems,
    },
    {
      key: 'rag_novel',
      label: 'RAG · 小说正文切片',
      hint: '对话检索配置「剧情原文」条数',
      count: novelHits.length,
      enabled: useRag,
      items: novelHits.map(hitToItem),
    },
    {
      key: 'rag_scrapbook_vec',
      label: 'RAG · 手札向量切片',
      hint: '对话检索配置「手札」条数',
      count: scrapbookHits.length,
      enabled: useRag,
      items: scrapbookHits.map(hitToItem),
    },
    {
      key: 'rag_summary',
      label: 'RAG · 剧情摘要切片',
      hint: '对话检索配置「剧情摘要」条数',
      count: summaryHits.length,
      enabled: useRag,
      items: summaryHits.map(hitToItem),
    },
  ];

  const parts = [];
  if (useStruct && taggedItems.length) parts.push(`手札结构化 ${taggedItems.length} 条`);
  if (mentionedItems.length) parts.push(`提及角色 ${mentionedItems.length} 名`);
  if (useRag) {
    const bits = [];
    if (novelHits.length) bits.push(`小说 ${novelHits.length}`);
    if (scrapbookHits.length) bits.push(`手札向量 ${scrapbookHits.length}`);
    if (summaryHits.length) bits.push(`摘要 ${summaryHits.length}`);
    parts.push(bits.length ? `RAG ${bits.join('，')}` : 'RAG 无命中');
  } else {
    parts.push('RAG 已关闭');
  }

  return {
    mode: 'chat',
    updatedAt: Date.now(),
    summaryLine: parts.join(' · '),
    requiredTags: Array.isArray(requiredTags) ? requiredTags : [],
    useStructuredContext: useStruct,
    useRagContext: useRag,
    modules,
  };
}
