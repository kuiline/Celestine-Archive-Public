/**
 * 正文「续写规划」工作流：读写分离、笔记 RAG 全量原文仅作临时载荷。
 */

import { findChapterOutlineScrapbookItem } from './chapterOutlineMatch.js';
import { mergeChatCompletionThinking } from './llmThinking.js';

export const NOVEL_PLANNER_STORAGE_PREFIX = 'celestial_novel_planner_v1';

/** 与服务端必选梗概使用同一套匹配规则（见 chapterOutlineMatch.js） */
export function findChapterSummaryScrapbook(scrapbook, chapterIndex1Based) {
  return findChapterOutlineScrapbookItem(scrapbook, chapterIndex1Based);
}

/** 当前章不足设定字数时，从上一章末尾向前补足 */
export function buildBeforeTextAcrossChapters(chapters, activeChapterId, cursorInChapter, refChars) {
  const ref = Math.max(1, Number(refChars) || 1000);
  const idx = Array.isArray(chapters) ? chapters.findIndex((c) => c.id === activeChapterId) : -1;
  if (idx < 0) return '';
  const cur = String(chapters[idx]?.content || '');
  const pos = Math.min(Math.max(0, Number(cursorInChapter) || 0), cur.length);
  const beforeInCur = cur.slice(0, pos);
  let need = ref - beforeInCur.length;
  let acc = beforeInCur;
  if (need <= 0) return beforeInCur.slice(-ref);
  for (let i = idx - 1; i >= 0 && need > 0; i -= 1) {
    const prev = String(chapters[i]?.content || '');
    const take = Math.min(need, prev.length);
    acc = prev.slice(-take) + acc;
    need -= take;
  }
  return acc.slice(-ref);
}

/** 多轮 RAG：将已合并进 chunkMap 的切片 id 传给服务端，检索时排除并顺延名额 */
export function getChunkIdsForRagExclude(chunkMap) {
  if (!chunkMap || typeof chunkMap !== 'object') return [];
  return Object.keys(chunkMap).filter((k) => k != null && String(k).trim() !== '');
}

export async function fetchPlannerCollect(body) {
  const res = await fetch('/api/rag/planner/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`planner/collect 失败 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'planner/collect 失败');
  return data;
}

/** 以 hit.id 为主键合并（小说 + 笔记）；保留完整 text */
export function mergeChunkMap(prevMap, hits) {
  const next = { ...(prevMap || {}) };
  for (const h of hits || []) {
    const id = h?.id;
    if (id == null || id === '') continue;
    if (!next[id]) {
      const sc = Number(h?.score);
      next[id] = {
        id,
        title: h.title || '',
        text: String(h.text || ''),
        type: h.type || 'scrapbook',
        ...(Number.isFinite(sc) ? { score: sc } : {})
      };
    }
  }
  return next;
}

export function mergeNeighborSummaries(prev, rows) {
  const next = { ...(prev || {}) };
  for (const r of rows || []) {
    const id = r?.id;
    if (!id || next[id]) continue;
    const s = String(r.summary || '').trim();
    if (s) next[id] = s;
  }
  return next;
}

export function formatSummaryHitsBlock(hits) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length === 0) return '<Summary_Chunks><Chunk empty="true">暂无剧情摘要切片</Chunk></Summary_Chunks>';
  return list
    .map(
      (h) =>
        `<Chunk id="${h.id}" title="${(h.title || '').replace(/"/g, "'")}">\n${h.text || ''}\n</Chunk>`
    )
    .join('\n');
}

export function formatNovelHitsBlock(hits) {
  return formatSummaryHitsBlock(hits);
}

export function formatScrapbookHitsBlock(hits) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length === 0) return '<Scrapbook_Chunks><Chunk empty="true">暂无笔记切片</Chunk></Scrapbook_Chunks>';
  return list
    .map(
      (h) =>
        `<Chunk id="${h.id}" title="${(h.title || '').replace(/"/g, "'")}">\n${h.text || ''}\n</Chunk>`
    )
    .join('\n');
}

export function formatNeighborSummariesBlock(rows) {
  const obj = rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
  const ids = Object.keys(obj);
  if (ids.length === 0) {
    return '<Neighbor_Summaries><Summary empty="true">暂无相邻段落摘要；需在 RAG 摘要中生成 novel_summary_index</Summary></Neighbor_Summaries>';
  }
  return ids
    .map((id) => `<Summary id="${id}">\n${obj[id]}\n</Summary>`)
    .join('\n');
}

export function formatCharacterHitsBlock(hits) {
  const list = Array.isArray(hits) ? hits : [];
  if (list.length === 0) return '<Profile empty="true">未命中角色资料</Profile>';
  return list
    .map((h) => `<Profile id="${h.id}" name="${(h.name || '').replace(/"/g, "'")}">\n${h.text || ''}\n</Profile>`)
    .join('\n');
}

