import { DEFAULT_CHARACTERS } from './constants';
import { scanSessionForFlags, computeInvolvedCharacterNames } from './appHelpers';

// 判断字符串是否为 Base64 图片
export const isBase64Image = (str) => typeof str === 'string' && str.startsWith('data:image/');

// 判断字符串是否为服务器路径（/data/...）
export const isServerPath = (str) => typeof str === 'string' && str.startsWith('/data/');

export const sanitizeCharacters = (chars) => {
  if (!Array.isArray(chars) || chars.length === 0) return DEFAULT_CHARACTERS;
  return chars.filter(Boolean).map(c => ({
    id: c.id || Date.now() + Math.random(),
    name: c.name || "未知角色", title: c.title || "", theme: c.theme || "orange",
    details: { phase: c.details?.phase || "未知", age: c.details?.age || "未知", weapon: c.details?.weapon || "未知", faction: c.details?.faction || "未知" },
    hexagram: (Array.isArray(c.hexagram) && c.hexagram.length === 6) ? c.hexagram : [3,3,3,3,3,3],
    lore: c.lore || "", image: c.image || null, combatImg: c.combatImg || null,
    combatDepthImg: c.combatDepthImg || null,
    combatDesc: c.combatDesc || "", combatPoem: c.combatPoem || "",
    combatVerses: typeof c.combatVerses === 'string' ? c.combatVerses : (c.combatVerses != null ? String(c.combatVerses) : ''),
    formOverrides: c.formOverrides || {},
    storyImgs: Array.isArray(c.storyImgs) ? c.storyImgs.map((img, idx) => {
      const src = typeof img === 'string' ? img : (img?.src || "");
      const fallbackName = typeof img === 'string' ? "无题" : (img?.name || img?.caption || "无题");
      const seqRaw = typeof img === 'object' && img ? (img.seq ?? img.order ?? img.imageNumber ?? img.imageIndex) : null;
      const seqNum = Number(seqRaw);
      const seq = Number.isFinite(seqNum) ? Math.max(1, Math.floor(seqNum)) : (idx + 1);
      return {
        seq,
        name: fallbackName,
        src,
        description: typeof img === 'object' && img ? String(img.description || img.desc || '') : '',
        // 兼容旧逻辑：当前图库图标题仍沿用 caption 字段
        caption: fallbackName,
      };
    }) : [],
    background: c.background || null
  }));
};

export const sanitizeScrapbook = (sb) => {
  const normalizeTags = (tags) => {
    if (!Array.isArray(tags)) return [];
    const cleaned = tags
      .map(t => String(t || '').trim())
      .filter(Boolean);
    return Array.from(new Set(cleaned));
  };
  if (!Array.isArray(sb)) return [];
  return sb.filter(Boolean).map(s => ({ id: s.id || Date.now() + Math.random(), title: s.title || "", content: s.content || "", image: s.image || null, tags: normalizeTags(s.tags) }));
};

export const createNewSession = () => ({
  id: `sess_${Date.now()}`,
  title: '新对话',
  mode: 'world',
  messages: [{ role: 'assistant', content: '仙灵助手与首席画师已就绪。请确认您在设置中配置了语言大模型(翻译提示词)以及 NovelAI 接口参数。' }],
  sessionFlags: { usedImageGen: false, usedAgentTool: false },
  involvedCharacterNames: []
});

export const createInspirationSession = () => ({
  id: `sess_${Date.now()}`,
  title: '灵感交流',
  mode: 'inspiration',
  messages: [],
  inspirationChunkMap: {},
  inspirationFirstSeed: '',
  sessionFlags: { usedImageGen: false, usedAgentTool: false },
  involvedCharacterNames: []
});

/** 普通对话不再使用会话级 characterId；读档时剥掉旧字段，统一为项目设定会话 */
const stripSessionCharacterBinding = (sess) => {
  if (!sess || sess.mode === 'inspiration') return sess;
  const { characterId, characterName, ...rest } = sess;
  return { ...rest, mode: 'world' };
};

const normalizeSessionShape = (s, safeCharacters = null) => {
  if (!s || !Array.isArray(s.messages)) return s;
  const cleaned = stripSessionCharacterBinding(s);
  const base = {
    ...cleaned,
    inspirationChunkMap: cleaned.inspirationChunkMap && typeof cleaned.inspirationChunkMap === 'object' ? cleaned.inspirationChunkMap : {},
    inspirationFirstSeed: typeof cleaned.inspirationFirstSeed === 'string' ? cleaned.inspirationFirstSeed : ''
  };
  const chars = Array.isArray(safeCharacters) && safeCharacters.length > 0 ? safeCharacters : null;
  if (chars) {
    return {
      ...base,
      sessionFlags: scanSessionForFlags(s.messages),
      involvedCharacterNames: computeInvolvedCharacterNames(s.messages, chars)
    };
  }
  return {
    ...base,
    sessionFlags: s.sessionFlags && typeof s.sessionFlags === 'object'
      ? { usedImageGen: !!s.sessionFlags.usedImageGen, usedAgentTool: !!s.sessionFlags.usedAgentTool }
      : { usedImageGen: false, usedAgentTool: false },
    involvedCharacterNames: Array.isArray(s.involvedCharacterNames) ? s.involvedCharacterNames : []
  };
};

/**
 * @param {unknown} sessions
 * @param {unknown} oldChats
 * @param {unknown[] | null} safeCharacters 传入时按 messages 回填 sessionFlags / involvedCharacterNames（旧存档也有小标）
 */
export const sanitizeAiSessions = (sessions, oldChats, safeCharacters = null) => {
  if (Array.isArray(sessions) && sessions.length > 0 && sessions[0].messages) {
    return sessions.map((sess) => normalizeSessionShape(sess, safeCharacters));
  }
  if (Array.isArray(oldChats) && oldChats.length > 0) {
    return [normalizeSessionShape({ id: `sess_legacy`, title: '历史对话留存', messages: oldChats }, safeCharacters)];
  }
  return [createNewSession()];
};

// 对齐官方 Precise Reference 预处理：映射到三种标准画布并输出 PNG Base64。
export const processImageForNAI = async (dataUrl) => {
  return new Promise((resolve) => {
    const TARGET_SIZES = [[1024, 1536], [1536, 1024], [1472, 1472]];
    const img = new Image();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 15_000);
    img.onload = () => {
      try {
        const srcRatio = img.width / img.height;
        let target = TARGET_SIZES[0];
        for (const candidate of TARGET_SIZES) {
          const candidateRatio = candidate[0] / candidate[1];
          const targetRatio = target[0] / target[1];
          if (Math.abs(candidateRatio - srcRatio) < Math.abs(targetRatio - srcRatio)) {
            target = candidate;
          }
        }
        const [canvasW, canvasH] = target;
        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { clearTimeout(timeout); finish(null); return; }
        const canvasRatio = canvasW / canvasH;
        let drawW = canvasW;
        let drawH = canvasH;
        if (srcRatio > canvasRatio) {
          drawH = Math.round(canvasW / srcRatio);
        } else {
          drawW = Math.round(canvasH * srcRatio);
        }
        // 官方流程使用黑底铺满后居中绘制
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, Math.round((canvasW - drawW) / 2), Math.round((canvasH - drawH) / 2), drawW, drawH);
        const out = canvas.toDataURL('image/png').split(',')[1] || null;
        clearTimeout(timeout);
        finish(out);
      } catch (e) {
        clearTimeout(timeout);
        finish(null);
      }
    };
    img.onerror = () => { clearTimeout(timeout); finish(null); };
    img.src = dataUrl;
  });
};
