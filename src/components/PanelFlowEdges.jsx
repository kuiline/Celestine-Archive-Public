import React, { useMemo } from 'react';

/**
 * 面板上下沿流光：1px 细线 + 窄渐变芯 + 轻外发光（粗线/大光晕会显得笨重）
 */
export default function PanelFlowEdges({ accentColor }) {
  const c = accentColor || '#8ab4ff';

  const barStyle = useMemo(() => {
    const glow = c.length === 7 ? `${c}99` : c;
    return {
      backgroundImage: `linear-gradient(90deg,
        transparent 38%,
        rgba(255,255,255,0.55) 47%,
        ${c} 50%,
        rgba(255,255,255,0.5) 53%,
        transparent 62%)`,
      backgroundSize: '200% 100%',
      boxShadow: `0 0 8px 2px ${glow}, 0 0 2px 0 ${c}`,
    };
  }, [c]);

  return (
    <>
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-20 h-px w-1/2 -translate-x-1/2 rounded-full animate-panel-edge-flow"
        style={barStyle}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 z-20 h-px w-1/2 -translate-x-1/2 rounded-full animate-panel-edge-flow-rev"
        style={barStyle}
        aria-hidden
      />
    </>
  );
}
