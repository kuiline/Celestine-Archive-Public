/** App.jsx 抽离的纯函数与无组件状态依赖的工具，行为与原内联实现一致 */

export const AI_TOOL_ACTION_START = '===TOOL_ACTION===';
export const AI_TOOL_ACTION_END = '=============';

/** 模型输出此块时，客户端自动把对应图库图载入下一轮多模态请求 */
export const ATTACH_GALLERY_IMAGE_START = '===ATTACH_GALLERY_IMAGE===';
export const ATTACH_GALLERY_IMAGE_END = '=============';

/**
 * 解析 ATTACH 块。支持 imageTitle（按图库标题 name/caption 匹配）、imageNumber（从1起）、imageIndex（从0起）。
 */
export function parseAttachGalleryImageBlock(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(/===ATTACH_GALLERY_IMAGE===\s*([\s\S]*?)(?:=============|$)/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1].trim());
    if (!j || typeof j !== 'object') return null;
    const name = String(j.characterName || j.name || '').trim();
    if (!name) return null;
    const imageTitle = [j.imageTitle, j.caption, j.title].map((x) => String(x || '').trim()).find(Boolean) || '';
    const num = Number(j.imageNumber);
    const idx = Number(j.imageIndex);
    const hasTitle = imageTitle.length > 0;
    const hasNum = Number.isFinite(num) && num >= 1;
    const hasIdx = Number.isFinite(idx) && idx >= 0;
    if (!hasTitle && !hasNum && !hasIdx) return null;
    return {
      characterName: name,
      imageTitle: hasTitle ? imageTitle : null,
      imageNumber: hasNum ? Math.floor(num) : null,
      imageIndex: hasIdx ? Math.floor(idx) : null
    };
  } catch (e) {
    return null;
  }
}

/**
 * 将解析结果或推断结果解析为 storyImgs 下标；失败返回 -1。
 */
export function resolveGalleryAttachSpecToIndex(storyImgs, spec) {
  if (!spec || typeof spec !== 'object') return -1;
  if (Number.isFinite(spec.resolvedIndex) && spec.resolvedIndex >= 0) return Math.floor(spec.resolvedIndex);
  const imgs = Array.isArray(storyImgs) ? storyImgs : [];
  const title = spec.imageTitle ? String(spec.imageTitle).trim() : '';
  if (title) {
    const norm = (s) => String(s || '').trim().replace(/\s+/g, '');
    const nt = norm(title);
    for (let i = 0; i < imgs.length; i++) {
      const candidates = [imgs[i]?.name, imgs[i]?.caption].map((s) => String(s || '').trim()).filter(Boolean);
      if (!candidates.length) continue;
      for (const cap of candidates) {
        if (cap === title || cap.includes(title) || title.includes(cap)) return i;
        const nc = norm(cap);
        if (nc.includes(nt) || nt.includes(nc)) return i;
      }
    }
    return -1;
  }
  if (spec.imageNumber != null && Number.isFinite(spec.imageNumber) && spec.imageNumber >= 1) {
    return Math.floor(spec.imageNumber) - 1;
  }
  if (spec.imageIndex != null && Number.isFinite(spec.imageIndex) && spec.imageIndex >= 0) {
    return Math.floor(spec.imageIndex);
  }
  return -1;
}

/**
 * 解析最近一次 list_gallery_images 的 [工具执行结果]：仅当 命中=1 时返回角色与首张索引（用于点击「执行」后自动链式载入，不误伤普通对话）。
 */