/** Phase 3：合并 chunkMap（含 novel + scrapbook） */
export function formatMergedChunkMapForPhase3(chunkMap) {
  const rows = Object.values(chunkMap || {});
  if (rows.length === 0) return '<Background_Dictionary><Chunk empty="true">无累积切片</Chunk></Background_Dictionary>';
  const summary = rows.filter((r) => r.type === 'novel_summary' || r.type === 'novel');
  const characters = rows.filter((r) => r.type === 'character');
  const scrap = rows.filter((r) => r.type !== 'novel' && r.type !== 'novel_summary' && r.type !== 'character');
  const parts = [];
  if (summary.length) {
    parts.push(`<Summary_Chunks>\n${formatSummaryHitsBlock(summary)}\n</Summary_Chunks>`);
  }
  if (scrap.length) {
    parts.push(`<Scrapbook_Chunks>\n${formatScrapbookHitsBlock(scrap)}\n</Scrapbook_Chunks>`);
  }
  if (characters.length) {
    parts.push(`<Character_Profiles>\n${formatCharacterHitsBlock(characters)}\n</Character_Profiles>`);
  }
  return `<Background_Dictionary>\n${parts.join('\n')}\n</Background_Dictionary>`;
}

export function formatTempScrapbookBlocks(chunkMap) {
  return formatMergedChunkMapForPhase3(chunkMap);
}

const PLANNER_JSON_SCHEMA_HINT = `你必须只输出一个 JSON 对象（不要 Markdown），结构严格为：
{
  "recursive_thinking": {
    "timeline_checkpoint": "前剧情当前所处时间节点",
    "current_action": "当前剧情正在做什么",
    "previous_action": "当前剧情前做了什么",
    "cut_point": "续写截断点在哪里",
    "involved_characters": [
      { "name": "角色名", "persona": "人物设定/性格", "current_motivation": "当下动机" }
    ],
    "dictionary_focus": ["本轮最关键的设定词1", "设定词2"],
    "why_previous_versions_failed": "用户为什么觉得上一轮三版不行（若为首轮则写“首轮无历史反馈”）"
  },
  "versions": [
    {
      "id": "v1",
      "title": "该方案的简短标题（走向区分）",
      "plot_beats": [
        "情节节拍 1",
        "情节节拍 2",
        "情节节拍 3",
        "情节节拍 4"
      ]
    },
    { "id": "v2", "title": "…", "plot_beats": [ "…", "…", "…", "…" ] },
    { "id": "v3", "title": "…", "plot_beats": [ "…", "…", "…", "…" ] }
  ]
}
说明：
1) recursive_thinking 是显式推演区，必须先完成。不要省略字段。
2) versions 必须恰好 3 项，id 分别为 v1、v2、v3。
3) plot_beats 为灵活数组，至少 4 条，建议 4-6 条；不得写成影视工业分镜字段（镜号、景别、机位等）。`;

export function buildPhase1SystemPrompt() {
  return [
    '你是长篇小说续写策划。你将收到 XML 闭环格式的背景字典与静默锚点，字典中包含：章节梗概笔记、剧情摘要RAG切片、笔记RAG切片、角色资料。',
    '你必须先在 recursive_thinking 完成显式推演（时间节点、当前动作、前序动作、截断点、角色动机、设定词、失败原因），再输出三版方案。',
    '不要输出正文小说，不要闲聊。',
    PLANNER_JSON_SCHEMA_HINT
  ].join('\n');
}

/** 与阶段 1/3「文风锚点」同口径：光标前参考窗末尾节选 */
export function slicePlannerSilentAnchor(beforeTextFull, referenceChars) {
  return String(beforeTextFull || '').slice(-Math.max(200, Number(referenceChars) || 1000));
}

export function buildPhase1UserPayload({
  beforeText,
  referenceChars,
  mandatoryOutlineBlock,
  summaryBlock,
  scrapbookBlock,
  characterBlock
}) {
  const ref = slicePlannerSilentAnchor(beforeText, referenceChars);
  return [
    '<Planner_Request>',
    '<Background_Dictionary>',
    '<Mandatory_Outline>',
    mandatoryOutlineBlock || '<Chunk empty="true">未找到对应梗概笔记</Chunk>',
    '</Mandatory_Outline>',
    '<Summary_RAG>',
    summaryBlock || '<Summary_Chunks><Chunk empty="true">无</Chunk></Summary_Chunks>',
    '</Summary_RAG>',
    '<Scrapbook_Support>',
    scrapbookBlock || '<Scrapbook_Chunks><Chunk empty="true">无</Chunk></Scrapbook_Chunks>',
    '</Scrapbook_Support>',
    '<Character_Profiles>',
    characterBlock || '<Profile empty="true">无</Profile>',
    '</Character_Profiles>',
    '</Background_Dictionary>',
    '<Silent_Anchor>',
    ref || '（空）',
    '</Silent_Anchor>',
    '</Planner_Request>'
  ].join('\n\n');
}

