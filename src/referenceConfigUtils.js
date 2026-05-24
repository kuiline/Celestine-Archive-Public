/**
 * 对话 / 生图 / 灵感室 的 RAG 条数与其它参考开关（不存 ragLayering、不存全局 topK）。
 */

const DEFAULT_TRIPLET = { novel: 4, scrapbook: 4, summary: 4 };
const DEFAULT_INS_FIRST = { novel: 6, scrapbook: 8, summary: 6 };
const DEFAULT_INS_FOLLOW = { novel: 4, scrapbook: 5, summary: 4 };

function clampInt(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function normTriplet(raw, fallback) {
  return {
    novel: clampInt(raw?.novel, 0, 24, fallback.novel),
    scrapbook: clampInt(raw?.scrapbook, 0, 24, fallback.scrapbook),
    summary: clampInt(raw?.summary, 0, 60, fallback.summary),
  };
}

export function normalizeReferenceConfig(raw) {
  const base = {
    useStructuredContext: true,
    useRagContext: true,
    useRagForImageTag: true,
    chatRagCounts: { ...DEFAULT_TRIPLET },
    imageTagRagCounts: { ...DEFAULT_TRIPLET },
    /** 生图时用于“避免重复场景”的历史条数（0=不注入） */
    imageSceneHistoryCount: 5,
    /** 主对话 / 生图 Tag RAG：查询句里带最近几条对话（0=不带历史，仅本轮 input + 角色提示） */
    chatRagHistoryMessages: 8,
    /** 0=不截断；>0 时只保留「最近对话」拼接串的末尾若干字，避免超长会话拖死检索语义 */
    chatRagHistoryMaxChars: 0,
    /** 为 true 时 RAG 查询句不含历史，仅本轮用户输入 + 角色提示 */
    chatRagUserMessageOnly: false,
    /** 发往 LLM 的对话条数：0=本会话尽量全带（内部最多 200 条）；设为 12 则只带最近 12 条 */
    chatWindowMessages: 0,
    inspirationRagFirst: { ...DEFAULT_INS_FIRST },
    inspirationRagFollow: { ...DEFAULT_INS_FOLLOW },
    inspirationCharMax: 12,
  };
  const x = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  if ('ragLayering' in x) delete x.ragLayering;
  x.chatRagCounts = normTriplet(x.chatRagCounts, base.chatRagCounts);
  x.imageTagRagCounts = normTriplet(x.imageTagRagCounts, base.imageTagRagCounts);
  x.inspirationRagFirst = normTriplet(x.inspirationRagFirst, base.inspirationRagFirst);
  x.inspirationRagFollow = normTriplet(x.inspirationRagFollow, base.inspirationRagFollow);
  x.inspirationCharMax = clampInt(x.inspirationCharMax, 0, 48, base.inspirationCharMax);
  x.chatRagHistoryMessages = clampInt(x.chatRagHistoryMessages, 0, 20, base.chatRagHistoryMessages);
  x.chatRagHistoryMaxChars = clampInt(x.chatRagHistoryMaxChars, 0, 50000, base.chatRagHistoryMaxChars);
  x.imageSceneHistoryCount = clampInt(x.imageSceneHistoryCount, 0, 20, base.imageSceneHistoryCount);
  x.chatRagUserMessageOnly = x.chatRagUserMessageOnly === true;
  x.chatWindowMessages = clampInt(x.chatWindowMessages, 0, 256, base.chatWindowMessages);
  x.useStructuredContext = x.useStructuredContext !== false;
  x.useRagContext = x.useRagContext !== false;
  x.useRagForImageTag = x.useRagForImageTag !== false;
  return x;
}