export function parseListGalleryToolSingleHit(toolResultText) {
  const s = String(toolResultText || '');
  /** 避免「命中=10」误匹配为 1 */
  if (!/命中=1(?!\d)/.test(s)) return null;
  const roleM = s.match(/角色=([^\s\n]+)/);
  const rowM = s.match(/#1\s+imageIndex=(\d+)\s+标题=(.+?)\s+未命名=/);
  if (!roleM || !rowM) return null;
  return {
    characterName: roleM[1].trim(),
    imageIndex: Number(rowM[1]),
    imageTitle: rowM[2].trim()
  };
}

/**
 * 用户只说「调出来」等短句且模型未输出 ATTACH 时：从最近 list_gallery 工具结果 + 助手「」引号推断要载入哪张。
 */
export function inferGalleryAttachFromConversation(validHistory, lastUserText) {
  const t = String(lastUserText || '').trim();
  if (!t || t.length > 48) return null;
  const short =
    t.length <= 10 ||
    /^[\s\?？!！。]*((请|帮)?(调|拿|发|给|显示|展示|换)(出来|上|我)?|再看|就这张|这张|那张)[\s\?？!！。]*$/i.test(t) ||
    /^[?？\s!！。]+$/i.test(t);
  if (!short) return null;
  const blob = (Array.isArray(validHistory) ? validHistory : [])
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.map((p) => (p?.type === 'text' ? p.text : '')).join('');
      }
      return '';
    })
    .join('\n');
  const roleM = blob.match(/角色=([^\s\n]+)/);
  if (!roleM) return null;
  const characterName = roleM[1].trim();
  const rows = [];
  /** 与 list_gallery_images 输出行一致：#1 imageIndex=3 标题=依依 未命名=否 … */
  const re = /#(\d+)\s+imageIndex=(\d+)\s+标题=(.+?)\s+未命名=/g;
  let mm;
  while ((mm = re.exec(blob)) !== null) {
    rows.push({ imageIndex: Number(mm[2]), title: mm[3].trim() });
  }
  if (rows.length === 0) return null;
  const assistants = (Array.isArray(validHistory) ? validHistory : []).filter((m) => m.role === 'assistant');
  const recentAssistant = assistants
    .slice(-4)
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
  const quotes = recentAssistant.match(/「([^」]{1,40})」/g) || [];
  for (let q = quotes.length - 1; q >= 0; q--) {
    const inner = quotes[q].replace(/[「」]/g, '').trim();
    if (!inner) continue;
    const hit = rows.find((r) => r.title.includes(inner) || inner.includes(r.title));
    if (hit) return { characterName, imageIndex: hit.imageIndex, imageTitle: hit.title };
  }
  for (const row of rows) {
    if (row.title && recentAssistant.includes(row.title)) {
      return { characterName, imageIndex: row.imageIndex, imageTitle: row.title };
    }
  }
  return null;
}

export function stripAttachGalleryImageBlock(content) {
  if (typeof content !== 'string') return String(content || '');
  return content.replace(/===ATTACH_GALLERY_IMAGE===\s*[\s\S]*?(?:=============|$)/, '').trim();
}

/** 从 user 消息取出纯文本（不含图片部分） */
export function getUserMessagePlainText(msg) {
  if (!msg || msg.role !== 'user') return '';
  if (typeof msg.content === 'string') return String(msg.content);
  if (Array.isArray(msg.content)) {
    const t = msg.content.find((p) => p?.type === 'text');
    return String(t?.text || '').trim();
  }
  return '';
}

export const normalizeEndpoint = (ep) => {
  const raw = ep && typeof ep === 'object' ? ep : {};
  const tb = Number(raw.thinkingBudget);
  return {
    ...raw,
    mode: raw?.mode === 'multimodal' ? 'multimodal' : 'text',
    thinkingEnabled: raw?.thinkingEnabled === true,
    thinkingBudget:
      Number.isFinite(tb) && tb >= 128 && tb <= 32768 ? Math.floor(tb) : undefined,
    reasoningEffort: raw?.reasoningEffort === 'max' ? 'max' : 'high',
  };
};
export const normalizeEndpoints = (eps) => (Array.isArray(eps) ? eps : []).map(normalizeEndpoint);
export const isMultimodalEndpoint = (ep) => (ep?.mode || 'text') === 'multimodal';
export const getReadableText = (content) => {
  let text = Array.isArray(content) ? (content.find(c => c.type === 'text')?.text || '[图片]') : content;
  if (typeof text === 'string') {
    text = text.replace(/===NOVELAI_RESULT===\s*[\s\S]*?(?:=============|$)/g, '===NOVELAI_RESULT===\n[已生成图片]\n=============');
    text = text.replace(/===NOVELAI_META===\s*[\s\S]*?(?:=============|$)/g, '===NOVELAI_META===\n{"hidden":true}\n=============');
    text = text.replace(/===NOVELAI_RETRY===\s*[\s\S]*?(?:=============|$)/g, '===NOVELAI_RETRY===\n{"hidden":true}\n=============');
  }
  return text;
};

