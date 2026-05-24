import React from 'react';
import { ChevronLeft, ChevronRight, Library, Plus, Trash2, Edit3, Upload } from 'lucide-react';

const StoryView = ({
  activeChar, theme, isEditMode,
  storyIndex, setStoryIndex,
  changeStoryImage, deleteCurrentStoryImage, clearStoryImages,
  updateStoryCaption,
  storyInputRef, handleImageUpload,
}) => {
  const imgs = activeChar?.storyImgs || [];
  const [isDragOver, setIsDragOver] = React.useState(false);
  const customTextStyle = theme?.isCustom ? { color: theme.styles?.textColor || theme.accent } : undefined;
  const customTextLightStyle = theme?.isCustom ? { color: theme.styles?.textLight || theme.accent } : undefined;
  const customBorderStyle = theme?.isCustom ? { borderColor: theme.styles?.borderColor || theme.accent } : undefined;
  const customBgDarkStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent } : undefined;
  const customShimmerStyle = theme?.isCustom ? { backgroundImage: `linear-gradient(90deg, transparent 0%, ${(theme.styles?.bgSoft || theme.accent)}66 50%, transparent 100%)` } : undefined;

  return (
    <div className="w-full h-full flex flex-col items-center justify-start animate-fade-in px-8 pt-16 relative z-20" onDragOver={(e) => {
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
      if (storyInputRef?.current) {
        storyInputRef.current.files = dt.files;
        storyInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }}>
      {isEditMode && isDragOver && (
        <div className="absolute inset-6 z-40 rounded-3xl border-2 border-dashed border-violet-400 bg-violet-50/80 backdrop-blur-sm flex items-center justify-center pointer-events-none shadow-inner">
          <div className="flex flex-col items-center gap-3 text-violet-700">
            <Upload size={34} className="animate-bounce" />
            <div className="text-xs font-black tracking-[0.25em] uppercase">释放以追加图库插图</div>
            <div className="text-[10px] font-bold text-violet-600">也保留原有全局拖拽上传</div>
          </div>
        </div>
      )}
      <button
        onClick={() => changeStoryImage(-1)}
        className={`absolute left-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/50 backdrop-blur-md shadow-lg hover:bg-white text-slate-600 transition-all z-30 ${isEditMode || imgs.length > 1 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronLeft size={24} />
      </button>
      <button
        onClick={() => changeStoryImage(1)}
        className={`absolute right-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/50 backdrop-blur-md shadow-lg hover:bg-white text-slate-600 transition-all z-30 ${isEditMode || imgs.length > 1 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronRight size={24} />
      </button>

      <div
        className="relative w-full max-w-5xl aspect-[4/3] max-h-[60vh] bg-white/30 backdrop-blur-sm shadow-2xl p-2 border border-white/50 rounded-sm flex-shrink-0 overflow-hidden group"
        onClick={() => changeStoryImage(1)}
      >
        <div className={`absolute inset-0 z-20 pointer-events-none bg-gradient-to-r from-transparent ${theme.isCustom ? '' : theme.shimmer} to-transparent -translate-x-full animate-shine`} style={customShimmerStyle}></div>
        <div className="w-full h-full bg-slate-900/5 relative overflow-hidden cursor-pointer rounded-sm flex items-center justify-center">
          {isEditMode && imgs.length > 0 && (
            <button
              onClick={deleteCurrentStoryImage}
              className="absolute top-4 right-16 bg-white/80 hover:bg-red-50 hover:text-red-600 text-slate-400 p-2 rounded-full shadow-md z-50 transition-colors"
              title="删除当前图片"
            >
              <Trash2 size={16} />
            </button>
          )}

          {imgs.length > 0 ? (
            imgs.map((item, idx) => (
              <div
                key={idx}
                className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-1000 ${idx === storyIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
              >
                <img src={item.src} className="w-full h-full object-contain shadow-lg" alt="story" />
                <div
                  className={`absolute top-6 left-6 py-3 px-2 rounded shadow-lg border flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105 backdrop-blur-xl ${theme.isCustom ? '' : theme.border}`}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.45)',
                    writingMode: 'vertical-rl',
                    textOrientation: 'upright',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06), inset 0 0 20px rgba(255,255,255,0.5)',
                    ...(customBorderStyle || {})
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isEditMode && (
                    <div className="mb-1" style={{ writingMode: 'horizontal-tb' }}>
                      <Edit3 size={10} className={theme.isCustom ? '' : theme.textLight} style={customTextLightStyle} />
                    </div>
                  )}
                  {isEditMode ? (
                    <textarea
                      value={item.caption || ''}
                      onChange={(e) => updateStoryCaption(idx, e.target.value)}
                      className={`bg-transparent border-none outline-none text-sm font-serif font-bold tracking-widest text-center w-6 min-h-[80px] resize-none placeholder-slate-500/50 ${theme.isCustom ? '' : theme.text}`}
                      style={customTextStyle}
                      placeholder="题..."
                      rows={1}
                    />
                  ) : (
                    <h3 className={`text-sm font-serif font-bold tracking-[0.4em] leading-relaxed select-none ${theme.isCustom ? '' : theme.text} drop-shadow-sm`} style={customTextStyle}>
                      {item.caption || '无题'}
                    </h3>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center text-slate-400 font-serif">
              <Library size={48} strokeWidth={1} />
              <span className="mt-4">暂无剧情插画</span>
            </div>
          )}

          {imgs.length > 0 && (
            <div className="absolute top-4 right-4 bg-black/30 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm font-mono z-20">
              {storyIndex + 1} / {imgs.length}
            </div>
          )}
        </div>
      </div>

      {isEditMode && (
        <div className="mt-6 flex gap-4 flex-shrink-0">
          <button
            onClick={() => storyInputRef.current.click()}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-bold text-white shadow-lg rounded-full backdrop-blur-md ${theme.isCustom ? '' : theme.bgDark}`}
            style={customBgDarkStyle}
          >
            <Plus size={16} /> 追加插图
          </button>
          <button
            onClick={clearStoryImages}
            className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-red-600 bg-white border border-red-200 shadow-lg rounded-full"
          >
            <Trash2 size={16} /> 清空
          </button>
          <input ref={storyInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'story_img')} />
        </div>
      )}
    </div>
  );
};

export default StoryView;
