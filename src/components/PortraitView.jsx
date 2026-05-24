import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, forwardRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Float, Sparkles, useTexture, Environment, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Scroll, User, Hexagon, Sword, Wind, Trash2, Plus, Camera, Edit3 } from 'lucide-react';
import { COLOR_THEMES, buildCustomTheme, makeCustomThemeKey, normalizeHexColor } from '../constants';
import DetailRow from './DetailRow';
import PanelFlowEdges from './PanelFlowEdges';

const LocalInput = ({ value, onChange, ...props }) => {
  const [localVal, setLocalVal] = useState(value || '');
  useEffect(() => { setLocalVal(value || ''); }, [value]);
  return <input value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={e => onChange(e.target.value)} {...props} />;
};

const LocalTextarea = ({ value, onChange, ...props }) => {
  const [localVal, setLocalVal] = useState(value || '');
  useEffect(() => { setLocalVal(value || ''); }, [value]);
  return <textarea value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={e => onChange(e.target.value)} {...props} />;
};

// ─── 1. 3D 辅助组件 (增强稳定性) ──────────────────────────────────────────────
const FALLBACK_TEXTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a2240"/><stop offset="55%" stop-color="#16213b"/><stop offset="100%" stop-color="#0d1326"/></linearGradient><radialGradient id="v" cx="0.5" cy="0.45" r="0.72"><stop offset="55%" stop-color="rgba(255,255,255,0.06)"/><stop offset="100%" stop-color="rgba(0,0,0,0.42)"/></radialGradient></defs><rect width="512" height="512" fill="url(#g)"/><rect width="512" height="512" fill="url(#v)"/></svg>'
)}`;
const IMAX_RADIUS = 60;
const IMAX_HEIGHT = 31.2;
const IMAX_THETA_LENGTH = 0.92;
const IMAX_SURFACE_ASPECT = (IMAX_RADIUS * IMAX_THETA_LENGTH) / IMAX_HEIGHT;

/** 与 Canvas 一致；弧幕中心原世界坐标 [0, 0.5, 25]，换算到「初始相机」本地坐标，保证与改绑定前到相机的距离、方向一致 */
const IMAX_WORLD_CENTER = new THREE.Vector3(0, 0.5, 25);
const IMAX_CAMERA_LOCAL_POS = (() => {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 0.8, 16.5);
  cam.lookAt(0, 0.5, 0);
  cam.updateMatrixWorld();
  const p = IMAX_WORLD_CENTER.clone();
  cam.worldToLocal(p);
  return p;
})();

/** 两侧 Html 面板绕 Y 轴向中线内收：左 +、右 -，对称（当前 10°） */
const PANEL_TILT_RAD = THREE.MathUtils.degToRad(10);

/** 与下方 <Html transform distanceFactor={HTML_PANEL_DISTANCE_FACTOR}> 一致 */
const HTML_PANEL_DISTANCE_FACTOR = 6;

function applyTextureCoverUv(texture, mediaAspect, surfaceAspect) {
  if (!texture || !mediaAspect || !surfaceAspect) return;

  let repeatX = 1;
  let repeatY = 1;
  let offsetX = 0;
  let offsetY = 0;

  // cover：保持媒体比例并居中裁切，避免弧幕上拉伸变形
  if (mediaAspect > surfaceAspect) {
    repeatX = surfaceAspect / mediaAspect;
    offsetX = (1 - repeatX) * 0.5;
  } else {
    repeatY = mediaAspect / surfaceAspect;
    offsetY = (1 - repeatY) * 0.5;
  }

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.offset.set(offsetX, offsetY);
  texture.needsUpdate = true;
}

/** 水平镜像 UV（用于个别角色背景视频构图） */
function applyHorizontalMirrorTextureU(texture) {
  const r = texture.repeat.x;
  const o = texture.offset.x;
  texture.repeat.x = -r;
  texture.offset.x = o + r;
  texture.needsUpdate = true;
}

function IMaxScreen({ src, isVideo, mirrorVideo, onTextureReady }) {
  const [videoTexture, setVideoTexture] = useState(null);
  const fallbackUrl = FALLBACK_TEXTURE;
  const finalSrc = src || fallbackUrl;

  useEffect(() => {
    if (isVideo && src) {
      const video = document.createElement('video');
      video.src = src;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.crossOrigin = "anonymous";
      video.play().catch(e => console.warn("Background video auto-play prevented:", e));
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      const applyVideoUv = () => {
        const vw = video.videoWidth || 0;
        const vh = video.videoHeight || 0;
        if (!vw || !vh) return;
        applyTextureCoverUv(tex, vw / vh, IMAX_SURFACE_ASPECT);
        if (mirrorVideo) applyHorizontalMirrorTextureU(tex);
      };
      applyVideoUv();
      video.addEventListener('loadedmetadata', applyVideoUv);
      setVideoTexture(tex);
      onTextureReady?.(tex);
      return () => {
        video.removeEventListener('loadedmetadata', applyVideoUv);
        tex.dispose();
        video.pause();
        video.src = "";
        video.load();
      };
    } else {
      setVideoTexture(null);
    }
  }, [src, isVideo, mirrorVideo]);

  const imgTex = useTexture(isVideo ? fallbackUrl : finalSrc);
  if (imgTex) imgTex.colorSpace = THREE.SRGBColorSpace;
  useEffect(() => {
    if (!imgTex || isVideo) return;
    const iw = imgTex.image?.width || 0;
    const ih = imgTex.image?.height || 0;
    if (!iw || !ih) return;
    applyTextureCoverUv(imgTex, iw / ih, IMAX_SURFACE_ASPECT);
    onTextureReady?.(imgTex);
  }, [imgTex, isVideo, finalSrc]);

  return (
    <mesh position={IMAX_CAMERA_LOCAL_POS} rotation={[0, Math.PI, 0]}>
      {/* 旋转 π 后，起始角取 -弧长/2，弧段中心正对相机 */}
      <cylinderGeometry args={[IMAX_RADIUS, IMAX_RADIUS, IMAX_HEIGHT, 96, 1, true, -IMAX_THETA_LENGTH / 2, IMAX_THETA_LENGTH]} />
      <meshBasicMaterial
        map={isVideo ? (videoTexture || imgTex) : imgTex}
        side={THREE.DoubleSide}
        transparent
        opacity={0.92}
        toneMapped={false}
        depthWrite
        fog={false}
      />
    </mesh>
  );
}

/**
 * GroundDiffuse: 磨砂玻璃漫反射光晕
 * 透视梯形雾带 + 斜边主题色高亮，平铺地面或对称顶面
 */
function GroundDiffuse({ map, accentColor, placement = 'bottom' }) {
  const meshRef = useRef();
  const isTop = placement === 'top';

  const uniforms = useMemo(() => ({
    uMap: { value: null },
    uAccentColor: { value: new THREE.Color(accentColor) },
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uFlipY: { value: isTop ? 1.0 : 0.0 },
  }), [isTop]);

  useEffect(() => {
    uniforms.uAccentColor.value.set(accentColor);
  }, [accentColor, uniforms]);

  useEffect(() => {
    uniforms.uMap.value = map;
  }, [map, uniforms]);

  useFrame((state) => {
    if (meshRef.current) {
      uniforms.uTime.value = state.clock.elapsedTime;
      const targetOpacity = map ? (isTop ? 0.54 : 0.43) : 0;
      uniforms.uOpacity.value = THREE.MathUtils.lerp(uniforms.uOpacity.value, targetOpacity, 0.05);
    }
  });

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D uMap;
    uniform vec3 uAccentColor;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uFlipY;

    // 1. 基础噪声
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    // 2. FBM（分形噪声）
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * hash(p);
        p *= 2.1;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      // vy：纵深，0 靠屏幕底边，1 远处
      float vy = mix(vUv.y, 1.0 - vUv.y, uFlipY);

      // 透视梯形：近处全宽，远处向中线收拢
      float maxWidth = mix(0.5, 0.15, vy);
      float distFromCenter = abs(vUv.x - 0.5);
      float maskTriangle = 1.0 - smoothstep(maxWidth - 0.08, maxWidth, distFromCenter);

      float edgeLine = smoothstep(maxWidth - 0.05, maxWidth, distFromCenter)
        * (1.0 - smoothstep(maxWidth, maxWidth + 0.02, distFromCenter));
      float lineGlow = sin(uTime * 3.0 + vy * 15.0) * 0.5 + 0.5;

      vec2 sampleUv = vUv;
      sampleUv.y = mix(vy * 0.4 + 0.1, 0.5 + vy * 0.45, uFlipY);
      float speed = uTime * 0.05 * mix(1.0, -1.0, uFlipY);
      vec2 flowUv = vUv * 8.0;
      vec2 fogOffset = vec2(
        fbm(flowUv + vec2(speed, 0.0)) - 0.5,
        fbm(flowUv + vec2(0.0, speed)) - 0.5
      ) * 0.08;

      vec3 color = texture2D(uMap, sampleUv + fogOffset).rgb * 0.6;
      color += texture2D(uMap, sampleUv - fogOffset * 0.4).rgb * 0.4;
      color = mix(color, uAccentColor, 0.15);

      vec3 edgeHighlight = uAccentColor * edgeLine * (1.0 - vy) * (0.5 + lineGlow * 1.5);
      color += edgeHighlight;

      // 原先用 smoothstep(0,0.15,vy) 在 vy→0 时接近 0，脚底一大片 alpha 被压没，会显得地面雾特别暗
      float nearDepth = smoothstep(0.0, 0.15, vy);
      float nearFade = mix(0.55 + 0.45 * nearDepth, nearDepth, uFlipY);
      float maskDepth = nearFade * (1.0 - smoothstep(0.4, 0.8, vy));
      float finalMask = maskTriangle * maskDepth;
      finalMask = max(finalMask, edgeLine * maskDepth * 0.8);

      gl_FragColor = vec4(color, finalMask * uOpacity * 1.6);
    }
  `;

  return (
    <mesh ref={meshRef} position={isTop ? [0, 5.98, 0] : [0, -5.98, 0]} rotation={isTop ? [Math.PI / 2, 0, 0] : [-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[50, 50]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        renderOrder={isTop ? 1 : 0}
      />
    </mesh>
  );
}

function SpiralParticles({ themeColor }) {
  const points = useRef(null);
  useFrame((state) => {
    if (!points.current) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.15;
    points.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
  });

  const particles = useMemo(() => {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 36;
      const radius = 5 + Math.random() * 2.8;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    return positions;
  }, []);

  return (
    <points ref={points} position={[0, 0, -2]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particles.length / 3} array={particles} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color={themeColor} transparent opacity={0.36} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

const CharacterPortrait3D = forwardRef(function CharacterPortrait3D({ src, isVisible, accentColor, mousePos }, ref) {
  const texture = useTexture(src || FALLBACK_TEXTURE);
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;

  const aspect = useMemo(() => {
    const width = texture?.image?.width;
    const height = texture?.image?.height;
    if (!width || !height) return 0.7;
    return width / height;
  }, [texture]);
  const height = 8.4; 
  const width = height * aspect;
  const frameT = 0.08;
  const groupRef = useRef();
  const materialRef = useRef();
  const setGroupRef = useCallback((node) => {
    groupRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useFrame((state) => {
    if (materialRef.current) {
      const targetOpacity = isVisible ? 1 : 0;
      materialRef.current.opacity += (targetOpacity - materialRef.current.opacity) * 0.08;
    }
    if (groupRef.current) {
      const mx = mousePos?.x || 0;
      const my = mousePos?.y || 0;
      const nx = THREE.MathUtils.clamp(mx / 10, -1, 1);
      const ny = THREE.MathUtils.clamp(my / 10, -1, 1);
      const maxTilt = THREE.MathUtils.degToRad(4);
      const targetX = ny * maxTilt;
      const targetY = nx * maxTilt;
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX, 0.035);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetY, 0.035);
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.2) * 0.06 - 0.2;
    }
  });

  return (
    <group ref={setGroupRef} position={[0, -0.2, 0]}>
      <mesh position={[0, 0, -0.1]}>
        <planeGeometry args={[width + 1.2, height + 1.2]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={materialRef}
          map={texture}
          transparent
          opacity={0}
          alphaTest={0.03}
          side={THREE.FrontSide}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[width + 0.1, height + 0.1, 0.04]} />
        <meshPhysicalMaterial
          color="#ffffff"
          metalness={0.2}
          roughness={0.18}
          transmission={0.88}
          thickness={0.18}
          clearcoat={0.9}
          clearcoatRoughness={0.14}
          ior={1.2}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments position={[0, 0, 0.05]}>
        <edgesGeometry args={[new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.04)]} />
        <lineBasicMaterial color={accentColor} transparent opacity={0.34} depthWrite={false} />
      </lineSegments>

      <group position={[0, 0, 0.018]}>
        <mesh position={[0, height / 2 + frameT / 2, 0]}>
          <planeGeometry args={[width + frameT * 2, frameT, 1]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh position={[0, -height / 2 - frameT / 2, 0]}>
          <planeGeometry args={[width + frameT * 2, frameT, 1]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh position={[-width / 2 - frameT / 2, 0, 0]}>
          <planeGeometry args={[frameT, height + frameT * 2, 1]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh position={[width / 2 + frameT / 2, 0, 0]}>
          <planeGeometry args={[frameT, height + frameT * 2, 1]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.28} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
});

function CameraRig({ mousePos }) {
  const { camera } = useThree();
  useFrame(() => {
    const mx = mousePos?.x || 0;
    const my = mousePos?.y || 0;
    const tx = mx * 0.06;
    const ty = -my * 0.022 + 0.8;
    camera.position.x += (tx - camera.position.x) * 0.05;
    camera.position.y += (ty - camera.position.y) * 0.05;
    camera.lookAt(0, 0.5, 0);
  });
  return null;
}

/** 背景挂在相机朝向下：每帧同步位姿，相对屏幕「钉死」，不受鼠标运镜视差影响 */
function BackgroundFixedToCamera({ children }) {
  const groupRef = useRef(null);
  const { camera } = useThree();
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);
  });
  return <group ref={groupRef}>{children}</group>;
}

function pickRandomUrl(list, excludeUrl = null) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];

  // 过滤掉当前正在显示的图，从剩下的图里选
  const candidates = list.filter(url => url !== excludeUrl);
  if (candidates.length === 0) return list[0]; // 如果全都一样，就返回第一个

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

function useTimedRandomImage(images, intervalMs = 300000, storageKey = null) {
  const list = useMemo(() => Array.isArray(images) ? images.filter(Boolean) : [], [images]);
  
  const getStoredUrl = useCallback(() => {
    if (!storageKey) return null;
    return localStorage.getItem(storageKey);
  }, [storageKey]);

  const [currentUrl, setCurrentUrl] = useState(null);
  const [visible, setVisible] = useState(true);
  
  const fadeTimerRef = useRef(null);
  const switchTimerRef = useRef(null);
  const isInitialPickDoneRef = useRef(false);

  const updateUrl = useCallback((newUrl) => {
    setCurrentUrl(newUrl);
    if (storageKey && newUrl) {
      localStorage.setItem(storageKey, newUrl);
    }
  }, [storageKey]);

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
    if (switchTimerRef.current) { clearTimeout(switchTimerRef.current); switchTimerRef.current = null; }
  }, []);

  const startCycle = useCallback(() => {
    clearTimers();
    if (list.length <= 1) return;
    
    const tick = () => {
      switchTimerRef.current = setTimeout(() => {
        setVisible(false);
        fadeTimerRef.current = setTimeout(() => {
          // 这里传入 currentUrl 确保换一张
          setCurrentUrl(prev => {
            const next = pickRandomUrl(list, prev);
            if (storageKey) localStorage.setItem(storageKey, next);
            return next;
          });
          setVisible(true);
          tick();
        }, 800);
      }, intervalMs);
    };
    tick();
  }, [list, intervalMs, storageKey, clearTimers]);

  // 当图片列表发生变化（加载完成）或者 Key 变化时
  useEffect(() => {
    if (list.length === 0) return;

    const lastUrl = getStoredUrl();
    // 核心逻辑：初始加载或重新进入时，必须选一个跟上次不一样的
    const nextPick = pickRandomUrl(list, lastUrl);
    
    updateUrl(nextPick);
    setVisible(true);
    isInitialPickDoneRef.current = true;
    
    startCycle();

    return () => clearTimers();
  }, [list.join('||'), startCycle, getStoredUrl, updateUrl, clearTimers]);

  return { src: currentUrl, visible, images: list };
}