export const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map(t => String(t || '').trim().replace(/：/g, ':')).filter(Boolean)));
};
export const parseTagsText = (text) => normalizeTags(String(text || '').split(/[，,、；;\n]+/));
export const buildIdeaDraftMessage = (payload) => `===IDEA_DRAFT_JSON===\n${JSON.stringify(payload)}\n=============`;
export const parseIdeaDraftMessage = (content) => {
  if (typeof content !== 'string') return null;
  const m = content.match(/===IDEA_DRAFT_JSON===\s*([\s\S]*?)(?:=============|$)/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch (e) { return null; }
};
export const parseToolActionMessage = (content) => {
  if (typeof content !== 'string') return null;
  const m = content.match(/===TOOL_ACTION===\s*([\s\S]*?)(?:=============|$)/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].trim());
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.action || typeof parsed.action !== 'string') return null;
    return parsed;
  } catch (e) {
    return null;
  }
};
export const stripToolActionBlock = (content) => {
  if (typeof content !== 'string') return String(content || '');
  return content.replace(/===TOOL_ACTION===\s*[\s\S]*?(?:=============|$)/, '').trim();
};

/** 与 NovelView 一致：<<<CHAPTER_SPLIT>>> + @@chapter: */
const NOVEL_CHAPTER_SPLIT = '\n\n<<<CHAPTER_SPLIT>>>\n\n';
const NOVEL_CHAPTER_PREFIX = '@@chapter:';

/** 解析正文内容为章节列表（只读工具用） */
export function parseNovelChaptersForTool(raw) {
  const src = String(raw || '');
  if (!src.trim()) return [];
  if (!src.includes(NOVEL_CHAPTER_PREFIX)) {
    return [{ index: 0, title: '全文', body: src.trim() }];
  }
  const blocks = src.split(NOVEL_CHAPTER_SPLIT);
  const out = [];
  blocks.forEach((block) => {
    const lines = String(block || '').split('\n');
    const first = String(lines[0] || '');
    if (!first.startsWith(NOVEL_CHAPTER_PREFIX)) return;
    out.push({
      index: out.length,
      title: first.slice(NOVEL_CHAPTER_PREFIX.length).trim() || `第${out.length + 1}章`,
      body: lines.slice(1).join('\n')
    });
  });
  return out.length > 0 ? out : [{ index: 0, title: '全文', body: src.trim() }];
}

/**
 * 在正文全文中按子串搜索，返回带上下文的片段（只读）
 */
export function searchNovelTextSnippets(fullText, query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return { error: 'query 不能为空' };
  const maxHits = Math.max(1, Math.min(20, Number(options.maxHits) || 8));
  const context = Math.max(60, Math.min(3000, Number(options.contextChars) || 480));
  const caseInsensitive = options.caseInsensitive !== false;
  const hay = String(fullText || '');
  const needle = caseInsensitive ? q.toLowerCase() : q;
  const haystack = caseInsensitive ? hay.toLowerCase() : hay;
  let pos = 0;
  const hits = [];
  while (hits.length < maxHits) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) break;
    const start = Math.max(0, idx - context);
    const end = Math.min(hay.length, idx + q.length + context);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < hay.length ? '…' : '';
    const lineApprox = hay.slice(0, idx).split('\n').length;
    hits.push({
      charIndex: idx,
      lineApprox,
      snippet: `${prefix}${hay.slice(start, end)}${suffix}`
    });
    pos = idx + Math.max(1, needle.length);
  }
  return { hits, query: q };
}

