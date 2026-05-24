import React, { useMemo } from 'react';
import {
  X, MessageCircle, ChevronDown, Eraser, Sliders, PlusCircle, Trash2, Settings, Pencil, Sparkles, Image, Wrench
} from 'lucide-react';
import AiSettingsPanel from './AiSettingsPanel';
import AiChatPanel from './AiChatPanel';
import InspirationRoom from './InspirationRoom';
import ContextPreviewColumn from './ContextPreviewColumn';

const AIPanel = ({
  aiSessions, activeSessionId, setActiveSessionId,
  activeSession, activeTextEndpoint, activeVisionEndpoint,
  activeTextEndpointId, activeVisionEndpointId,
  aiEndpoints, setAiEndpoints,
  showAiSettings, setShowAiSettings,
  showModelDropdown, setShowModelDropdown,
  naiConfig, setNaiConfig,
  systemPrompt, setSystemPrompt,
  naiTagPrompt, setNaiTagPrompt,
  ideaCultivatePrompt, setIdeaCultivatePrompt,
  ragConfig, setRagConfig,
  referenceConfig, setReferenceConfig,
  aiInputText, setAiInputText,
  aiInputImage, setAiInputImage,
  aiDrawBatchMode, setAiDrawBatchMode,
  isMultiImageDraw,
  onAbortBatchImage,
  isAiLoading,
  imageRequestStatus,
  lastResolvedSystemPrompt,
  lastContextPreview,
  chatScrollRef, aiImageInputRef,
  handleAiSendMessage, handleDrawImage,
  handleAiImageUpload,
  onSaveIdeaToScrapbook,
  resolvedChar,
  safeCharacters,
  handleCreateSession,
  handleCreateInspirationSession,
  handleDeleteSession,
  handleRenameSession,
  handleBackFromInspiration,
  onInspirationPreviewUpdate,
  patchActiveSession,
  generateTitle,
  clearAiChats,
  saveActiveEndpoint, saveAiEndpoints, saveNaiConfig,
  onRebuildRag,
  setShowAI,
  renderSafeContent, renderAiMessage,
  activeCharPortraitSrc,
  activeStoryImageSrc,
}) => {
  const isInspirationView = activeSession?.mode === 'inspiration';

  const textEndpoints = useMemo(() => (aiEndpoints || []).filter(ep => (ep.mode || 'text') !== 'multimodal'), [aiEndpoints]);
  const multimodalEndpoints = useMemo(() => (aiEndpoints || []).filter(ep => (ep.mode || 'text') === 'multimodal'), [aiEndpoints]);

  return (
    <div className="fixed inset-2 sm:inset-auto sm:bottom-28 sm:right-10 w-auto sm:w-[min(1420px,99vw)] max-w-none sm:max-w-[99vw] h-auto sm:h-[680px] max-h-none sm:max-h-[88vh] z-50 bg-white/80 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-2xl flex overflow-hidden animate-fade-in font-serif ring-1 ring-black/5 text-stone-800">

      {/* 左侧：会话卷轴列表 */}
      <div className="w-56 bg-slate-900/10 backdrop-blur-md border-r border-slate-200/60 flex flex-col shrink-0 hidden sm:flex">
        <div className="p-5 border-b border-slate-200/60 shrink-0">
          <div className="space-y-3">
            <button type="button" onClick={handleCreateSession} className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs tracking-widest transition-all shadow-lg active:scale-95 border border-slate-700">
              <PlusCircle size={14} /> 新对话
            </button>
            <button type="button" onClick={handleCreateInspirationSession} className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs tracking-widest transition-all shadow-md active:scale-95 border border-amber-700">
              <Sparkles size={14} /> 灵感交流
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          <div className="px-2 text-[10px] font-black tracking-widest text-slate-400 uppercase mb-2">历史记录索引</div>
          {(aiSessions || []).map(sess => (
            <div
              key={sess.id}
              onClick={() => setActiveSessionId(sess.id)}
              className={`group relative p-3 rounded-xl cursor-pointer transition-all duration-300 ${
                activeSessionId === sess.id
                  ? 'bg-white shadow-md border border-slate-200/50 translate-x-1'
                  : 'hover:bg-white/40 text-slate-500 hover:text-slate-900'
              }`}
            >
              <div className={`truncate pr-8 text-xs font-bold tracking-wider ${activeSessionId === sess.id ? 'text-slate-900' : ''}`}>{sess.title || '新对话'}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {sess.mode === 'inspiration' && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-black shrink-0">灵感</span>
                )}
                {(sess.involvedCharacterNames || []).slice(0, 3).map((name) => (
                  <span key={name} className="text-[8px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold truncate max-w-[4.2rem]" title={name}>{name}</span>
                ))}
                {sess.sessionFlags?.usedImageGen && (
                  <span title="本会话使用过生图" className="inline-flex"><Image size={12} className="text-purple-500" strokeWidth={2.2} /></span>
                )}
                {sess.sessionFlags?.usedAgentTool && (
                  <span title="本会话出现过 Agent 工具提议" className="inline-flex"><Wrench size={12} className="text-sky-600" strokeWidth={2.2} /></span>
                )}
              </div>
              {activeSessionId === sess.id && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={(e) => handleRenameSession(sess.id, e)} className="p-1 text-slate-300 hover:text-slate-600"><Pencil size={11} /></button>
                  <button type="button" onClick={(e) => handleDeleteSession(sess.id, e)} className="p-1 text-slate-300 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ContextPreviewColumn
        preview={lastContextPreview}
        fullSystemPrompt={lastResolvedSystemPrompt}
        referenceConfig={referenceConfig}
        setReferenceConfig={setReferenceConfig}
        inspirationSessionActive={isInspirationView}
      />

      {/* 右侧：主交互区域 */}
      <div className="flex-1 flex flex-col bg-white/40 min-w-0">
        <div className="h-16 border-b border-slate-200/60 flex items-center justify-between px-6 shrink-0 bg-white/60 backdrop-blur-md relative z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-lg shrink-0">
              {isInspirationView ? <Sparkles size={16} className="text-amber-200" /> : <MessageCircle size={16} />}
            </div>
            <div className="relative min-w-0">
              <button type="button" onClick={() => setShowModelDropdown(!showModelDropdown)} className="group flex flex-col items-start hover:bg-slate-100/60 px-3 py-1.5 rounded-xl transition-all max-w-[50vw] sm:max-w-none text-stone-800">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black tracking-widest text-slate-900 uppercase truncate">
                    {isInspirationView ? '灵感交流室' : '设定辅助智能'}
                  </span>
                  <ChevronDown size={12} className="text-slate-400 group-hover:text-slate-800 transition-colors shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 truncate">
                  <span>文本：{activeTextEndpoint?.name || '未配置'}</span>
                  <span className="opacity-20">/</span>
                  <span>视觉：{activeVisionEndpoint?.name || '未配置'}</span>
                </div>
              </button>
              {showModelDropdown && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-white/95 backdrop-blur-xl border border-slate-200 shadow-2xl rounded-2xl py-2 z-50 animate-fade-in overflow-hidden ring-1 ring-black/5 text-stone-800">
                  <div className="px-5 py-2 text-[9px] font-black tracking-widest text-stone-400 uppercase">对话模型节点</div>
                  {(textEndpoints || []).map(ep => (
                    <button key={ep.id} type="button" onClick={() => saveActiveEndpoint(ep.id, 'text')} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-slate-50 flex items-center justify-between ${activeTextEndpointId === ep.id ? 'text-slate-900 font-bold bg-slate-100/50' : 'text-slate-500'}`}>
                      {ep.name}
                      {activeTextEndpointId === ep.id && <div className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse"></div>}
                    </button>
                  ))}
                  <div className="border-t border-slate-100/60 my-2"></div>
                  <div className="px-5 py-2 text-[9px] font-black tracking-widest text-stone-400 uppercase">视觉模型节点</div>
                  {(multimodalEndpoints || []).map(ep => (
                    <button key={ep.id} type="button" onClick={() => saveActiveEndpoint(ep.id, 'multimodal')} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-slate-50 flex items-center justify-between ${activeVisionEndpointId === ep.id ? 'text-slate-900 font-bold bg-slate-100/50' : 'text-slate-500'}`}>
                      {ep.name}
                      {activeVisionEndpointId === ep.id && <div className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse"></div>}
                    </button>
                  ))}
                  <div className="border-t border-slate-100/60 my-2 pt-1"></div>
                  <button type="button" onClick={() => { setShowModelDropdown(false); setShowAiSettings(true); }} className="w-full text-left px-5 py-3 text-[10px] font-bold text-slate-500 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                    <Settings size={13} /> 进入高级参数配置
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button type="button" onClick={clearAiChats} className="hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-all p-2 rounded-xl" title="清理会话记录"><Eraser size={16} /></button>
            <button type="button" onClick={() => setShowAiSettings(!showAiSettings)} className={`p-2 rounded-xl transition-all ${showAiSettings ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`} title="全局配置"><Sliders size={16} /></button>
            <button type="button" onClick={() => setShowAI(false)} className="p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all"><X size={20} /></button>
          </div>
        </div>

        <div className="flex flex-col flex-1 min-h-0 relative overflow-hidden">
          <div className={`min-h-0 flex-1 flex flex-col ${showAiSettings ? '' : 'hidden'}`}>
            <AiSettingsPanel
              aiEndpoints={aiEndpoints} setAiEndpoints={setAiEndpoints}
              naiConfig={naiConfig} setNaiConfig={setNaiConfig}
              systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
              naiTagPrompt={naiTagPrompt} setNaiTagPrompt={setNaiTagPrompt}
              ideaCultivatePrompt={ideaCultivatePrompt} setIdeaCultivatePrompt={setIdeaCultivatePrompt}
              ragConfig={ragConfig} setRagConfig={setRagConfig}
              saveAiEndpoints={saveAiEndpoints} saveNaiConfig={saveNaiConfig}
              onRebuildRag={onRebuildRag} setShowAiSettings={setShowAiSettings}
            />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 ${!showAiSettings && !isInspirationView ? '' : 'hidden'}`}>
            <AiChatPanel
              activeSession={activeSession} isAiLoading={isAiLoading}
              aiInputText={aiInputText} setAiInputText={setAiInputText}
              aiInputImage={aiInputImage} setAiInputImage={setAiInputImage}
              aiDrawBatchMode={aiDrawBatchMode} setAiDrawBatchMode={setAiDrawBatchMode}
              isMultiImageDraw={isMultiImageDraw}
              onAbortBatchImage={onAbortBatchImage}
              naiConfig={naiConfig} setNaiConfig={setNaiConfig}
              imageRequestStatus={imageRequestStatus}
              referenceConfig={referenceConfig} setReferenceConfig={setReferenceConfig}
              aiImageInputRef={aiImageInputRef} chatScrollRef={chatScrollRef}
              handleAiSendMessage={handleAiSendMessage} handleDrawImage={handleDrawImage}
              onCreateInspirationSession={handleCreateInspirationSession}
              handleAiImageUpload={handleAiImageUpload}
              renderSafeContent={renderSafeContent} renderAiMessage={renderAiMessage}
              activeCharPortraitSrc={activeCharPortraitSrc}
              activeStoryImageSrc={activeStoryImageSrc}
              activeTextEndpoint={activeTextEndpoint}
              activeVisionEndpoint={activeVisionEndpoint}
            />
          </div>

          <div className={`flex-1 flex flex-col min-h-0 ${!showAiSettings && isInspirationView ? '' : 'hidden'}`}>
            <InspirationRoom
              onClose={handleBackFromInspiration}
              activeSessionId={activeSessionId}
              messages={activeSession?.messages || []}
              inspirationChunkMap={activeSession?.inspirationChunkMap || {}}
              inspirationFirstSeed={activeSession?.inspirationFirstSeed || ''}
              patchSession={patchActiveSession}
              activeTextEndpoint={activeTextEndpoint}
              ragConfig={ragConfig}
              referenceConfig={referenceConfig}
              setReferenceConfig={setReferenceConfig}
              ideaCultivatePrompt={ideaCultivatePrompt}
              resolvedChar={resolvedChar}
              safeCharacters={safeCharacters}
              onSaveToScrapbook={onSaveIdeaToScrapbook}
              setShowAiSettings={setShowAiSettings}
              generateTitle={generateTitle}
              onInspirationPreviewUpdate={onInspirationPreviewUpdate}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