const PortraitView = ({
  activeChar, theme, isEditMode,
  updateCharacter, deleteCharacter,
  mousePos,
  globalBgInputRef, bgInputRef, fileInputRef,
  handleImageUpload,
  onPortraitChange,
  onBackgroundChange,
  onBgVideoChange,
  appBackgroundSrc,
  appBackgroundVideo,
}) => {
  const [portraitImages, setPortraitImages] = useState([]);
  const [backgroundImages, setBackgroundImages] = useState([]);
  const [backgroundVideos, setBackgroundVideos] = useState([]);
  const [customThemeInput, setCustomThemeInput] = useState('');
  const [activeTexture, setActiveTexture] = useState(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const themeEntries = Object.entries(COLOR_THEMES);
  
  useEffect(() => {
    if (!activeChar?.name) return;
    const name = activeChar.name;
    setPortraitImages([]);
    setBackgroundImages([]);
    setBackgroundVideos([]);

    fetch(`/api/list-images?char=${encodeURIComponent(name)}&type=portraits`)
      .then(r => r.ok ? r.json() : { images: [] })
      .then(d => setPortraitImages(Array.isArray(d.images) && d.images.length > 0 ? d.images : []))
      .catch(() => setPortraitImages([]));

    fetch(`/api/list-images?char=${encodeURIComponent(name)}&type=backgrounds`)
      .then(r => r.ok ? r.json() : { images: [], videos: [] })
      .then(d => {
        setBackgroundImages(Array.isArray(d.images) && d.images.length > 0 ? d.images : []);
        setBackgroundVideos(Array.isArray(d.videos) && d.videos.length > 0 ? d.videos : []);
      })
      .catch(() => { setBackgroundImages([]); setBackgroundVideos([]); });
  }, [activeChar?.name]);

  const finalPortraits = portraitImages.length > 0 ? portraitImages : (activeChar?.image ? [activeChar.image] : []);
  const finalBackgrounds = backgroundImages.length > 0
    ? backgroundImages
    : ((activeChar?.background || appBackgroundSrc) ? [activeChar?.background || appBackgroundSrc] : []);
  const activeVideo = backgroundVideos.length > 0 ? backgroundVideos[0] : (appBackgroundVideo || null);

  const portrait = useTimedRandomImage(finalPortraits, 60000, `last_portrait_${activeChar?.name}`);
  const background = useTimedRandomImage(activeVideo ? [] : finalBackgrounds, 15000, `last_bg_${activeChar?.name}`);

  useEffect(() => {
    onPortraitChange?.(portrait.src || null);
  }, [portrait.src, onPortraitChange]);

  useEffect(() => {
    onBgVideoChange?.(activeVideo || null);
    onBackgroundChange?.(activeVideo ? null : (background.src || appBackgroundSrc || null));
  }, [activeVideo, background.src, appBackgroundSrc, onBgVideoChange, onBackgroundChange]);

  const customTextStyle = theme?.isCustom ? { color: theme.styles?.textColor || theme.accent } : undefined;
  const customStripStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent } : undefined;
  const customPanelStyle = theme?.isCustom ? { borderColor: theme.styles?.borderColor } : undefined;
  const customTextLightStyle = theme?.isCustom ? { color: theme.styles?.textLight || theme.accent } : undefined;
  const currentSwatchStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent, border: `1px solid ${theme.styles?.borderColor || theme.accent}` } : null;
  const customChronicleBarStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent } : undefined;
  const accentHex = theme?.accent || '#8ab4ff';

  const mirrorVideoName = String(import.meta.env?.VITE_PORTRAIT_MIRROR_VIDEO_NAME || '').trim();
  const shouldMirrorVideo =
    !!mirrorVideoName &&
    (activeChar?.name === mirrorVideoName ||
      (typeof activeChar?.name === 'string' && activeChar.name.startsWith(`${mirrorVideoName}·`)));

  const applyCustomTheme = () => {
    const normalized = normalizeHexColor(customThemeInput);
    if (!normalized) { alert('请输入有效色值'); return; }
    const key = makeCustomThemeKey(normalized);
    if (!key) return;
    updateCharacter('theme', key);
    setCustomThemeInput(normalized);
  };

  if (!activeChar) return null;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none">
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: false, antialias: true, toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        camera={{ position: [0, 0.8, 16.5], fov: 40 }}
      >        <Suspense fallback={<Html center><div className="text-white/20 text-xs font-bold tracking-[0.5em] animate-pulse uppercase">Awakening Archivist...</div></Html>}>
          <color attach="background" args={['#020207']} />
          {/* 无视频时雾勿过近，否则弧幕与立绘易被压暗；暗角亦与视频分支对齐量级 */}
          <fog attach="fog" args={activeVideo ? ['#020207', 55, 180] : ['#020207', 42, 105]} />
          <ambientLight intensity={activeVideo ? 0.24 : 0.34} color={accentHex} />
          <directionalLight position={[4.5, 6.8, 7.5]} intensity={activeVideo ? 1.1 : 1.28} color={accentHex} />
          <pointLight position={[0, -0.45, -2.8]} color={accentHex} intensity={1.6} distance={12} decay={2} />
          <spotLight position={[0, 12, 8]} angle={0.35} penumbra={1} intensity={0.9} color={accentHex} />

          <Environment resolution={256}>
            <mesh scale={100}>
              <sphereGeometry args={[1, 64, 64]} />
              <meshBasicMaterial color="#020207" side={THREE.BackSide} />
            </mesh>
            <mesh position={[10, 10, 10]}>
              <sphereGeometry args={[2, 24, 24]} />
              <meshBasicMaterial color={accentHex} />
            </mesh>
            <mesh position={[-10, 10, -10]}>
              <sphereGeometry args={[2, 24, 24]} />
              <meshBasicMaterial color={accentHex} />
            </mesh>
          </Environment>

          <CameraRig mousePos={mousePos} />

          <BackgroundFixedToCamera>
            <IMaxScreen
              src={activeVideo || background.src}
              isVideo={!!activeVideo}
              mirrorVideo={shouldMirrorVideo && !!activeVideo}
              onTextureReady={setActiveTexture}
            />
          </BackgroundFixedToCamera>

          <GroundDiffuse map={activeTexture} accentColor={accentHex} />
          <GroundDiffuse map={activeTexture} accentColor={accentHex} placement="top" />

          <Sparkles count={42} scale={20} size={1.25} speed={0.18} color={accentHex} opacity={0.22} />

          {portrait.src && (
            <CharacterPortrait3D src={portrait.src} isVisible={portrait.visible} accentColor={accentHex} mousePos={mousePos} />
          )}

          <ContactShadows position={[0, -5.9, 0]} opacity={0.65} scale={22} blur={2.2} far={10} color={accentHex} />

          <Float speed={2} rotationIntensity={0.05} floatIntensity={0.25} position={[-6.9, 0.6, 0.5]}>
            <group rotation={[0, PANEL_TILT_RAD, 0]}>
            <Html transform distanceFactor={HTML_PANEL_DISTANCE_FACTOR} className="pointer-events-auto">
              <div ref={leftPanelRef} className={`relative overflow-hidden w-[22rem] p-6 rounded-[2.5rem] border-2 bg-white/70 backdrop-blur-3xl shadow-2xl transition-all duration-700 ${theme.isCustom ? '' : theme.border}`} style={customPanelStyle}>
                <PanelFlowEdges accentColor={accentHex} />
                <div className={`absolute top-0 left-0 w-2.5 h-full ${theme.isCustom ? '' : theme.bgDark} rounded-l-[2.3rem] opacity-30`} style={customStripStyle}></div>
                <div className="mb-8">
                  <span className={`text-[10px] font-black tracking-[0.5em] uppercase opacity-40 ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>Divine Essence</span>
                  <LocalInput
                    value={String(activeChar.title || '')}
                    onChange={(val) => updateCharacter('title', val)}
                    disabled={!isEditMode}
                    className={`w-full text-xl font-black italic bg-transparent border-none outline-none font-serif ${theme.isCustom ? '' : theme.text}`}
                    style={customTextStyle}
                    placeholder="输入标题..."
                  />
                  <LocalInput
                    value={String(activeChar.name || '')}
                    onChange={(val) => updateCharacter('name', val)}
                    disabled={!isEditMode}
                    className="w-full text-3xl font-black bg-transparent border-none outline-none font-serif text-slate-900 mt-3 tracking-tighter"
                  />
                </div>                <div className="space-y-2.5">
                  <DetailRow icon={<User size={16}/>} label="芳龄" value={activeChar.details?.age} onChange={(v) => updateCharacter('details', v, 'age')} isEdit={isEditMode} theme={theme} />
                  <DetailRow icon={<Hexagon size={16}/>} label="阶段" value={activeChar.details?.phase} onChange={(v) => updateCharacter('details', v, 'phase')} isEdit={isEditMode} theme={theme} />
                  <DetailRow icon={<Sword size={16}/>} label="佩剑" value={activeChar.details?.weapon} onChange={(v) => updateCharacter('details', v, 'weapon')} isEdit={isEditMode} theme={theme} />
                  <DetailRow icon={<Wind size={16}/>} label="归属" value={activeChar.details?.faction} onChange={(v) => updateCharacter('details', v, 'faction')} isEdit={isEditMode} theme={theme} />
                </div>
                {isEditMode && (
                   <div className="mt-9 pt-7 border-t border-slate-200/60">
                     <div className="flex gap-2 mb-4">
                       <button onClick={() => globalBgInputRef.current.click()} className="flex-1 py-2 text-[10px] font-black bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors uppercase tracking-widest text-slate-500">Global</button>
                       <button onClick={() => bgInputRef.current.click()} className="flex-1 py-2 text-[10px] font-black bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors uppercase tracking-widest text-slate-500">Local</button>
                     </div>
                     <div className="flex flex-wrap gap-2.5 mb-5">
                       {themeEntries.map(([k, item]) => (
                         <button key={k} onClick={() => updateCharacter('theme', k)} title={item.name} className={`w-5 h-5 rounded-full ${item.bgDark} ${activeChar.theme === k ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-125 transition-transform'}`} />
                       ))}
                       {theme?.isCustom && (
                         <button type="button" onClick={() => setCustomThemeInput(theme.accent || '')} className={`w-4 h-4 rounded-full ${activeChar.theme?.startsWith?.('custom:') ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`} style={currentSwatchStyle || undefined} />
                       )}
                     </div>
                     <div className="flex gap-2">
                       <input value={customThemeInput} onChange={(e) => setCustomThemeInput(e.target.value)} placeholder="#HEX" className="flex-1 h-10 px-4 text-xs rounded-xl border border-slate-200 bg-white/50 outline-none font-mono" />
                       <button onClick={applyCustomTheme} className="px-4 rounded-xl bg-slate-900 text-white font-bold"><Plus size={14}/></button>
                     </div>
                     <button
                       type="button"
                       onClick={() => deleteCharacter?.()}
                       className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200/80 bg-red-50/90 text-red-700 text-[10px] font-black uppercase tracking-widest hover:bg-red-100/90 transition-colors"
                     >
                       <Trash2 size={14} strokeWidth={2.25} aria-hidden />
                       移除角色
                     </button>
                   </div>
                )}
              </div>
            </Html>
            </group>
          </Float>

          <Float speed={1.2} rotationIntensity={0.03} floatIntensity={0.15} position={[6.9, -0.15, 0.5]}>
            <group rotation={[0, -PANEL_TILT_RAD, 0]}>
            <Html transform distanceFactor={HTML_PANEL_DISTANCE_FACTOR} className="pointer-events-auto">
              <div ref={rightPanelRef} className="w-[24rem] h-[37rem] min-h-[37rem] bg-white/60 backdrop-blur-3xl border-2 border-white/40 shadow-2xl rounded-[3rem] p-7 flex flex-col relative overflow-hidden">
                <PanelFlowEdges accentColor={accentHex} />
                <div className={`absolute top-0 left-16 right-16 h-1.5 ${theme.isCustom ? '' : theme.bgDark} rounded-b-full opacity-20`} style={customChronicleBarStyle}></div>
                <div className="relative flex items-center justify-between border-b border-slate-200/40 pb-6 mb-8">
                   <h3 className={`flex items-center gap-4 text-xl font-serif ${theme.isCustom ? '' : theme.text}`} style={customTextStyle}>
                     <Scroll size={26} className={theme.isCustom ? '' : theme.textLight} style={customTextLightStyle} /> 
                     <span className="tracking-[0.5em] font-black uppercase text-sm">Chronicles</span>
                   </h3>
                   {isEditMode && <Edit3 size={18} className="text-slate-400" />}
                   <div
                     className="pointer-events-none absolute bottom-0 left-0 z-[1] h-px w-full overflow-hidden rounded-full"
                     aria-hidden
                   >
                     <div
                       className="h-full w-full animate-panel-edge-flow"
                       style={{
                         backgroundImage: `linear-gradient(90deg,
                           transparent 35%,
                           rgba(255,255,255,0.45) 47%,
                           ${accentHex} 50%,
                           rgba(255,255,255,0.4) 53%,
                           transparent 65%)`,
                         backgroundSize: '200% 100%',
                         boxShadow: accentHex.length === 7 ? `0 0 6px 1px ${accentHex}77` : `0 0 6px 1px ${accentHex}`,
                       }}
                     />
                   </div>
                </div>
                <LocalTextarea
                  value={String(activeChar.lore || '')}
                  onChange={(val) => updateCharacter('lore', val)}
                  disabled={!isEditMode}
                  className="flex-1 bg-transparent resize-none outline-none overflow-y-auto custom-scrollbar text-slate-800 leading-7 text-justify font-serif text-sm tracking-wide whitespace-pre-line pr-3"
                  placeholder="在此记述档案纪事..."
                />
              </div>
            </Html>
            </group>
          </Float>

          <EffectComposer renderPriority={-1}>
            <Bloom
              luminanceThreshold={activeVideo ? 0.62 : 0.5}
              luminanceSmoothing={activeVideo ? 0.82 : 0.75}
              intensity={activeVideo ? 0.18 : 0.24}
              mipmapBlur
            />
            <Vignette eskil={false} offset={activeVideo ? 0.38 : 0.34} darkness={activeVideo ? 0.24 : 0.32} />
          </EffectComposer>

        </Suspense>
      </Canvas>

      <input ref={globalBgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'global_bg')} />
      <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'char_bg')} />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'char_img')} />
    </div>
  );
};

export default PortraitView;