export const buildTaggedScrapbookContext = (scrapbook, safeCharacters, resolvedChar, historyMessages = [], session = null) => {
  const scrapbookTitles = (Array.isArray(scrapbook) ? scrapbook : []).map(s => s.title).join(', ');
  const currentRoleTag = resolvedChar?.name ? `角色:${resolvedChar.name}` : '';
  const globalTag = '全局';
  const historyText = (Array.isArray(historyMessages) ? historyMessages : []).map(m => getReadableText(m.content) || '').join('\n');
  const mentionedRoleTags = safeCharacters
    .filter(c => c?.name && historyText.includes(c.name))
    .map(c => `角色:${c.name}`);
  const requiredTags = Array.from(new Set(normalizeTags([currentRoleTag, globalTag, ...mentionedRoleTags])));
  const relatedScrapbook = (Array.isArray(scrapbook) ? scrapbook : []).filter(item => {
    const itemTags = normalizeTags(item.tags);
    if (itemTags.length === 0) return false;
    return itemTags.some(tag => requiredTags.includes(tag));
  });
  const selectedIds = Array.isArray(session?.selectedScrapbookIds) ? session.selectedScrapbookIds : null;
  const selectedScrapbook = selectedIds === null
    ? relatedScrapbook
    : relatedScrapbook.filter(item => selectedIds.includes(item.id));
  const scrapbookContext = selectedScrapbook
    .slice(0, 20)
    .map(item => `- 标题: ${item.title || '未命名'}\n  标签: ${(item.tags || []).join(', ') || '无'}\n  内容: ${item.content || '（空）'}`)
    .join('\n');
  return { scrapbookTitles, requiredTags, relatedScrapbook, selectedScrapbook, scrapbookContext };
};

export const fetchRagContext = async (query, topK = 8, referenceConfig, ragConfig) => {
  if (!referenceConfig?.useRagContext) return { context: '', refs: [], novelRefs: [], scrapbookRefs: [], summaryRefs: [] };
  try {
    const res = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK, ragConfig })
    });
    if (!res.ok) return { context: '', refs: [] };
    const data = await res.json();
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const context = hits.map((h, i) => `#${i + 1} [${h.type}] ${h.title || '未命名'}\n${h.text || ''}`).join('\n\n');
    return { context, refs: hits };
  } catch (e) {
    return { context: '', refs: [] };
  }
};

/**
 * 简单续写/润色：按条数分别召回小说原文、笔记、剧情摘要（三路并行）
 */
export const fetchRagForSimpleTool = async (query, ragConfig, ragCounts, excludeIds = []) => {
  const nc = Math.max(0, Number(ragCounts?.novel) || 0);
  const sc = Math.max(0, Number(ragCounts?.scrapbook) || 0);
  const sumc = Math.max(0, Number(ragCounts?.summary) || 0);
  if (!nc && !sc && !sumc) {
    return { context: '', refs: [], novelRefs: [], scrapbookRefs: [], summaryRefs: [] };
  }
  const safeQuery = String(query || '').trim() || '小说';
  const headers = { 'Content-Type': 'application/json' };
  const ex = Array.isArray(excludeIds) ? excludeIds : [];

  const run = (type, topK) => {
    if (!topK) return Promise.resolve({ hits: [] });
    return fetch('/api/rag/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: safeQuery,
        topK,
        ragConfig,
        type,
        excludeIds: ex
      })
    }).then((r) => (r.ok ? r.json() : { hits: [] }));
  };

  try {
    const [novelData, scrapData, sumData] = await Promise.all([
      run('novel', nc),
      run('scrapbook', sc),
      run('novel_summary', sumc)
    ]);
    const novelRefs = Array.isArray(novelData.hits) ? novelData.hits.map((h) => ({ ...h, type: h.type || 'novel' })) : [];
    const scrapbookRefs = Array.isArray(scrapData.hits) ? scrapData.hits : [];
    const summaryRefs = Array.isArray(sumData.hits)
      ? sumData.hits.map((h) => ({ ...h, type: h.type || 'novel_summary' }))
      : [];
    const refs = [...novelRefs, ...scrapbookRefs, ...summaryRefs];
    const context = refs
      .map((h, i) => `#${i + 1} [${h.type}] ${h.title || '未命名'}\n${h.text || ''}`)
      .join('\n\n');
    return { context, refs, novelRefs, scrapbookRefs, summaryRefs };
  } catch (e) {
    return { context: '', refs: [], novelRefs: [], scrapbookRefs: [], summaryRefs: [] };
  }
};

