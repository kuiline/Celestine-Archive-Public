import { fetchRagForSimpleTool, getReadableText, extractMentionedCharacters, buildCharacterSettingContext } from './appHelpers';
import { mergeChunkMap, formatTempScrapbookBlocks } from './novelPlannerApi';

export const INSPIRATION_ROOM_STORAGE_KEY = 'celestial_inspiration_room_v1';

/** 首轮：多取一些切片写入底层；后续轮次：追加检索 */
export const INSPIRATION_FIRST_COUNTS = { novel: 6, scrapbook: 8, summary: 6 };
export const INSPIRATION_FOLLOW_COUNTS = { novel: 4, scrapbook: 5, summary: 4 };
export const INSPIRATION_CHAR_MAX = 12;

export async function fetchCharacterHits(queryText, maxProfiles = INSPIRATION_CHAR_MAX, excludeIds = []) {
  const res = await fetch('/api/rag/character-hits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queryText: String(queryText || '').trim(),
      maxProfiles,
      excludeIds: Array.isArray(excludeIds) ? excludeIds : []
    })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.hits) ? data.hits : [];
}

/**
 * 检索小说原文 + 剧情摘要 + 笔记向量 + 姓名命中角色资料；不做必选梗概、不做标签前排。
 * 返回用于 mergeChunkMap 的 hit 列表（按 id 去重在 mergeChunkMap 中完成）。
 */
export async function collectInspirationHits(query, ragConfig, counts, existingChunkIds = [], characterMax = INSPIRATION_CHAR_MAX) {
  const safeQuery = String(query || '').trim() || '项目设定';
  const ex = Array.isArray(existingChunkIds) ? existingChunkIds : [];
  const rag = await fetchRagForSimpleTool(safeQuery, ragConfig, counts, ex);
  const cm = Math.max(0, Math.min(48, Number(characterMax) || 0));
  const chars = cm > 0 ? await fetchCharacterHits(safeQuery, cm, ex) : [];
  return [
    ...(rag.novelRefs || []),
    ...(rag.summaryRefs || []),
    ...(rag.scrapbookRefs || []),
    ...chars
  ];
}

export function formatInspirationHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .map((m) => {
      const t = getReadableText(m.content) || '';
      if (m.role === 'user') return `【用户】${t}`;
      return `【助手】${t.slice(0, 1200)}${t.length > 1200 ? '…' : ''}`;
    })
    .join('\n');
}

export function buildInspirationRagQuery(firstSeed, messages, extraLine = '') {
  const parts = [String(firstSeed || '').trim(), formatInspirationHistory(messages), String(extraLine || '').trim()].filter(Boolean);
  return parts.join('\n\n');
}

export function buildInspirationUserPayload({
  chunkMap,
  messages,
  resolvedChar,
  safeCharacters,
  mode,
  userLine,
  refineFeedback,
  refineDraftText
}) {
  const map = chunkMap || {};
  const dictBlock = formatTempScrapbookBlocks(map);
  const hist = formatInspirationHistory(messages);
  const blob = [hist, userLine, refineFeedback, refineDraftText].filter(Boolean).join('\n');
  const mentioned = extractMentionedCharacters(blob, safeCharacters || []);
  const charCtx = buildCharacterSettingContext(mentioned);

  const lines = [];
  if (charCtx) lines.push(`涉及角色设定：\n${charCtx}`);
  lines.push(`底层切片库（本室常驻，随对话累积；含小说/摘要/笔记/角色资料命中）：\n${dictBlock}`);
  if (hist) lines.push(`对话摘录：\n${hist}`);
  if (mode === 'refine') {
    lines.push(`本轮为润色：\n用户反馈：${refineFeedback || ''}\n当前草稿：${refineDraftText || ''}`);
  } else {
    lines.push(`本轮用户说：\n${userLine || ''}`);
  }
  return lines.join('\n\n');
}

export function mergeInspirationChunkMap(prevMap, hits) {
  return mergeChunkMap(prevMap, hits);
}
