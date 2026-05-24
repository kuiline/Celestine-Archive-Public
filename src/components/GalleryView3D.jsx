import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Plus, Trash2, Upload, Edit3 } from 'lucide-react';
import { getCombatPoemUiFontFamily } from '../combatVerseTypography';
import '../styles/combatVerseFonts.css';
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(100,180,255,${alpha})`;
  const value = String(hex).replace('#', '');
  const full = value.length === 3
    ? value.split('').map((s) => s + s).join('')
    : value.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function useTextureFromSrc(src) {
  const [texture, setTexture] = useState(null);
  useEffect(() => {
    if (!src) {
      setTexture(null);
      return undefined;
    }
    const loader = new THREE.TextureLoader();
    let alive = true;
    loader.load(src, (tex) => {
      if (!alive) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      setTexture((prev) => {
        if (prev && prev !== tex) prev.dispose();
        return tex;
      });
    });
    return () => {
      alive = false;
    };
  }, [src]);
  useEffect(() => () => {
    if (texture) texture.dispose();
  }, [texture]);
  return texture;
}

function Painting({ src, index, activeIndex, total, onClick, accent, onActiveHoverChange }) {
  const groupRef = useRef();
  const texture = useTextureFromSrc(src);

  // 从 accent 派生颜色
  const accentColor = accent || '#4a8fff';
  const accentLight = accent || '#8ab4f8';
  const darkColor = '#0d1520';

  const getTarget = (idx, active, tot) => {
    let offset = idx - active;
    if (tot > 1) {
      const half = tot / 2;
      if (offset > half) offset -= tot;
      else if (offset < -half) offset += tot;
    }
    
    // 恢复原来的宽松感：如果是少数图片，间距放大；如果图片很多，最小间距限制在 0.55，防止挤在一起
    const spacing = Math.max(0.55, (Math.PI * 0.85) / Math.max(tot - 1, 1));
    const angle = offset * spacing;
    const radius = 6.5;
    return {
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius - radius + 1.5,
      ry: -angle * 0.6,
      scale: idx === active ? 1.2 : Math.max(0.45, 1 - Math.abs(offset) * 0.22),
    };
  };

  const tgt = getTarget(index, activeIndex, total);
  const cur = useRef({ ...tgt });

  useFrame((_, delta) => {
    const t = 1 - Math.pow(0.008, delta);
    const next = getTarget(index, activeIndex, total);
    cur.current.x += (next.x - cur.current.x) * t;
    cur.current.z += (next.z - cur.current.z) * t;
    cur.current.ry += (next.ry - cur.current.ry) * t;
    cur.current.scale += (next.scale - cur.current.scale) * t;
    if (groupRef.current) {
      groupRef.current.position.x = cur.current.x;
      groupRef.current.position.z = cur.current.z;
      groupRef.current.rotation.y = cur.current.ry;
      groupRef.current.scale.setScalar(cur.current.scale);
    }
  });

  const aspect = texture
    ? (texture.image?.naturalWidth || texture.image?.width || 1) /
      (texture.image?.naturalHeight || texture.image?.height || 1)
    : 1;
  const pw = aspect >= 1 ? 2.8 : 2.8 * aspect;
  const ph = aspect >= 1 ? 2.8 / aspect : 2.8;
  const isActive = index === activeIndex;
  const handleHoverChange = (next) => {
    if (isActive && typeof onActiveHoverChange === 'function') onActiveHoverChange(next);
  };

  if (!texture) {
    // 纹理未加载完成时显示占位框
    return (
      <group
        ref={groupRef}
        position={[tgt.x, 0, tgt.z]}
        rotation={[0, tgt.ry, 0]}
        onClick={(e) => { e.stopPropagation(); onClick(index); }}
        onPointerOver={(e) => { e.stopPropagation(); handleHoverChange(true); }}
        onPointerOut={(e) => { e.stopPropagation(); handleHoverChange(false); }}
      >
        <mesh>
          <boxGeometry args={[3.2, 3.2, 0.1]} />
          <meshStandardMaterial color="#1a2a4a" metalness={0.4} roughness={0.7} transparent opacity={0.5} />
        </mesh>
      </group>
    );
  }

  return (
    <group
      ref={groupRef}
      position={[tgt.x, 0, tgt.z]}
      rotation={[0, tgt.ry, 0]}
      onClick={(e) => { e.stopPropagation(); onClick(index); }}
      onPointerOver={(e) => { e.stopPropagation(); handleHoverChange(true); }}
      onPointerOut={(e) => { e.stopPropagation(); handleHoverChange(false); }}
    >
      {/* 背光板 - 灯箱效果 */}
      <mesh position={[0, 0, -0.12]}>
        <planeGeometry args={[pw + 0.22, ph + 0.22]} />
        <meshBasicMaterial
          color={isActive ? accentColor : darkColor}
          transparent
          opacity={isActive ? 0.18 : 0.08}
        />
      </mesh>
      {/* 液态玻璃外发光层 */}
      <mesh position={[0, 0, -0.08]}>
        <planeGeometry args={[pw + 0.28, ph + 0.28]} />
        <meshBasicMaterial
          color={isActive ? accentColor : darkColor}
          transparent
          opacity={isActive ? 0.22 : 0.10}
        />
      </mesh>
      {/* 玻璃主框体 */}
      <mesh position={[0, 0, -0.04]}>
        <boxGeometry args={[pw + 0.12, ph + 0.12, 0.04]} />
        <meshBasicMaterial
          color={isActive ? accentLight : darkColor}
          transparent
          opacity={isActive ? 0.35 : 0.22}
        />
      </mesh>
      {/* 画面本体 */}
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[pw, ph]} />
        <meshBasicMaterial map={texture} color="#dbe6f2" toneMapped={false} />
      </mesh>
    </group>
  );
}

function EmptyFrame() {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.1;
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[3.2, 3.2, 0.1]} />
        <meshStandardMaterial color="#1a2a4a" metalness={0.4} roughness={0.7} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[2.9, 2.9]} />
        <meshBasicMaterial color="#0a1525" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function Floor() {
  return null;
}

function Dust() {
  const ref = useRef();
  const count = 260;
  const pos = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 22;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 7;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
    }
    return arr;
  }, []);
  useFrame(() => {
    if (!ref.current) return;
    const a = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] += 0.0035;
      if (a[i * 3 + 1] > 3.5) a[i * 3 + 1] = -3.5;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={pos} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.042} color="#aad4ff" transparent opacity={0.32} sizeAttenuation />
    </points>
  );
}

function CameraRig({ mouseRef }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0.8, 7);
    camera.lookAt(0, 0.3, 0);
  }, [camera]);
  useFrame(() => {
    const tx = mouseRef.current.x * 0.3;
    const ty = 0.8 + mouseRef.current.y * -0.12;
    camera.position.x += (tx - camera.position.x) * 0.04;
    camera.position.y += (ty - camera.position.y) * 0.04;
    camera.lookAt(0, 0.3, 0);
  });
  return null;
}

export default function GalleryView3D({
  activeChar, theme, isEditMode,
  storyIndex, setStoryIndex,
  changeStoryImage, deleteCurrentStoryImage, clearStoryImages,
  updateStoryCaption,
  onMetaVisibilityChange,
  storyInputRef, handleImageUpload,
}) {
  const imgs = activeChar?.storyImgs || [];
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [displayMeta, setDisplayMeta] = useState(null);
  const [metaAnimPhase, setMetaAnimPhase] = useState('idle');
  const [isActivePaintingHovered, setIsActivePaintingHovered] = useState(false);
  const [isMetaVisible, setIsMetaVisible] = useState(false);
  const [activeAspect, setActiveAspect] = useState(1);
  const hoverDelayRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  // Public build keeps the gallery background intentionally simple and uniform.
  const themeGlowCore = hexToRgba(theme?.accent || '#6ec2ff', 0.18);
  const themeGlowEdge = hexToRgba(theme?.accent || '#6ec2ff', 0.06);
  const customBgDarkStyle = theme?.isCustom
    ? { backgroundColor: theme.styles?.bgDark || theme.accent }
    : undefined;
  const poemUiFamily = useMemo(() => getCombatPoemUiFontFamily(), []);
  
  const shuffledIndices = useMemo(() => {
    const arr = Array.from({ length: imgs.length }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [imgs]);

  const activeShuffledIndex = shuffledIndices.indexOf(storyIndex) !== -1 ? shuffledIndices.indexOf(storyIndex) : 0;

  useEffect(() => {
    if (imgs.length > 0 && shuffledIndices.length > 0) {
      setStoryIndex(shuffledIndices[0]);
    }
  }, [activeChar?.id, imgs.length, shuffledIndices, setStoryIndex]);

  const activeItem = imgs[storyIndex];
  const shouldRenderPainting = useMemo(() => {
    const total = imgs.length;
    return (index) => {
      if (total <= 7) return true;
      const rawDistance = Math.abs(index - activeShuffledIndex);
      const circularDistance = Math.min(rawDistance, total - rawDistance);
      return circularDistance <= 2;
    };
  }, [imgs.length, activeShuffledIndex]);
  const activeItemMeta = useMemo(() => {
    if (!activeItem) return null;
    const title = String(activeItem?.name || activeItem?.caption || '').trim() || '无题';
    const desc = String(activeItem?.description || '').trim();
    return {
      seq: Number(activeItem?.seq) || (storyIndex + 1),
      title,
      description: desc || '未填写描述语句',
    };
  }, [activeItem, storyIndex]);
  const metaPanelLeft = useMemo(() => {
    const ar = Number.isFinite(activeAspect) && activeAspect > 0 ? activeAspect : 1;
    // 横图越宽，说明框向左额外偏移，避免覆盖当前展示图的主体
    const landscapeBoost = ar > 1 ? Math.min(220, (ar - 1) * 235) : 0;
    // 竖图也额外左移一点，避免贴图过近
    const portraitBoost = ar < 1 ? Math.min(60, (1 - ar) * 95 + 24) : 0;
    const offsetPx = 380 + landscapeBoost + portraitBoost;
    return `max(0.75rem, calc(50% - ${offsetPx}px))`;
  }, [activeAspect]);

  useEffect(() => {
    const onMove = (e) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    if (!activeItemMeta) {
      setDisplayMeta(null);
      setMetaAnimPhase('idle');
      return;
    }
    if (!displayMeta) {
      setDisplayMeta(activeItemMeta);
      setMetaAnimPhase('idle');
      return;
    }
    const sameMeta =
      displayMeta.seq === activeItemMeta.seq
      && displayMeta.title === activeItemMeta.title
      && displayMeta.description === activeItemMeta.description;
    if (sameMeta) return;
    setMetaAnimPhase('exit');
    const t1 = setTimeout(() => {
      setDisplayMeta(activeItemMeta);
      setMetaAnimPhase('enter');
      requestAnimationFrame(() => setMetaAnimPhase('idle'));
    }, 180);
    return () => clearTimeout(t1);
  }, [activeItemMeta, displayMeta]);

  useEffect(() => {
    if (typeof onMetaVisibilityChange === 'function') {
      onMetaVisibilityChange(!!isMetaVisible);
    }
  }, [isMetaVisible, onMetaVisibilityChange]);

  useEffect(() => {
    setIsActivePaintingHovered(false);
    setIsMetaVisible(false);
    if (hoverDelayRef.current) {
      clearTimeout(hoverDelayRef.current);
      hoverDelayRef.current = null;
    }
  }, [storyIndex, activeChar?.id]);

  useEffect(() => {
    if (hoverDelayRef.current) {
      clearTimeout(hoverDelayRef.current);
      hoverDelayRef.current = null;
    }
    if (isActivePaintingHovered) {
      hoverDelayRef.current = setTimeout(() => {
        setIsMetaVisible(true);
      }, 500);
      return () => {
        if (hoverDelayRef.current) {
          clearTimeout(hoverDelayRef.current);
          hoverDelayRef.current = null;
        }
      };
    }
    setIsMetaVisible(false);
    return undefined;
  }, [isActivePaintingHovered]);

  useEffect(() => {
    const src = String(activeItem?.src || '').trim();
    if (!src) {
      setActiveAspect(1);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = Number(img.naturalWidth || img.width || 1);
      const h = Number(img.naturalHeight || img.height || 1);
      setActiveAspect(h > 0 ? (w / h) : 1);
    };
    img.onerror = () => {
      if (alive) setActiveAspect(1);
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [activeItem?.src]);

  useEffect(() => {
    let interval;
    if (!isEditMode && !isMetaVisible && imgs.length > 1) {
      interval = setInterval(() => {
        setStoryIndex(prevStoryIndex => {
          const currentShuffledIdx = shuffledIndices.indexOf(prevStoryIndex) !== -1 ? shuffledIndices.indexOf(prevStoryIndex) : 0;
          const nextShuffledIdx = (currentShuffledIdx + 1) % imgs.length;
          return shuffledIndices[nextShuffledIdx];
        });
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isEditMode, isMetaVisible, imgs.length, shuffledIndices, setStoryIndex]);

  return (
    <div
      className="fixed inset-0 z-20"
      style={{ background:
        `radial-gradient(circle at center, ${theme?.accent || '#004488'}66 0%, #000814 100%)`
      }}
      onDragOver={(e) => {
        if (!isEditMode) return;
        const hasImg = Array.from(e.dataTransfer?.items || []).some(
          (i) => i.kind === 'file' && String(i.type || '').startsWith('image/')
        );
        if (!hasImg) return;
        e.preventDefault(); e.stopPropagation(); setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        if (!isEditMode) return;
        const file = Array.from(e.dataTransfer?.files || []).find(
          (f) => String(f.type || '').startsWith('image/')
        );
        if (!file) return;
        const dt = new DataTransfer(); dt.items.add(file);
        if (storyInputRef?.current) {
          storyInputRef.current.files = dt.files;
          storyInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }}
    >
      {isEditMode && isDragOver && (
        <div className="absolute inset-6 z-50 rounded-3xl border-2 border-dashed backdrop-blur-sm flex items-center justify-center pointer-events-none"
          style={{ borderColor: theme?.accent || '#60a5fa', backgroundColor: `${theme?.accent || '#1e3a5f'}33` }}
        >
          <div className="flex flex-col items-center gap-3" style={{ color: theme?.accent || '#93c5fd' }}>
            <Upload size={34} className="animate-bounce" />
            <div className="text-xs font-black tracking-[0.25em] uppercase">释放以追加图库插图</div>
          </div>
        </div>
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 74% 58% at 50% 60%, ${themeGlowCore} 0%, ${themeGlowEdge} 44%, transparent 78%)`,
        }}
      />
      {displayMeta && isMetaVisible && (
        <div className="absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none" style={{ left: metaPanelLeft }}>
          <div
            className={`w-[12.5rem] min-h-[18rem] rounded-2xl border border-white/30 bg-white/15 shadow-[0_10px_40px_rgba(10,18,30,0.35)] backdrop-blur-2xl transition-all duration-300 ${
              metaAnimPhase === 'exit'
                ? 'translate-y-6 blur-[2px] opacity-0'
                : metaAnimPhase === 'enter'
                  ? '-translate-y-5 blur-[2px] opacity-0'
                  : 'translate-y-0 blur-0 opacity-100'
            }`}
            style={{
              backgroundImage: 'linear-gradient(145deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.08) 50%, rgba(160,210,255,0.10) 100%)',
            }}
          >
            <div className="px-4 pt-3 pb-2 border-b border-white/20 flex items-center justify-end">
              <span className="text-[9px] text-white/50 font-mono tracking-[0.2em]">#{String(displayMeta.seq).padStart(2, '0')}</span>
            </div>
            <div className="px-4 py-4">
              <div
                className="text-white/90 text-[12px] leading-6 whitespace-pre-wrap"
                style={{ fontFamily: poemUiFamily, textShadow: '0 0 10px rgba(120,190,255,0.25)' }}
              >
                {displayMeta.description}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-0 z-10">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0.8, 7], fov: 50 }}
          gl={{
            alpha: true,
            antialias: true,
            toneMapping: THREE.NoToneMapping,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <CameraRig mouseRef={mouseRef} />
          <Dust />
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.78}
              luminanceSmoothing={0.48}
              intensity={0.42}
              mipmapBlur
            />
          </EffectComposer>
          {imgs.length > 0
            ? shuffledIndices.map((origIdx, i) => {
                const item = imgs[origIdx];
                return shouldRenderPainting(i) ? (
                <Painting
                  key={`${i}-${item.src?.slice(-20)}`}
                  src={item.src}
                  index={i}
                  activeIndex={activeShuffledIndex}
                  total={imgs.length}
                  onClick={() => setStoryIndex(origIdx)}
                  accent={theme?.accent}
                  onActiveHoverChange={setIsActivePaintingHovered}
                />
                ) : null;
              })
            : <EmptyFrame />
          }
        </Canvas>
      </div>

      {(isEditMode || imgs.length > 1) && (
        <>
          <button
            onClick={() => {
              if (imgs.length <= 1) return;
              const nextI = (activeShuffledIndex - 1 + imgs.length) % imgs.length;
              setStoryIndex(shuffledIndices[nextI]);
            }}
            className="absolute left-5 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-110"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button
            onClick={() => {
              if (imgs.length <= 1) return;
              const nextI = (activeShuffledIndex + 1) % imgs.length;
              setStoryIndex(shuffledIndices[nextI]);
            }}
            className="absolute right-5 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-all hover:scale-110"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center pb-5 pointer-events-none">
        {activeItem && (
          <div className="pointer-events-auto mb-3">
            {isEditMode && editingCaption ? (
              <input
                autoFocus
                value={activeItem.caption || ''}
                onChange={(e) => updateStoryCaption(storyIndex, e.target.value)}
                onBlur={() => setEditingCaption(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingCaption(false)}
                className="bg-black/50 border border-white/25 text-white text-center text-sm font-serif tracking-[0.3em] px-4 py-2 rounded-lg outline-none backdrop-blur-md w-56"
                placeholder="题名..."
              />
            ) : (
              <div
                onClick={() => isEditMode && setEditingCaption(true)}
                className="flex items-center gap-2 text-white/85 text-sm font-serif tracking-[0.45em] cursor-pointer select-none"
                style={{ textShadow: `0 0 18px ${theme?.accent || 'rgba(100,180,255,0.7)'}99, 0 2px 6px rgba(0,0,0,0.9)` }}
              >
                {isEditMode && <Edit3 size={11} className="text-white/40" />}
                {activeItem.caption || '无题'}
              </div>
            )}
          </div>
        )}
        {imgs.length > 1 && (
          <div className="flex gap-1.5 pointer-events-auto mb-3">
            {imgs.map((_, i) => (
              <button
                key={i}
                onClick={() => setStoryIndex(i)}
                className={`rounded-full transition-all duration-300 ${
                  i === storyIndex
                    ? 'w-5 h-1.5'
                    : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/55'
                }`}
                style={i === storyIndex ? {
                  backgroundColor: theme?.accent || '#93c5fd',
                  boxShadow: `0 0 6px ${theme?.accent || '#93c5fd'}cc`
                } : {}}
              />
            ))}
          </div>
        )}
        {imgs.length > 0 && (
          <div className="text-white/35 text-[10px] font-mono tracking-widest">
            {String(storyIndex + 1).padStart(2, '0')} / {String(imgs.length).padStart(2, '0')}
          </div>
        )}
      </div>

      {isEditMode && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 flex gap-2">
          <button
            onClick={() => storyInputRef.current.click()}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white rounded-full backdrop-blur-md border border-white/20 shadow-lg transition-all hover:scale-105 ${
              theme?.isCustom ? '' : (theme?.bgDark || 'bg-indigo-700')
            }`}
            style={customBgDarkStyle}
          >
            <Plus size={14} /> 追加插图
          </button>
          {imgs.length > 0 && (
            <button
              onClick={deleteCurrentStoryImage}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-red-300 bg-black/30 rounded-full backdrop-blur-md border border-red-400/20 shadow-lg transition-all hover:scale-105 hover:bg-red-900/40"
            >
              <Trash2 size={14} /> 删除当前
            </button>
          )}
          <button
            onClick={clearStoryImages}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-red-300 bg-black/30 rounded-full backdrop-blur-md border border-red-400/20 shadow-lg transition-all hover:scale-105 hover:bg-red-900/40"
          >
            <Trash2 size={14} /> 清空
          </button>
          <input ref={storyInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'story_img')} />
        </div>
      )}
    </div>
  );
}