/**
 * 主对话发往 LLM API 的 messages 窗口：避免无限增长（多模态极耗 token）。
 * @param {number} maxMessages <=0 或未设置：取当前会话**全部**保留消息，至多 maxCap 条。
 */
export function sliceChatHistoryForApi(history, maxMessages, maxCap = 200) {
  const h = Array.isArray(history) ? history : [];
  if (h.length === 0) return [];
  const n = Number(maxMessages);
  const limit = !Number.isFinite(n) || n <= 0
    ? Math.min(h.length, maxCap)
    : Math.min(h.length, Math.max(1, Math.min(256, Math.floor(n))));
  return h.slice(-limit);
}

/**
 * 拼装 RAG 检索句。注意：会话历史过长时容易「锚死」在同一话题，多轮命中会雷同；
 * 可用 historyMaxMessages / historyMaxChars 收紧，或 userMessageOnly 只用本轮 input。
 */
export const buildRagQuery = ({
  input = '',
  historyMessages = [],
  resolvedChar = null,
  requiredTags = [],
  historyMaxMessages = 8,
  historyMaxChars = 0,
  userMessageOnly = false,
} = {}) => {
  const hints = resolvedChar?.name ? `当前角色名：角色:${resolvedChar.name}` : '';
  const currentInputPart = String(input || '').trim();

  let latest = '';
  if (!userMessageOnly) {
    const maxTurns = Math.max(0, Math.floor(Number(historyMaxMessages) || 0));
    if (maxTurns > 0) {
      latest = (Array.isArray(historyMessages) ? historyMessages : [])
        .slice(-maxTurns)
        .map((m) => getReadableText(m.content) || '')
        .filter(Boolean)
        .join('\n');
      const maxC = Number(historyMaxChars);
      if (Number.isFinite(maxC) && maxC > 0 && latest.length > maxC) {
        latest = latest.slice(-maxC);
      }
    }
  }

  const queryParts = [];
  if (currentInputPart) queryParts.push(currentInputPart);
  if (latest) queryParts.push(`最近对话：${latest}`);
  if (hints) queryParts.push(hints);

  return queryParts.filter(Boolean).join('\n').trim();
};

export const extractMentionedCharacters = (text, safeCharacters) => {
  if (!text || typeof text !== 'string') return [];
  const mentioned = new Set();
  safeCharacters.forEach(char => {
    if (char?.name && text.includes(char.name)) {
      mentioned.add(char);
    }
  });
  return Array.from(mentioned);
};

/** 扫描会话消息：是否使用过生图、是否出现过 Agent 工具块 */
export const scanSessionForFlags = (messages) => {
  let usedImageGen = false;
  let usedAgentTool = false;
  for (const m of messages || []) {
    const t = getReadableText(m.content) || '';
    if (Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url')) usedImageGen = true;
    if (t.includes('===NOVELAI_RESULT===') || t.includes('[召唤画师]') || t.includes('===NOVELAI_RETRY===')) usedImageGen = true;
    if (t.includes('===TOOL_ACTION===')) usedAgentTool = true;
    if (parseToolActionMessage(t)) usedAgentTool = true;
  }
  return { usedImageGen, usedAgentTool };
};

/** 从全会话文本中提取出现过的角色名，最多 3 个（用于列表小标） */
export const computeInvolvedCharacterNames = (messages, safeCharacters) => {
  const blob = (messages || [])
    .map((m) => {
      const base = getReadableText(m.content) || '';
      const p = m?.inspirationPayload;
      if (p && typeof p === 'object') {
        return [base, p.title, p.text, p.question].filter(Boolean).join('\n');
      }
      return base;
    })
    .join('\n');
  const mentioned = extractMentionedCharacters(blob, safeCharacters || []);
  const names = mentioned.map((c) => c.name).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 3);
};

