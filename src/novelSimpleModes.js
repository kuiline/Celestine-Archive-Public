/**
 * 「简单续写 / 润色」多模式配置
 * 「星辰续写规划」另有独立配置：novelPlannerSettings.js（celestial_novel_planner_settings_v1）
 * 持久化：localStorage celestial_novel_simple_modes_v2
 */

export const SIMPLE_MODES_STORAGE_KEY = 'celestial_novel_simple_modes_v2'; // 与 loadSimpleModes 使用同一键
export const LEGACY_CONTINUE_SETTINGS_KEY = 'celestial_novel_continue_settings_v1';

export const makeModeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const DEFAULT_CONTINUE_PROMPT =
  '保持文风一致，紧接光标续写。只返回正文。';
const DEFAULT_POLISH_PROMPT =
  '你是小说润色编辑器。仅润色用户提供的选中文本，保持人物设定、语气与上下文一致，只返回润色后的正文。';

export const BLANK_CONTINUE_MODE = () => ({
  id: makeModeId('cm'),
  name: '新模式',
  systemPrompt: DEFAULT_CONTINUE_PROMPT,
  useCharacterContext: true,
  useRag: true,
  ragCounts: { novel: 4, scrapbook: 4, summary: 4 },
  referenceChars: 1000,
  afterContextChars: 300,
  targetLength: 500,
  temperature: 0.8
});

export const BLANK_POLISH_MODE = () => ({
  id: makeModeId('pm'),
  name: '新模式',
  systemPrompt: DEFAULT_POLISH_PROMPT,
  useCharacterContext: true,
  useRag: true,
  ragCounts: { novel: 3, scrapbook: 3, summary: 3 },
  refBeforeChars: 1000,
  refAfterChars: 300,
  temperature: 0.75
});

function normalizeRagCounts(base, o) {
  return {
    novel: Math.max(0, Math.min(24, Number(o?.novel ?? base.novel) || 0)),
    scrapbook: Math.max(0, Math.min(24, Number(o?.scrapbook ?? base.scrapbook) || 0)),
    summary: Math.max(0, Math.min(24, Number(o?.summary ?? base.summary) || 0))
  };
}

export function normalizeContinueMode(m) {
  const d = BLANK_CONTINUE_MODE();
  const x = { ...d, ...m };
  x.ragCounts = normalizeRagCounts(d.ragCounts, m?.ragCounts);
  x.referenceChars = Math.max(200, Math.min(8000, Number(x.referenceChars) || 1000));
  x.afterContextChars = Math.max(0, Math.min(2000, Number(x.afterContextChars) || 300));
  x.targetLength = Math.max(120, Math.min(1200, Number(x.targetLength) || 500));
  x.temperature = Math.max(0, Math.min(2, Number(x.temperature) || 0.8));
  if (!x.id) x.id = makeModeId('cm');
  return x;
}

export function normalizePolishMode(m) {
  const d = BLANK_POLISH_MODE();
  const x = { ...d, ...m };
  x.ragCounts = normalizeRagCounts(d.ragCounts, m?.ragCounts);
  x.refBeforeChars = Math.max(200, Math.min(8000, Number(x.refBeforeChars) || 1000));
  x.refAfterChars = Math.max(0, Math.min(2000, Number(x.refAfterChars) || 300));
  x.temperature = Math.max(0, Math.min(2, Number(x.temperature) || 0.75));
  if (!x.id) x.id = makeModeId('pm');
  return x;
}

function migrateFromLegacy() {
  let ref = 1000;
  let tgt = 500;
  let useRag = true;
  let sysC = DEFAULT_CONTINUE_PROMPT;
  let sysP = DEFAULT_POLISH_PROMPT;
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_CONTINUE_SETTINGS_KEY) || '{}');
    ref = Number(old.referenceChars) || 1000;
    tgt = Number(old.targetLength) || 500;
    if (old.useRag === false) useRag = false;
    if (old.systemPrompt) sysC = String(old.systemPrompt);
    if (old.polishSystemPrompt) sysP = String(old.polishSystemPrompt);
  } catch (e) {}

  const cm = normalizeContinueMode({
    id: makeModeId('cm'),
    name: '默认',
    systemPrompt: sysC,
    referenceChars: ref,
    targetLength: tgt,
    useRag
  });
  const pm = normalizePolishMode({
    id: makeModeId('pm'),
    name: '默认',
    systemPrompt: sysP,
    refBeforeChars: ref,
    useRag
  });
  return {
    continueModes: [cm],
    polishModes: [pm],
    activeContinueModeId: cm.id,
    activePolishModeId: pm.id
  };
}

export function loadSimpleModes() {
  try {
    const raw = localStorage.getItem(SIMPLE_MODES_STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.continueModes) && d.continueModes.length > 0) {
        const continueModes = d.continueModes.map((m) => normalizeContinueMode(m));
        const polishModes =
          Array.isArray(d.polishModes) && d.polishModes.length > 0
            ? d.polishModes.map((m) => normalizePolishMode(m))
            : [normalizePolishMode({ ...BLANK_POLISH_MODE(), name: '默认' })];
        let activeContinueModeId = d.activeContinueModeId;
        let activePolishModeId = d.activePolishModeId;
        if (!continueModes.some((x) => x.id === activeContinueModeId)) activeContinueModeId = continueModes[0].id;
        if (!polishModes.some((x) => x.id === activePolishModeId)) activePolishModeId = polishModes[0].id;
        return { continueModes, polishModes, activeContinueModeId, activePolishModeId };
      }
    }
  } catch (e) {}
  return migrateFromLegacy();
}

export function saveSimpleModes(state) {
  try {
    localStorage.setItem(SIMPLE_MODES_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}
