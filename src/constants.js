// --- 颜色配置 ---
export const COLOR_THEMES = {
  emerald: { name: "竹青", text: "text-emerald-800", textLight: "text-emerald-600", border: "border-emerald-700", bg: "bg-emerald-100", bgGradient: "from-emerald-50/80 to-emerald-100/20", bgDark: "bg-emerald-800", inputBorder: "focus:border-emerald-800", accent: "#047857", shimmer: "via-emerald-400/30" },
  red: { name: "朱砂", text: "text-red-800", textLight: "text-red-600", border: "border-red-700", bg: "bg-red-50", bgGradient: "from-red-50/80 to-red-100/20", bgDark: "bg-red-800", inputBorder: "focus:border-red-800", accent: "#b91c1c", shimmer: "via-red-400/30" },
  purple: { name: "紫檀", text: "text-purple-900", textLight: "text-purple-700", border: "border-purple-800", bg: "bg-purple-50", bgGradient: "from-purple-50/80 to-purple-100/20", bgDark: "bg-purple-900", inputBorder: "focus:border-purple-800", accent: "#6b21a8", shimmer: "via-purple-400/30" },
  yellow: { name: "藤黄", text: "text-yellow-800", textLight: "text-yellow-600", border: "border-yellow-600", bg: "bg-yellow-50", bgGradient: "from-yellow-50/80 to-yellow-100/20", bgDark: "bg-yellow-700", inputBorder: "focus:border-yellow-700", accent: "#a16207", shimmer: "via-yellow-400/30" },
  sky: { name: "霁青", text: "text-sky-800", textLight: "text-sky-600", border: "border-sky-700", bg: "bg-sky-50", bgGradient: "from-sky-50/80 to-sky-100/20", bgDark: "bg-sky-800", inputBorder: "focus:border-sky-800", accent: "#0369a1", shimmer: "via-sky-400/30" },
  cyan: { name: "月白", text: "text-cyan-800", textLight: "text-cyan-600", border: "border-cyan-700", bg: "bg-cyan-50", bgGradient: "from-cyan-50/80 to-cyan-100/20", bgDark: "bg-cyan-800", inputBorder: "focus:border-cyan-800", accent: "#0e7490", shimmer: "via-cyan-400/30" },
  orange: { name: "雄黄", text: "text-orange-800", textLight: "text-orange-600", border: "border-orange-700", bg: "bg-orange-50", bgGradient: "from-orange-50/80 to-orange-100/20", bgDark: "bg-orange-800", inputBorder: "focus:border-orange-800", accent: "#c2410c", shimmer: "via-orange-400/30" },
  lime: { name: "柳绿", text: "text-lime-800", textLight: "text-lime-600", border: "border-lime-700", bg: "bg-lime-50", bgGradient: "from-lime-50/80 to-lime-100/20", bgDark: "bg-lime-800", inputBorder: "focus:border-lime-800", accent: "#4d7c0f", shimmer: "via-lime-400/30" },
  white: { name: "雪白", text: "text-slate-600", textLight: "text-slate-400", border: "border-slate-200", bg: "bg-white", bgGradient: "from-white/90 to-slate-100/50", bgDark: "bg-slate-400", inputBorder: "focus:border-slate-300", accent: "#94a3b8", shimmer: "via-white/80" },
  rose: { name: "胭脂", text: "text-rose-800", textLight: "text-rose-600", border: "border-rose-700", bg: "bg-rose-50", bgGradient: "from-rose-50/80 to-rose-100/20", bgDark: "bg-rose-800", inputBorder: "focus:border-rose-800", accent: "#be123c", shimmer: "via-rose-400/30" },
  teal: { name: "黛色", text: "text-teal-800", textLight: "text-teal-600", border: "border-teal-700", bg: "bg-teal-50", bgGradient: "from-teal-50/80 to-teal-100/20", bgDark: "bg-teal-800", inputBorder: "focus:border-teal-800", accent: "#0f766e", shimmer: "via-teal-400/30" },
  padparadscha: { name: "莲花", text: "text-rose-700", textLight: "text-rose-500", border: "border-rose-400", bg: "bg-orange-50", bgGradient: "from-rose-50/80 to-orange-50/20", bgDark: "bg-rose-500", inputBorder: "focus:border-rose-400", accent: "#f47983", shimmer: "via-rose-300/30" },
  imperialJade: { name: "阳绿", text: "text-emerald-900", textLight: "text-emerald-700", border: "border-emerald-600", bg: "bg-green-50", bgGradient: "from-emerald-100/80 to-green-50/20", bgDark: "bg-green-700", inputBorder: "focus:border-emerald-600", accent: "#00a86b", shimmer: "via-green-400/30" },
  glacier: { name: "冰川", text: "text-cyan-800", textLight: "text-cyan-600", border: "border-cyan-300", bg: "bg-cyan-50/50", bgGradient: "from-cyan-50/80 to-blue-50/20", bgDark: "bg-cyan-600", inputBorder: "focus:border-cyan-300", accent: "#7ac5cd", shimmer: "via-cyan-300/30" },
  cornflower: { name: "矢车菊", text: "text-indigo-900", textLight: "text-indigo-700", border: "border-indigo-500", bg: "bg-indigo-50", bgGradient: "from-indigo-100/80 to-blue-50/20", bgDark: "bg-indigo-700", inputBorder: "focus:border-indigo-500", accent: "#6495ed", shimmer: "via-indigo-400/30" },
  darkTeal: { name: "深黛", text: "text-teal-950", textLight: "text-teal-800", border: "border-teal-900", bg: "bg-teal-50", bgGradient: "from-teal-100/50 to-slate-100/20", bgDark: "bg-teal-950", inputBorder: "focus:border-teal-900", accent: "#004b49", shimmer: "via-teal-700/30" },
  neonBlue: { name: "霓虹", text: "text-cyan-900", textLight: "text-cyan-700", border: "border-cyan-500", bg: "bg-cyan-50", bgGradient: "from-cyan-100/80 to-sky-50/20", bgDark: "bg-cyan-600", inputBorder: "focus:border-cyan-500", accent: "#00bfff", shimmer: "via-cyan-400/30" },
  springTide: { name: "碧漪", text: "text-[#009688]", textLight: "text-[#1ac9b2]", border: "border-[#1ac9b2]/30", bg: "bg-[#f4fdfc]", bgGradient: "from-[#ecfaf8] to-white", bgDark: "bg-[#5BF3D3]", inputBorder: "focus:border-[#5BF3D3]", accent: "#1ac9b2", shimmer: "via-[#5BF3D3]/50" }
};