export const buildCharacterSettingContext = (characters) => {
  if (!Array.isArray(characters) || characters.length === 0) return '';
  const HEXAGRAM_LABELS = ["项一", "项二", "项三", "项四", "项五", "项六"];
  return characters
    .map(char => {
      const hexagramData = Array.isArray(char.hexagram) && char.hexagram.length === 6
        ? Object.fromEntries(
            char.hexagram.map((value, idx) => [HEXAGRAM_LABELS[idx], value])
          )
        : null;
      const setting = {
        name: char.name,
        title: char.title,
        details: char.details,
        ...(hexagramData && { hexagram: hexagramData }),
        lore: char.lore,
        ...(char.combatDesc && { combatDesc: char.combatDesc }),
        ...(char.combatPoem && { combatPoem: char.combatPoem })
      };
      return `【${char.name}】\n${JSON.stringify(setting, null, 2)}`;
    })
    .join('\n\n');
};

export const addCurrentRoleTag = (tags, roleName) => normalizeTags([...(Array.isArray(tags) ? tags : []), roleName ? `角色:${roleName}` : '']);
export const promptTagsBeforeSave = (defaultTags) => {
  const preset = normalizeTags(defaultTags);
  const input = prompt('保存前可调整标签（支持中英文逗号/分号）：', preset.join(', '));
  if (input === null) return null;
  const parsed = parseTagsText(input);
  return parsed.length > 0 ? parsed : preset;
};

export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('图片转码失败'));
  reader.readAsDataURL(blob);
});

export const normalizeImageUrlForModel = async (url) => {
  if (typeof url !== 'string' || !url) return url;
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch (e) {
    console.warn('图片 URL 转 Base64 失败，保留原始 URL：', e.message);
    return url;
  }
};

/** 批量生图行：行尾可接若干段 @1–30 与/或 @角色名，顺序任意（如 @20@示例角色 与 @示例角色@20 均可）。从末端循环剥下，@ 前可不留空格。 */
export function parseBatchImageLine(line) {
  let s = String(line ?? '').trim();
  if (!s) return { prompt: '', repeat: 1, charName: null };
  let repeat = 1;
  let charName = null;
  const isRepeatCountToken = (tail) => {
    const t = String(tail ?? '').trim();
    const n = parseInt(t, 10);
    return t !== '' && String(n) === t && n >= 1 && n <= 30;
  };
  for (;;) {
    const mNum = s.match(/^(.*)\s*@([1-9]|[12][0-9]|30)\s*$/s);
    if (mNum) {
      repeat = Math.min(30, Math.max(1, parseInt(mNum[2], 10)));
      s = mNum[1].trim();
      continue;
    }
    const mName = s.match(/^(.*)\s*@(.+?)\s*$/s);
    if (mName) {
      const tail = mName[2].trim();
      if (isRepeatCountToken(tail)) {
        repeat = Math.min(30, Math.max(1, parseInt(tail, 10)));
        s = mName[1].trim();
        continue;
      }
      charName = tail;
      s = mName[1].trim();
      continue;
    }
    break;
  }
  return { prompt: s, repeat, charName };
}

export function findCharacterByBatchName(safeCharacters, rawName) {
  const n = String(rawName ?? '').trim();
  if (!n) return null;
  const list = Array.isArray(safeCharacters) ? safeCharacters : [];
  return list.find((c) => c?.name === n) || list.find((c) => c?.name && n.startsWith(c.name)) || null;
}

export async function resolveCharacterPortraitDataUrl(safeCharacters, charName) {
  const c = findCharacterByBatchName(safeCharacters, charName);
  if (!c?.image) return null;
  const src = c.image;
  if (String(src).startsWith('data:')) return src;
  return normalizeImageUrlForModel(src);
}

/** 将多行扩成任务队列：每行 { prompt, charName } 重复 repeat 次 */
export function expandBatchImageJobs(trimmedLines) {
  const jobs = [];
  for (const line of trimmedLines) {
    const { prompt, repeat, charName } = parseBatchImageLine(line);
    if (!prompt) continue;
    const r = Math.min(30, Math.max(1, repeat));
    for (let k = 0; k < r; k += 1) {
      jobs.push({ prompt, charName });
    }
  }
  return jobs;
}

