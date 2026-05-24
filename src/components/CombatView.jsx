import React from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { Zap, Quote, Upload, SlidersHorizontal } from 'lucide-react';
import { HEXAGRAM_LABELS, CHARACTER_POWER_MAP, resolveThemeTextColorHex, blendTextTowardAccent } from '../constants';
import {
  getCombatPoemUiFontFamily,
  getCombatPoemUiFontSizeScale,
  getCombatVerseFontFamily,
  getCombatVerseFontSizeScale,
} from '../combatVerseTypography';
import '../styles/combatVerseFonts.css';

const LocalInput = ({ value, onChange, ...props }) => {
  const [localVal, setLocalVal] = React.useState(value || '');
  React.useEffect(() => { setLocalVal(value || ''); }, [value]);
  return <input value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={e => onChange(e.target.value)} {...props} />;
};

const LocalTextarea = ({ value, onChange, ...props }) => {
  const [localVal, setLocalVal] = React.useState(value || '');
  React.useEffect(() => { setLocalVal(value || ''); }, [value]);
  return <textarea value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={e => onChange(e.target.value)} {...props} />;
};

/** 与 drei's preset="city" 为同一 HDR；raw.githubusercontent 在国内易断连，改用 jsDelivr 同步镜像 */
const COMBAT_ENV_CITY_HDR =
  '/hdri/potsdamer_platz_1k.hdr';

function pickRandomIndex(length, excludeIndex = -1) {
  if (!length) return 0;
  if (length === 1) return 0;
  let next = Math.floor(Math.random() * length);
  if (next === excludeIndex) next = (next + 1) % length;
  return next;
}

function useTimedRandomImage(images, intervalMs = 300000) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [visible, setVisible] = React.useState(true);
  const keyRef = React.useRef('');
  const fadeTimerRef = React.useRef(null);
  const switchTimerRef = React.useRef(null);

  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const key = list.join('|');

  React.useEffect(() => {
    if (key !== keyRef.current) {
      keyRef.current = key;
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      setCurrentIndex(pickRandomIndex(list.length));
      setVisible(true);
    }
  }, [key, list.length]);

  React.useEffect(() => {
    if (list.length <= 1) return undefined;

    const scheduleNext = () => {
      switchTimerRef.current = setTimeout(() => {
        setVisible(false);
        fadeTimerRef.current = setTimeout(() => {
          setCurrentIndex(prev => pickRandomIndex(list.length, prev));
          setVisible(true);
          scheduleNext();
        }, 600);
      }, intervalMs);
    };

    scheduleNext();

    return () => {
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [key, intervalMs, list.length]);

  return { src: list[currentIndex] || null, visible, index: currentIndex, images: list };
}

const FALLBACK_COMBAT_TEXTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b1226"/><stop offset="45%" stop-color="#111a33"/><stop offset="100%" stop-color="#1a2748"/></linearGradient><radialGradient id="r" cx="0.5" cy="0.48" r="0.7"><stop offset="0%" stop-color="rgba(255,255,255,0.14)"/><stop offset="100%" stop-color="rgba(0,0,0,0.45)"/></radialGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect width="1200" height="800" fill="url(#r)"/></svg>'
)}`;

const COMBAT_PARALLAX_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COMBAT_PARALLAX_FRAGMENT = `
  uniform sampler2D uTexture;
  uniform sampler2D uDepthMap;
  uniform vec2 uMouse;
  uniform float uIntensity;
  uniform float uFocalDepth;
  uniform float uPow;
  uniform float uUvInset;
  uniform float uOpacity;
  /** 远景相对前景的视差倍率：<1 时远景位移更小，交界撕边会弱很多（视觉重心在前景） */
  uniform float uBgParallaxMul;
  /** 深度域上的过渡宽度：越大焦平面两侧从「远景模式」到「前景模式」越柔和 */
  uniform float uDepthFeather;
  /** 远景方向额外羽化：按纹理像素做十字模糊，弱化远景错层感 */
  uniform float uBgBlurPx;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    float depth = texture2D(uDepthMap, vUv).r;
    float d = depth - uFocalDepth;
    float fgMask = uDepthFeather > 1e-4
      ? smoothstep(-uDepthFeather, uDepthFeather, d)
      : step(0.0, d);
    float amp = mix(uBgParallaxMul, 1.0, fgMask);
    float parallax = sign(d) * pow(abs(d), uPow) * uIntensity * amp;
    vec2 offset = -uMouse * parallax;
    vec2 lo = vec2(uUvInset);
    vec2 hi = vec2(1.0 - uUvInset);
    vec2 targetUv = clamp(vUv + offset, lo, hi);
    vec4 color = texture2D(uTexture, targetUv);
    float farBlend = 1.0 - fgMask;
    if (farBlend > 0.001 && uBgBlurPx > 1e-4) {
      vec2 s = uTexelSize * uBgBlurPx;
      vec4 c1 = texture2D(uTexture, clamp(targetUv + vec2(s.x, 0.0), lo, hi));
      vec4 c2 = texture2D(uTexture, clamp(targetUv - vec2(s.x, 0.0), lo, hi));
      vec4 c3 = texture2D(uTexture, clamp(targetUv + vec2(0.0, s.y), lo, hi));
      vec4 c4 = texture2D(uTexture, clamp(targetUv - vec2(0.0, s.y), lo, hi));
      vec4 soft = (color + c1 + c2 + c3 + c4) * 0.2;
      color = mix(color, soft, farBlend);
    }
    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 有垫图时：与单平面相同的深度驱动 UV 视差；远景权重下不从彩图「撕」像素，而采样 uBackground 的同向视差 UV。
 * fgMix 与编辑里分层蒙版一致（focalDepth / depthFeather / layerMaskFgPull / depthPow / 深度取反）。
 */
