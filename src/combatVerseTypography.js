/**
 * 中间 **展示短句** 条（combatPoem）使用统一 Web 字：全新硬笔楷书简（见 getCombatPoemUiFontFamily）。
 * **环绕短句**（combatVerses：编辑框 + 3D 飘字）仍按角色选用 font-family。
 * 「母版字体库」里「长城*.TTF」「文鼎*.ttf」等原版 cmap 非浏览器 Unicode BMP，需先运行：
 *   pip install fonttools && python scripts/rebuild_legacy_font_cmap.py
 * 生成 `*_web.ttf` 到「字体库」，由 combatVerseFonts.css 引用。
 * 「迷你简黄草体」原版 cmap 会被 Chrome OTS 拒解析，须使用 `迷你简黄草体_web.ttf`。
 */
export const FONT_FACE_ZHONGQI_HANMO = 'CombatVerseZhongqiHanmo';
export const FONT_FACE_YEGENYOU_CANYAN_LISHU = 'CombatVerseYegenyouCanyanLishu';
export const FONT_FACE_ZHANGCAO = 'CombatVerseZhangcao';
export const FONT_FACE_BOYANG_KAI_7000 = 'CombatVerseBoyangKai7000';
export const FONT_FACE_BOYANG_CAOSHU_7000 = 'CombatVerseBoyangCaoshu7000';
export const FONT_FACE_CHANGCHENG_XINGKAI = 'CombatVerseChangchengXingkai';
export const FONT_FACE_SHUTIFANG_ZHAO_JIUJIANG = 'CombatVerseShutifangZhaoJiujiang';
export const FONT_FACE_CHANGCHENG_ZHONGLI = 'CombatVerseChangchengZhongli';
export const FONT_FACE_CHANGCHENG_CUWEIBEI = 'CombatVerseChangchengCuWeibei';
export const FONT_FACE_MINIJIAN_HUANGCAO = 'CombatVerseMinijianHuangcao';
export const FONT_FACE_SHUTIFANG_AN_JINGCHEN = 'CombatVerseShutifangAnJingchen';

const FALLBACK = '"Noto Serif SC", "Source Han Serif CN", serif';

/** 展示短句条专用（全角色统一）；用「全新硬笔楷书简_web.ttf」（脚本会修 cmap / 去掉坏掉的 vhea·vmtx）。 */
export const FONT_FACE_POEM_UI_YINGBIKAI = 'CombatVersePoemUiYingbikai';
/** 本地楷体回退 + size-adjust，见 combatVerseFonts.css */
export const FONT_FACE_POEM_KAI_FALLBACK = 'CombatPoemKaiFallback';

export function getCombatPoemUiFontFamily() {
  return `${FONT_FACE_POEM_UI_YINGBIKAI}, ${FONT_FACE_POEM_KAI_FALLBACK}, ${FALLBACK}`;
}

/** @type {Record<string, string>} */
export const COMBAT_VERSE_FONT_FAMILY_BY_CHARACTER_NAME = {
  // Public builds intentionally ship without private character-name mappings.
  // Example: "Sample Character": `${FONT_FACE_ZHONGQI_HANMO}, ${FALLBACK}`,
};

/** 形态名等处的「・」(U+30FB) 与「·」(U+00B7) 统一，并去掉零宽字符，避免匹配不到字体表。 */
function normalizeCombatVerseCharacterName(raw) {
  let s = String(raw || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\u30FB/g, '\u00B7');
  try {
    s = s.normalize('NFC');
  } catch (e) {
    /* ignore */
  }
  return s;
}

function resolveCombatVerseKey(characterName) {
  const key = normalizeCombatVerseCharacterName(characterName);
  if (COMBAT_VERSE_FONT_FAMILY_BY_CHARACTER_NAME[key]) return key;
  const entries = Object.keys(COMBAT_VERSE_FONT_FAMILY_BY_CHARACTER_NAME);
  for (const base of entries) {
    if (key === base || key.startsWith(`${base}·`) || key.startsWith(`${base}\u00b7`)) return base;
  }
  return key;
}

export function getCombatVerseFontFamily(characterName) {
  const key = resolveCombatVerseKey(characterName);
  const custom = COMBAT_VERSE_FONT_FAMILY_BY_CHARACTER_NAME[key];
  if (custom) return custom;
  return FALLBACK;
}

/** 仅用于中间展示短句条：在环绕短句倍率上再乘此系数（此前要求的 +30%） */
export const COMBAT_VERSE_BASE_DISPLAY_SCALE = 1.3;

/** Optional per-character scale overrides; poem UI multiplies this by POEM_UI. */
/** @type {Record<string, number>} */
export const COMBAT_VERSE_FONT_SIZE_SCALE_BY_CHARACTER_NAME = {
  // "Sample Character": 1.2,
};

function getCombatVersePerCharacterScale(characterName) {
  const key = resolveCombatVerseKey(characterName);
  const s = COMBAT_VERSE_FONT_SIZE_SCALE_BY_CHARACTER_NAME[key];
  return typeof s === 'number' && s > 0 ? s : 1;
}

/** 环绕短句（编辑框 + 3D 飘字）字号倍率，不含全局 +30% */
export function getCombatVerseFontSizeScale(characterName) {
  return getCombatVersePerCharacterScale(characterName);
}

/** 中间展示短句条字号 = 角色基础 × COMBAT_VERSE_BASE_DISPLAY_SCALE */
export function getCombatPoemUiFontSizeScale(characterName) {
  return getCombatVersePerCharacterScale(characterName) * COMBAT_VERSE_BASE_DISPLAY_SCALE;
}