export const normalizeMessageForEndpoint = async (msg, useMultimodal) => {
  if (!useMultimodal) return { ...msg, content: getReadableText(msg.content) };
  if (!Array.isArray(msg.content)) return { ...msg, content: getReadableText(msg.content) };
  const normalizedParts = await Promise.all(msg.content.map(async (part) => {
    if (part?.type === 'text') {
      return { ...part, text: getReadableText(part.text) };
    }
    if (part?.type !== 'image_url') return part;
    const rawUrl = part.image_url?.url || '';
    const safeUrl = await normalizeImageUrlForModel(rawUrl);
    return { ...part, image_url: { ...(part.image_url || {}), url: safeUrl } };
  }));
  return { ...msg, content: normalizedParts };
};

export const extractNovelAiMeta = (content) => {
  if (typeof content !== 'string') return null;
  const metaMatch = content.match(/===NOVELAI_META===\s*([\s\S]*?)(?:=============|$)/);
  if (!metaMatch) return null;
  try {
    return JSON.parse(metaMatch[1].trim());
  } catch (e) {
    return null;
  }
};

/** 与 vite `computeNovelOverlapExcludeIds` 一致：按光标前 referenceChars 窗口排除与原文/摘要切片重叠的 id */
export async function fetchNovelOverlapExcludeIds({ novelContent, chapterIndex, cursorInChapter, referenceChars }) {
  try {
    const res = await fetch('/api/rag/novel-overlap-exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelContent: String(novelContent || ''),
        chapterIndex: Number(chapterIndex) || 0,
        cursorInChapter: Number(cursorInChapter) || 0,
        referenceChars: Math.max(200, Math.min(8000, Number(referenceChars) || 1000))
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.excludeIds) ? data.excludeIds : [];
  } catch (e) {
    return [];
  }
}

/** @deprecated 旧版按 400 字滑窗推 novel_i，与现行索引 id（novel_{chapterKey}_{piece}）不一致；请用 fetchNovelOverlapExcludeIds */
export const calculateExcludeIdsForContinue = (fullContent, beforeText) => {
  const cursorPos = fullContent.lastIndexOf(beforeText) + beforeText.length;

  const chunkSize = 400;
  const overlap = 100;
  const excludeIds = [];

  let pos = 0;
  let chunkIndex = 0;
  let currentChunkIndex = -1;

  while (pos < fullContent.length) {
    const chunkEnd = Math.min(fullContent.length, pos + chunkSize);

    if (cursorPos >= pos && cursorPos <= chunkEnd) {
      currentChunkIndex = chunkIndex;
      break;
    }

    if (chunkEnd >= fullContent.length) break;
    pos = Math.max(0, chunkEnd - overlap);
    chunkIndex++;
  }

  if (currentChunkIndex >= 0) {
    const startExclude = Math.max(0, currentChunkIndex - 5);
    for (let i = startExclude; i <= currentChunkIndex; i++) {
      excludeIds.push(`novel_${i}`);
    }
  }

  return excludeIds;
};

export const isLikelyUntitledCaption = (rawCaption) => {
  const caption = String(rawCaption || '').trim();
  if (!caption) return true;
  if (caption === '无题' || caption === '点击输入标题') return true;
  if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(caption)) return true;
  if (/^(img|image|dsc|pxl|mmexport|wechat|wx|screenshot|screen|photo|pic|untitled|new[-_ ]?image)[-_ ]?\d*$/i.test(caption)) return true;
  if (/^[a-z]{2,}[-_ ]?\d{3,}$/i.test(caption)) return true;
  if (/^\d{6,}$/.test(caption)) return true;
  const hasChinese = /[\u3400-\u9fff]/.test(caption);
  const alphaNumLike = caption.replace(/[\s\-_.]/g, '');
  const mostlyAlphaNum = alphaNumLike.length > 0 && /^[a-z0-9]+$/i.test(alphaNumLike);
  if (!hasChinese && mostlyAlphaNum) return true;
  return false;
};

