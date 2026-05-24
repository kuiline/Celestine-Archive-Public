import React from 'react';
import { X, Palette, Paperclip, Send, RefreshCw, Sparkles, Upload, Library, Layers, OctagonX, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';

const AiChatPanel = ({
  activeSession, isAiLoading,
  aiInputText, setAiInputText,
  aiInputImage, setAiInputImage,
  aiDrawBatchMode, setAiDrawBatchMode,
  isMultiImageDraw,
  onAbortBatchImage,
  imageRequestStatus,
  naiConfig, setNaiConfig,
  referenceConfig, setReferenceConfig,
  aiImageInputRef, chatScrollRef,
  handleAiSendMessage, handleDrawImage,
  onCreateInspirationSession,
  handleAiImageUpload,
  renderSafeContent, renderAiMessage,
  activeCharPortraitSrc,
  activeStoryImageSrc,
  activeTextEndpoint,
  activeVisionEndpoint,
}) => {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const messages = activeSession?.messages || [];
  const imageStatusLevel = imageRequestStatus?.level || (imageRequestStatus?.phase === 'error' ? 'error' : imageRequestStatus?.phase === 'success' ? 'success' : 'running');

  const sessionUsesVision = React.useMemo(
    () =>
      messages.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url')
      ),
    [messages]
  );
  const visionPrefixFlags = React.useMemo(() => {
    let seenVision = false;
    return messages.map((m) => {
      if (!seenVision && Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url')) {
        seenVision = true;
      }
      return seenVision;
    });
  }, [messages]);

  const handleDrop = React.useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer?.files || []).find(f => String(f.type || '').startsWith('image/'));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAiInputImage(reader.result);
    reader.readAsDataURL(file);
  }, [setAiInputImage]);

  const handleDragOver = React.useCallback((e) => {
    const hasImage = Array.from(e.dataTransfer?.items || []).some(item => item.kind === 'file' && String(item.type || '').startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handleDragLeave = React.useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextTarget = e.relatedTarget;
    if (nextTarget && e.currentTarget.contains(nextTarget)) return;
    setIsDragOver(false);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white/30 text-stone-800 relative" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragOver && (
        <div className="absolute inset-4 z-30 rounded-2xl border-2 border-dashed border-sky-400 bg-sky-50/80 backdrop-blur-sm flex items-center justify-center pointer-events-none shadow-inner">
          <div className="flex flex-col items-center gap-3 text-sky-700">
            <Upload size={34} className="animate-bounce" />
            <div className="text-xs font-black tracking-[0.25em] uppercase">释放以上传到对话参考图</div>
            <div className="text-[10px] font-bold text-sky-500">支持直接拖入图片作为当前参考图</div>
          </div>
        </div>
      )}
      {/* 消息历史滚动区 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar scroll-smooth">
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const hasVisionInContext = visionPrefixFlags[i];

          const modelName = hasVisionInContext 
            ? (activeVisionEndpoint?.name || '视觉辅佐') 
            : (activeTextEndpoint?.name || '档案辅佐');

          return (
            <div key={i} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} animate-fade-in`}>
              {!isUser && (
                <div className={`text-[10px] font-black tracking-[0.2em] text-stone-400 mb-2 uppercase ml-2`}>
                  {modelName}
                </div>
              )}
              {isUser ? (
                <div className="max-w-[min(90%,32rem)] p-4 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap bg-slate-900 text-white shadow-xl ring-1 ring-white/10 font-sans tracking-wide">
                  {renderSafeContent(msg.content)}
                </div>
              ) : (
              <div className="max-w-[min(92%,34rem)] text-sm leading-relaxed text-stone-800 bg-white/70 backdrop-blur-md p-6 rounded-2xl rounded-tl-sm border border-white shadow-sm ring-1 ring-black/5 font-serif relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-multiply" style={{backgroundImage: `url("https://www.transparenttextures.com/patterns/handmade-paper.png")`}}></div>
                <div className="relative z-10">{renderAiMessage(msg.content, i)}</div>
              </div>
            )}
          </div>
        );
      })}
      {isAiLoading && (
          <div className="flex flex-col items-start gap-2 animate-fade-in">
            <div className="p-4 bg-white/80 border border-stone-200 text-stone-500 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-3 text-xs font-bold tracking-widest">
              <RefreshCw size={14} className="animate-spin text-slate-900" />
              <span>
                正在等待回复
                {(sessionUsesVision ? activeVisionEndpoint : activeTextEndpoint)?.name ? (
                  <span className="text-stone-400 font-semibold normal-case tracking-normal">
                    {' '}
                    · {sessionUsesVision ? '多模态' : '文本'} · {(sessionUsesVision ? activeVisionEndpoint : activeTextEndpoint).name}
                  </span>
                ) : null}
                …
              </span>
            </div>
          </div>
        )}
        <div ref={chatScrollRef} className="h-4" />
      </div>

      {/* 底部创作台区域 */}
      <div className="p-4 bg-white/80 backdrop-blur-xl border-t border-stone-200 shrink-0 flex flex-col gap-3 shadow-[0_-10px_30px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-black text-stone-400 tracking-[0.2em] uppercase">渲染参数</span>
            <select
              value={naiConfig?.resolution || 'portrait'}
              onChange={(e) => setNaiConfig({ ...naiConfig, resolution: e.target.value })}
              className="text-[10px] font-bold px-2 py-1 rounded-lg border border-stone-200 bg-white text-stone-600 outline-none hover:border-stone-400 transition-colors"
            >
              <option value="portrait">竖屏立绘 832x1216</option>
              <option value="landscape">横屏插图 1216x832</option>
              <option value="square">正方比例 1024x1024</option>
            </select>
            <div className="flex items-center gap-1.5 border-l border-stone-200 pl-3">
              <button
                onClick={() => setReferenceConfig(prev => ({ ...prev, useStructuredContext: !prev.useStructuredContext }))}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${
                  referenceConfig?.useStructuredContext
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-stone-400 border-stone-200 hover:border-stone-400'
                }`}
                title="结构化角色参考"
              >
                结构化
              </button>
              <button
                onClick={() => setReferenceConfig(prev => ({ ...prev, useRagContext: !prev.useRagContext }))}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${
                  referenceConfig?.useRagContext
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-stone-400 border-stone-200 hover:border-stone-400'
                }`}
                title="RAG 检索参考"
              >
                RAG
              </button>
            </div>
          </div>
          {aiInputImage && (
            <div className="relative group flex items-center gap-2 bg-stone-100/50 pl-2 pr-1 py-1 rounded-lg border border-stone-200">
              <span className="text-[9px] font-black text-stone-400 uppercase">当前参考图</span>
              <img src={aiInputImage} className="h-10 w-10 object-cover rounded shadow-sm border border-white" alt="预览" />
              <button onClick={() => setAiInputImage(null)} className="bg-slate-900 text-white rounded-full p-0.5 shadow-md hover:bg-red-500 transition-colors"><X size={10} /></button>
            </div>
          )}
        </div>
        {imageRequestStatus?.visible && (
          <div
            className={`rounded-xl border px-3 py-2 text-[11px] leading-relaxed flex items-start gap-2 ${
              imageStatusLevel === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : imageStatusLevel === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-sky-50 border-sky-200 text-sky-700'
            }`}
          >
            {imageStatusLevel === 'error' ? (
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            ) : imageStatusLevel === 'success' ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            ) : (
              <Clock3 size={14} className="mt-0.5 shrink-0 animate-pulse" />
            )}
            <div className="min-w-0">
              <div className="font-black tracking-wide">{imageRequestStatus.title || '生图请求进行中'}</div>
              {imageRequestStatus.detail ? <div className="opacity-90 break-all">{imageRequestStatus.detail}</div> : null}
            </div>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <input type="file" accept="image/*" className="hidden" ref={aiImageInputRef} onChange={handleAiImageUpload} />
          
          <div className="flex items-center bg-stone-100/50 rounded-2xl p-1 gap-0.5 border border-stone-200/50 shadow-inner">
            <button onClick={() => aiImageInputRef.current.click()} className="p-2.5 text-stone-400 hover:bg-white hover:text-stone-900 rounded-xl transition-all" title="上传图片；会话含图时自动使用多模态模型">
              <Paperclip size={18} />
            </button>
            {activeCharPortraitSrc && (
              <button
                onClick={() => setAiInputImage(activeCharPortraitSrc)}
                className="relative p-1 rounded-xl hover:bg-white transition-all shrink-0 group"
                title="引用当前档案立绘作为参考（含图对话将自动走多模态节点）"
              >
                <div className="w-7 h-7 rounded-lg overflow-hidden ring-2 ring-purple-200 group-hover:ring-purple-400 transition-all">
                  <img src={activeCharPortraitSrc} className="w-full h-full object-cover object-top" alt="档案立绘" />
                </div>
                <div className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] font-black w-3 h-3 rounded-full flex items-center justify-center shadow-sm">荐</div>
              </button>
            )}
            {activeStoryImageSrc && (
              <button
                type="button"
                onClick={() => setAiInputImage(activeStoryImageSrc)}
                className="relative p-1 rounded-xl hover:bg-white transition-all shrink-0 group"
                title="插入当前正在浏览的图库图到对话（命名讨论请在此完成，含图将自动使用多模态）"
              >
                <div className="w-7 h-7 rounded-lg overflow-hidden ring-2 ring-amber-200 group-hover:ring-amber-400 transition-all">
                  <img src={activeStoryImageSrc} className="w-full h-full object-cover" alt="当前图库图" />
                </div>
                <div className="absolute -top-1 -right-1 bg-amber-600 text-white rounded-full p-0.5 shadow-sm">
                  <Library size={8} strokeWidth={3} />
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => setAiDrawBatchMode((v) => !v)}
              disabled={isAiLoading}
              className={`p-2.5 rounded-xl transition-all disabled:opacity-30 ${
                aiDrawBatchMode
                  ? 'text-violet-700 bg-violet-100 ring-2 ring-violet-300'
                  : 'text-stone-400 hover:bg-white hover:text-violet-600'
              }`}
              title="批量：多行时默认每行一条。若某行仅以 @ 开头（如 @次数 或 @角色），会自动合并到上一行，避免换行拆断命令。IdleCloud 上游会自动拉长间隔避免限流"
            >
              <Layers size={18} />
            </button>
            {(aiDrawBatchMode || isMultiImageDraw) && isAiLoading && (
              <button
                type="button"
                onClick={() => onAbortBatchImage?.()}
                className="p-2.5 rounded-xl text-red-600 bg-red-50 ring-2 ring-red-200 hover:bg-red-100 transition-all animate-pulse"
                title="终止批量：当前这一张仍会跑完，之后不再继续下一张"
              >
                <OctagonX size={18} />
              </button>
            )}
            <button onClick={handleDrawImage} disabled={isAiLoading} className="p-2.5 text-purple-500 hover:bg-white hover:text-purple-600 rounded-xl transition-all disabled:opacity-30" title={aiDrawBatchMode ? '批量文生图（每行一张）' : '文生图系统'}>
              <Palette size={18} />
            </button>
            <button
              type="button"
              onClick={() => onCreateInspirationSession?.()}
              disabled={isAiLoading}
              className="p-2.5 text-amber-600 hover:bg-white hover:text-amber-700 rounded-xl transition-all disabled:opacity-30"
              title="新建灵感交流会话"
            >
              <Sparkles size={18} />
            </button>
          </div>

          <div className="flex-1 relative group">
            <textarea
              value={aiInputText}
              onChange={e => setAiInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSendMessage(); } }}
              placeholder={aiDrawBatchMode ? '每行一条。行尾先 @次数 再 @角色 或相反；@角色名=立绘参考（优先上传图）；@3=连出3张。例：红裙 @示例角色 @2' : '请输入指令引导辅助智能...'}
              className="w-full max-h-32 min-h-[48px] py-3 px-4 bg-white border border-stone-200 outline-none rounded-2xl text-sm resize-none custom-scrollbar font-serif shadow-inner focus:border-stone-900 transition-colors placeholder-stone-300"
              rows={1}
            />
          </div>

          <button
            onClick={handleAiSendMessage}
            disabled={isAiLoading || (!aiInputText.trim() && !aiInputImage)}
            className="w-12 h-12 shrink-0 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 transition-all shadow-lg active:scale-95 border border-slate-700"
          >
            <Send size={20} className="mt-0.5 -ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel;