export const CUSTOM_THEME_PREFIX = 'custom:';

export const normalizeHexColor = (input) => {
  const raw = String(input || '').trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) return null;
  if (normalized.length === 4) {
    return `#${normalized.slice(1).split('').map(ch => ch + ch).join('').toUpperCase()}`;
  }
  return normalized.toUpperCase();
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const hexToRgb = (hex) => {
  const safe = normalizeHexColor(hex);
  if (!safe) return null;
  return {
    r: parseInt(safe.slice(1, 3), 16),
    g: parseInt(safe.slice(3, 5), 16),
    b: parseInt(safe.slice(5, 7), 16)
  };
};
const rgbToHex = ({ r, g, b }) => `#${[r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export const makeCustomThemeKey = (input) => {
  const hex = normalizeHexColor(input);
  return hex ? `${CUSTOM_THEME_PREFIX}${hex.slice(1)}` : null;
};

export const buildCustomTheme = (input) => {
  const hex = normalizeHexColor(input);
  const rgb = hexToRgb(hex);
  if (!hex || !rgb) return null;

  // --- RGB → Linear → OKLab → OKLCH ---
  const toLinear = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const rgbToOklch = ({ r, g, b }) => {
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    // Linear RGB → OKLab (via XYZ, Oklab matrix)
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const C = Math.sqrt(a * a + bv * bv);
    const H = Math.atan2(bv, a);
    return { L, C, H };
  };
  const oklchToRgb = ({ L, C, H }) => {
    const a = C * Math.cos(H), bv = C * Math.sin(H);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * bv;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * bv;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * bv;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const lr =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    const toSrgb = (c) => {
      const clipped = Math.max(0, Math.min(1, c));
      return Math.round((clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1/2.4) - 0.055) * 255);
    };
    return { r: toSrgb(lr), g: toSrgb(lg), b: toSrgb(lb) };
  };

  const ok = rgbToOklch(rgb);
  const isBrightTheme = ok.L > 0.75; // OKLCH L 感知亮度阈值

  // 色相锁死 ok.H，只动 L 和 C
  // 背景：极淡透亮
  const light = rgbToHex(oklchToRgb({ L: 0.97, C: Math.min(ok.C * 0.15, 0.025), H: ok.H }));
  // 中层柔光
  const mid   = rgbToHex(oklchToRgb({ L: 0.93, C: Math.min(ok.C * 0.20, 0.035), H: ok.H }));
  // 强调块：原色本体
  const dark  = hex;
  // 文字主色：亮色主题压暗到深色；深色主题略压
  const textColor = rgbToHex(oklchToRgb({
    L: isBrightTheme ? 0.28 : 0.35,
    C: Math.min(ok.C * 0.55, 0.12),
    H: ok.H
  }));
  // 文字次色
  const textLight = rgbToHex(oklchToRgb({
    L: isBrightTheme ? 0.42 : 0.50,
    C: Math.min(ok.C * 0.45, 0.10),
    H: ok.H
  }));
  // 边框：轻薄
  const borderColor = rgbToHex(oklchToRgb({ L: 0.82, C: Math.min(ok.C * 0.30, 0.06), H: ok.H }));

  return {
    name: `自定 ${hex}`,
    text: '',
    textLight: '',
    border: '',
    bg: '',
    bgGradient: '',
    bgDark: '',
    inputBorder: '',
    accent: hex,
    shimmer: '',
    isCustom: true,
    styles: {
      textColor,
      textLight,
      borderColor,
      bgColor: light,
      bgSoft: mid,
      bgDark: dark,
      gradient: `linear-gradient(135deg, ${light}F0 0%, ${mid}50 100%)`
    }
  };
};

/** 预设主题无 styles.textColor 时，用与自定主题相同的算法从 accent 推出正文色 */
export const resolveThemeTextColorHex = (theme) => {
  if (!theme) return '#0F172A';
  if (theme.isCustom && theme.styles?.textColor) return theme.styles.textColor;
  const built = buildCustomTheme(theme.accent);
  if (built?.styles?.textColor) return built.styles.textColor;
  return '#0F172A';
};

/** 向深色混合，用于场景里需要再压一档对比度的文字 */
export const deepenHexColor = (input, ratio = 0.2) => {
  const safe = normalizeHexColor(input);
  if (!safe) return '#0F172A';
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const t = clamp(ratio, 0, 1);
  const tr = 2;
  const tg = 6;
  const tb = 23;
  return rgbToHex({
    r: Math.round(r * (1 - t) + tr * t),
    g: Math.round(g * (1 - t) + tg * t),
    b: Math.round(b * (1 - t) + tb * t),
  });
};

/** 将正文色向主题 accent 混合，略提饱和度（如展示「环绕短句」环绕句） */
export const blendTextTowardAccent = (textHex, accentHex, amount = 0.24) => {
  const t = clamp(amount, 0, 1);
  const a = hexToRgb(textHex);
  const b = hexToRgb(accentHex);
  if (!a) return String(textHex || '#0F172A');
  if (!b) return rgbToHex(a);
  return rgbToHex({
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  });
};

export const resolveTheme = (themeKey) => {
  if (themeKey === 'tianqing') {
    return buildCustomTheme('#5BF3D7') || COLOR_THEMES.orange;
  }
  if (themeKey && COLOR_THEMES[themeKey]) return COLOR_THEMES[themeKey];
  if (typeof themeKey === 'string' && themeKey.startsWith(CUSTOM_THEME_PREFIX)) {
    return buildCustomTheme(`#${themeKey.slice(CUSTOM_THEME_PREFIX.length)}`) || COLOR_THEMES.orange;
  }
  return COLOR_THEMES.orange;
};


export const HEXAGRAM_LABELS = ["项一", "项二", "项三", "项四", "项五", "项六"];

export const CHARACTER_POWER_MAP = {
  // Public builds intentionally ship without private character power data.
  // Add local entries in your private data layer if you need fixed rankings.
};

export const DEFAULT_CHARACTERS = [
  { id: 1, name: "示例角色", title: "虚位以待", theme: "sky", details: { phase: "初始阶段", age: "??", weapon: "未知", faction: "无" }, hexagram: [3, 3, 3, 3, 3, 3], lore: "等待数据加载中...", image: null, combatImg: null, combatDesc: "暂无数据", combatPoem: "加载中...", storyImgs: [], background: null }
];

export const DEFAULT_AI_ENDPOINTS = [
  { id: 'ep_1', name: 'DeepSeek (高性价)', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', key: '', mode: 'text' }
];

export const RESOLUTIONS = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 }
};