export const getCharacterCarouselLayout = (index, active, total) => {
  const offset = index - active;
  const spread = Math.max(total - 1, 1);
  const angle = (offset / spread) * Math.PI * 0.92;
  const radius = Math.min(520, 190 + total * 16);
  const x = Math.sin(angle) * radius * 0.92;
  return {
    offset,
    x,
    z: Math.cos(angle) * radius - radius + 52,
    rotateY: (-angle * 0.78 * 180) / Math.PI,
    scale: index === active ? 1.08 : Math.max(0.5, 1 - Math.abs(offset) * 0.1),
    opacity: index === active ? 1 : Math.max(0.2, 1 - Math.abs(offset) * 0.15),
    y: Math.abs(offset) * 2,
  };
};

export const normalizeToolActionKey = (sessionId, msgIndex) => `${sessionId}:${msgIndex}`;

/** 剥离历史消息里可能残留的 Agent 多轮调试注释（前端已移除 Agent UI，保留兼容旧会话） */
export const stripAgentTrace = (content) => {
  if (typeof content !== 'string') return content;
  return content.replace(/<!-- AGENT_TRACE: [\s\S]*? -->/, '').trim();
};

const createAbortError = (message = 'aborted') => {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
};

export const generateRollingSummaries = async (chunks, onProgress, options = {}) => {
  const getChapterOrder = (doc) => {
    const key = String(doc?.chapterKey || '');
    const m = key.match(/^ch(\d+)_/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const docs = (Array.isArray(chunks) ? chunks : [])
    .filter(doc => doc?.type === 'novel')
    .sort((a, b) => {
      const byChapterOrder = getChapterOrder(a) - getChapterOrder(b);
      if (byChapterOrder !== 0) return byChapterOrder;
      const byChapter = String(a.chapterTitle || '').localeCompare(String(b.chapterTitle || ''), 'zh-Hans-CN');
      if (byChapter !== 0) return byChapter;
      return Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
    });

  const endpoint = options?.endpoint || null;
  const signal = options?.signal;
  const forceRegenerate = options?.forceRegenerate === true;
  const shouldStop = typeof options?.shouldStop === 'function' ? options.shouldStop : () => false;
  const fetchSummaryOne = options?.fetchSummaryOne || (async (payload) => {
    const res = await fetch('/api/rag/summarize-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  });

  if (!endpoint?.url || !endpoint?.key || !endpoint?.model) {
    throw new Error('请先配置并选择可用的文本模型节点');
  }

  let previousChunkSummary = '';
  let previousPreviousChunkSummary = '';
  let processed = 0;
  let skipped = 0;
  const updatedMap = new Map();
  const total = docs.length;

  for (let i = 0; i < docs.length; i += 1) {
    if (signal?.aborted || shouldStop()) throw createAbortError('用户已停止生成');

    const doc = docs[i];
    const existingSummary = String(doc?.ai_metadata?.summary || '').trim();
    if (!forceRegenerate && existingSummary) {
      skipped += 1;
      previousPreviousChunkSummary = previousChunkSummary;
      previousChunkSummary = existingSummary;
      updatedMap.set(doc.id, doc);
      onProgress?.({
        current: i + 1,
        total,
        processed,
        skipped,
        status: 'skipped',
        docId: doc.id,
        doc
      });
      continue;
    }

    const result = await fetchSummaryOne({
      docId: doc.id,
      endpoint: {
        url: endpoint.url,
        key: endpoint.key,
        model: endpoint.model
      },
      forceRegenerate,
      previousChunkSummary,
      previousPreviousChunkSummary
    });

    const updatedDoc = result?.doc || doc;
    const newSummary = String(updatedDoc?.ai_metadata?.summary || result?.ai_metadata?.summary || '').trim();
    previousPreviousChunkSummary = previousChunkSummary;
    previousChunkSummary = newSummary;
    processed += 1;
    updatedMap.set(doc.id, updatedDoc);

    onProgress?.({
      current: i + 1,
      total,
      processed,
      skipped,
      status: 'generated',
      docId: doc.id,
      doc: updatedDoc
    });
  }

  return {
    updatedDocs: docs.map(doc => updatedMap.get(doc.id) || doc),
    processed,
    skipped,
    total
  };
};