const COMBAT_LAYERED_PARALLAX_FRAGMENT = `
  uniform sampler2D uTexture;
  uniform sampler2D uBackground;
  uniform sampler2D uDepthMap;
  uniform vec2 uMouse;
  uniform float uIntensity;
  uniform float uFocalDepth;
  uniform float uPow;
  uniform float uUvInset;
  uniform float uBgParallaxMul;
  uniform float uDepthFeather;
  uniform float uBgBlurPx;
  uniform vec2 uTexelSize;
  uniform float uFgPull;
  uniform float uDepthInvert;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float raw = texture2D(uDepthMap, vUv).r;
    float d = raw - uFocalDepth;
    float fgMaskParallax = uDepthFeather > 1e-4
      ? smoothstep(-uDepthFeather, uDepthFeather, d)
      : step(0.0, d);
    float amp = mix(uBgParallaxMul, 1.0, fgMaskParallax);
    float parallaxFg = sign(d) * pow(abs(d), uPow) * uIntensity * amp;
    vec2 lo = vec2(uUvInset);
    vec2 hi = vec2(1.0 - uUvInset);
    vec2 targetUvFg = clamp(vUv - uMouse * parallaxFg, lo, hi);

    float parallaxBg = sign(d) * pow(abs(d), uPow) * uIntensity * uBgParallaxMul;
    vec2 targetUvBg = clamp(vUv - uMouse * parallaxBg, lo, hi);

    float r = mix(raw, 1.0 - raw, uDepthInvert);
    float x = pow(clamp(r, 0.0, 1.0), uPow);
    float fe = max(uDepthFeather, 0.018);
    float lowM = max(0.0, uFocalDepth - fe - uFgPull);
    float hiM = min(1.0, uFocalDepth + fe);
    float fgMix = smoothstep(lowM, hiM, x);

    vec4 colFront = texture2D(uTexture, targetUvFg);
    vec4 colBack = texture2D(uBackground, targetUvBg);

    float farBlend = 1.0 - fgMix;
    if (farBlend > 0.001 && uBgBlurPx > 1e-4) {
      vec2 s = uTexelSize * uBgBlurPx;
      vec4 b1 = texture2D(uBackground, clamp(targetUvBg + vec2(s.x, 0.0), lo, hi));
      vec4 b2 = texture2D(uBackground, clamp(targetUvBg - vec2(s.x, 0.0), lo, hi));
      vec4 b3 = texture2D(uBackground, clamp(targetUvBg + vec2(0.0, s.y), lo, hi));
      vec4 b4 = texture2D(uBackground, clamp(targetUvBg - vec2(0.0, s.y), lo, hi));
      vec4 softB = (colBack + b1 + b2 + b3 + b4) * 0.2;
      colBack = mix(colBack, softB, farBlend);
    }

    vec3 rgb = mix(colBack.rgb, colFront.rgb, fgMix);
    float alpha = mix(colBack.a, colFront.a, fgMix) * uOpacity;
    gl_FragColor = vec4(rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 与彩图同目录、同主文件名：foo.jpg → foo_background.* 候选列表。
 * 优先与彩图相同扩展名，再依次尝试 png/jpg/jpeg/webp，避免「combat.jpg + 磁盘上 combat_background.png」时只请求 jpg 导致 404、整段分层失败并回退视差重影。
 */
function buildCombatLayeredBackgroundCandidates(combatSrc) {
  if (!combatSrc || typeof combatSrc !== 'string') return [];
  if (!combatSrc.includes('/combats/')) return [];
  if (/_background\.(png|jpg|jpeg|webp)$/i.test(combatSrc)) return [];
  const m = combatSrc.match(/^(.*\/combats\/)([^/]+)\.(png|jpg|jpeg|webp)$/i);
  if (!m) return [];
  const dir = m[1];
  const stem = m[2];
  const origExt = m[3].toLowerCase();
  const order = [origExt, 'png', 'jpg', 'jpeg', 'webp'];
  const seen = new Set();
  const out = [];
  for (const e of order) {
    const low = e.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(`${dir}${stem}_background.${low}`);
  }
  return out;
}

/** 与 vite resolveCombatDepthImgUrl 顺序一致：先 combat_depth.png，再 {stem}_depth.*，最后库里的 combatDepthImg */
function buildCombatDepthCandidates(combatSrc, charFallbackDepth) {
  const out = [];
  if (combatSrc && typeof combatSrc === 'string') {
    const m = combatSrc.match(/^(.*\/combats\/)([^/]+)\.(png|jpg|jpeg|webp)$/i);
    if (m) {
      const dir = m[1];
      const stem = m[2];
      out.push(`${dir}combat_depth.png`);
      for (const e of ['png', 'jpg', 'jpeg', 'webp']) {
        out.push(`${dir}${stem}_depth.${e}`);
      }
    }
  }
  if (charFallbackDepth) out.push(charFallbackDepth);
  return [...new Set(out.filter(Boolean))];
}

function disposeTexture(tex) {
  try {
    if (tex && typeof tex.dispose === 'function') tex.dispose();
  } catch (e) { /* ignore */ }
}

/** 避免 useTexture 在 404/磁盘缺失时抛错拖垮整个 Canvas */
function useCombatColorTextureSafe(src) {
  const [texture, setTexture] = React.useState(null);
  const texRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const loader = new THREE.TextureLoader();
    let alive = true;
    const primary = src || FALLBACK_COMBAT_TEXTURE;

    const finish = (tex) => {
      if (!alive || !tex) return;
      if (texRef.current && texRef.current !== tex) disposeTexture(texRef.current);
      texRef.current = tex;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      setTexture(tex);
    };

    loader.load(
      primary,
      (tex) => finish(tex),
      undefined,
      () => {
        if (!alive) return;
        if (primary !== FALLBACK_COMBAT_TEXTURE) {
          loader.load(FALLBACK_COMBAT_TEXTURE, (tex) => finish(tex), undefined, () => {
            if (alive) {
              texRef.current = null;
              setTexture(null);
            }
          });
        } else {
          texRef.current = null;
          setTexture(null);
        }
      }
    );

    return () => {
      alive = false;
      disposeTexture(texRef.current);
      texRef.current = null;
    };
  }, [src]);

  return texture;
}

function useCombatParallaxTexturesSafe(src, charFallbackDepth) {
  const [colorTex, setColorTex] = React.useState(null);
  const [depthTex, setDepthTex] = React.useState(null);
  const colorRef = React.useRef(null);
  const depthRef = React.useRef(null);
  const depthTryRef = React.useRef(0);

  const depthCandidates = React.useMemo(
    () => buildCombatDepthCandidates(src, charFallbackDepth),
    [src, charFallbackDepth]
  );

  React.useLayoutEffect(() => {
    const loader = new THREE.TextureLoader();
    let alive = true;
    const primaryColor = src || FALLBACK_COMBAT_TEXTURE;

    const finishColor = (tex) => {
      if (!alive || !tex) return;
      if (colorRef.current && colorRef.current !== tex) disposeTexture(colorRef.current);
      colorRef.current = tex;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      setColorTex(tex);
    };

    loader.load(
      primaryColor,
      (tex) => finishColor(tex),
      undefined,
      () => {
        if (!alive) return;
        if (primaryColor !== FALLBACK_COMBAT_TEXTURE) {
          loader.load(FALLBACK_COMBAT_TEXTURE, (tex) => finishColor(tex), undefined, () => {
            if (alive) {
              disposeTexture(colorRef.current);
              colorRef.current = null;
              setColorTex(null);
            }
          });
        } else {
          disposeTexture(colorRef.current);
          colorRef.current = null;
          setColorTex(null);
        }
      }
    );

    disposeTexture(depthRef.current);
    depthRef.current = null;
    setDepthTex(null);

    const trySeq = ++depthTryRef.current;
    let idx = 0;

    const tryNextDepth = () => {
      if (!alive || depthTryRef.current !== trySeq) return;
      if (idx >= depthCandidates.length) {
        disposeTexture(depthRef.current);
        depthRef.current = null;
        setDepthTex(null);
        return;
      }
      const url = depthCandidates[idx];
      idx += 1;
      loader.load(
        url,
        (tex) => {
          if (!alive || depthTryRef.current !== trySeq) {
            disposeTexture(tex);
            return;
          }
          if (depthRef.current && depthRef.current !== tex) disposeTexture(depthRef.current);
          depthRef.current = tex;
          tex.colorSpace = THREE.NoColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          setDepthTex(tex);
        },
        undefined,
        () => tryNextDepth()
      );
    };

    if (depthCandidates.length) tryNextDepth();

    return () => {
      alive = false;
      disposeTexture(colorRef.current);
      colorRef.current = null;
      disposeTexture(depthRef.current);
      depthRef.current = null;
    };
  }, [src, depthCandidates]);

  return { colorTex, depthTex };
}

/**
 * 与彩图同目录存在 foo_background.* 且深度可解析时 layered=true；否则 ready+layered=false（走视差/平面）。
 * 纹理在 hook 内持有，卸载时 dispose。
 */
function useCombatLayeredDecisionTextures(src, layeredBgCandidates, charFallbackDepth) {
  const [state, setState] = React.useState(() => ({ status: 'loading' }));
  const candidates = React.useMemo(
    () => buildCombatDepthCandidates(src, charFallbackDepth),
    [src, charFallbackDepth]
  );

  React.useLayoutEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const primaryColor = src || FALLBACK_COMBAT_TEXTURE;
    setState({ status: 'loading' });

    let colorTex = null;
    let bgTex = null;
    let depthTex = null;
    let colorDone = false;
    let bgDone = false;
    let depthDone = false;

    const armFinish = () => {
      if (!colorDone || !bgDone || !depthDone || !alive) return;
      if (colorTex && bgTex && depthTex) {
        setState({
          status: 'ready',
          layered: true,
          colorTex,
          backgroundTex: bgTex,
          depthTex,
        });
      } else {
        disposeTexture(colorTex);
        disposeTexture(bgTex);
        disposeTexture(depthTex);
        colorTex = null;
        bgTex = null;
        depthTex = null;
        setState({ status: 'ready', layered: false });
      }
    };

    const finishColor = (tex) => {
      colorTex = tex;
      colorDone = true;
      armFinish();
    };

    loader.load(
      primaryColor,
      (tex) => {
        if (!alive) {
          disposeTexture(tex);
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        finishColor(tex);
      },
      undefined,
      () => {
        if (!alive) return;
        if (primaryColor !== FALLBACK_COMBAT_TEXTURE) {
          loader.load(
            FALLBACK_COMBAT_TEXTURE,
            (tex) => {
              if (!alive) {
                disposeTexture(tex);
                return;
              }
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.wrapS = THREE.ClampToEdgeWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              finishColor(tex);
            },
            undefined,
            () => {
              colorTex = null;
              colorDone = true;
              armFinish();
            }
          );
        } else {
          colorTex = null;
          colorDone = true;
          armFinish();
        }
      }
    );

    let bIdx = 0;
    const tryLayeredBg = () => {
      if (!alive) return;
      if (bIdx >= layeredBgCandidates.length) {
        bgTex = null;
        bgDone = true;
        armFinish();
        return;
      }
      const url = layeredBgCandidates[bIdx];
      bIdx += 1;
      loader.load(
        url,
        (tex) => {
          if (!alive) {
            disposeTexture(tex);
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          bgTex = tex;
          bgDone = true;
          armFinish();
        },
        undefined,
        () => tryLayeredBg()
      );
    };
    tryLayeredBg();

    let dIdx = 0;
    const tryDepth = () => {
      if (!alive) return;
      if (dIdx >= candidates.length) {
        depthTex = null;
        depthDone = true;
        armFinish();
        return;
      }
      const url = candidates[dIdx];
      dIdx += 1;
      loader.load(
        url,
        (tex) => {
          if (!alive) {
            disposeTexture(tex);
            return;
          }
          tex.colorSpace = THREE.NoColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          depthTex = tex;
          depthDone = true;
          armFinish();
        },
        undefined,
        () => tryDepth()
      );
    };
    tryDepth();

    return () => {
      alive = false;
      disposeTexture(colorTex);
      disposeTexture(bgTex);
      disposeTexture(depthTex);
    };
  }, [src, layeredBgCandidates, candidates]);

  return state;
}

/** 按战斗图 URL 单独覆盖焦点深度（无键则用全局 parallaxPrefs.focalDepth） */
const COMBAT_FOCAL_BY_SRC_STORAGE_KEY = 'celestine_combat_focal_by_src_v1';

function loadCombatFocalBySrc() {
  try {
    const s = localStorage.getItem(COMBAT_FOCAL_BY_SRC_STORAGE_KEY);
    if (!s) return {};
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

/** 全角色共用：存在本机 localStorage，换角色不单独存一份 */
const COMBAT_PARALLAX_STORAGE_KEY = 'celestine_combat_parallax_v1';
const DEFAULT_COMBAT_PARALLAX = {
  intensity: 0.038,
  focalDepth: 0.85,
  depthPow: 1.12,
  uvInset: 0.002,
  mouseLerp: 0.08,
  mouseDiv: 10,
  tiltDeg: 3,
  /** 远景视差 = 前景 × 该倍率；<1 减轻远景与前景交界处的错层重影 */
  bgParallaxMul: 0.42,
  /** 焦平面附近深度混合带宽度（0~0.12，深度图坐标） */
  depthFeather: 0.028,
  /** 远景羽化模糊强度（纹理像素，0 关闭） */
  bgBlurPx: 1.15,
  /** 分层蒙版：把「算前景」的深度下沿往暗部扩展，避免人物灰阶被整块压透明（0.35~0.65 常用） */
  layerMaskFgPull: 0.5,
  /** 分层蒙版：深度图若为近暗远亮（主体偏黑），勾选与默认「近亮」相反 */
  layerMaskDepthInvert: false,
};

/** 与 useCombatPlaneSize 一致：planeScale=0.9，横图顶宽 13.6*scale、竖高 8.4*scale；加余量包住玻璃框 → 诗句采样落在此轴对齐矩形之外 */
const COMBAT_PLANE_LAYOUT_SCALE = 0.9;
const COMBAT_VERSE_EXCLUDE_HALF_W = (13.6 * COMBAT_PLANE_LAYOUT_SCALE) / 2 + 0.5;
const COMBAT_VERSE_EXCLUDE_HALF_H = (8.4 * COMBAT_PLANE_LAYOUT_SCALE) / 2 + 0.45;
/** 平面内 z 轴旋转上限，严格小于 10° */
const COMBAT_VERSE_MAX_TILT_RAD = THREE.MathUtils.degToRad(9);
/**
 * 环绕短句句字号：font-size(px) = pxMin * (1 + 0.15 * t)，t 为 fontSize 在 [W_MIN,W_MIN+SPAN] 上归一化到 [0,1]；
 * 故随机最大/最小 = 115%。layer.fontSize 仍为布局/权重，不是 Three.js 单位。
 * 屏幕上的视觉大小还受 @react-three/drei Html 的 distanceFactor 与透视影响：同一 px，离相机越远看起来越小。
 */
const COMBAT_VERSE_FONT_W_MIN = 0.34;
const COMBAT_VERSE_FONT_W_SPAN = 0.56;
/** 在上一版基础上整体 ×1.3 */
const COMBAT_VERSE_PX_BASE = 20;
const COMBAT_VERSE_PX_PER_UNIT = 46;
/** 环绕短句随机字号的 最大/最小 上限比例（1.15 即最大不超过最小的 115%） */
const COMBAT_VERSE_PX_MAX_OVER_MIN = 1.15;
const COMBAT_VERSE_HTML_DISTANCE_FACTOR = 6.7;
const COMBAT_VERSE_MAXW_PX_MUL = 65;
/** 环绕短句逐字渐进：单行总时长 ≈ 字数 × 该值（ms）；相邻句位起笔错开 */
const COMBAT_VERSE_REVEAL_MS_PER_CHAR = 46;
const COMBAT_VERSE_REVEAL_LINE_STAGGER_MS = 120;
/** 展示 3D 主内容在 Y 上整体略上移（战斗图+环绕短句同组、与 Html 面板用同一常数，避免主块在视口中偏下） */
const COMBAT_SCENE_LIFT_Y = 0.4;

function easeInOutSine(t) {
  const x = Math.max(0, Math.min(1, t));
  return (1 - Math.cos(Math.PI * x)) / 2;
}

/** 浮点进度 0..len：已整字不透明，当前字渐变 + 轻微上滑；逐字 span 显式 fontFamily，避免 Html/transform 下继承丢失 */
function CombatVerseRevealLine({ text, progress, fontFamily, fontWeight = 400 }) {
  const chars = Array.from(String(text || ''));
  const n = chars.length;
  if (n === 0) return null;
  const p = Math.min(Math.max(0, progress), n);
  const fl = Math.floor(p);
  const frac = p - fl;
  return (
    <>
      {chars.map((ch, idx) => {
        let op = 0;
        let ty = 0;
        if (idx < fl) {
          op = 1;
        } else if (idx === fl) {
          op = frac;
          ty = (1 - frac) * 5;
        }
        return (
          <span
            key={`cv-${idx}-${ch}`}
            style={{
              fontFamily,
              fontWeight,
              opacity: op,
              display: 'inline-block',
              transform: ty > 0.01 ? `translateY(${ty}px)` : undefined,
              willChange: idx === fl ? 'opacity, transform' : undefined,
            }}
          >
            {ch}
          </span>
        );
      })}
    </>
  );
}

function loadCombatParallaxPrefs() {
  try {
    const s = localStorage.getItem(COMBAT_PARALLAX_STORAGE_KEY);
    if (s) return { ...DEFAULT_COMBAT_PARALLAX, ...JSON.parse(s) };
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_COMBAT_PARALLAX };
}

function resetCombatParallaxToDefaults(onChange, clearFocalBySrc) {
  try {
    localStorage.removeItem(COMBAT_PARALLAX_STORAGE_KEY);
    localStorage.removeItem(COMBAT_FOCAL_BY_SRC_STORAGE_KEY);
  } catch (e) { /* ignore */ }
  clearFocalBySrc?.();
  onChange({ ...DEFAULT_COMBAT_PARALLAX });
}

function CombatParallaxControls({ prefs, onChange, accent, activeCombatSrc, focalBySrc, setFocalBySrc }) {
  const [panelOpen, setPanelOpen] = React.useState(true);
  const p = { ...DEFAULT_COMBAT_PARALLAX, ...prefs };
  const row = (label, key, min, max, step, fmt = (v) => String(v)) => (
    <div className="mb-2.5" key={key}>
      <div className="flex justify-between gap-2 text-[10px] opacity-75 font-bold tracking-wide">
        <span>{label}</span>
        <span className="font-mono opacity-90 tabular-nums shrink-0">{fmt(p[key])}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={p[key]}
        onChange={(e) => onChange({ ...p, [key]: Number(e.target.value) })}
        className="w-full h-1.5 rounded-full cursor-pointer"
        style={{ accentColor: accent }}
      />
    </div>
  );

  /** 挂到 body：父级若有 perspective / transform（含 fade-in 动画），fixed 会相对父级而非视口，导致控件「消失」在裁切区外 */
  const ui = (
    <>
      <button
        type="button"
        title="将所有战斗视差参数恢复为内置默认值，并清除本地保存"
        className="pointer-events-auto fixed right-3 bottom-28 z-[10050] rounded-full border-2 border-slate-400/80 bg-white px-3.5 py-2 text-[11px] font-black tracking-wide text-slate-800 shadow-[0_6px_24px_rgba(15,23,42,0.22)] backdrop-blur-sm hover:bg-slate-50 active:scale-[0.98] max-w-[calc(100vw-1.5rem)]"
        style={{ boxShadow: `0 6px 24px rgba(15,23,42,0.22), 0 0 0 1px ${accent}33` }}
        onClick={() => resetCombatParallaxToDefaults(onChange, () => setFocalBySrc?.({}))}
      >
        视差 · 恢复默认
      </button>
      <details
        className="pointer-events-auto fixed right-3 bottom-44 z-[10040] w-[min(15rem,calc(100vw-1.5rem))] max-h-[min(48vh,420px)] sm:max-h-[min(52vh,460px)] overflow-y-auto rounded-xl border border-white/45 bg-white/92 backdrop-blur-md shadow-[0_8px_32px_rgba(15,23,42,0.18)] [&_summary::-webkit-details-marker]:hidden"
        open={panelOpen}
        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
      >
      <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2 text-[11px] font-black tracking-widest border-b border-slate-200/90 text-slate-700">
        <SlidersHorizontal size={14} className="opacity-55 shrink-0" />
        战斗图视差（全角色）
      </summary>
      <div className="px-3 py-2.5 pb-3 text-slate-800">
        <p className="text-[9px] text-slate-500 leading-snug mb-2.5">
          仅编辑模式可见；参数对所有角色共用（本机保存）。交界重影时可降强度、降远景倍率或略加大深度羽化与远景模糊。若当前战斗图同目录存在「与主文件同主名的 _background」垫图（扩展名可与彩图不同，会自动尝试 png/jpg/webp）且深度可加载，将走「垫图 + 视差」单 Pass：与无垫图时相同的 UV 深度视差，但远景权重下采样垫图而非从彩图拉伸。焦点深度、分层前景覆盖、深度取反仍控制前景/垫图混合；远景羽化模糊作用于垫图。每张战斗图可单独记忆「当前图焦点深度」，未设置则用下方默认。
        </p>
        {row('视差强度', 'intensity', 0.01, 0.12, 0.001, (v) => Number(v).toFixed(3))}
        {row('默认焦点深度（未单独设置的图）', 'focalDepth', 0.5, 0.98, 0.01, (v) => Number(v).toFixed(2))}
        {activeCombatSrc && setFocalBySrc && (
          <div className="mb-2.5">
            <div className="flex justify-between gap-2 text-[10px] opacity-75 font-bold tracking-wide">
              <span>当前图焦点深度</span>
              <span className="font-mono opacity-90 tabular-nums shrink-0">
                {Number(focalBySrc?.[activeCombatSrc] ?? p.focalDepth).toFixed(2)}
                {focalBySrc?.[activeCombatSrc] != null ? '' : ' · 同默认'}
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={0.98}
              step={0.01}
              value={focalBySrc?.[activeCombatSrc] ?? p.focalDepth}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFocalBySrc((prev) => ({ ...prev, [activeCombatSrc]: v }));
              }}
              className="w-full h-1.5 rounded-full cursor-pointer"
              style={{ accentColor: accent }}
            />
            {focalBySrc?.[activeCombatSrc] != null && (
              <button
                type="button"
                className="mt-1 text-[9px] font-bold text-slate-500 hover:text-slate-700 underline"
                onClick={() =>
                  setFocalBySrc((prev) => {
                    const next = { ...prev };
                    delete next[activeCombatSrc];
                    return next;
                  })
                }
              >
                清除当前图覆盖（改用默认）
              </button>
            )}
          </div>
        )}
        {row('深度曲线 pow', 'depthPow', 1, 1.6, 0.01, (v) => Number(v).toFixed(2))}
        {row('UV 内缩（裁边）', 'uvInset', 0, 0.08, 0.0005, (v) => Number(v).toFixed(4))}
        {row('鼠标跟随平滑', 'mouseLerp', 0.03, 0.25, 0.005, (v) => Number(v).toFixed(3))}
        {row('鼠标幅度除数', 'mouseDiv', 4, 32, 1, (v) => String(Math.round(v)))}
        {row('整卡倾斜 °', 'tiltDeg', 0, 12, 0.5, (v) => Number(v).toFixed(1))}
        {row('远景视差倍率', 'bgParallaxMul', 0.15, 1, 0.01, (v) => Number(v).toFixed(2))}
        {row('深度交界羽化', 'depthFeather', 0, 0.12, 0.001, (v) => Number(v).toFixed(3))}
        {row('分层前景覆盖(深度)', 'layerMaskFgPull', 0.15, 0.72, 0.01, (v) => Number(v).toFixed(2))}
        <label className="flex items-start gap-2 mb-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300"
            checked={!!p.layerMaskDepthInvert}
            onChange={(e) => onChange({ ...p, layerMaskDepthInvert: e.target.checked })}
          />
          <span className="text-[10px] font-bold text-slate-600 leading-snug">
            分层蒙版：深度黑白取反（主体在深度图里偏黑、垫图却从人物里透出来时试）
          </span>
        </label>
        {row('远景羽化模糊(px)', 'bgBlurPx', 0, 3.5, 0.05, (v) => Number(v).toFixed(2))}
        <button
          type="button"
          onClick={() => resetCombatParallaxToDefaults(onChange, () => setFocalBySrc?.({}))}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white/80 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
        >
          恢复默认（同右下角胶囊按钮）
        </button>
      </div>
    </details>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(ui, document.body);
}

function useCombatPlaneSize(texture) {
  return React.useMemo(() => {
    const w = texture?.image?.width || 0;
    const h = texture?.image?.height || 0;
    const aspect = !w || !h ? 16 / 9 : w / h;
    const planeScale = 0.9;
    const baseHeight = 8.4 * planeScale;
    const maxWidth = 13.6 * planeScale;
    let width = baseHeight * aspect;
    let height = baseHeight;
    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspect;
    }
    return { width, height };
  }, [texture]);
}

/** omitTransmissionFrame：若某路径前景大量透明、玻璃会糊住后层时可关前侧玻璃+描边（当前垫图走单 Pass 合成，默认仍显示玻璃框） */
function CombatPlaneDecor({ width, height, accent, children, omitTransmissionFrame = false }) {
  return (
    <group>
      <mesh position={[0, 0, -0.12]}>
        <planeGeometry args={[width + 0.6, height + 0.6]} />
        <meshBasicMaterial color={accent} transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {children}
      {!omitTransmissionFrame && (
        <>
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[width + 0.12, height + 0.12, 0.09]} />
            <meshPhysicalMaterial
              color="#ffffff"
              metalness={0.25}
              roughness={0.16}
              transmission={0.9}
              thickness={0.2}
              clearcoat={0.95}
              clearcoatRoughness={0.08}
              ior={1.22}
              transparent
              opacity={0.08}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments position={[0, 0, 0.06]}>
            <edgesGeometry args={[new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.09)]} />
            <lineBasicMaterial color={accent} transparent opacity={0.38} depthWrite={false} />
          </lineSegments>
        </>
      )}
    </group>
  );
}

function CombatPlaneFromTexture({ texture, opacity = 1, accent = '#7dd3fc' }) {
  const materialRef = React.useRef(null);
  const { width, height } = useCombatPlaneSize(texture);

  useFrame((_, delta) => {
    if (!materialRef.current) return;
    materialRef.current.opacity = THREE.MathUtils.lerp(
      materialRef.current.opacity,
      opacity,
      Math.min(1, delta * 8)
    );
  });

  return (
    <CombatPlaneDecor width={width} height={height} accent={accent}>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={materialRef}
          map={texture}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </CombatPlaneDecor>
  );
}

function CombatPlaneBasic({ src, opacity = 1, accent = '#7dd3fc' }) {
  const texture = useCombatColorTextureSafe(src);
  if (!texture) return null;
  return <CombatPlaneFromTexture texture={texture} opacity={opacity} accent={accent} />;
}

function CombatPlaneParallaxShader({ colorTex, depthTex, opacity = 1, accent = '#7dd3fc', mousePos, parallaxParams }) {
  const materialRef = React.useRef(null);
  const { pointer } = useThree();
  const { width, height } = useCombatPlaneSize(colorTex);

  const uniforms = React.useMemo(
    () => ({
      uTexture: { value: colorTex },
      uDepthMap: { value: depthTex },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uIntensity: { value: DEFAULT_COMBAT_PARALLAX.intensity },
      uFocalDepth: { value: DEFAULT_COMBAT_PARALLAX.focalDepth },
      uPow: { value: DEFAULT_COMBAT_PARALLAX.depthPow },
      uUvInset: { value: DEFAULT_COMBAT_PARALLAX.uvInset },
      uBgParallaxMul: { value: DEFAULT_COMBAT_PARALLAX.bgParallaxMul },
      uDepthFeather: { value: DEFAULT_COMBAT_PARALLAX.depthFeather },
      uBgBlurPx: { value: DEFAULT_COMBAT_PARALLAX.bgBlurPx },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uOpacity: { value: 0 },
    }),
    [colorTex, depthTex]
  );

  useFrame((_, delta) => {
    const m = materialRef.current;
    if (!m?.uniforms) return;
    const q = { ...DEFAULT_COMBAT_PARALLAX, ...parallaxParams };
    const inset = THREE.MathUtils.clamp(q.uvInset, 0.0005, 0.12);
    m.uniforms.uIntensity.value = q.intensity;
    m.uniforms.uFocalDepth.value = q.focalDepth;
    m.uniforms.uPow.value = THREE.MathUtils.clamp(q.depthPow, 1.0, 1.6);
    m.uniforms.uUvInset.value = inset;
    m.uniforms.uBgParallaxMul.value = THREE.MathUtils.clamp(q.bgParallaxMul ?? DEFAULT_COMBAT_PARALLAX.bgParallaxMul, 0.1, 1);
    m.uniforms.uDepthFeather.value = THREE.MathUtils.clamp(q.depthFeather ?? DEFAULT_COMBAT_PARALLAX.depthFeather, 0, 0.15);
    m.uniforms.uBgBlurPx.value = THREE.MathUtils.clamp(q.bgBlurPx ?? DEFAULT_COMBAT_PARALLAX.bgBlurPx, 0, 4);
    const tw = colorTex?.image?.width || 1;
    const th = colorTex?.image?.height || 1;
    m.uniforms.uTexelSize.value.set(1 / tw, 1 / th);
    m.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      m.uniforms.uOpacity.value,
      opacity,
      Math.min(1, delta * 8)
    );
    const div = Math.max(4, q.mouseDiv || 10);
    const lerpF = THREE.MathUtils.clamp(q.mouseLerp ?? 0.08, 0.03, 0.25);
    const mx = mousePos?.x ?? 0;
    const my = mousePos?.y ?? 0;
    const fromWindow = new THREE.Vector2(
      THREE.MathUtils.clamp(mx / div, -1, 1),
      THREE.MathUtils.clamp(my / div, -1, 1)
    );
    const blend = 0.55;
    const tx = fromWindow.x * blend + pointer.x * (1 - blend);
    const ty = fromWindow.y * blend + pointer.y * (1 - blend);
    m.uniforms.uMouse.value.x = THREE.MathUtils.lerp(m.uniforms.uMouse.value.x, tx, lerpF);
    m.uniforms.uMouse.value.y = THREE.MathUtils.lerp(m.uniforms.uMouse.value.y, ty, lerpF);
  });

  return (
    <CombatPlaneDecor width={width} height={height} accent={accent}>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={COMBAT_PARALLAX_VERTEX}
          fragmentShader={COMBAT_PARALLAX_FRAGMENT}
          transparent
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </CombatPlaneDecor>
  );
}

function CombatPlaneParallax({ src, charFallbackDepth, opacity = 1, accent = '#7dd3fc', mousePos, parallaxParams }) {
  const { colorTex, depthTex } = useCombatParallaxTexturesSafe(src, charFallbackDepth);
  if (!colorTex) return null;
  if (!depthTex) {
    return <CombatPlaneFromTexture texture={colorTex} opacity={opacity} accent={accent} />;
  }
  return (
    <CombatPlaneParallaxShader
      colorTex={colorTex}
      depthTex={depthTex}
      opacity={opacity}
      accent={accent}
      mousePos={mousePos}
      parallaxParams={parallaxParams}
    />
  );
}

/** 有 _background 时：单 Pass 深度视差 + 远景处采样垫图（与无垫图时同一套 parallax 参数） */
function CombatPlaneLayered({ colorTex, backgroundTex, depthTex, opacity = 1, accent = '#7dd3fc', mousePos, parallaxParams }) {
  const materialRef = React.useRef(null);
  const { pointer } = useThree();
  const { width, height } = useCombatPlaneSize(colorTex);

  const uniforms = React.useMemo(
    () => ({
      uTexture: { value: colorTex },
      uBackground: { value: backgroundTex },
      uDepthMap: { value: depthTex },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uIntensity: { value: DEFAULT_COMBAT_PARALLAX.intensity },
      uFocalDepth: { value: DEFAULT_COMBAT_PARALLAX.focalDepth },
      uPow: { value: DEFAULT_COMBAT_PARALLAX.depthPow },
      uUvInset: { value: DEFAULT_COMBAT_PARALLAX.uvInset },
      uBgParallaxMul: { value: DEFAULT_COMBAT_PARALLAX.bgParallaxMul },
      uDepthFeather: { value: DEFAULT_COMBAT_PARALLAX.depthFeather },
      uBgBlurPx: { value: DEFAULT_COMBAT_PARALLAX.bgBlurPx },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uFgPull: { value: DEFAULT_COMBAT_PARALLAX.layerMaskFgPull },
      uDepthInvert: { value: 0 },
      uOpacity: { value: 0 },
    }),
    [colorTex, depthTex, backgroundTex]
  );

  useFrame((_, delta) => {
    const m = materialRef.current;
    if (!m?.uniforms) return;
    const q = { ...DEFAULT_COMBAT_PARALLAX, ...parallaxParams };
    const inset = THREE.MathUtils.clamp(q.uvInset, 0.0005, 0.12);
    m.uniforms.uIntensity.value = q.intensity;
    m.uniforms.uFocalDepth.value = q.focalDepth;
    m.uniforms.uPow.value = THREE.MathUtils.clamp(q.depthPow, 1.0, 1.6);
    m.uniforms.uUvInset.value = inset;
    m.uniforms.uBgParallaxMul.value = THREE.MathUtils.clamp(q.bgParallaxMul ?? DEFAULT_COMBAT_PARALLAX.bgParallaxMul, 0.1, 1);
    m.uniforms.uDepthFeather.value = THREE.MathUtils.clamp(q.depthFeather ?? DEFAULT_COMBAT_PARALLAX.depthFeather, 0, 0.15);
    m.uniforms.uBgBlurPx.value = THREE.MathUtils.clamp(q.bgBlurPx ?? DEFAULT_COMBAT_PARALLAX.bgBlurPx, 0, 4);
    m.uniforms.uFgPull.value = THREE.MathUtils.clamp(
      q.layerMaskFgPull ?? DEFAULT_COMBAT_PARALLAX.layerMaskFgPull,
      0.05,
      0.85
    );
    m.uniforms.uDepthInvert.value = q.layerMaskDepthInvert ? 1 : 0;
    const tw = colorTex?.image?.width || 1;
    const th = colorTex?.image?.height || 1;
    m.uniforms.uTexelSize.value.set(1 / tw, 1 / th);
    m.uniforms.uOpacity.value = THREE.MathUtils.lerp(m.uniforms.uOpacity.value, opacity, Math.min(1, delta * 8));
    const div = Math.max(4, q.mouseDiv || 10);
    const lerpF = THREE.MathUtils.clamp(q.mouseLerp ?? 0.08, 0.03, 0.25);
    const mx = mousePos?.x ?? 0;
    const my = mousePos?.y ?? 0;
    const fromWindow = new THREE.Vector2(
      THREE.MathUtils.clamp(mx / div, -1, 1),
      THREE.MathUtils.clamp(my / div, -1, 1)
    );
    const blend = 0.55;
    const tx = fromWindow.x * blend + pointer.x * (1 - blend);
    const ty = fromWindow.y * blend + pointer.y * (1 - blend);
    m.uniforms.uMouse.value.x = THREE.MathUtils.lerp(m.uniforms.uMouse.value.x, tx, lerpF);
    m.uniforms.uMouse.value.y = THREE.MathUtils.lerp(m.uniforms.uMouse.value.y, ty, lerpF);
  });

  return (
    <CombatPlaneDecor width={width} height={height} accent={accent}>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={COMBAT_PARALLAX_VERTEX}
          fragmentShader={COMBAT_LAYERED_PARALLAX_FRAGMENT}
          transparent
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </CombatPlaneDecor>
  );
}

function CombatPlane3DMaybeLayered({ src, layeredBgCandidates, charFallbackDepth, opacity, accent, mousePos, parallaxParams }) {
  const d = useCombatLayeredDecisionTextures(src, layeredBgCandidates, charFallbackDepth);
  if (d.status === 'loading') return null;
  if (d.layered) {
    return (
      <CombatPlaneLayered
        colorTex={d.colorTex}
        backgroundTex={d.backgroundTex}
        depthTex={d.depthTex}
        opacity={opacity}
        accent={accent}
        mousePos={mousePos}
        parallaxParams={parallaxParams}
      />
    );
  }
  return (
    <CombatPlaneParallax
      src={src}
      charFallbackDepth={charFallbackDepth}
      opacity={opacity}
      accent={accent}
      mousePos={mousePos}
      parallaxParams={parallaxParams}
    />
  );
}

function CombatPlane3D({ src, charFallbackDepth, opacity = 1, accent = '#7dd3fc', mousePos, parallaxParams }) {
  const layeredBgCandidates = React.useMemo(() => buildCombatLayeredBackgroundCandidates(src), [src]);
  if (layeredBgCandidates.length > 0) {
    return (
      <CombatPlane3DMaybeLayered
        key={`layered:${src}:${charFallbackDepth || ''}`}
        src={src}
        layeredBgCandidates={layeredBgCandidates}
        charFallbackDepth={charFallbackDepth}
        opacity={opacity}
        accent={accent}
        mousePos={mousePos}
        parallaxParams={parallaxParams}
      />
    );
  }
  return (
    <CombatPlaneParallax
      src={src}
      charFallbackDepth={charFallbackDepth}
      opacity={opacity}
      accent={accent}
      mousePos={mousePos}
      parallaxParams={parallaxParams}
    />
  );
}

/** 战斗图：整卡倾斜幅度由 parallaxPrefs.tiltDeg 控制（与深度视差叠加过重影时建议调低） */
function CombatImageTiltGroup({ mousePos, tiltDeg = 4, mouseDiv = 10, children }) {
  const groupRef = React.useRef(null);
  useFrame(() => {
    if (!groupRef.current) return;
    const div = Math.max(4, mouseDiv || 10);
    const mx = mousePos?.x ?? 0;
    const my = mousePos?.y ?? 0;
    const nx = THREE.MathUtils.clamp(mx / div, -1, 1);
    const ny = THREE.MathUtils.clamp(my / div, -1, 1);
    const maxTilt = THREE.MathUtils.degToRad(Math.max(0, Math.min(12, tiltDeg)));
    const targetX = ny * maxTilt;
    const targetY = nx * maxTilt;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX, 0.035);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetY, 0.035);
  });
  return <group ref={groupRef}>{children}</group>;
}

/** 战斗界面：相机固定，Html UI 不随视角漂移；仅下方战斗图组 CombatImageTiltGroup 随鼠标动 */
function CombatCameraRig() {
  const { camera } = useThree();
  useFrame(() => {
    camera.position.set(0, 0.15, 14);
    camera.lookAt(0, 0.2, 0);
  });
  return null;
}

/**
 * 环绕短句 · 文案来源（与空间散布无关）
 * ————————————————————————————————————————————————————————————————
 * - 只读 `combatVerses`：按换行拆成多行，trim、去空行；单行超过 28 字则截断并加「…」。
 * - 若用户未填：用 6 条内置 demo 句。
 * - 若用户有填：始终输出 **6 条字符串**，下标 0..5 对应 6 个 Html 句位；行数不足时在 manualLines 上取模循环填满。
 */
function buildDepthVerseLines(activeChar) {
  const manualLines = String(activeChar?.combatVerses || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.length > 28 ? `${s.slice(0, 28)}…` : s));
  const demo = ['星河不语', '剑意成霜', '旧梦回潮', '风起青冥', '烬火照夜', '万象归心'];
  if (manualLines.length === 0) return demo.slice(0, 6);
  return Array.from({ length: 6 }, (_, i) => manualLines[i % manualLines.length]);
}

/**
 * 环绕短句 · 空间散布（6 个 Html 句位，与 buildDepthVerseLines 的 6 条文案一一对应）
 * ————————————————————————————————————————————————————————————————
 * 坐标：战斗立牌 tilt 组原点为 (0,0)，与战斗图同一平面。先定「禁止区」矩形：与战斗卡玻璃框对齐略扩边
 *   （COMBAT_VERSE_EXCLUDE_HALF_W/H，来自 planeScale=0.9 的 13.6×8.4 卡面半宽/半高 + 余量），
 *   句位中心必须落在矩形 **外**，避免字叠在人物上。
 *
 * 1) 分区顺序：固定 6 槽模板 [上, 下, 上, 下, 左, 右]，再 **Fisher–Yates 洗牌**，使每次进入展示页时上下左右组合随机。
 * 2) 每区采样 sampleInZone：在左/右窄带或上/下宽带内均匀随机一点；上、下带内用 slot 把两句分到半区，降低挤在同一条边的概率。
 * 3) pickXY：该点须 (a) 在禁止区外 (b) 与已放点欧氏距离 ≥ minGap(≈2.88)。否则重试最多 200 次，再抖动/螺旋搜索，最后 ensureOutsideCard 兜底推到洞外。
 * 4) 6 点取齐后 pushApartPositions：多轮两两推开 + ensureOutsideCard，缓解句块 Html 实际占位比点大造成的视觉重叠。
 * 5) 每层附带随机：平面 z∈[z0,z0+zSpan]、平面内旋转 rz∈[-maxTiltRad,maxTiltRad]、fontSize 权重、opacity、maxWidth、鼠标视差系数 px/py。
 * 6) 按 z **从大到小排序** 再写 ro，使略靠前的层后画（略盖住后面的），配合战斗图深度。
 *
 * 调用时机：CombatDepthVerseLayers 挂载时 useMemo([]) 只算一次；离开展示页再进会重新挂载并重摇。
 */
function buildRandomDepthVerseLayers(maxTiltRad) {
  const rnd = () => Math.random();
  const innerW = COMBAT_VERSE_EXCLUDE_HALF_W;
  const innerH = COMBAT_VERSE_EXCLUDE_HALF_H;
  const outerW = 7.05;
  const band = 0.62;
  const yHi = innerH + band;
  const yLo = -innerH - band;
  const edgeM = 0.14;
  const z0 = 0.068;
  const zSpan = 0.07;
  /** 点距要大于 Html 字块在场景中的有效半径，否则两句仍可能叠；略放大并配合半区分带 */
  const minGap = 2.88;
  const minGapSq = minGap * minGap;
  const xyList = [];

  /**
   * slot：同带内第几句（0/1），上/下各两句时分上下半区，减少两「顶」或两「底」采到同一片。
   */
  const sampleInZone = (zone, slot = 0) => {
    if (zone === 'left') {
      const xLo = -outerW;
      const xHi = -innerW - edgeM;
      const y = yLo + rnd() * (yHi - yLo);
      const x = xLo + rnd() * (xHi - xLo);
      return [x, y];
    }
    if (zone === 'right') {
      const xLo = innerW + edgeM;
      const xHi = outerW;
      const y = yLo + rnd() * (yHi - yLo);
      const x = xLo + rnd() * (xHi - xLo);
      return [x, y];
    }
    if (zone === 'top') {
      const yLoZ = innerH + edgeM;
      const yRange = yHi - yLoZ;
      const yHalf = yRange * 0.5;
      const y = (slot & 1) === 0
        ? yLoZ + rnd() * yHalf
        : yLoZ + yHalf + rnd() * (yRange - yHalf);
      const xMid = 0;
      const xW = outerW;
      const x0 = -xW + rnd() * (xMid + xW);
      const x1 = xMid + rnd() * (xW - xMid);
      const x = (slot & 1) === 0 ? x0 : x1;
      return [x, y];
    }
    const yHiZ = -innerH - edgeM;
    const yRange = yHiZ - yLo;
    const yHalf = yRange * 0.5;
    const y = (slot & 1) === 0
      ? yLo + rnd() * yHalf
      : yLo + yHalf + rnd() * (yRange - yHalf);
    const xMid = 0;
    const xW = outerW;
    const x0 = -xW + rnd() * (xMid + xW);
    const x1 = xMid + rnd() * (xW - xMid);
    const x = (slot & 1) === 0 ? x0 : x1;
    return [x, y];
  };

  const zones = ['top', 'bottom', 'top', 'bottom', 'left', 'right'];
  for (let k = zones.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [zones[k], zones[j]] = [zones[j], zones[k]];
  }

  const distSq = (x, y) => xyList.reduce((m, [px, py]) => Math.min(m, (px - x) ** 2 + (py - y) ** 2), Infinity);

  const ensureOutsideCard = (x, y) => {
    if (Math.abs(x) > innerW || Math.abs(y) > innerH) return [x, y];
    if (Math.abs(x) < 1e-5 && Math.abs(y) < 1e-5) return [innerW + 0.22, 0];
    /** 沿原点射线推到洞外，取先碰到的边（t 为 min 而非 max） */
    const t = 1.03 * Math.min(
      (innerW + 0.12) / (Math.abs(x) + 1e-5),
      (innerH + 0.12) / (Math.abs(y) + 1e-5)
    );
    return [x * t, y * t];
  };

  const pushApartPositions = (pos) => {
    const mSq = minGapSq;
    for (let it = 0; it < 14; it += 1) {
      for (let i = 0; i < pos.length; i += 1) {
        for (let j = i + 1; j < pos.length; j += 1) {
          let [x1, y1] = pos[i];
          let [x2, y2] = pos[j];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const d2 = dx * dx + dy * dy;
          if (d2 >= mSq || d2 < 1e-10) continue;
          const d = Math.sqrt(d2);
          const need = (minGap - d) * 0.5 + 0.04;
          const ux = dx / d;
          const uy = dy / d;
          x1 -= ux * need;
          y1 -= uy * need;
          x2 += ux * need;
          y2 += uy * need;
          pos[i] = ensureOutsideCard(x1, y1);
          pos[j] = ensureOutsideCard(x2, y2);
        }
      }
    }
  };

  const pickXY = (zone, i) => {
    const slot = zones.slice(0, i).filter((z) => z === zone).length;
    const valid = (x, y) => {
      if (Math.abs(x) <= innerW && Math.abs(y) <= innerH) return false;
      return distSq(x, y) >= minGapSq;
    };
    for (let attempt = 0; attempt < 200; attempt++) {
      const [x, y] = sampleInZone(zone, slot);
      if (valid(x, y)) return [x, y];
    }
    let [x, y] = sampleInZone(zone, slot);
    for (let bump = 0; bump < 40; bump++) {
      if (valid(x, y)) return [x, y];
      const j = (bump + 1) * 0.24;
      x += (rnd() - 0.5) * j * 2;
      y += (rnd() - 0.5) * j * 2;
    }
    for (let r = 0.2; r < 4.2; r += 0.2) {
      for (let k = 0; k < 18; k++) {
        const ang = (k / 18) * Math.PI * 2;
        const tx = x + Math.cos(ang) * r;
        const ty = y + Math.sin(ang) * r;
        if (valid(tx, ty)) return [tx, ty];
      }
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      const [tx, ty] = sampleInZone(zone, slot);
      if (valid(tx, ty)) return [tx, ty];
    }
    return ensureOutsideCard(x, y);
  };

  const positions = [];
  for (let i = 0; i < 6; i += 1) {
    const p = pickXY(zones[i], i);
    positions.push(p);
    xyList.push(p);
  }
  pushApartPositions(positions);

  const raw = [];
  for (let i = 0; i < 6; i += 1) {
    const [x, y] = positions[i];
    const rz = (rnd() * 2 - 1) * maxTiltRad;
    raw.push({
      z: z0 + rnd() * zSpan,
      x,
      y,
      fontSize: COMBAT_VERSE_FONT_W_MIN + rnd() * COMBAT_VERSE_FONT_W_SPAN,
      opacity: 0.24 + rnd() * 0.36,
      maxWidth: 6.8 + rnd() * 6.2,
      px: 0.06 + rnd() * 0.26,
      py: 0.04 + rnd() * 0.17,
      rz,
      ro: 110 + i,
    });
  }
  return raw.sort((a, b) => b.z - a.z).map((layer, i) => ({ ...layer, ro: 120 - i }));
}

function CombatDepthVerseLayers({ activeChar, verseTextColor, accentGlow, mousePos }) {
  const verseFontFamily = React.useMemo(
    () => getCombatVerseFontFamily(activeChar?.name),
    [activeChar?.name]
  );
  const verseSizeScale = React.useMemo(
    () => getCombatVerseFontSizeScale(activeChar?.name),
    [activeChar?.name]
  );
  const lines = React.useMemo(
    () => buildDepthVerseLines(activeChar),
    [activeChar?.id, activeChar?.name, activeChar?.combatVerses]
  );
  const linesKey = React.useMemo(() => lines.join('\0'), [lines]);
  const [revealProgress, setRevealProgress] = React.useState(() => [0, 0, 0, 0, 0, 0]);
  const groupsRef = React.useRef([]);
  const glow = String(accentGlow || '#64748b').replace('#', '');
  const glowRgb = /^[0-9a-fA-F]{6}$/.test(glow)
    ? `${parseInt(glow.slice(0, 2), 16)},${parseInt(glow.slice(2, 4), 16)},${parseInt(glow.slice(4, 6), 16)}`
    : '100,116,139';
  /**
   * 与战斗卡同坐标系。不透明贴图会盖住先画的物体，故诗句必须在 JSX 里画在战斗图**之后**；
   * 使用 Html+浏览器字体：Troika Text 在部分环境下中文全空，与是否有战斗图无关。
   */
  /** 战斗卡玻璃框约在 z≈0.06；全横向；|rz| 见 COMBAT_VERSE_MAX_TILT_RAD（<10°）。每次进入展示页挂载本组件时用 Math.random() 重摇布局。 */
  const layers = React.useMemo(
    () => buildRandomDepthVerseLayers(COMBAT_VERSE_MAX_TILT_RAD),
    []
  );

  React.useEffect(() => {
    const fullLens = lines.map((s) => Array.from(s).length);
    setRevealProgress([0, 0, 0, 0, 0, 0]);
    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const dt = performance.now() - start;
      const next = lines.map((line, i) => {
        const n = fullLens[i];
        if (n === 0) return 0;
        const t0 = i * COMBAT_VERSE_REVEAL_LINE_STAGGER_MS;
        const dur = n * COMBAT_VERSE_REVEAL_MS_PER_CHAR;
        const raw = dur > 0 ? Math.max(0, dt - t0) / dur : 1;
        const u = Math.min(1, raw);
        return easeInOutSine(u) * n;
      });
      if (!cancelled) setRevealProgress(next);
      const done = next.every((pr, i) => fullLens[i] === 0 || pr >= fullLens[i] - 0.001);
      if (done) {
        if (!cancelled) setRevealProgress(fullLens.map((len) => len));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [linesKey]);

  useFrame(() => {
    const nx = THREE.MathUtils.clamp((mousePos?.x ?? 0) / 10, -1, 1);
    const ny = THREE.MathUtils.clamp((mousePos?.y ?? 0) / 10, -1, 1);
    layers.forEach((layer, i) => {
      const g = groupsRef.current[i];
      if (!g) return;
      const tx = layer.x + nx * layer.px;
      const ty = layer.y + ny * layer.py;
      g.position.x = THREE.MathUtils.lerp(g.position.x, tx, 0.06);
      g.position.y = THREE.MathUtils.lerp(g.position.y, ty, 0.06);
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, nx * 0.02, 0.06);
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -ny * 0.012, 0.06);
    });
  });

  return (
    <group>
      {layers.map((layer, i) => {
        const source = lines[i] || lines[i % lines.length] || '';
        const lineProgress = revealProgress[i] ?? 0;
        const pxMin = (COMBAT_VERSE_PX_BASE + COMBAT_VERSE_FONT_W_MIN * COMBAT_VERSE_PX_PER_UNIT) * 0.9;
        const t = COMBAT_VERSE_FONT_W_SPAN > 1e-8
          ? THREE.MathUtils.clamp((layer.fontSize - COMBAT_VERSE_FONT_W_MIN) / COMBAT_VERSE_FONT_W_SPAN, 0, 1)
          : 0;
        const pxSize = Math.round(
          pxMin * (1 + (COMBAT_VERSE_PX_MAX_OVER_MIN - 1) * t) * verseSizeScale
        );
        const maxWpx = Math.round(Math.max(3, layer.maxWidth) * COMBAT_VERSE_MAXW_PX_MUL * verseSizeScale);
        return (
          <group
            key={`depth-verse-${i}`}
            ref={(el) => { groupsRef.current[i] = el; }}
            position={[layer.x, layer.y, layer.z]}
            rotation={[0, 0, THREE.MathUtils.clamp(layer.rz, -COMBAT_VERSE_MAX_TILT_RAD, COMBAT_VERSE_MAX_TILT_RAD)]}
          >
            <Html
              transform
              center
              distanceFactor={COMBAT_VERSE_HTML_DISTANCE_FACTOR}
              zIndexRange={[50, 200]}
              style={{ pointerEvents: 'none' }}
              occlude={false}
            >
              <div
                style={{
                  fontFamily: verseFontFamily,
                  fontWeight: 400,
                  fontSize: `${pxSize}px`,
                  lineHeight: 1.45,
                  letterSpacing: '0.12em',
                  color: verseTextColor,
                  opacity: layer.opacity,
                  maxWidth: `${maxWpx}px`,
                  whiteSpace: 'pre-wrap',
                  writingMode: 'horizontal-tb',
                  textAlign: 'center',
                  textShadow: `0 0 20px rgba(${glowRgb},0.38), 0 1px 3px rgba(15,23,42,0.55)`,
                  overflow: 'visible',
                }}
              >
                <CombatVerseRevealLine
                  text={source}
                  progress={lineProgress}
                  fontFamily={verseFontFamily}
                  fontWeight={400}
                />
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function CombatCanvas3D({
  images,
  activeIndex,
  visible,
  accent,
  activeChar,
  combatDepthSrc,
  mousePos,
  theme,
  isEditMode,
  customTextStyle,
  customBorderStyle,
  customBgDarkStyle,
  customGlowShadow,
  powerData,
  availableForms,
  selectedFormKey,
  setSelectedFormKey,
  updateFormOverride,
  updateHexagram,
  updateCharacter,
  combatInputRef,
  handleImageUpload,
  hoveredPanel,
  setHoveredPanel,
  parallaxParams,
  combatFocalBySrc,
  verseTextColor,
}) {
  const pp = { ...DEFAULT_COMBAT_PARALLAX, ...parallaxParams };
  const focalMap = combatFocalBySrc && typeof combatFocalBySrc === 'object' ? combatFocalBySrc : {};
  return (
    <Canvas
      camera={{ position: [0, 0.15, 14], fov: 46 }}
      dpr={[1, 1.8]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent', overflow: 'visible' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
        });
      }}
    >
      <fog attach="fog" args={['#090f1d', 22, 46]} />

      <ambientLight intensity={0.62} />
      <pointLight position={[0, 2.6, 4]} intensity={1.45} color="#ffffff" />
      <pointLight position={[3.8, -0.5, 2]} intensity={1.1} color={accent} />
      <pointLight position={[-4, 1.2, 1]} intensity={0.65} color="#60a5fa" />
      <pointLight position={[0, 0.7, -2.6]} intensity={1.65} color={accent} />
      <spotLight position={[0, 4.8, 2.8]} angle={0.36} penumbra={0.9} intensity={1.0} color="#ffffff" />

      <CombatCameraRig />

      <group position={[0, 1.016 + COMBAT_SCENE_LIFT_Y, 0]}>
        <CombatImageTiltGroup mousePos={mousePos} tiltDeg={pp.tiltDeg} mouseDiv={pp.mouseDiv}>
          {images.map((src, idx) => (
            <CombatPlane3D
              key={src || `img-${idx}`}
              src={src}
              charFallbackDepth={combatDepthSrc}
              accent={accent}
              mousePos={mousePos}
              parallaxParams={{
                ...pp,
                focalDepth: focalMap[src] != null ? focalMap[src] : pp.focalDepth,
              }}
              opacity={idx === activeIndex ? (visible ? 1 : 0) : 0}
            />
          ))}
          <CombatDepthVerseLayers activeChar={activeChar} verseTextColor={verseTextColor} accentGlow={accent} mousePos={mousePos} />
        </CombatImageTiltGroup>
      </group>

      <mesh position={[0, -3.5, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[22, 12]} />
        <meshBasicMaterial color={accent} transparent opacity={0.11} />
      </mesh>
      <mesh position={[0, 0.7, -1.8]}>
        <planeGeometry args={[13.5, 8.2]} />
        <meshBasicMaterial color={accent} transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <Sparkles count={36} size={1.4} scale={[11, 6, 7]} speed={0.16} color={accent} opacity={0.24} />
      <Environment files={COMBAT_ENV_CITY_HDR} />

      <group rotation={[0, 0, 0]} position={[-7.75, 2.28 + COMBAT_SCENE_LIFT_Y, 0.78]}>
        <Html transform distanceFactor={6.75} className="pointer-events-auto">
          <div
            className={`w-[14.4rem] px-3 py-5 bg-white/80 backdrop-blur-md border border-white/50 rounded-lg shadow-lg hover:opacity-100 opacity-90 combat-ui-panel ${hoveredPanel === 'left' ? 'combat-ui-panel--hover' : ''}`}
            onMouseEnter={() => setHoveredPanel('left')}
            onMouseLeave={() => setHoveredPanel(null)}
            style={{
              boxShadow: hoveredPanel === 'left' ? `0 10px 26px ${accent}22` : undefined
            }}
          >
            <div className={`text-xs font-bold tracking-widest opacity-60 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>COMBAT PHASE</div>
            <div className="text-2xl font-black font-serif text-slate-800 mt-1">{activeChar.name}</div>
            <div className={`text-lg font-bold font-serif ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>{activeChar.title} · {activeChar.details?.phase}</div>

            <div className="w-28 h-28 mx-auto mt-4 relative flex items-center justify-center">
              <div className={`absolute inset-0 rounded-full border-2 border-dashed opacity-20 animate-[spin_20s_linear_infinite] ${theme.isCustom ? '' : theme.border}`} style={customBorderStyle}></div>
              <div className={`absolute inset-3 rounded-full border border-solid opacity-10 ${theme.isCustom ? '' : theme.border}`} style={customBorderStyle}></div>

              {HEXAGRAM_LABELS.map((label, i) => {
                const val = (activeChar.hexagram || [])[i] || 0;
                return (
                  <div key={`${activeChar.id}-${i}`} className="absolute top-1/2 left-1/2 w-6 h-12 origin-bottom flex flex-col-reverse justify-start items-center gap-[1px] pb-1" style={{ transform: `translateX(-50%) translateY(-100%) rotate(${i * 60}deg)` }}>
                    {[...Array(6)].map((_, j) => {
                      const isFilled = j < val;
                      return (
                        <div key={j}
                          onClick={() => isEditMode && updateHexagram(i, j + 1)}
                          className={`h-[12%] rounded-[1px] transition-all duration-300 ${isEditMode ? 'cursor-pointer hover:scale-110' : ''} ${isFilled ? 'animate-hex-ripple' : ''}`}
                          style={{
                            width: `${40 + (j * 10)}%`,
                            backgroundColor: isFilled ? theme.accent : 'transparent',
                            border: isFilled ? 'none' : '1px solid rgba(200,200,200,0.3)',
                            boxShadow: isFilled ? `0 0 5px ${theme.accent}40` : 'none',
                            animationDelay: `${j * 0.2}s`,
                            color: theme.accent
                          }}
                        ></div>
                      );
                    })}
                    <div className={`absolute -top-5 text-[8px] font-bold scale-75 ${theme.isCustom ? '' : theme.text}`} style={{ transform: `rotate(-${i * 60}deg)`, ...(customTextStyle || {}) }}>{label}</div>
                  </div>
                );
              })}
              <div className={`absolute w-2 h-2 rounded-full ${theme.isCustom ? '' : theme.bgDark} z-10 shadow-md border border-white`} style={customBgDarkStyle}></div>
            </div>
            {isEditMode && <div className="text-center text-[8px] text-slate-400 mt-2">点击图表调整数值</div>}
          </div>
        </Html>
      </group>

      <group rotation={[0, 0, 0]} position={[7.7, 3.24 + COMBAT_SCENE_LIFT_Y, 0.78]}>
        <Html transform distanceFactor={6.75} className="pointer-events-auto">
          <div
            className={`w-[15.3rem] p-4 bg-white/80 backdrop-blur-md border border-white/50 rounded-lg shadow-lg hover:opacity-100 opacity-90 combat-ui-panel ${hoveredPanel === 'right' ? 'combat-ui-panel--hover' : ''}`}
            onMouseEnter={() => setHoveredPanel('right')}
            onMouseLeave={() => setHoveredPanel(null)}
            style={{
              boxShadow: hoveredPanel === 'right' ? `0 10px 26px ${accent}22` : undefined
            }}
          >
            <div className="flex flex-col items-end">
              <div className={`text-[10px] font-black tracking-[0.2em] opacity-50 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>POWER SPECTRUM</div>
              <div className="flex items-baseline gap-2 mt-1">
                {isEditMode ? (
                  <input type="number" value={powerData.power || 0} onChange={(e) => updateFormOverride('power', Number(e.target.value))}
                    className={`w-24 text-2xl font-black font-mono leading-none bg-transparent border-b border-dashed ${theme.isCustom ? '' : theme.border} outline-none ${theme.isCustom ? '' : theme.text} text-right`}
                    style={{ ...(customBorderStyle || {}), ...(customTextStyle || {}) }} />
                ) : (
                  <span className={`text-2xl font-black font-mono leading-none ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>{powerData.power}</span>
                )}
                <span className="text-[10px] font-bold text-slate-400">UNIT</span>
              </div>
            </div>

            <div className="flex gap-1 items-center max-w-[255px] flex-wrap justify-end ml-auto">
              {powerData.bits.map((bit, idx) => {
                const bitPos = powerData.bits.length - 1 - idx;
                const isWithinRank = bitPos < (powerData.rank || 0);
                return (
                  <div key={idx} className="flex flex-col items-center gap-0.5">
                    <div
                      className={`w-3 h-3 rounded-[1px] transition-all duration-700 flex items-center justify-center
                        ${!isWithinRank
                          ? 'border border-slate-200/20 scale-[0.5] opacity-20'
                          : bit === 1
                            ? `${theme.isCustom ? '' : theme.bgDark} animate-pulse`
                            : 'bg-white/30 border border-slate-300/40'
                        }`}
                      style={{
                        ...(bit === 1 && isWithinRank ? (customBgDarkStyle || {}) : {}),
                        boxShadow: (isWithinRank && bit === 1) ? (customGlowShadow || `0 0 10px ${theme.accent}aa`) : (isWithinRank && bit === 0) ? `inset 0 0 3px ${theme.accent}22` : 'none',
                        backgroundColor: (isWithinRank && bit === 1) ? (theme.styles?.bgDark || theme.accent) : (isWithinRank && bit === 0) ? `${theme.accent}11` : 'transparent'
                      }}
                    >
                      {isWithinRank && bit === 1 && (
                        <div className="w-1 h-1 bg-white rounded-full opacity-80" />
                      )}
                      {isWithinRank && bit === 0 && (
                        <div
                          className="w-1 h-1 rounded-full opacity-20"
                          style={{ backgroundColor: theme.accent }}
                        />
                      )}
                    </div>
                    {isEditMode && bitPos % 5 === 0 && <span className="text-[6px] text-slate-400 font-mono scale-75 leading-none">{bitPos}</span>}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col items-end w-full">
              <div className={`text-xs font-bold tracking-widest ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>
                {activeChar.name}
                {powerData.formName !== '基础形态' && (
                  <>
                    <span className="opacity-40 mx-1">/</span>
                    <span className="text-slate-700">{powerData.formName}</span>
                  </>
                )}
              </div>
              <div className="text-[9px] font-bold text-slate-400 mt-1 tracking-widest uppercase">
                Phase Rank: {isEditMode ? (
                  <input type="number" min="1" max="16" value={powerData.rank || 0} onChange={(e) => updateFormOverride('rank', Number(e.target.value))}
                    className="w-10 bg-transparent border-b border-dashed border-slate-400 outline-none text-[9px] font-black text-slate-600 text-center mx-1" />
                ) : <span className="font-black text-slate-600 mx-1">{powerData.rank}</span>} Bits
              </div>
              {availableForms.length > 1 && (
                <div className="flex flex-wrap justify-end gap-1 mt-3 max-w-[180px]">
                  {availableForms.map(formKey => {
                    const isSelected = (selectedFormKey || activeChar.name) === formKey;
                    const label = formKey.includes('·') ? formKey.split('·')[1] : '基础';
                    return (
                      <button key={formKey} onClick={() => setSelectedFormKey(formKey)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all border ${isSelected ? `${theme.isCustom ? '' : theme.bgDark} text-white border-transparent shadow-sm` : 'bg-white/50 text-slate-500 border-slate-200 hover:border-slate-400'}`}
                        style={isSelected ? customBgDarkStyle : undefined}>{label}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Html>
      </group>

      <group position={[0, 4.55 + COMBAT_SCENE_LIFT_Y, 1.12]}>
        <Html transform distanceFactor={6.75} className="pointer-events-auto" style={{ overflow: 'visible' }}>
          <div
            className="origin-center"
            style={{
              transform: 'scale(0.8)',
              transformOrigin: 'center center',
            }}
          >
            <div
              className={`relative px-8 py-2.5 bg-[#fffbf0]/90 backdrop-blur-sm border-y ${theme.isCustom ? '' : theme.border} shadow-sm w-max max-w-[min(48rem,calc(100vw-2rem))] min-h-[3.25rem] flex items-center justify-center combat-ui-panel combat-ui-panel--poem-inner ${hoveredPanel === 'poem' ? 'combat-ui-panel--hover' : ''}`}
              onMouseEnter={() => setHoveredPanel('poem')}
              onMouseLeave={() => setHoveredPanel(null)}
              style={{
                ...(customBorderStyle || {}),
                boxShadow: hoveredPanel === 'poem' ? `0 8px 20px ${accent}1f` : undefined
              }}
            >
              <div className={`absolute left-2 top-1/2 -translate-y-1/2 text-lg opacity-30 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}><Quote size={14} className="rotate-180" /></div>
              <div className={`absolute right-2 top-1/2 -translate-y-1/2 text-lg opacity-30 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}><Quote size={14} /></div>
              {isEditMode ? (
                <LocalInput value={activeChar.combatPoem} onChange={(val) => updateCharacter('combatPoem', val)}
                  className={`combat-poem-ui-text combat-poem-ui-text--editor bg-transparent border-none outline-none text-center font-serif text-lg font-medium tracking-widest min-h-[2.5rem] px-2 leading-normal ${theme.isCustom ? '' : theme.text}`}
                  style={{
                    ...customTextStyle,
                    fontFamily: getCombatPoemUiFontFamily(),
                    fontWeight: 500,
                    fontSize: `${Math.round(18 * getCombatPoemUiFontSizeScale(activeChar?.name))}px`,
                  }}
                  placeholder="点击输入诗句..." />
              ) : (
                <h2
                  className={`combat-poem-ui-text font-serif text-lg font-medium tracking-[0.15em] text-center px-2 leading-normal ${theme.isCustom ? '' : theme.text}`}
                  style={{
                    ...customTextStyle,
                    fontFamily: getCombatPoemUiFontFamily(),
                    fontWeight: 500,
                    fontSize: `${Math.round(18 * getCombatPoemUiFontSizeScale(activeChar?.name))}px`,
                  }}
                >{activeChar.combatPoem}</h2>
              )}
            </div>
          </div>
        </Html>
      </group>

      <group rotation={[0, 0, 0]} position={[8.1, -1.02 + COMBAT_SCENE_LIFT_Y, 0.88]}>
        <Html transform distanceFactor={6.75} className="pointer-events-auto">
          <div
            className={`w-52 p-4 bg-white/60 backdrop-blur-md border border-white/40 rounded-lg shadow-lg combat-ui-panel ${hoveredPanel === 'desc' ? 'combat-ui-panel--hover' : ''}`}
            onMouseEnter={() => setHoveredPanel('desc')}
            onMouseLeave={() => setHoveredPanel(null)}
            style={{
              boxShadow: hoveredPanel === 'desc' ? `0 10px 24px ${accent}20` : undefined
            }}
          >
            <div className={`text-xs font-bold tracking-widest border-b border-slate-300 pb-2 mb-2 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>角色说明</div>
            <LocalTextarea value={String(activeChar.combatDesc || '')} onChange={(val) => updateCharacter('combatDesc', val)} disabled={!isEditMode}
              className="w-full h-40 bg-transparent resize-none outline-none text-slate-700 text-xs leading-5 text-justify font-serif" placeholder="在此输入角色/技能说明..." />
            {isEditMode && (
              <LocalTextarea
                value={String(activeChar.combatVerses || '')}
                onChange={(val) => updateCharacter('combatVerses', val)}
                className="w-full h-24 mt-2 bg-slate-50/80 rounded-md px-2 py-1.5 resize-none outline-none text-slate-600 leading-snug font-serif font-normal border border-slate-200/80"
                style={{
                  fontFamily: getCombatVerseFontFamily(activeChar?.name),
                  fontWeight: 400,
                  fontSize: `${Math.round(11 * getCombatVerseFontSizeScale(activeChar?.name))}px`,
                }}
                placeholder="环绕短句（每行一句，最多取前6句）"
                maxLength={220}
              />
            )}
            {selectedFormKey && selectedFormKey !== activeChar.name && <div className={`mt-2 text-[9px] font-bold italic opacity-60 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>* 当前查看形态: {powerData.formName}</div>}
          </div>
        </Html>
      </group>

      {isEditMode && (
        <group position={[0, -2.9 + COMBAT_SCENE_LIFT_Y, 1]}>
          <Html transform distanceFactor={6.75} className="pointer-events-auto">
            <button type="button" onClick={() => combatInputRef.current.click()} className={`combat-ui-panel combat-upload-btn flex items-center gap-2 px-6 py-2 text-sm font-bold text-white shadow-lg rounded-full backdrop-blur-md ${theme.isCustom ? '' : theme.bgDark}`} style={customBgDarkStyle}>
              <Upload size={16} /> 上传战斗横图
            </button>
            <input ref={combatInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'combat_img')} />
          </Html>
        </group>
      )}

      {!images.length && (
        <group position={[0, COMBAT_SCENE_LIFT_Y, 1]}>
          <Html transform distanceFactor={6.1} className="pointer-events-none">
            <div className="flex flex-col items-center justify-center text-slate-300 font-serif tracking-widest">
              <Zap size={48} strokeWidth={1} /><span className="mt-4">暂无战斗特效</span>
            </div>
          </Html>
        </group>
      )}
    </Canvas>
  );
}

const CombatView = ({
  activeChar, theme, isEditMode,
  updateCharacter, updateHexagram,
  combatInputRef, handleImageUpload,
  mousePos,
}) => {
  const [combatImages, setCombatImages] = React.useState([]);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [hoveredPanel, setHoveredPanel] = React.useState(null);
  const customTextStyle = theme?.isCustom ? { color: theme.styles?.textColor || theme.accent } : undefined;
  const customBorderStyle = theme?.isCustom ? { borderColor: theme.styles?.borderColor || theme.accent } : undefined;
  const customBgDarkStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent } : undefined;
  const customGlowShadow = theme?.isCustom ? `0 0 10px ${(theme.styles?.bgDark || theme.accent)}AA` : undefined;

  const [parallaxPrefs, setParallaxPrefs] = React.useState(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_COMBAT_PARALLAX };
    return loadCombatParallaxPrefs();
  });

  const [combatFocalBySrc, setCombatFocalBySrc] = React.useState(() => {
    if (typeof window === 'undefined') return {};
    return loadCombatFocalBySrc();
  });

  React.useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(COMBAT_PARALLAX_STORAGE_KEY, JSON.stringify(parallaxPrefs));
      } catch (e) { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [parallaxPrefs]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(COMBAT_FOCAL_BY_SRC_STORAGE_KEY, JSON.stringify(combatFocalBySrc));
      } catch (e) { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [combatFocalBySrc]);

  React.useEffect(() => {
    if (!activeChar?.name) return;
    const name = activeChar.name;
    setCombatImages([]);
    fetch(`/api/list-images?char=${encodeURIComponent(name)}&type=combats`)
      .then(r => r.ok ? r.json() : { images: [] })
      .then(d => setCombatImages(Array.isArray(d.images) && d.images.length > 0 ? d.images : []))
      .catch(() => setCombatImages([]));
  }, [activeChar?.name]);

  const finalCombats = combatImages.length > 0
    ? combatImages
    : (activeChar?.combatImg ? [activeChar.combatImg] : []);

  const combatDisplay = useTimedRandomImage(finalCombats, 60000);

  // 1. 查找当前角色的所有可用形态
  const availableForms = React.useMemo(() => {
    return Object.keys(CHARACTER_POWER_MAP).filter(key => 
      key === activeChar.name || key.startsWith(`${activeChar.name}·`)
    );
  }, [activeChar.name]);

  // 2. 本地状态记录当前选择的形态键
  const [selectedFormKey, setSelectedFormKey] = React.useState(null);

  // 当切换角色或标题改变时，尝试匹配默认形态
  React.useEffect(() => {
    const fullMatch = `${activeChar.name}·${activeChar.title}`;
    if (CHARACTER_POWER_MAP[fullMatch]) {
      setSelectedFormKey(fullMatch);
    } else if (CHARACTER_POWER_MAP[activeChar.name]) {
      setSelectedFormKey(activeChar.name);
    } else if (availableForms.length > 0) {
      setSelectedFormKey(availableForms[0]);
    } else {
      setSelectedFormKey(activeChar.name); // 兜底
    }
  }, [activeChar.name, activeChar.title, availableForms]);

  // 3. 计算展示用的战力数据
  const getDisplayPowerData = () => {
    const currentKey = selectedFormKey || activeChar.name;
    const overrides = (activeChar.formOverrides || {})[currentKey] || {};
    const baseData = CHARACTER_POWER_MAP[currentKey] || { power: 0, rank: 0 };
    
    const data = { ...baseData, ...overrides };
    
    const requiredBits = (data.power || 0).toString(2).length;
    const totalBits = Math.max(10, data.rank || 0, requiredBits);
    
    const binaryStr = (data.power || 0).toString(2).padStart(totalBits, '0');
    const bits = binaryStr.split('').map(Number);
    
    const formName = currentKey.includes('·') 
      ? currentKey.split('·')[1] 
      : '基础形态';

    return { ...data, bits, formName, currentKey };
  };

  const updateFormOverride = (field, value) => {
    const currentKey = selectedFormKey || activeChar.name;
    const currentOverrides = activeChar.formOverrides || {};
    const formOverride = currentOverrides[currentKey] || {};
    
    const nextOverrides = {
      ...currentOverrides,
      [currentKey]: {
        ...formOverride,
        [field]: value
      }
    };
    updateCharacter('formOverrides', nextOverrides);
  };

  const powerData = getDisplayPowerData();

  const verseTextColor = React.useMemo(
    () => blendTextTowardAccent(resolveThemeTextColorHex(theme), theme?.accent, 0.34),
    [theme?.accent, theme?.isCustom, theme?.styles?.textColor]
  );

  return (
    <div className="w-full h-full min-h-0 flex relative justify-start pt-0 -mt-3 md:-mt-4 overflow-visible" onDragOver={(e) => {
      if (!isEditMode) return;
      const hasImage = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file' && String(item.type || '').startsWith('image/'));
      if (!hasImage) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }} onDragLeave={(e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextTarget = e.relatedTarget;
      if (nextTarget && e.currentTarget.contains(nextTarget)) return;
      setIsDragOver(false);
    }} onDrop={(e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (!isEditMode) return;
      const file = Array.from(e.dataTransfer?.files || []).find(f => String(f.type || '').startsWith('image/'));
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      if (combatInputRef?.current) {
        combatInputRef.current.files = dt.files;
        combatInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }}>
      {isEditMode && isDragOver && (
        <div className="absolute inset-6 z-50 rounded-3xl border-2 border-dashed border-cyan-400 bg-cyan-50/80 backdrop-blur-sm flex items-center justify-center pointer-events-none shadow-inner">
          <div className="flex flex-col items-center gap-3 text-cyan-700">
            <Upload size={34} className="animate-bounce" />
            <div className="text-xs font-black tracking-[0.25em] uppercase">释放以设置战斗图</div>
            <div className="text-[10px] font-bold text-cyan-600">也保留原有全局拖拽上传</div>
          </div>
        </div>
      )}
      <div className="relative w-full h-full min-h-0 overflow-visible [&_canvas]:!overflow-visible isolate [perspective:1800px] [transform-style:preserve-3d] animate-fade-in">
        <CombatCanvas3D
          key={activeChar?.name || 'combat'}
          images={combatDisplay.images}
          activeIndex={combatDisplay.index}
          visible={combatDisplay.visible}
          accent={theme.accent}
          activeChar={activeChar}
          combatDepthSrc={activeChar?.combatDepthImg || null}
          mousePos={mousePos}
          theme={theme}
          isEditMode={isEditMode}
          customTextStyle={customTextStyle}
          customBorderStyle={customBorderStyle}
          customBgDarkStyle={customBgDarkStyle}
          customGlowShadow={customGlowShadow}
          powerData={powerData}
          availableForms={availableForms}
          selectedFormKey={selectedFormKey}
          setSelectedFormKey={setSelectedFormKey}
          updateFormOverride={updateFormOverride}
          updateHexagram={updateHexagram}
          updateCharacter={updateCharacter}
          combatInputRef={combatInputRef}
          handleImageUpload={handleImageUpload}
          hoveredPanel={hoveredPanel}
          setHoveredPanel={setHoveredPanel}
          parallaxParams={parallaxPrefs}
          combatFocalBySrc={combatFocalBySrc}
          verseTextColor={verseTextColor}
        />
        {isEditMode && (
          <CombatParallaxControls
            prefs={parallaxPrefs}
            onChange={setParallaxPrefs}
            accent={theme.accent}
            activeCombatSrc={combatDisplay.src}
            focalBySrc={combatFocalBySrc}
            setFocalBySrc={setCombatFocalBySrc}
          />
        )}
      </div>
    </div>
  );
};

export default CombatView;