export function buildPhase2SystemPrompt() {
  return [
    '你是长篇小说续写策划。用户在多轮对话中提出修改意见。',
    '对话历史：assistant 消息为上一轮完整策划 JSON；较早的 user 消息仅含 <User_Round><User_Absolute_Command>（该轮用户指令）。',
    '仅在最后一条 user 消息末尾附带一次 <Background_Dictionary>（当前最新、最全的累积设定）与 <Silent_Anchor>（文风衔接点）；不要要求历史轮重复贴字典。',
    '规则：<User_Absolute_Command> 是最高优先级；<Silent_Anchor> 决定动作衔接；<Background_Dictionary> 决定硬设定边界。',
    '请严格吸收全部用户意见并重写完整 JSON（同一结构），不要输出正文小说，不要闲聊。',
    PLANNER_JSON_SCHEMA_HINT
  ].join('\n');
}

function normalizePlannerPayload(raw) {
  const recursive_thinking = raw?.recursive_thinking ?? String(raw?.situation_summary || '').trim();
  const versionsIn = Array.isArray(raw?.versions) ? raw.versions : [];
  const versions = ['v1', 'v2', 'v3'].map((vid, idx) => {
    const v = versionsIn[idx] || {};
    const beatsRaw = Array.isArray(v.plot_beats)
      ? v.plot_beats
      : (Array.isArray(v.storyboard) ? v.storyboard : []);
    const plot_beats = beatsRaw.map((s) => String(s)).filter(Boolean);
    return {
      id: vid,
      title: String(v.title || `方案 ${idx + 1}`).trim(),
      plot_beats: plot_beats.length >= 4 ? plot_beats : [...plot_beats, ...Array(4 - plot_beats.length).fill('（待补充）')].slice(0, 4)
    };
  });
  return { recursive_thinking, versions };
}

export function parsePlannerResponse(content) {
  const raw = String(content || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('模型未返回合法 JSON');
  }
  return normalizePlannerPayload(parsed);
}

export async function callTextModelJson(endpoint, systemPrompt, userPrompt, temperature = 0.65) {
  if (!endpoint?.url || !endpoint?.key) throw new Error('未配置文本模型');
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify(
      mergeChatCompletionThinking(endpoint, {
        model: endpoint.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    )
  });
  if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parsePlannerResponse(content);
}

export async function callPhase2Messages(endpoint, messages, temperature = 0.65) {
  if (!endpoint?.url || !endpoint?.key) throw new Error('未配置文本模型');
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify(
      mergeChatCompletionThinking(endpoint, {
        model: endpoint.model,
        temperature,
        response_format: { type: 'json_object' },
        messages
      })
    )
  });
  if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parsePlannerResponse(content);
}

export async function extractFeedbackKeywords(endpoint, feedbackText) {
  const input = String(feedbackText || '').trim();
  if (!input) return [];
  if (!endpoint?.url || !endpoint?.key) return [];
  const system = [
    '你是关键词提取器。只输出 JSON。',
    '从用户反馈中提取可用于设定检索的关键词，优先保留：角色名、地点、组织、能力、事件、情绪诉求、纠错意图。'
  ].join('\n');
  const user = [
    '请输出结构：{"keywords":["词1","词2"],"why_failed":"一句话说明用户为什么不满意上轮方案"}',
    'keywords 数量 4-10，去重，不要短于2个字，不要废话。',
    `用户反馈：${input}`
  ].join('\n');
  const model = endpoint.keywordModel || endpoint.lightweightModel || endpoint.model;
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify(
      mergeChatCompletionThinking(endpoint, {
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    )
  });
  if (!res.ok) throw new Error(`关键词提取失败 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const content = String(data.choices?.[0]?.message?.content || '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch (e) {}
  const list = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  return [...new Set(list.map((x) => String(x || '').trim()).filter((x) => x.length >= 2))].slice(0, 10);
}

export function buildPhase3SystemPrompt(targetLength) {
  const lo = Math.round(Number(targetLength) * 0.7);
  const hi = Math.round(Number(targetLength) * 1.2);
  return [
    '你是长篇小说作者。你将收到 XML 闭环输入：<Background_Dictionary>、<Execution_Command>、<Silent_Anchor>。',
    '请按所选方案中的 plot_beats 顺序展开为小说正文，紧接文风锚点之后，保持语气一致；不得违背笔记中的硬性设定。',
    `篇幅约 ${lo}-${hi} 字。只输出正文，不要标题、不要解释、不要 JSON。`
  ].join('\n');
}

export function buildPhase3UserPayload({ chunkMap, selectedVersion, styleAnchor }) {
  const blocks = formatTempScrapbookBlocks(chunkMap);
  const script = JSON.stringify(selectedVersion, null, 2);
  return [
    '<Planner_Execution>',
    '<Background_Dictionary>',
    blocks,
    '</Background_Dictionary>',
    '<Execution_Command>',
    script,
    '</Execution_Command>',
    '<Silent_Anchor>',
    String(styleAnchor || ''),
    '</Silent_Anchor>',
    '</Planner_Execution>'
  ].join('\n\n');
}

export function loadPlannerDraft(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function savePlannerDraft(storageKey, draft) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch (e) {}
}

export function clearPlannerDraft(storageKey) {
  try {
    localStorage.removeItem(storageKey);
  } catch (e) {}
}
