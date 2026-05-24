import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Settings, User, Download, Zap, Library, Book, Save, Copy, Check, Cloud, MessageSquare, X, Upload, ScrollText, RefreshCw } from 'lucide-react';
import { COLOR_THEMES, DEFAULT_CHARACTERS, DEFAULT_AI_ENDPOINTS, resolveTheme } from './constants';
import { sanitizeCharacters, sanitizeScrapbook, createNewSession, createInspirationSession, sanitizeAiSessions } from './utils';
import PortraitView from './components/PortraitView';
import CombatView from './components/CombatView';
import StoryView from './components/StoryView';
import { lazy, Suspense } from 'react';
const GalleryView3D = lazy(() => import('./components/GalleryView3D'));
import ScrapbookView from './components/ScrapbookView';
import NovelView from './components/NovelView';
import AIPanel from './components/AIPanel';
import ScrapbookEditDialog from './components/ScrapbookEditDialog';
import {
  AI_TOOL_ACTION_START,
  AI_TOOL_ACTION_END,
  normalizeEndpoint,
  normalizeEndpoints,
  isMultimodalEndpoint,
  getReadableText,
  normalizeTags,
  parseTagsText,
  parseIdeaDraftMessage,
  parseToolActionMessage,
  stripToolActionBlock,
  buildTaggedScrapbookContext,
  fetchRagForSimpleTool,
  buildRagQuery,
  extractMentionedCharacters,
  buildCharacterSettingContext,
  normalizeImageUrlForModel,
  normalizeMessageForEndpoint,
  sliceChatHistoryForApi,
  extractNovelAiMeta,
  fetchNovelOverlapExcludeIds,
  isLikelyUntitledCaption,
  normalizeToolActionKey,
  stripAgentTrace,
  parseNovelChaptersForTool,
  searchNovelTextSnippets,
  parseAttachGalleryImageBlock,
  stripAttachGalleryImageBlock,
  getUserMessagePlainText,
  resolveGalleryAttachSpecToIndex,
  inferGalleryAttachFromConversation,
  parseListGalleryToolSingleHit,
} from './appHelpers';
import { mergeChatCompletionThinking } from './llmThinking.js';
import { SIMPLE_MODES_STORAGE_KEY } from './novelSimpleModes';
import { buildChatContextPreview } from './chatContextPreview';
import { normalizeReferenceConfig } from './referenceConfigUtils';
import { buildNaiPayloadByPrompt, requestNovelAiImage, persistGeneratedImage } from './naiService';
import useArchiveBootstrap from './hooks/useArchiveBootstrap';
import useAiSessionMeta from './hooks/useAiSessionMeta';
import useNaiGeneration from './hooks/useNaiGeneration';

const AUTO_SAVE_IDLE_MS = 45 * 1000;
const AUTO_SAVE_IDLE_HEAVY_MS = 120 * 1000;
const AUTO_SAVE_MAX_WAIT_MS = 5 * 60 * 1000;
const AUTO_SAVE_MIN_INTERVAL_MS = 90 * 1000;
const AUTO_SAVE_RETRY_BASE_MS = 30 * 1000;
const AUTO_SAVE_RETRY_MAX_MS = 10 * 60 * 1000;
const QUICK_DRAFT_DELAY_MS = 10 * 1000;
const AUTO_SAVE_BOOTSTRAP_GRACE_MS = 20 * 1000;

export default function App() {
  const appTitle = String(import.meta.env?.VITE_APP_TITLE || 'Celestial Archive').trim() || 'Celestial Archive';
  const [appMode, setAppMode] = useState('archive');
  const [characters, setCharacters] = useState(DEFAULT_CHARACTERS);
  const [scrapbook, setScrapbook] = useState([]);
  const [novel, setNovel] = useState({ title: '未命名正文', content: '', updatedAt: 0 });
  const [globalBackground, setGlobalBackground] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState('portrait');
  const [storyIndex, setStoryIndex] = useState(0);
  const [isStoryMetaVisible, setIsStoryMetaVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [showAI, setShowAI] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [prevActiveIndex, setPrevActiveIndex] = useState(0);
  const [aiEndpoints, setAiEndpoints] = useState(normalizeEndpoints(DEFAULT_AI_ENDPOINTS));
  const [activeEndpointId, setActiveEndpointId] = useState('ep_1');
  const [activeVisionEndpointId, setActiveVisionEndpointId] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState('你是一个辅助项目设定构建的专业共创伙伴。语气自然专业，直接切入正题。当前角色：{CHAR}。其他角色：{OTHERS}。笔记：{SCRAPBOOK}。\n如有适合记录的设定，在回复末尾附加：\n===SCRAPBOOK===\nTITLE: [标题]\nCONTENT: [内容]\n=============');
  const [naiTagPrompt, setNaiTagPrompt] = useState('你现在是 NovelAI 的提示词翻译官。仅返回英文Tag，用逗号分隔，不要任何解释。角色：{CHAR}');
  const [ideaCultivatePrompt, setIdeaCultivatePrompt] = useState(
    '你是项目设定创作编辑器。请把用户灵感扩写为80-100字，并提出一个引导性追问。'
  );
  /** Chroma 须显式开启：旧版 database 常不带 useChroma 字段，若默认 true 会在每次加载后像「莫名打开」 */
  const [ragConfig, setRagConfig] = useState({
    enabled: true,
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    embeddingModel: 'Qwen/Qwen3-Embedding-8B',
    useChroma: false,
    chromaHost: '127.0.0.1',
    chromaPort: 8000,
    chromaSsl: false
  });
  const [scrapbookEditDialog, setScrapbookEditDialog] = useState(null); // {title, content, tags}
  const [referenceConfig, setReferenceConfig] = useState(() => normalizeReferenceConfig({}));
  const [naiConfig, setNaiConfig] = useState({
    key: '', url: '/api/novelai/generate-image',
    /** novelai: 转发至 image.novelai.net；idlecloud: 转发至 api.idlecloud.cc 官方适配端点（请求体仍由本地中间件按官方格式封装） */
    imageUpstream: 'novelai',
    version: 'v4.5',
    model: 'nai-diffusion-4-5-full', resolution: 'portrait',
    prefix: 'masterpiece, best quality, highly detailed, illustration, ',
    negative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
    steps: 28, scale: 5.0, sampler: 'k_euler',
    v45_qualityToggle: true, v45_ucPreset: 0, v45_refType: 'character',
    v45_refStrength: 0.6, v45_refFidelity: 1.0, v3_sm: false, v3_sm_dyn: false
  });
  const [aiSessions, setAiSessions] = useState([createNewSession()]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [aiInputText, setAiInputText] = useState('');
  const [isChatAiLoading, setIsChatAiLoading] = useState(false);
  const [imageRequestStatus, setImageRequestStatus] = useState(null);
  const [isNovelAiLoading, setIsNovelAiLoading] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [currentPortraitSrc, setCurrentPortraitSrc] = useState(null);
  const [currentBackgroundSrc, setCurrentBackgroundSrc] = useState(null);
  const [currentBgVideo, setCurrentBgVideo] = useState(null);
  const [aiInputImage, setAiInputImage] = useState(null);
  /** 对话内「画师」批量：输入框每行一条，串行生图；IdleCloud 自动拉长间隔（>=22s） */
  const [aiDrawBatchMode, setAiDrawBatchMode] = useState(false);
  /** 生图多任务连跑（行尾 @N>1 等），与是否点亮「批量」无必然关系 */
  const [isMultiImageDraw, setIsMultiImageDraw] = useState(false);
  const [lastResolvedSystemPrompt, setLastResolvedSystemPrompt] = useState('');
  const [lastContextPreview, setLastContextPreview] = useState(null);
  const [toolActionStatus, setToolActionStatus] = useState({});
  const chatScrollRef = useRef(null);
  const aiImageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const combatInputRef = useRef(null);
  const storyInputRef = useRef(null);
  const bgInputRef = useRef(null);
  const globalBgInputRef = useRef(null);
  const importFileRef = useRef(null);
  const scrapbookFileInputRef = useRef(null);
  /** 批量文生图：置 true 后下一轮任务前退出循环 */
  const batchImageAbortRef = useRef(false);
  const mouseMoveRafRef = useRef(null);
  const chatScrollTimerRef = useRef(null);
  const autoSaveIdleTimerRef = useRef(null);
  const autoSaveMaxTimerRef = useRef(null);
  const autoSaveRetryTimerRef = useRef(null);
  const quickDraftTimerRef = useRef(null);
  const autoSaveInFlightRef = useRef(false);
  const autoSavePendingRef = useRef(false);
  const autoSaveBootstrappedRef = useRef(false);
  const autoSaveReadyAtRef = useRef(Date.now() + AUTO_SAVE_BOOTSTRAP_GRACE_MS);
  const autoSaveRetryDelayRef = useRef(AUTO_SAVE_RETRY_BASE_MS);
  const lastPersistentSaveAtRef = useRef(0);
  const autoSaveDirtyRef = useRef(false);
  const [activeScrapbookId, setActiveScrapbookId] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const safeCharacters = Array.isArray(characters) ? characters : DEFAULT_CHARACTERS;
  const activeChar = (safeCharacters.length > 0 && safeCharacters[activeIndex]) ? safeCharacters[activeIndex] : DEFAULT_CHARACTERS[0];
  const theme = resolveTheme(activeChar?.theme);
  const activeThemeButtonStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent, color: '#fff', borderColor: theme.styles?.borderColor || theme.accent } : undefined;
  const archiveBgStyle = appMode === 'archive' && theme?.isCustom ? { backgroundImage: theme.styles?.gradient } : undefined;
  const archiveGlowStyle = appMode === 'archive' && theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent } : undefined;
  const uploadFabStyle = theme?.isCustom ? { backgroundColor: theme.styles?.bgDark || theme.accent, color: '#fff' } : undefined;
  const activeSession = aiSessions.find(s => s.id === activeSessionId) || aiSessions[0];

  const { mergeSessionMeta, patchActiveSession } = useAiSessionMeta({
    aiSessions,
    activeSessionId,
    activeSession,
    characters,
    lastContextPreview,
    setAiSessions,
    setActiveSessionId,
    setLastContextPreview,
    setLastResolvedSystemPrompt,
  });

  const textEndpoints = aiEndpoints.filter(ep => !isMultimodalEndpoint(ep));
  const multimodalEndpoints = aiEndpoints.filter(ep => isMultimodalEndpoint(ep));
  const activeTextEndpoint = textEndpoints.find(ep => ep.id === activeEndpointId) || textEndpoints[0] || aiEndpoints[0];
  const activeVisionEndpoint = multimodalEndpoints.find(ep => ep.id === activeVisionEndpointId) || multimodalEndpoints[0] || null;
  const currentBg = (appMode === 'archive' && viewMode === 'portrait' && (currentBackgroundSrc || activeChar?.background || globalBackground))
    ? (currentBackgroundSrc || activeChar.background || globalBackground)
    : null;
  useEffect(() => {
    // 切换角色时不重置 currentBackgroundSrc，由 PortraitView 的 onBackgroundChange 自行更新
    // 必须清空全局视频：PortraitView 在接口无视频时会回退到 appBackgroundVideo，否则会播上一角色的视频
    setCurrentBgVideo(null);
  }, [activeChar?.id]);

  /** 仅灵感室使用左侧当前档案；普通对话不再绑定会话角色，由你在对话中说明即可 */
  const resolveSessionCharacter = (session) => {
    if (session?.mode === 'inspiration') return activeChar;
    return null;
  };

  const activeSessionResolvedChar = resolveSessionCharacter(activeSession);
  // Character transition splash is currently disabled; replace with a generic presentation later.

  const { applyLoadedArchiveData } = useArchiveBootstrap({
    setCharacters,
    setGlobalBackground,
    setScrapbook,
    setNovel,
    setAiEndpoints,
    setActiveEndpointId,
    setActiveVisionEndpointId,
    setNaiConfig,
    setSystemPrompt,
    setNaiTagPrompt,
    setIdeaCultivatePrompt,
    setRagConfig,
    referenceConfig,
    setReferenceConfig,
    setAiSessions,
    setActiveSessionId,
    setIsDataLoaded,
  });

  const formatClockTime = useCallback((date = new Date()) => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  }, []);

  const hasInlineImageData = useMemo(() => {
    if (typeof globalBackground === 'string' && globalBackground.startsWith('data:image/')) return true;
    const hasInlineInCharacters = (Array.isArray(characters) ? characters : []).some((char) => {
      if (!char || typeof char !== 'object') return false;
      if (typeof char.image === 'string' && char.image.startsWith('data:image/')) return true;
      if (typeof char.background === 'string' && char.background.startsWith('data:image/')) return true;
      if (typeof char.combatImg === 'string' && char.combatImg.startsWith('data:image/')) return true;
      if (Array.isArray(char.stories) && char.stories.some((img) => typeof img === 'string' && img.startsWith('data:image/'))) return true;
      return false;
    });
    if (hasInlineInCharacters) return true;
    return (Array.isArray(scrapbook) ? scrapbook : []).some((item) => typeof item?.image === 'string' && item.image.startsWith('data:image/'));
  }, [characters, globalBackground, scrapbook]);

  const persistQuickDraft = useCallback(() => {
    try {
      const safeAiSessions = aiSessions.map(s => ({
        ...s,
        messages: (s.messages || []).map(m => {
          let c = m.content;
          if (typeof c === 'string' && c.includes('data:image/')) {
            c = c.replace(/data:image\/[A-Za-z0-9+/=;,]+/g, '[本地未保存的临时图像]');
          } else if (Array.isArray(c)) {
            c = c.map(part => {
              if (part && part.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/')) {
                return { ...part, image_url: { ...part.image_url, url: '[本地未保存的临时图像]' } };
              }
              return part;
            });
          }
          return { ...m, content: c };
        })
      }));
      localStorage.setItem('celestial_novel_v1', JSON.stringify(novel));
      localStorage.setItem('celestial_scrapbook_v1', JSON.stringify(scrapbook));
      localStorage.setItem('celestial_ai_sessions_v2', JSON.stringify(safeAiSessions));
      localStorage.setItem('celestial_quick_draft_meta_v1', JSON.stringify({ timestamp: Date.now() }));
    } catch (e) {}
  }, [novel, scrapbook, aiSessions]);

  const buildSavePayload = useCallback(() => {
    const safeAiSessions = aiSessions.map(s => ({
      ...s,
      messages: (s.messages || []).map(m => {
        let c = m.content;
        if (typeof c === 'string' && c.includes('data:image/')) {
          c = c.replace(/data:image\/[A-Za-z0-9+/=;,]+/g, '[本地未保存的临时图像]');
        } else if (Array.isArray(c)) {
          c = c.map(part => {
            if (part && part.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/')) {
              return { ...part, image_url: { ...part.image_url, url: '[本地未保存的临时图像]' } };
            }
            return part;
          });
        }
        return { ...m, content: c };
      })
    }));

    return {
      version: 'v12',
      timestamp: Date.now(),
      characters,
      globalBackground,
      scrapbook,
      novel,
      aiSessions: safeAiSessions,
      aiEndpoints,
      activeEndpointId,
      activeVisionEndpointId,
      naiConfig,
      systemPrompt,
      naiTagPrompt,
      ideaCultivatePrompt,
      ragConfig,
      referenceConfig,
      novelContinueSettings: (() => {
        try {
          const s = localStorage.getItem('celestial_novel_continue_settings_v1');
          return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
      })(),
      novelSimpleModes: (() => {
        try {
          const s = localStorage.getItem(SIMPLE_MODES_STORAGE_KEY);
          return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
      })()
    };
  }, [
    characters,
    globalBackground,
    scrapbook,
    novel,
    aiSessions,
    aiEndpoints,
    activeEndpointId,
    activeVisionEndpointId,
    naiConfig,
    systemPrompt,
    naiTagPrompt,
    ideaCultivatePrompt,
    ragConfig,
    referenceConfig,
  ]);

  const persistArchive = useCallback(async ({
    newVersion = false,
    silent = false,
    reloadAfterSave = true,
    source = 'manual',
  } = {}) => {
    if (autoSaveInFlightRef.current) {
      if (source === 'auto') {
        autoSavePendingRef.current = true;
        return false;
      }
      if (!silent) alert('已有保存任务进行中，请稍后再试。');
      return false;
    }
    if (!isDataLoaded && source !== 'bootstrap') {
      console.warn('[Guard] Blocking save because data has not been fully loaded yet.');
      return false;
    }

    autoSaveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const payload = buildSavePayload();
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, newVersion }),
      });
      if (!res.ok) {
        throw new Error(`保存失败 (${res.status})`);
      }
      const result = await res.json();
      if (reloadAfterSave) {
        const loadRes = await fetch('/api/load');
        const loadText = await loadRes.text();
        let data;
        try {
          data = JSON.parse(loadText);
        } catch (e) {
          throw new Error('无法解析服务器返回的存档');
        }
        if (!loadRes.ok || !data || data.error || !applyLoadedArchiveData(data)) {
          throw new Error('保存成功但刷新存档失败，请手动刷新页面');
        }
      }
      const now = new Date();
      const saveTs = now.getTime();
      lastPersistentSaveAtRef.current = saveTs;
      setLastSaveTime(formatClockTime(now));
      autoSaveDirtyRef.current = false;
      autoSavePendingRef.current = false;
      autoSaveRetryDelayRef.current = AUTO_SAVE_RETRY_BASE_MS;
      if (newVersion && !silent) {
        alert(result.versionId ? `已生成新版本快照：${result.versionId}` : '已生成新版本快照！');
      }
      return true;
    } catch (e) {
      persistQuickDraft();
      if (!silent) alert('保存失败：' + e.message);
      return false;
    } finally {
      autoSaveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [applyLoadedArchiveData, buildSavePayload, formatClockTime, persistQuickDraft]);

  const handleSave = useCallback((newVersion = false) => {
    void persistArchive({
      newVersion,
      silent: false,
      reloadAfterSave: true,
      source: 'manual',
    });
  }, [persistArchive]);

  const clearAutoSaveTimers = useCallback(() => {
    if (autoSaveIdleTimerRef.current) {
      clearTimeout(autoSaveIdleTimerRef.current);
      autoSaveIdleTimerRef.current = null;
    }
    if (autoSaveMaxTimerRef.current) {
      clearTimeout(autoSaveMaxTimerRef.current);
      autoSaveMaxTimerRef.current = null;
    }
    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
      autoSaveRetryTimerRef.current = null;
    }
  }, []);

  const triggerAutoSave = useCallback(async (reason = 'idle') => {
    if (!autoSaveDirtyRef.current || !autoSavePendingRef.current) return;
    if (Date.now() < autoSaveReadyAtRef.current) return;
    if (autoSaveInFlightRef.current) return;
    const elapsed = Date.now() - lastPersistentSaveAtRef.current;
    if (lastPersistentSaveAtRef.current > 0 && elapsed < AUTO_SAVE_MIN_INTERVAL_MS) {
      const waitMs = AUTO_SAVE_MIN_INTERVAL_MS - elapsed;
      if (!autoSaveRetryTimerRef.current) {
        autoSaveRetryTimerRef.current = setTimeout(() => {
          autoSaveRetryTimerRef.current = null;
          void triggerAutoSave(`cooldown-${reason}`);
        }, waitMs);
      }
      return;
    }
    const ok = await persistArchive({
      newVersion: false,
      silent: true,
      reloadAfterSave: false,
      source: 'auto',
    });
    if (!ok) {
      autoSavePendingRef.current = true;
      const retryMs = autoSaveRetryDelayRef.current;
      autoSaveRetryDelayRef.current = Math.min(retryMs * 2, AUTO_SAVE_RETRY_MAX_MS);
      if (!autoSaveRetryTimerRef.current) {
        autoSaveRetryTimerRef.current = setTimeout(() => {
          autoSaveRetryTimerRef.current = null;
          void triggerAutoSave(`retry-${reason}`);
        }, retryMs);
      }
      return;
    }
    if (autoSavePendingRef.current) {
      void triggerAutoSave('drain');
    }
  }, [persistArchive]);

  const scheduleAutoSave = useCallback(() => {
    if (Date.now() < autoSaveReadyAtRef.current) return;
    clearAutoSaveTimers();
    const idleMs = hasInlineImageData ? AUTO_SAVE_IDLE_HEAVY_MS : AUTO_SAVE_IDLE_MS;
    autoSaveIdleTimerRef.current = setTimeout(() => {
      autoSaveIdleTimerRef.current = null;
      void triggerAutoSave('idle');
    }, idleMs);
    autoSaveMaxTimerRef.current = setTimeout(() => {
      autoSaveMaxTimerRef.current = null;
      void triggerAutoSave('max-wait');
    }, AUTO_SAVE_MAX_WAIT_MS);
  }, [clearAutoSaveTimers, hasInlineImageData, triggerAutoSave]);

  const extractKeywordsFromContext = async (beforeText, afterText, resolvedChar) => {
    if (!activeTextEndpoint?.key) return beforeText;
    
    try {
      const charInfo = resolvedChar?.name ? `当前角色：${resolvedChar.name}` : '';
      const prompt = `你是关键词提取器。根据以下文本，提取出：
1. 涉及的关键人物名字
2. 未解决的伏笔或悬念
3. 需要回收的旧信息或设定
4. 当前的主要情节走向

只返回提取的关键词和短语，用逗号分隔，不要解释。

${charInfo}

文本：
${beforeText.slice(-1000)}
${afterText ? `\n后续：${afterText.slice(0, 300)}` : ''}`;

      const res = await fetch(activeTextEndpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeTextEndpoint.key}` },
        body: JSON.stringify(
          mergeChatCompletionThinking(activeTextEndpoint, {
            model: activeTextEndpoint.model,
            temperature: 0.3,
            messages: [
              { role: 'system', content: '你是关键词提取器，只返回关键词，不要其他内容。' },
              { role: 'user', content: prompt }
            ]
          })
        )
      });

      if (!res.ok) return beforeText;
      const data = await res.json();
      const keywords = data.choices?.[0]?.message?.content?.trim() || '';
      
      // 组合原始上下文和提取的关键词
      return `${keywords}\n\n${beforeText}`;
    } catch (e) {
      console.warn('关键词提取失败，使用原始查询', e);
      return beforeText;
    }
  };

  const handleContinueNovel = async (options = {}) => {
    if (isNovelAiLoading) return;
    if (!activeTextEndpoint?.key) { alert('请先配置文本模型 API Key！'); setShowAiSettings(true); return; }
    const current = String(novel?.content || '');
    const beforeText = String(options.beforeText || current.slice(-2500));
    const afterText = String(options.afterText || '');
    const selectedText = String(options.selectedText || '');
    const userDirection = String(options.userDirection || '');
    const taskType = options.taskType === 'polish' ? 'polish' : (options.taskType === 'suggest-directions' ? 'suggest-directions' : 'continue');
    const simple = options.simpleToolConfig && typeof options.simpleToolConfig === 'object' ? options.simpleToolConfig : null;
    const referenceChars = Math.max(200, Math.min(4000, Number(options.referenceChars || 1000)));
    const targetLength = Math.max(120, Math.min(1200, Number(options.targetLength || simple?.targetLength || 500)));
    if (!beforeText.trim() && !current.trim()) { alert('请先写入一些正文再续写。'); return; }
    setIsNovelAiLoading(true);
    try {
      const contextText = [beforeText, afterText, selectedText].join('\n');
      const mentionedChars = extractMentionedCharacters(contextText, safeCharacters);
      const useCharacterCtx = simple ? simple.useCharacterContext !== false : true;
      const charSettingContext = useCharacterCtx ? buildCharacterSettingContext(mentionedChars) : '';

      const selectedScrapbookIds = Array.isArray(options.selectedScrapbookIds) ? options.selectedScrapbookIds : [];
      const selectedScrapbookContent = selectedScrapbookIds.length > 0
        ? (Array.isArray(scrapbook) ? scrapbook : [])
            .filter(item => selectedScrapbookIds.includes(item.id))
            .map(item => `【${item.title || '未命名'}】\n${item.content || '（空）'}`)
            .join('\n\n')
        : '';

      const wantSimpleRag = Boolean(simple && simple.useRag !== false);
      let ragContext = '';
      let novelRefs = [];
      let scrapbookRefs = [];
      let summaryRefs = [];
      if (wantSimpleRag && taskType !== 'suggest-directions') {
        const ragQuery = buildRagQuery({
          input: [beforeText.slice(-500), selectedText.slice(0, 800), afterText.slice(0, 300)].filter(Boolean).join('\n')
        });
        const rc = simple?.ragCounts || { novel: 4, scrapbook: 4, summary: 4 };
        const ox = options.overlapExcludeContext;
        let overlapExcludeIds = [];
        if (ox && String(ox.novelContent || '').trim()) {
          overlapExcludeIds = await fetchNovelOverlapExcludeIds({
            novelContent: ox.novelContent,
            chapterIndex: ox.chapterIndex,
            cursorInChapter: ox.cursorInChapter,
            referenceChars
          });
        }
        const rag = await fetchRagForSimpleTool(ragQuery, ragConfig, rc, overlapExcludeIds);
        ragContext = rag.context || '';
        novelRefs = rag.novelRefs || [];
        scrapbookRefs = rag.scrapbookRefs || [];
        summaryRefs = rag.summaryRefs || [];
      }

      const tempBase = Number(simple?.temperature);
      const temperature = Number.isFinite(tempBase) ? Math.max(0, Math.min(2, tempBase)) : 0.8;

      let sys; let user;

      if (taskType === 'suggest-directions') {
        sys = String(options.systemPrompt || '').trim() || '你是小说剧情架构师。请分析当前剧情，给出3个可能的续写方向。';
        user = [
          `当前正文结尾：\n${beforeText.slice(-referenceChars)}`,
          afterText ? `光标后已写内容：\n${afterText.slice(0, 300)}` : '',
          '请先思考：1.当前有哪些伏笔？2.角色目前的动机是什么？3.接下来的冲突点在哪？',
          '基于现有上下文进行分析。'
        ].filter(Boolean).join('\n\n');
      } else if (taskType === 'polish') {
        sys = String(options.systemPrompt || simple?.systemPrompt || '').trim() || [
          '你是小说润色编辑器。',
          '仅润色用户提供的选中文本，不要扩写剧情，不要新增设定。',
          '保持人物设定、语气与上下文一致，只返回润色后的正文。'
        ].join('\n');
        user = [
          `待润色文本：\n${selectedText}`,
          `光标前参考文本：\n${beforeText.slice(-referenceChars)}`,
          afterText ? `光标后文本：\n${afterText.slice(0, 300)}` : '',
          charSettingContext ? `涉及角色设定：\n${charSettingContext}` : '',
          selectedScrapbookContent ? `用户手动指定的笔记参考：\n${selectedScrapbookContent}` : '',
          ragContext ? `【语义召回参考】\n${ragContext}` : ''
        ].filter(Boolean).join('\n\n');
      } else {
        sys = String(options.systemPrompt || simple?.systemPrompt || '').trim() || [
          '你是长篇小说续写助手。保持文风与现有正文一致，避免复述。',
          `单次续写约 ${Math.round(targetLength * 0.7)}-${Math.round(targetLength * 1.2)} 字，只返回正文，不要解释。`,
          '续写应当紧接光标处，不改写已有文本。',
          '在正式动笔前，请先思考：接下来的剧情需要用到哪些设定？之前的章节是否有相关的线索？',
          '基于现有上下文进行续写。'
        ].filter(Boolean).join('\n');
        user = [
          userDirection ? `用户指定的续写方向：${userDirection}` : '',
          `当前正文结尾：\n${beforeText.slice(-referenceChars)}`,
          afterText ? `光标后已写内容：\n${afterText.slice(0, 300)}` : '',
          charSettingContext ? `已识别到的角色：\n${charSettingContext}` : '',
          selectedScrapbookContent ? `用户手动指定的笔记参考：\n${selectedScrapbookContent}` : '',
          ragContext ? `【语义召回参考】\n${ragContext}` : ''
        ].filter(Boolean).join('\n\n');
      }

      const res = await fetch(activeTextEndpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeTextEndpoint.key}` },
        body: JSON.stringify(
          mergeChatCompletionThinking(activeTextEndpoint, {
            model: activeTextEndpoint.model,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: user }
            ],
            temperature: taskType === 'suggest-directions' ? 0.7 : temperature
          })
        )
      });

      if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const continuation = (data.choices?.[0]?.message?.content || '').trim();
      if (!continuation) throw new Error('模型未返回内容');

      return {
        text: continuation,
        ragRefs: {
          novelRefs,
          scrapbookRefs,
          summaryRefs,
          charSettingContext: charSettingContext || '',
          selectedScrapbookContent: selectedScrapbookContent || ''
        }
      };
    } catch (e) {
      alert(e.message);
      throw e;
    } finally {
      setIsNovelAiLoading(false);
    }
  };

  useEffect(() => {
    if (!autoSaveBootstrappedRef.current) {
      autoSaveBootstrappedRef.current = true;
      return;
    }
    autoSaveDirtyRef.current = true;
    autoSavePendingRef.current = true;
    scheduleAutoSave();
  }, [
    characters,
    globalBackground,
    scrapbook,
    novel,
    aiSessions,
    aiEndpoints,
    activeEndpointId,
    activeVisionEndpointId,
    naiConfig,
    systemPrompt,
    naiTagPrompt,
    ideaCultivatePrompt,
    ragConfig,
    referenceConfig,
    scheduleAutoSave,
  ]);

  useEffect(() => {
    if (!autoSaveBootstrappedRef.current) return;
    if (quickDraftTimerRef.current) clearTimeout(quickDraftTimerRef.current);
    quickDraftTimerRef.current = setTimeout(() => {
      quickDraftTimerRef.current = null;
      persistQuickDraft();
    }, QUICK_DRAFT_DELAY_MS);
    return () => {
      if (quickDraftTimerRef.current) {
        clearTimeout(quickDraftTimerRef.current);
        quickDraftTimerRef.current = null;
      }
    };
  }, [novel, scrapbook, aiSessions, persistQuickDraft]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void triggerAutoSave('visibility-hidden');
      }
    };
    const onBeforeUnload = () => {
      persistQuickDraft();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearAutoSaveTimers();
    };
  }, [clearAutoSaveTimers, persistQuickDraft, triggerAutoSave]);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); handleSave(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  useEffect(() => {
    if (!autoSavePendingRef.current) return;
    scheduleAutoSave();
  }, [hasInlineImageData, scheduleAutoSave]);

  useEffect(() => {
    const delay = Math.max(0, autoSaveReadyAtRef.current - Date.now());
    const timer = setTimeout(() => {
      if (autoSavePendingRef.current) scheduleAutoSave();
    }, delay);
    return () => clearTimeout(timer);
  }, [scheduleAutoSave]);

  useEffect(() => {
    return () => {
      if (quickDraftTimerRef.current) {
        clearTimeout(quickDraftTimerRef.current);
        quickDraftTimerRef.current = null;
      }
      clearAutoSaveTimers();
    };
  }, [clearAutoSaveTimers]);

  useEffect(() => {
    if (chatScrollTimerRef.current) clearTimeout(chatScrollTimerRef.current);
    chatScrollTimerRef.current = setTimeout(() => {
      if (!chatScrollRef.current) return;
      chatScrollRef.current.scrollIntoView({ behavior: isChatAiLoading ? 'auto' : 'smooth' });
    }, 120);
    return () => {
      if (chatScrollTimerRef.current) {
        clearTimeout(chatScrollTimerRef.current);
        chatScrollTimerRef.current = null;
      }
    };
  }, [activeSession?.messages, isChatAiLoading, showAI, activeSessionId]);

  useEffect(() => {
    const shouldTrackMouse =
      appMode === 'archive' && (viewMode === 'portrait' || viewMode === 'combat');
    if (!shouldTrackMouse) return undefined;
    const onMove = (e) => {
      if (mouseMoveRafRef.current) return;
      mouseMoveRafRef.current = window.requestAnimationFrame(() => {
        setMousePos({
          x: (e.clientX - window.innerWidth / 2) / 50,
          y: (e.clientY - window.innerHeight / 2) / 50
        });
        mouseMoveRafRef.current = null;
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (mouseMoveRafRef.current) {
        window.cancelAnimationFrame(mouseMoveRafRef.current);
        mouseMoveRafRef.current = null;
      }
    };
  }, [appMode, viewMode]);

  useEffect(() => {
    if (viewMode !== 'story' || appMode !== 'archive') {
      setIsStoryMetaVisible(false);
    }
  }, [viewMode, appMode]);

  const updateCharacter = (field, value, nestedField = null) => {
    setCharacters(prev => (Array.isArray(prev) ? prev : []).map((char, i) => {
      if (i !== activeIndex) return char;
      if (nestedField) return { ...char, [field]: { ...char[field], [nestedField]: value } };
      return { ...char, [field]: value };
    }));
  };

  const updateHexagram = (index, value) => {
    const newHex = [...(activeChar.hexagram || [3,3,3,3,3,3])];
    newHex[index] = value;
    updateCharacter('hexagram', newHex);
  };

  const normalizeStoryImgItem = (item, idx) => {
    const fallbackName = String(item?.name || item?.caption || '无题').trim() || '无题';
    return {
      seq: idx + 1,
      name: fallbackName,
      src: String(item?.src || ''),
      description: String(item?.description || ''),
      caption: fallbackName,
    };
  };

  const normalizeStoryImgList = (list) => (Array.isArray(list) ? list : []).map((item, idx) => normalizeStoryImgItem(item, idx));

  const updateStoryCaption = (imgIndex, newCaption) => {
    setCharacters(prev => (Array.isArray(prev) ? prev : []).map((char, i) => {
      if (i !== activeIndex) return char;
      const newImgs = normalizeStoryImgList(char.storyImgs || []);
      if (newImgs[imgIndex]) {
        const nextName = String(newCaption || '').trim() || '无题';
        newImgs[imgIndex] = { ...newImgs[imgIndex], name: nextName, caption: nextName };
      }
      return { ...char, storyImgs: normalizeStoryImgList(newImgs) };
    }));
  };

  const addNewCharacter = () => {
    setCharacters((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const names = new Set(list.map((c) => c?.name).filter(Boolean));
      const base = '新角色';
      let name = base;
      let n = 2;
      while (names.has(name)) {
        name = `${base}${n}`;
        n += 1;
      }
      const next = [
        ...list,
        {
          id: Date.now(),
          name,
          title: '未知',
          theme: 'neonBlue',
          details: { phase: '未知', age: '未知', weapon: '未知', faction: '未知' },
          hexagram: [3, 3, 3, 3, 3, 3],
          lore: '...',
          image: null,
          background: null,
          combatImg: null,
          combatPoem: '点击输入诗句...',
          combatVerses: '',
          storyImgs: [],
          combatDesc: '暂无说明',
        },
      ];
      queueMicrotask(() => setActiveIndex(next.length - 1));
      return next;
    });
  };

  const deleteCharacter = () => {
    if (!Array.isArray(characters) || characters.length <= 1) return;
    if (confirm('确定删除？')) { setCharacters(prev => prev.filter((_, i) => i !== activeIndex)); setActiveIndex(0); }
  };
  const updateScrapbookItem = (id, field, value) => setScrapbook(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === id ? { ...item, [field]: value } : item));
  const deleteScrapbookItem = (id) => { if (confirm('确定删除这条灵感记录吗？')) setScrapbook(prev => (Array.isArray(prev) ? prev : []).filter(item => item.id !== id)); };
  const triggerScrapbookImageUpload = (id) => { setActiveScrapbookId(id); setTimeout(() => scrapbookFileInputRef.current.click(), 0); };
  const appendAssistantMessageToSession = (sessionId, text) => {
    setAiSessions((prev) => prev.map((s) => {
      if (s.id !== sessionId) return s;
      const msgs = [...(s.messages || []), { role: 'assistant', content: text }];
      return { ...s, messages: msgs, ...mergeSessionMeta(msgs) };
    }));
  };
  const findCharacterByName = (name) => {
    const n = String(name || '').trim();
    if (!n) return null;
    return safeCharacters.find(c => c?.name === n || String(c?.name || '').startsWith(`${n}·`)) || null;
  };
  const runAiToolAction = async (rawAction) => {
    const truncToolText = (s, max) => {
      const t = String(s || '');
      if (t.length <= max) return t;
      return `${t.slice(0, max)}\n\n…（已截断，原文约 ${t.length} 字）`;
    };
    /** 部分模型会把参数包在 params 里；执行层展平为与协议示例一致的顶层字段 */
    let actionObj = rawAction;
    if (rawAction?.params && typeof rawAction.params === 'object' && !Array.isArray(rawAction.params)) {
      const { params, ...rest } = rawAction;
      actionObj = { ...params, ...rest };
    }
    const action = String(actionObj?.action || '').trim();
    if (!action) throw new Error('未指定 action');
    if (action === 'list_novel_chapters') {
      const bookTitle = String(novel?.title || '').trim() || '未命名正文';
      const raw = String(novel?.content || '');
      const chs = parseNovelChaptersForTool(raw);
      if (chs.length === 0) return `《${bookTitle}》正文为空。`;
      return [`《${bookTitle}》共 ${chs.length} 章/段`, ...chs.map((c, i) => `#${i + 1} 「${c.title}」 ${c.body.length} 字`)].join('\n');
    }
    if (action === 'get_novel_chapter') {
      const raw = String(novel?.content || '');
      const chs = parseNovelChaptersForTool(raw);
      if (chs.length === 0) return '正文内容为空。';
      const titleContains = String(actionObj?.titleContains || '').trim();
      const idx1 = Number(actionObj?.chapterIndex);
      let ch = null;
      if (Number.isFinite(idx1) && idx1 >= 1) ch = chs[Math.floor(idx1) - 1];
      if (!ch && titleContains) ch = chs.find((c) => String(c.title).includes(titleContains));
      if (!ch) return '未找到章节。请使用 chapterIndex（从 1 起）或 titleContains（标题子串）。';
      const maxChars = Math.max(2000, Math.min(50000, Number(actionObj?.maxChars) || 20000));
      return `「${ch.title}」\n${truncToolText(ch.body, maxChars)}`;
    }
    if (action === 'search_novel') {
      const raw = String(novel?.content || '');
      const r = searchNovelTextSnippets(raw, actionObj?.query, {
        maxHits: actionObj?.maxHits,
        contextChars: actionObj?.contextChars,
        caseInsensitive: actionObj?.caseInsensitive !== false
      });
      if (r.error) return r.error;
      if (!r.hits?.length) return `未在正文中找到「${r.query}」。`;
      return r.hits
        .map(
          (h, i) =>
            `#${i + 1} 约第 ${h.lineApprox} 行 · charIndex=${h.charIndex}\n${h.snippet}`
        )
        .join('\n\n---\n\n');
    }
    if (action === 'rag_search') {
      const q = String(actionObj?.query || '').trim();
      if (!q) return 'rag_search 需要非空 query。';
      const rawType = String(actionObj?.type || 'all').trim();
      const allowed = new Set(['all', 'novel', 'scrapbook', 'novel_summary']);
      const t = allowed.has(rawType) ? rawType : 'all';
      const topK = Math.max(1, Math.min(24, Number(actionObj?.topK) || 12));
      const excludeIds = Array.isArray(actionObj?.excludeIds) ? actionObj.excludeIds.map((x) => String(x)) : [];
      const res = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, topK, ragConfig, type: t, excludeIds })
      });
      if (!res.ok) return `RAG 检索失败 (${res.status})：${(await res.text()).slice(0, 400)}`;
      const data = await res.json();
      const hits = Array.isArray(data.hits) ? data.hits : [];
      if (hits.length === 0) return 'RAG 无命中。';
      return hits
        .map((h, i) => {
          const title = h.title || h.id || '未命名';
          const score = typeof h.score === 'number' ? ` · score=${h.score.toFixed(4)}` : '';
          const preview = truncToolText(String(h.text || ''), 2200);
          return `#${i + 1} [${h.type || '?'}] ${title}${score}\n${preview}`;
        })
        .join('\n\n---\n\n');
    }
    if (action === 'list_characters') {
      const q = String(actionObj?.query || '').trim().toLowerCase();
      const list = (Array.isArray(characters) ? characters : []).filter((c) => {
        if (!q) return true;
        const blob = [c.name, c.title, c.lore].map((x) => String(x || '').toLowerCase()).join('\n');
        return blob.includes(q);
      });
      if (list.length === 0) return '未找到匹配角色。';
      return list
        .map((c, i) => `#${i + 1} id=${c.id} 名=${c.name || ''} 标题=${c.title || ''}`)
        .join('\n');
    }
    if (action === 'get_character') {
      const idRaw = actionObj?.id;
      const name = String(actionObj?.characterName || '').trim();
      let c = null;
      if (idRaw != null && idRaw !== '') {
        c = (Array.isArray(characters) ? characters : []).find((x) => String(x.id) === String(idRaw));
      }
      if (!c && name) c = findCharacterByName(name);
      if (!c) return '未找到角色（请提供 id 或 characterName）。';
      const pick = actionObj?.fields;
      const allow = Array.isArray(pick) && pick.length ? new Set(pick.map(String)) : null;
      const keys = [
        'id',
        'name',
        'title',
        'theme',
        'details',
        'hexagram',
        'lore',
        'combatDesc',
        'combatPoem',
        'combatVerses',
        'image',
        'background',
        'combatImg',
        'storyImgs',
        'formOverrides'
      ];
      const out = {};
      for (const k of keys) {
        if (allow && !allow.has(k)) continue;
        if (k === 'storyImgs') {
          const imgs = Array.isArray(c.storyImgs) ? c.storyImgs : [];
          out[k] = imgs.map((im, ix) => ({
            imageIndex: ix,
            seq: Number(im?.seq) || (ix + 1),
            name: String(im?.name || im?.caption || '无题'),
            caption: String(im?.caption || im?.name || '无题'),
            description: String(im?.description || ''),
            hasSrc: !!im?.src
          }));
        } else {
          out[k] = c[k];
        }
      }
      if (out.lore != null) out.lore = truncToolText(String(out.lore), 8000);
      return JSON.stringify(out, null, 2);
    }
    if (action === 'get_scrapbook') {
      const idRaw = actionObj?.id;
      const titleMatch = String(actionObj?.titleMatch || '').trim();
      const list = Array.isArray(scrapbook) ? scrapbook : [];
      let item = null;
      if (idRaw != null && idRaw !== '') item = list.find((s) => String(s.id) === String(idRaw));
      if (!item && titleMatch) item = list.find((s) => String(s.title || '').includes(titleMatch));
      if (!item) return '未找到笔记（请提供 id 或 titleMatch）。';
      const lines = [
        `id=${item.id}`,
        `title=${item.title || ''}`,
        `tags=${(item.tags || []).join(',') || '无'}`,
        `content:\n${truncToolText(String(item.content || ''), 12000)}`
      ];
      if (item.image) lines.push('（本条含封面图，未展开二进制）');
      return lines.join('\n');
    }
    if (action === 'list_scrapbook') {
      const query = String(actionObj?.query || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(20, Number(actionObj?.limit || 8)));
      const items = (Array.isArray(scrapbook) ? scrapbook : []).filter(item => {
        if (!query) return true;
        const title = String(item?.title || '').toLowerCase();
        const content = String(item?.content || '').toLowerCase();
        const tags = Array.isArray(item?.tags) ? item.tags.join(',').toLowerCase() : '';
        return title.includes(query) || content.includes(query) || tags.includes(query);
      }).slice(0, limit);
      if (items.length === 0) return '未找到匹配的笔记记录。';
      return items.map((item, i) => `#${i + 1} id=${item.id} 标题=${item.title || '未命名'} 标签=${(item.tags || []).join(',') || '无'}`).join('\n');
    }
    if (action === 'create_scrapbook') {
      const title = String(actionObj?.title || '').trim();
      const content = String(actionObj?.content ?? '');
      if (!title) return 'create_scrapbook 需要非空 title（笔记标题）。';
      const tags = Array.isArray(actionObj?.tags)
        ? actionObj.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
      const newId = Date.now();
      setScrapbook((prev) => [{ id: newId, title, content, tags, image: null }, ...(Array.isArray(prev) ? prev : [])]);
      return `笔记已新建：id=${newId} 标题=${title} 标签=${tags.join(',') || '无'}`;
    }
    if (action === 'update_scrapbook') {
      const targetId = actionObj?.id;
      const targetTitle = String(actionObj?.titleMatch || '').trim();
      let updated = null;
      setScrapbook(prev => (Array.isArray(prev) ? prev : []).map(item => {
        const idMatch = targetId != null && String(item.id) === String(targetId);
        const titleMatch = targetTitle && String(item.title || '').includes(targetTitle);
        if (!idMatch && !titleMatch) return item;
        const nextTags = Array.isArray(actionObj?.tags) ? actionObj.tags.map(t => String(t).trim()).filter(Boolean) : item.tags;
        updated = {
          ...item,
          ...(actionObj?.title != null ? { title: String(actionObj.title) } : {}),
          ...(actionObj?.content != null ? { content: String(actionObj.content) } : {}),
          ...(actionObj?.tags != null ? { tags: nextTags } : {}),
        };
        return updated;
      }));
      if (!updated) return '未找到要更新的笔记（请提供 id 或 titleMatch）。';
      return `笔记已更新：id=${updated.id} 标题=${updated.title || '未命名'}`;
    }
    if (action === 'list_gallery_images') {
      const targetChar = findCharacterByName(actionObj?.characterName) || activeChar;
      if (!targetChar) return '未找到目标角色。';
      const query = String(actionObj?.query || '').trim().toLowerCase();
      const untitledOnly = actionObj?.untitledOnly === true;
      const limit = Math.max(1, Math.min(50, Number(actionObj?.limit || 20)));
      const imgs = Array.isArray(targetChar.storyImgs) ? targetChar.storyImgs : [];
      const rows = imgs
        .map((item, idx) => {
          const title = String(item?.name || item?.caption || '').trim();
          const description = String(item?.description || '').trim();
          const isUntitled = isLikelyUntitledCaption(title);
          return {
            idx,
            caption: title || '无题',
            description,
            src: String(item?.src || ''),
            isUntitled
          };
        })
        .filter(row => {
          if (untitledOnly && !row.isUntitled) return false;
          if (!query) return true;
          return row.caption.toLowerCase().includes(query) || row.description.toLowerCase().includes(query) || row.src.toLowerCase().includes(query);
        })
        .slice(0, limit);
      if (rows.length === 0) {
        return `角色 ${targetChar.name} 未找到匹配图库图。`;
      }
      return [
        `角色=${targetChar.name} 图库总数=${imgs.length} 命中=${rows.length}`,
        ...rows.map((row, i) => `#${i + 1} imageIndex=${row.idx} 标题=${row.caption} 未命名=${row.isUntitled ? '是' : '否'} src=${row.src ? '[有]' : '[空]'}`)
      ].join('\n');
    }
    if (action === 'rename_gallery_caption') {
      const targetChar = findCharacterByName(actionObj?.characterName) || activeChar;
      if (!targetChar) return '未找到目标角色。';
      const imageIndex = Number(actionObj?.imageIndex);
      if (!Number.isInteger(imageIndex) || imageIndex < 0) return 'imageIndex 非法。';
      const newCaption = String(actionObj?.caption || '').trim();
      if (!newCaption) return 'caption 不能为空。';
      const targetList = Array.isArray(targetChar.storyImgs) ? targetChar.storyImgs : [];
      if (!targetList[imageIndex]) {
        const maxIdx = Math.max(0, targetList.length - 1);
        return `未找到角色 ${targetChar.name} 的第 ${imageIndex} 张图库（当前可用 index: 0-${maxIdx}）。`;
      }
      setCharacters(prev => (Array.isArray(prev) ? prev : []).map(char => {
        if (char?.id !== targetChar.id) return char;
        const list = normalizeStoryImgList(char.storyImgs || []);
        list[imageIndex] = { ...list[imageIndex], name: newCaption, caption: newCaption };
        return { ...char, storyImgs: list };
      }));
      return `图库标题已更新：角色=${targetChar.name} index=${imageIndex} 标题=${newCaption}`;
    }
    return `暂不支持的 action: ${action}`;
  };

  /**
   * list_gallery_images 执行后的「第二环」：若可从列表结果 + 用户意图推断目标图库，自动插入带图用户消息并请求多模态，相当于代理多走一步。
   */
  const runGalleryVisionAfterListTool = async (msgsAfterTool) => {
    const lastMsg = msgsAfterTool[msgsAfterTool.length - 1];
    const lastText = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
    let inferred = null;
    if (lastText.includes('[工具执行结果]')) {
      inferred = parseListGalleryToolSingleHit(lastText.slice(lastText.indexOf('[工具执行结果]')));
    }
    if (!inferred) {
      const lastUser = [...msgsAfterTool].reverse().find((m) => m.role === 'user');
      const lastUserText = getUserMessagePlainText(lastUser) || '';
      inferred = inferGalleryAttachFromConversation(msgsAfterTool, lastUserText);
    }
    if (!inferred) return;
    const ch = findCharacterByName(inferred.characterName);
    const imgs = Array.isArray(ch?.storyImgs) ? ch.storyImgs : [];
    const resolvedIndex = resolveGalleryAttachSpecToIndex(imgs, inferred);
    const img = resolvedIndex >= 0 ? imgs[resolvedIndex] : null;
    if (!img?.src) {
      appendAssistantMessageToSession(activeSessionId, '[自动续步] 未能从列表结果载入图库图片，请核对角色与索引。');
      return;
    }
    if (!activeVisionEndpoint?.key) {
      appendAssistantMessageToSession(activeSessionId, '[系统] 已列出图库；未配置多模态 API，无法自动载入图片。请在设置中配置视觉模型。');
      return;
    }
    const safeUrl = await normalizeImageUrlForModel(img.src);
    const cap = String(img.name || img.caption || '').trim() || `第 ${resolvedIndex + 1} 张`;
    const validHistory = msgsAfterTool.filter((m) => {
      if (typeof m.content === 'string') {
        return !m.content.startsWith('[发生错误]') && !m.content.includes('已就绪') && !m.content.includes('===NOVELAI_RESULT===');
      }
      return true;
    });
    const finalSystemPrompt =
      lastResolvedSystemPrompt && String(lastResolvedSystemPrompt).trim()
        ? lastResolvedSystemPrompt
        : systemPrompt
            .replace('{CHAR}', '无预设角色（项目设定模式）')
            .replace('{OTHERS}', '')
            .replace('{SCRAPBOOK}', '');
    const hist = sliceChatHistoryForApi(validHistory, referenceConfig?.chatWindowMessages);
    const chainBodies = await Promise.all([
      ...hist.map((m) => normalizeMessageForEndpoint(m, true)),
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `【已自动从档案载入「${inferred.characterName}」图库 · 「${cap}」（imageIndex=${resolvedIndex}）】请结合用户上一条需求与对话历史继续。`
          },
          { type: 'image_url', image_url: { url: safeUrl } }
        ]
      }
    ]);
    const chainMsgs = [{ role: 'system', content: finalSystemPrompt }, ...chainBodies];
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 120000);
    let res2;
    try {
      res2 = await fetch(activeVisionEndpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeVisionEndpoint.key}` },
        body: JSON.stringify(mergeChatCompletionThinking(activeVisionEndpoint, { model: activeVisionEndpoint.model, messages: chainMsgs, temperature: 0.7 })),
        signal: ac.signal
      });
    } finally {
      clearTimeout(to);
    }
    if (!res2.ok) throw new Error(`多模态续请求 (${res2.status}): ${(await res2.text()).slice(0, 400)}`);
    const data2 = await res2.json();
    const reply2 = data2.choices?.[0]?.message?.content || '（无响应）';
    const label = `【已载入「${inferred.characterName}」·「${cap}」】`;
    const galleryInsertUserMsg = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `【已自动从档案载入「${inferred.characterName}」图库 · 「${cap}」（imageIndex=${resolvedIndex}）】`
        },
        { type: 'image_url', image_url: { url: safeUrl } }
      ]
    };
    patchActiveSession({
      messages: [...msgsAfterTool, galleryInsertUserMsg, { role: 'assistant', content: `${label}\n\n${reply2}` }]
    });
  };

  const executeToolActionFromMessage = async (msgIndex, actionObj) => {
    const key = normalizeToolActionKey(activeSessionId, msgIndex);
    if (toolActionStatus[key] === 'running') return;
    setToolActionStatus(prev => ({ ...prev, [key]: 'running' }));
    try {
      const result = await runAiToolAction(actionObj);
      const action = String(actionObj?.action || '').trim();
      const toolContent = `[工具执行结果]\n${result}`;
      let msgsAfterTool = null;
      setAiSessions((prev) => {
        const s = prev.find((x) => x.id === activeSessionId);
        if (!s) return prev;
        msgsAfterTool = [...(s.messages || []), { role: 'assistant', content: toolContent }];
        return prev.map((x) =>
          x.id === activeSessionId ? { ...x, messages: msgsAfterTool, ...mergeSessionMeta(msgsAfterTool) } : x
        );
      });
      if (action === 'list_gallery_images' && msgsAfterTool) {
        setIsChatAiLoading(true);
        try {
          await runGalleryVisionAfterListTool(msgsAfterTool);
        } catch (e) {
          appendAssistantMessageToSession(activeSessionId, `[自动载入图库失败] ${e.message}`);
        } finally {
          setIsChatAiLoading(false);
        }
      }
      setToolActionStatus((prev) => ({ ...prev, [key]: 'done' }));
    } catch (e) {
      appendAssistantMessageToSession(activeSessionId, `[工具执行失败] ${e.message}`);
      setToolActionStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
  };
  const rejectToolActionFromMessage = (msgIndex) => {
    const key = normalizeToolActionKey(activeSessionId, msgIndex);
    setToolActionStatus(prev => ({ ...prev, [key]: 'rejected' }));
    appendAssistantMessageToSession(activeSessionId, '[工具执行已拒绝] 已保留原数据，不做改动。');
  };

  const changeStoryImage = (direction) => {
    const imgs = activeChar?.storyImgs || [];
    if (imgs.length <= 1) return;
    setStoryIndex(prev => { let next = prev + direction; if (next >= imgs.length) next = 0; if (next < 0) next = imgs.length - 1; return next; });
  };
  const clearStoryImages = () => { if (confirm('确定清空所有图库插图吗？')) updateCharacter('storyImgs', []); };
  const deleteCurrentStoryImage = (e) => {
    e.stopPropagation();
    const imgs = activeChar?.storyImgs || [];
    if (imgs.length === 0) return;
    if (confirm('确定要删除当前这张插图吗？')) {
      setCharacters(prev => (Array.isArray(prev) ? prev : []).map((char, i) => {
        if (i !== activeIndex) return char;
        const nextList = (char.storyImgs || []).filter((_, idx) => idx !== storyIndex);
        return { ...char, storyImgs: normalizeStoryImgList(nextList) };
      }));
      setStoryIndex(prev => Math.max(0, Math.min(prev, imgs.length - 2)));
    }
  };

  const processFile = (file, type) => {
    if (file.size > 3 * 1024 * 1024) alert('图片较大，推荐压缩后导入。');
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result;
      if (type === 'global_bg') setGlobalBackground(res);
      else if (type === 'char_img') updateCharacter('image', res);
      else if (type === 'char_bg') updateCharacter('background', res);
      else if (type === 'combat_img') updateCharacter('combatImg', res);
      else if (type === 'story_img') {
        setCharacters(prev => (Array.isArray(prev) ? prev : []).map((char, i) => {
          if (i !== activeIndex) return char;
          const list = normalizeStoryImgList(char.storyImgs || []);
          const next = [...list, {
            seq: list.length + 1,
            name: '点击输入标题',
            caption: '点击输入标题',
            src: res,
            description: '',
          }];
          return { ...char, storyImgs: normalizeStoryImgList(next) };
        }));
        setTimeout(() => setStoryIndex((activeChar.storyImgs || []).length), 100);
      } else if (type === 'scrapbook_new') {
        setScrapbook(prev => [{ id: Date.now(), title: '新灵感', content: '', image: res, tags: [] }, ...(Array.isArray(prev) ? prev : [])]);
      } else if (type === 'scrapbook_update') {
        setScrapbook(prev => (Array.isArray(prev) ? prev : []).map(item => item.id === activeScrapbookId ? { ...item, image: res } : item));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e, type) => { const file = e.target.files[0]; if (!file) return; processFile(file, type); e.target.value = ''; };
  const handleAiImageUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setAiInputImage(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleDragOver = (e) => { e.preventDefault(); if (isEditMode) setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    if (!isEditMode) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0 && files[0].type.startsWith('image/')) {
      const type = appMode === 'scrapbook' ? 'scrapbook_new' : (viewMode === 'portrait' ? 'char_img' : (viewMode === 'combat' ? 'combat_img' : 'story_img'));
      processFile(files[0], type);
    }
  };
  const triggerUpload = () => {
    if (viewMode === 'portrait') fileInputRef.current.click();
    else if (viewMode === 'combat') combatInputRef.current.click();
    else if (viewMode === 'story') storyInputRef.current.click();
  };
  const exportData = () => {
    (async () => {
      try {
        const res = await fetch('/api/versions');
        if (!res.ok) throw new Error('无法读取版本列表');
        const data = await res.json();
        const versions = (data.versions || []).map(v => v.id);
        if (versions.length === 0) { alert('暂无版本快照，请先点“保存为新版本”。'); return; }
        const versionId = prompt(`输入要下载的版本号（默认最新）:\n${versions.slice(0, 12).join('\n')}`, versions[0]) || versions[0];
        window.open(`/api/version/download?versionId=${encodeURIComponent(versionId)}`, '_blank');
      } catch (e) {
        alert(`下载版本失败：${e.message}`);
      }
    })();
  };

  const exportCharacters = () => {
    const HEXAGRAM_LABELS = ['项一', '项二', '项三', '项四', '项五', '项六'];
    const payload = (Array.isArray(characters) ? characters : []).map(char => ({
      name: char.name,
      title: char.title,
      theme: char.theme,
      details: char.details,
      hexagram: Array.isArray(char.hexagram)
        ? Object.fromEntries(char.hexagram.map((v, i) => [HEXAGRAM_LABELS[i], v]))
        : {},
      lore: char.lore,
      combatDesc: char.combatDesc,
      combatPoem: char.combatPoem,
      combatVerses: char.combatVerses,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '\u89d2\u8272\u8bbe\u5b9a_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportScrapbook = () => {
    const payload = (Array.isArray(scrapbook) ? scrapbook : []).map(item => ({
      title: item.title,
      tags: item.tags,
      content: item.content,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '\u624b\u672d_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadVersionSnapshot = async () => {
    try {
      const res = await fetch('/api/versions');
      if (!res.ok) throw new Error('无法读取版本列表');
      const data = await res.json();
      const versions = (data.versions || []).map(v => v.id);
      if (versions.length === 0) { alert('暂无版本快照，请先点“保存为新版本”。'); return; }
      const versionId = prompt(`输入要加载的版本号（默认最新）:\n${versions.slice(0, 12).join('\n')}`, versions[0]);
      if (!versionId) return;
      if (!confirm(`确定加载版本 ${versionId} 吗？当前未保存改动会丢失。`)) return;
      const loadRes = await fetch('/api/version/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: versionId.trim() })
      });
      const loaded = await loadRes.json();
      if (!loadRes.ok || !loaded?.data) throw new Error(loaded?.error || '加载失败');
      const d = loaded.data;
      setCharacters(sanitizeCharacters(d.characters));
      setGlobalBackground(d.globalBackground || null);
      setScrapbook(sanitizeScrapbook(d.scrapbook));
      setNovel(d.novel || { title: '未命名正文', content: '', updatedAt: 0 });
      if (d.ragConfig) setRagConfig((prev) => {
        const merged = { ...prev, ...d.ragConfig };
        delete merged.topK;
        return merged;
      });
      if (d.referenceConfig) setReferenceConfig(normalizeReferenceConfig(d.referenceConfig));
      const s = sanitizeAiSessions(d.aiSessions, d.aiChats, sanitizeCharacters(d.characters || []));
      setAiSessions(s);
      setActiveSessionId(s[0].id);
      alert(`已加载版本：${versionId}`);
    } catch (e) {
      alert(`加载版本失败：${e.message}`);
    }
  };
  const importData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.characters) {
          setCharacters(sanitizeCharacters(d.characters));
          if (d.globalBackground) setGlobalBackground(d.globalBackground);
          if (d.scrapbook) setScrapbook(sanitizeScrapbook(d.scrapbook));
          if (d.novel) setNovel(d.novel);
          if (d.ragConfig) setRagConfig((prev) => {
            const merged = { ...prev, ...d.ragConfig };
            delete merged.topK;
            return merged;
          });
          if (d.referenceConfig) setReferenceConfig(normalizeReferenceConfig(d.referenceConfig));
          if (d.aiSessions) {
            const s = sanitizeAiSessions(d.aiSessions, d.aiChats, sanitizeCharacters(d.characters || []));
            setAiSessions(s);
            setActiveSessionId(s[0].id);
          }
          alert('JSON 导入成功！建议按 Ctrl+S 保存。');
        }
      } catch (e) { alert('格式错误'); }
    };
    reader.readAsText(file); e.target.value = '';
  };
  const saveAiEndpoints = (ep) => {
    const normalized = normalizeEndpoints(ep);
    setAiEndpoints(normalized);
    localStorage.setItem('celestial_ai_endpoints', JSON.stringify(normalized));
  };
  const saveActiveEndpoint = (id, mode = 'text') => {
    if (mode === 'multimodal') {
      setActiveVisionEndpointId(id);
      localStorage.setItem('celestial_ai_active_vision_endpoint', id);
    } else {
      setActiveEndpointId(id);
      localStorage.setItem('celestial_ai_active_endpoint', id);
    }
    setShowModelDropdown(false);
  };
  const saveNaiConfig = () => {
    localStorage.setItem('celestial_nai_config_v8', JSON.stringify(naiConfig));
    localStorage.setItem('celestial_system_prompt', systemPrompt);
    localStorage.setItem('celestial_nai_tag_prompt', naiTagPrompt);
    localStorage.setItem('celestial_idea_cultivate_prompt', ideaCultivatePrompt);
    localStorage.setItem('celestial_rag_config_v1', JSON.stringify(ragConfig));
    localStorage.setItem('celestial_reference_config_v1', JSON.stringify(referenceConfig));
    setShowAiSettings(false);
  };
  const handleRebuildRag = async () => {
    try {
      const res = await fetch('/api/rag/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ragConfig })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      alert(
        `RAG 重建完成：共 ${data.docs || 0} 条（设定 ${data.settingDocs || 0} / 小说 ${data.novelDocs || 0} / 摘要 ${data.summaryDocs || 0}）\n`
        + `向量状态：${data.embedded ? '已启用' : '未启用（关键词检索兜底）'}\n`
        + `失败分片：设定 ${data.failedSettingEmbeddings || 0} / 小说 ${data.failedNovelEmbeddings || 0}`
      );
    } catch (e) {
      alert(`RAG 重建失败：${e.message}`);
    }
  };

  const handleCreateSession = () => {
    const s = createNewSession();
    setAiSessions([s, ...aiSessions]);
    setActiveSessionId(s.id);
  };
  const handleCreateInspirationSession = () => {
    const s = createInspirationSession();
    setAiSessions([s, ...aiSessions]);
    setActiveSessionId(s.id);
  };
  const handleBackFromInspiration = () => {
    const nonInsp = aiSessions.find((x) => x.mode !== 'inspiration');
    if (nonInsp) setActiveSessionId(nonInsp.id);
    else {
      const s = createNewSession();
      setAiSessions([s, ...aiSessions]);
      setActiveSessionId(s.id);
    }
  };

  const handleInspirationPreviewUpdate = (payload) => {
    if (!payload) return;
    setLastContextPreview(payload.preview ?? null);
    setLastResolvedSystemPrompt(payload.fullPrompt ?? '');
  };
  const handleDeleteSession = (id, e) => {
    e.stopPropagation();
    if (aiSessions.length <= 1) { alert('至少保留一个会话。'); return; }
    if (confirm('确定删除这个对话记忆吗？')) {
      const filtered = aiSessions.filter(s => s.id !== id);
      setAiSessions(filtered); if (activeSessionId === id) setActiveSessionId(filtered[0].id);
    }
  };
  const handleRenameSession = (id, e) => {
    e?.stopPropagation?.();
    const target = aiSessions.find(s => s.id === id);
    if (!target) return;
    const nextTitle = prompt('请输入新的对话标题：', target.title || '新对话');
    if (nextTitle === null) return;
    const finalTitle = nextTitle.trim() || '新对话';
    setAiSessions(prev => prev.map(s => s.id === id ? { ...s, title: finalTitle } : s));
  };
  const updateCurrentSession = (msgs) => patchActiveSession({ messages: msgs });
  const clearAiChats = () => {
    if (!confirm('确定要清空当前会话的聊天记录吗？')) return;
    setLastContextPreview(null);
    setLastResolvedSystemPrompt('');
    if (activeSession?.mode === 'inspiration') {
      patchActiveSession({ messages: [], inspirationChunkMap: {}, inspirationFirstSeed: '' });
    } else {
      patchActiveSession({ messages: [{ role: 'assistant', content: '仙灵助手已就绪。' }] });
    }
  };
  const generateTitle = async (sessionId, firstUserMsg, endpoint) => {
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${endpoint.key}` },
        body: JSON.stringify(
          mergeChatCompletionThinking(endpoint, {
            model: endpoint.model,
            messages: [{ role: 'user', content: `请2到46个字总结下面这段话的核心议题作为对话标题（不要标点）：\n${firstUserMsg}` }],
            temperature: 0.3
          })
        )
      });
      if (res.ok) {
        const data = await res.json();
        const title = data.choices?.[0]?.message?.content?.trim().replace(/['"“”。]/g, '') || '新灵感探讨';
        setAiSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s));
      }
    } catch (e) { console.error('标题生成失败', e); }
  };

  const { handleDrawImage, handleRerollImage } = useNaiGeneration({
    activeSession,
    activeSessionId,
    aiInputText,
    setAiInputText,
    aiInputImage,
    isChatAiLoading,
    setIsChatAiLoading,
    naiConfig,
    activeTextEndpoint,
    naiTagPrompt,
    referenceConfig,
    ragConfig,
    setShowAiSettings,
    resolveSessionCharacter,
    updateCurrentSession,
    generateTitle,
    setAiSessions,
    mergeSessionMeta,
    fetchRagForSimpleTool,
    buildRagQuery,
    buildNaiPayloadByPrompt,
    requestNovelAiImage,
    persistGeneratedImage,
    drawBatchMode: aiDrawBatchMode,
    safeCharacters,
    batchImageAbortRef,
    onMultiImageRunChange: setIsMultiImageDraw,
    onImageRequestStatusChange: setImageRequestStatus,
  });

  const handleSaveIdeaToScrapbook = (payload) => {
    const tags = parseTagsText(payload?.tagsText || '');
    setScrapbook((prev) => [
      {
        id: Date.now(),
        title: (payload?.title || '新灵感').trim(),
        content: (payload?.text || '').trim(),
        image: null,
        tags
      },
      ...(Array.isArray(prev) ? prev : [])
    ]);
    setAppMode('scrapbook');
    setIsEditMode(true);
    alert('已加入笔记，可继续手动微调。');
  };

  const handleAiSendMessage = async () => {
    if (activeSession?.mode === 'inspiration') return;
    if ((!aiInputText.trim() && !aiInputImage) || isChatAiLoading) return;
    const resolvedChar = resolveSessionCharacter(activeSession);
    const isFirstUserMsg = activeSession.messages.length === 1;
    const newUserMsg = aiInputImage
      ? { role: 'user', content: [{ type: 'text', text: aiInputText.trim() || '请分析这张图' }, { type: 'image_url', image_url: { url: aiInputImage } }] }
      : { role: 'user', content: aiInputText };
    const newMessages = [...activeSession.messages, newUserMsg];
    const hasImageContext = newMessages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url' && p?.image_url?.url)
    );
    const useMultimodal = hasImageContext;
    const targetEndpoint = useMultimodal ? activeVisionEndpoint : activeTextEndpoint;
    if (!targetEndpoint?.key) {
      alert(useMultimodal ? '该会话包含图片，将使用多模态模型；请先在设置中配置多模态 API 节点。' : '请先配置文本模型 API Key！');
      setShowAiSettings(true);
      return;
    }
    updateCurrentSession(newMessages);
    const titleContent = aiInputText.trim() || '新议题探讨';
    setAiInputText(''); setAiInputImage(null); setIsChatAiLoading(true);
    const titleEndpoint = useMultimodal ? activeVisionEndpoint : activeTextEndpoint;
    if (isFirstUserMsg && titleEndpoint?.key) generateTitle(activeSessionId, titleContent, titleEndpoint);
    try {
      const validHistory = newMessages.filter(m => {
        if (typeof m.content === 'string') return !m.content.startsWith('[发生错误]') && !m.content.includes('已就绪') && !m.content.includes('===NOVELAI_RESULT===');
        return true;
      });
      const charNames = safeCharacters.map(c => c.name).join(', ');
      const { scrapbookTitles, requiredTags, selectedScrapbook, scrapbookContext } = buildTaggedScrapbookContext(scrapbook, safeCharacters, resolvedChar, validHistory, activeSession);
      const useStruct = !!referenceConfig?.useStructuredContext;
      const resolvedSystemPrompt = systemPrompt
        .replace('{CHAR}', '无预设角色（项目设定模式）')
        .replace('{OTHERS}', useStruct ? charNames : '')
        .replace('{SCRAPBOOK}', useStruct ? scrapbookTitles : '');
      // 对话中提及的角色设定始终解析；按标签注入笔记仅由「结构化参考」控制
      const historyText = validHistory.map(m => getReadableText(m.content) || '').join('\n');
      const mentionedChars = extractMentionedCharacters(historyText, safeCharacters);
      const charSettingContext = buildCharacterSettingContext(mentionedChars);

      const chatRag = referenceConfig?.chatRagCounts || { novel: 4, scrapbook: 4, summary: 4 };
      const rag = referenceConfig?.useRagContext
        ? await fetchRagForSimpleTool(
            buildRagQuery({
              input: titleContent || '',
              historyMessages: validHistory,
              resolvedChar,
              requiredTags,
              historyMaxMessages: referenceConfig?.chatRagHistoryMessages,
              historyMaxChars: referenceConfig?.chatRagHistoryMaxChars,
              userMessageOnly: referenceConfig?.chatRagUserMessageOnly,
            }),
            ragConfig,
            chatRag,
            []
          )
        : { context: '', refs: [], novelRefs: [], scrapbookRefs: [], summaryRefs: [] };
      const finalSystemPrompt = resolvedSystemPrompt
        + (charSettingContext ? `\n\n===MENTIONED_CHARACTERS===\n${charSettingContext}\n============================` : '')
        + (useStruct && scrapbookContext ? `\n\n===TAGGED_SCRAPBOOK_CONTEXT===\n${scrapbookContext}\n==============================` : '')
        + (referenceConfig?.useRagContext && rag.context ? `\n\n===RAG_CONTEXT===\n${rag.context}\n================` : '')
        + `\n\n===GALLERY_AUTO_ATTACH===\n当用户要**看到**某张图库才能继续（配字、描述、讨论）时，你必须在回复中输出以下块（可另写一句简短承接语）。客户端会自动载入图片并走多模态。\n===ATTACH_GALLERY_IMAGE===\n{"characterName":"示例角色","imageTitle":"示例图片"}\n=============\n**重要**：若用户用「图片名/标题」称呼，必须用 **imageTitle** 填该标题（与档案里图库 caption 一致或子串），**禁止**默认 imageNumber:1。仅当用户明确说「第N张」时才用 imageNumber（从1起）或 imageIndex（从0起）。\n用户说「调出来」「发出来」「就这张」且上文已约定某张图时，**必须**再次输出本块（可沿用同一 imageTitle），禁止只回复文字而不输出块。\n**list_gallery_images 工具只返回文字索引；客户端在用户点击「执行」后会自动尝试再跑一轮多模态载入（与推断条件一致时）。** 若自动载入未触发，你仍须输出上面的 ATTACH 块（imageTitle 或 imageIndex），禁止只写「已为您调出」而无此块。\n若用户本条已贴图或本会话用户消息里已有图，不要输出此块。无法确定时先追问。\n`
        + `\n===VISION_CHAT===\n本会话中只要出现过「用户消息含图片」，后续请求会自动使用多模态模型。图库命名、读图、讨论标题请在对话里完成（可贴图），不要输出 TOOL_ACTION 来做看图起名。仅当用户明确要「把某标题写入图库」时，再提议 rename_gallery_caption。\n`
        + `\n===TOOL_PROTOCOL===
当用户明确要求“读取/修改项目数据”时，你可以提议一个工具动作（一次只提议一个）：
${AI_TOOL_ACTION_START}
{"action":"list_scrapbook","query":"关键词","limit":8}
${AI_TOOL_ACTION_END}
（字段与 action **同级**；勿单独包一层 "params"。若误包，客户端会尝试展平。）
可用 action（只读 1–7；笔记 8–10；图库 11–12）：
1) list_novel_chapters -> 列出当前正文章节标题与字数（@@chapter: 分段）
2) get_novel_chapter -> 参数: chapterIndex(从1起) 或 titleContains；可选 maxChars
3) search_novel -> 参数: query；可选 maxHits, contextChars, caseInsensitive
4) rag_search -> 参数: query；可选 type(all|novel|scrapbook|novel_summary), topK, excludeIds
5) list_characters -> 参数: query?（按姓名/标题/lore 子串过滤）
6) get_character -> 参数: id 或 characterName；可选 fields 数组只取部分字段。**档案字段 combatVerses 即界面「环绕短句」**（展示 3D 多行战斗台词）。用户问「环绕短句」「战斗环绕句」或要核对 combatVerses 时，须用本 action 读取（勿只靠 lore/combatPoem 猜测）。
7) get_scrapbook -> 参数: id 或 titleMatch（读取单条笔记全文，只读）
8) list_scrapbook -> 参数: query?, limit?
9) create_scrapbook -> **新建一条笔记**；参数: title（必填）, content?, tags?（数组）。用户要「写入/保存到笔记」且尚无 id 时用本项，**勿用** update 冒充新建。
10) update_scrapbook -> **仅改已有条目**；先 list_scrapbook / get_scrapbook 取 id；参数: id **或** titleMatch（用于**查找**的子串，不是整篇新标题）, 再可选 title（改标题）, content?, tags?
11) list_gallery_images -> 参数: characterName?, query?, untitledOnly?, limit?。**query 按图库标题 caption 子串过滤**（用户说「名叫某某的图库」时把某某放进 query）。结果仅有索引与标题，**不能**据此「看见」像素；用户要你看图/描述画面时，列出后须再输出 ===ATTACH_GALLERY_IMAGE===（见 GALLERY_AUTO_ATTACH）。
12) rename_gallery_caption -> 仅在对话中已商定标题后，写入图库；参数: characterName?, imageIndex, caption（不要用本工具讨论命名）
若无需工具，请正常回答，不要输出 TOOL_ACTION 块。
================`;
      setLastResolvedSystemPrompt(finalSystemPrompt);
      setLastContextPreview(
        buildChatContextPreview({
          referenceConfig,
          mentionedChars,
          selectedScrapbook,
          rag,
          requiredTags,
          sessionId: activeSessionId,
        })
      );
      const safeMsgs = await Promise.all(
        sliceChatHistoryForApi(validHistory, referenceConfig?.chatWindowMessages).map((m) =>
          normalizeMessageForEndpoint(m, useMultimodal)
        )
      );

      safeMsgs.unshift({ role: 'system', content: finalSystemPrompt });
      const res = await fetch(targetEndpoint.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${targetEndpoint.key}` },
        body: JSON.stringify(mergeChatCompletionThinking(targetEndpoint, { model: targetEndpoint.model, messages: safeMsgs, temperature: 0.7 }))
      });
      if (!res.ok) throw new Error(`请求失败 (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || '（无响应）';

      let assistantContent = reply;
      let galleryInsertUserMsg = null;
      let attachSpec = parseAttachGalleryImageBlock(reply);
      if (!attachSpec && !useMultimodal && activeVisionEndpoint?.key) {
        const inferred = inferGalleryAttachFromConversation(
          validHistory,
          getUserMessagePlainText(validHistory[validHistory.length - 1])
        );
        if (inferred) {
          attachSpec = {
            characterName: inferred.characterName,
            resolvedIndex: inferred.imageIndex,
            imageTitle: inferred.imageTitle
          };
        }
      }
      if (attachSpec && !useMultimodal && activeVisionEndpoint?.key) {
        const ch = findCharacterByName(attachSpec.characterName);
        const imgs = Array.isArray(ch?.storyImgs) ? ch.storyImgs : [];
        const resolvedIndex = resolveGalleryAttachSpecToIndex(imgs, attachSpec);
        const img = resolvedIndex >= 0 ? imgs[resolvedIndex] : null;
        if (img?.src) {
          try {
            const safeUrl = await normalizeImageUrlForModel(img.src);
            const hist = sliceChatHistoryForApi(validHistory, referenceConfig?.chatWindowMessages);
            const lastUserText = getUserMessagePlainText(hist[hist.length - 1]) || '请根据上图继续。';
            const withoutLast = hist.slice(0, -1);
            const cap = String(img.name || img.caption || '').trim() || `第 ${resolvedIndex + 1} 张`;
            galleryInsertUserMsg = {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `【已自动从档案载入「${attachSpec.characterName}」图库 · 「${cap}」（imageIndex=${resolvedIndex}）】`
                },
                { type: 'image_url', image_url: { url: safeUrl } }
              ]
            };
            const chainBodies = await Promise.all([
              ...withoutLast.map((m) => normalizeMessageForEndpoint(m, true)),
              {
                role: 'user',
                content: [
                  { type: 'text', text: lastUserText },
                  { type: 'image_url', image_url: { url: safeUrl } }
                ]
              }
            ]);
            const chainMsgs = [{ role: 'system', content: finalSystemPrompt }, ...chainBodies];
            const res2 = await fetch(activeVisionEndpoint.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeVisionEndpoint.key}` },
              body: JSON.stringify(mergeChatCompletionThinking(activeVisionEndpoint, { model: activeVisionEndpoint.model, messages: chainMsgs, temperature: 0.7 }))
            });
            if (!res2.ok) throw new Error(`多模态续请求 (${res2.status}): ${(await res2.text()).slice(0, 400)}`);
            const data2 = await res2.json();
            const reply2 = data2.choices?.[0]?.message?.content || '（无响应）';
            const r1 = stripAttachGalleryImageBlock(reply).trim();
            const label = `【已载入「${attachSpec.characterName}」·「${cap}」】`;
            assistantContent = r1 ? `${r1}\n\n${label}\n\n${reply2}` : `${label}\n\n${reply2}`;
          } catch (chainErr) {
            galleryInsertUserMsg = null;
            assistantContent = `${stripAttachGalleryImageBlock(reply)}\n\n[自动载入图库失败] ${chainErr.message}`;
          }
        } else {
          assistantContent = `${stripAttachGalleryImageBlock(reply)}\n\n[未找到该图库图] 请核对角色名；用图片名时请写 imageTitle，或先 list_gallery_images 核对 imageIndex。`;
        }
      } else if (attachSpec && !useMultimodal && !activeVisionEndpoint?.key) {
        assistantContent = `${stripAttachGalleryImageBlock(reply)}\n\n[系统] 未配置多模态 API，无法自动载入图库。请在设置中配置「视觉模型」节点。`;
      } else if (attachSpec && useMultimodal) {
        assistantContent = stripAttachGalleryImageBlock(reply);
      }

      updateCurrentSession([
        ...newMessages,
        ...(galleryInsertUserMsg ? [galleryInsertUserMsg] : []),
        { role: 'assistant', content: assistantContent }
      ]);
    } catch (e) {
      updateCurrentSession([...newMessages, { role: 'assistant', content: `[发生错误] ${e.message}` }]);
    } finally { setIsChatAiLoading(false); }
  };

  const renderSafeContent = (content) => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (
        <div className="flex flex-col gap-2">
          {content.find(c => c.type === 'image_url') ? (
            <img src={content.find(c => c.type === 'image_url').image_url.url} alt="upload" className="max-w-full rounded-md max-h-48 object-cover border border-white/20" />
          ) : null}
          <span>{content.find(c => c.type === 'text')?.text || ''}</span>
        </div>
      );
    }
    return <pre className="text-xs break-all">{JSON.stringify(content, null, 2)}</pre>;
  };

  const renderAiMessage = (content, msgIndex = -1) => {
    if (!content) return null;
    if (typeof content !== 'string') return renderSafeContent(content);

    const cleanContent = stripAttachGalleryImageBlock(stripAgentTrace(content));

    const toolAction = parseToolActionMessage(cleanContent);
    if (toolAction) {
      const textPart = stripToolActionBlock(cleanContent);
      const key = normalizeToolActionKey(activeSessionId, msgIndex);
      const status = toolActionStatus[key] || 'idle';
      const isBusy = status === 'running';
      const isDone = status === 'done' || status === 'rejected';
      return (
        <div className="flex flex-col gap-2">
          {textPart ? <div className="whitespace-pre-wrap">{textPart}</div> : null}
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl">
            <div className="text-[10px] font-black text-sky-700 tracking-widest uppercase mb-2">AI 工具提议</div>
            <pre className="text-[11px] text-slate-700 whitespace-pre-wrap break-all">{JSON.stringify(toolAction, null, 2)}</pre>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => executeToolActionFromMessage(msgIndex, toolAction)}
                disabled={isBusy || isDone}
                className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors"
              >
                {isBusy ? '执行中...' : (status === 'done' ? '已执行' : '执行')}
              </button>
              <button
                onClick={() => rejectToolActionFromMessage(msgIndex)}
                disabled={isBusy || isDone}
                className="flex-1 py-1.5 bg-white border border-slate-300 hover:border-red-300 hover:text-red-600 disabled:opacity-50 rounded text-xs font-bold transition-colors"
              >
                {status === 'rejected' ? '已拒绝' : '拒绝'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    const ideaDraft = parseIdeaDraftMessage(cleanContent);
    if (ideaDraft) {
      return (
        <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl text-sm text-stone-700 space-y-2 max-w-xl">
          <div className="text-[10px] font-bold text-amber-800/80 uppercase tracking-widest">历史灵感草稿（已迁入灵感交流室）</div>
          <div className="font-bold text-stone-900">{ideaDraft.title}</div>
          <div className="whitespace-pre-wrap leading-relaxed">{ideaDraft.text}</div>
          {ideaDraft.question ? <div className="text-xs text-stone-500">追问：{ideaDraft.question}</div> : null}
        </div>
      );
    }

    const naiMatch = cleanContent.match(/===NOVELAI_RESULT===\s*([\s\S]*?)(?:=============|$)/);
    if (naiMatch) {
      const imgUrl = naiMatch[1].trim();
      const textBefore = cleanContent.split('===NOVELAI_RESULT===')[0].trim();
      const meta = extractNovelAiMeta(cleanContent);
      const rerollPrompt = meta?.prompt || '';
      const referenceImage = meta?.referenceImage || null;
      return (
        <div className="flex flex-col gap-2 w-full max-w-sm">
          {textBefore && (
            <details className="mb-1">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 font-bold select-none">展开/收起 生成提示词</summary>
              <div className="mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 font-mono whitespace-pre-wrap break-all">{textBefore}</div>
            </details>
          )}
          <div className="flex items-center gap-1.5 text-xs text-purple-600 font-bold mb-1">画师已交付作品</div>
          <img src={imgUrl} alt="Generated" className="w-full h-auto rounded-xl shadow-md border border-slate-200" />
          <div className="flex gap-2 mt-1">
            <button onClick={() => { updateCharacter?.('image', imgUrl); alert('已设为立绘！'); }} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition-colors">设为立绘</button>
            <button onClick={() => {
              const list = normalizeStoryImgList(activeChar?.storyImgs || []);
              const next = [...list, {
                seq: list.length + 1,
                name: '新插图',
                caption: '新插图',
                src: imgUrl,
                description: '',
              }];
              updateCharacter?.('storyImgs', normalizeStoryImgList(next));
              alert('已加入图库！');
            }} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-colors">加入图库</button>
          </div>
          <button
            onClick={() => handleRerollImage?.(rerollPrompt, referenceImage)}
            disabled={!rerollPrompt || isChatAiLoading}
            className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors"
            title={rerollPrompt ? '使用同一提示词重新生成（随机种子）' : '该图片消息缺少提示词元信息'}
          >
            同参数再生一张（含参考图）
          </button>
        </div>
      );
    }

    const retryMatch = cleanContent.match(/===NOVELAI_RETRY===\s*([\s\S]*?)(?:=============|$)/);
    if (retryMatch) {
      const textPart = cleanContent.split('===NOVELAI_RETRY===')[0].trim();
      try {
        const retryData = JSON.parse(retryMatch[1].trim());
        return (
          <div className="flex flex-col gap-2">
            <div className="whitespace-pre-wrap text-stone-600">{textPart}</div>
            <button
              onClick={() => handleRerollImage?.(retryData.prompt, retryData.referenceImage)}
              disabled={isChatAiLoading}
              className="mt-2 w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black tracking-widest flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
            >
              <RefreshCw size={14} className={isChatAiLoading ? 'animate-spin' : ''} /> 重新尝试生图
            </button>
          </div>
        );
      } catch (e) { return <div className="whitespace-pre-wrap">{cleanContent}</div>; }
    }

    const scrapMatch = cleanContent.match(/===SCRAPBOOK===\s*TITLE:\s*(.*?)\s*(?:TAGS:\s*(.*?)\s*)?CONTENT:([\s\S]*?)(?:=============|$)/);
    if (scrapMatch) {
      const textPart = cleanContent.replace(scrapMatch[0], '');
      const title = scrapMatch[1]?.trim() || '新灵感';
      const tagsStr = scrapMatch[2]?.trim() || '';
      const scrapContent = scrapMatch[3]?.trim() || '';
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      return (
        <div>
          {textPart && <div className="whitespace-pre-wrap mb-3">{textPart}</div>}
          <div className="p-3 bg-amber-50 border border-amber-200/60 rounded-xl shadow-sm">
            <div className="font-bold text-slate-800 text-base">{title}</div>
            <div className="text-xs text-slate-600 mt-1.5 line-clamp-3">{scrapContent}</div>
            <button onClick={() => {
              const resolvedChar = resolveSessionCharacter(activeSession);
              const roleTag = resolvedChar?.name ? `角色:${resolvedChar.name}` : '';
              const finalTags = tags.length > 0 ? tags : (roleTag ? [roleTag] : []);
              setScrapbookEditDialog({
                title: title,
                content: scrapContent,
                tags: finalTags,
                resolvedChar: resolvedChar
              });
            }} className="mt-3 w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold transition-colors">
              一键存入资料卡
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="whitespace-pre-wrap">{cleanContent}</div>
      </div>
    );
  };

  return (
    <div
      className="relative w-full h-screen overflow-hidden overscroll-none bg-[#f4f1ea] font-serif transition-colors duration-700"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onWheelCapture={(e) => {
        if (appMode === 'archive') {
          e.preventDefault();
        }
      }}
    >
      {/* Character transition animation is currently disabled. */}
      
      {isDragging && isEditMode && (
        <div className="absolute inset-4 z-[100] border-4 border-dashed border-blue-400 bg-blue-50/50 rounded-2xl flex items-center justify-center pointer-events-none backdrop-blur-sm">
          <div className="bg-white px-8 py-4 rounded-xl shadow-xl flex flex-col items-center gap-2">
            <Upload size={48} className="text-blue-500 animate-bounce" />
            <span className="text-blue-600 font-bold text-xl tracking-widest">释放以添加图片</span>
          </div>
        </div>
      )}
      <div className={`absolute inset-0 z-0 transition-colors duration-1000 opacity-50 pointer-events-none ${appMode === 'archive' ? (theme.isCustom ? '' : theme.bgGradient) : 'bg-gradient-to-br from-amber-50/80 to-stone-100/30'}`} style={archiveBgStyle}></div>
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none mix-blend-multiply" style={{backgroundImage: `url("https://www.transparenttextures.com/patterns/p6.png")`}}></div>
      <div className={`absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full blur-[80px] opacity-10 pointer-events-none transition-colors duration-1000 ${appMode === 'archive' ? (theme.isCustom ? '' : theme.bgDark) : 'bg-stone-600'}`} style={archiveGlowStyle}></div>
      <div className={`absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] rounded-full blur-[100px] opacity-10 pointer-events-none transition-colors duration-1000 ${appMode === 'archive' ? (theme.isCustom ? '' : theme.bgDark) : 'bg-stone-600'}`} style={archiveGlowStyle}></div>
      <div className="fixed top-6 right-6 z-40 flex items-center gap-2 bg-white/90 backdrop-blur-md p-1.5 rounded-full border border-slate-200 shadow-md opacity-80 hover:opacity-100">
        {isSaving ? <span className="text-xs text-blue-600 font-bold px-3 animate-pulse">保存中...</span> : !isDataLoaded ? <span className="text-xs text-amber-600 font-bold px-3 animate-pulse">核心加载中...</span> : lastSaveTime ? <span className="text-xs text-emerald-600 font-bold px-3 flex items-center gap-1"><Check size={14}/> {lastSaveTime}</span> : null}
        <button onClick={() => handleSave(false)} disabled={!isDataLoaded} className={`p-2 rounded-full transition-colors ${!isDataLoaded ? 'text-slate-300 cursor-not-allowed' : 'text-emerald-700 hover:bg-emerald-50'}`} title="覆盖保存 (Ctrl+S)"><Save size={18} /></button>
        <button onClick={() => handleSave(true)} disabled={!isDataLoaded} className={`p-2 rounded-full transition-colors ${!isDataLoaded ? 'text-slate-300 cursor-not-allowed' : 'text-blue-700 hover:bg-blue-50'}`} title="保存为新版本"><Copy size={18} /></button>
        <div className="w-px h-4 bg-slate-300 mx-1"></div>
        <button onClick={exportData} className="p-2 text-emerald-700 hover:bg-emerald-50 rounded-full transition-colors" title="下载版本快照(JSON)"><Download size={18} /></button>
        <button onClick={exportCharacters} className="p-2 text-sky-700 hover:bg-sky-50 rounded-full transition-colors" title="导出角色设定JSON"><User size={18} /></button>
        <button onClick={exportScrapbook} className="p-2 text-amber-700 hover:bg-amber-50 rounded-full transition-colors" title="导出笔记JSON"><Book size={18} /></button>
        <button onClick={loadVersionSnapshot} className="p-2 text-stone-600 hover:bg-stone-50 rounded-full transition-colors" title="加载版本快照"><Cloud size={18} /></button>
        <button onClick={() => importFileRef.current.click()} className="p-2 text-slate-600 hover:bg-slate-50 rounded-full transition-colors" title="导入JSON存档"><Upload size={18} /></button>
        <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={importData} />
        <button onClick={() => setIsEditMode(!isEditMode)} className={`p-2 rounded-full transition-colors ${isEditMode ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`} title="编辑模式"><Settings size={18} /></button>
      </div>
      <div className="relative z-30 flex flex-col w-full max-w-[1440px] mx-auto px-6 pt-6 pb-1">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <h1 className={`text-4xl font-black tracking-widest transition-colors duration-700 ${(viewMode === 'portrait' || viewMode === 'story') ? 'text-white drop-shadow-lg' : 'text-slate-900'}`} style={{ fontFamily: '"Noto Serif SC", serif' }}>{appTitle}</h1>
              <div className={`w-full h-0.5 mt-0.5 transition-colors duration-700 ${(viewMode === 'portrait' || viewMode === 'story') ? 'bg-white/80 shadow-md' : 'bg-slate-900'}`}></div>
            </div>
            <div className={`h-10 w-[1px] mx-1 transition-colors duration-700 ${(viewMode === 'portrait' || viewMode === 'story') ? 'bg-white/20' : 'bg-slate-300'}`}></div>
            <div className="flex flex-col">
              <span className={`text-xs tracking-[0.2em] uppercase transition-colors duration-700 ${(viewMode === 'portrait' || viewMode === 'story') ? 'text-white/70' : 'text-slate-500'}`}>Celestine</span>
              <span className={`text-xs tracking-[0.2em] uppercase transition-colors duration-700 ${(viewMode === 'portrait' || viewMode === 'story') ? 'text-white/70' : 'text-slate-500'}`}>Archive</span>
            </div>
            <div className="ml-8 flex items-center bg-slate-900/10 backdrop-blur-md border border-slate-200/60 rounded-2xl p-1 shadow-inner ring-1 ring-black/5">
              <button onClick={() => setAppMode('archive')} className={`px-6 py-2 rounded-xl text-xs font-black tracking-widest transition-all duration-500 ${appMode === 'archive' ? 'bg-slate-900 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'}`}>档案图鉴</button>
              <button onClick={() => setAppMode('scrapbook')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black tracking-widest transition-all duration-500 ${appMode === 'scrapbook' ? 'bg-amber-700 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'}`}>资料卡</button>
              <button onClick={() => setAppMode('novel')} className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black tracking-widest transition-all duration-500 ${appMode === 'novel' ? 'bg-indigo-700 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'}`}>正文编辑</button>
            </div>
          </div>
        </div>
        {appMode === 'archive' && (
          <div
            className="relative w-full h-[8.5rem] -mt-2 pt-1 pb-3 animate-fade-in overflow-visible"
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!safeCharacters.length) return;
              const dir = e.deltaY > 0 ? 1 : -1;
              setActiveIndex((prev) => {
                const total = safeCharacters.length;
                const next = (prev + dir + total) % total;
                if (next !== prev) setStoryIndex(0);
                return next;
              });
            }}
          >
            <div className="relative h-full overflow-visible">
              {safeCharacters.map((char, index) => {
                const total = safeCharacters.length;
                const rawOffset = index - activeIndex;
                const loopOffset = rawOffset > total / 2
                  ? rawOffset - total
                  : rawOffset < -total / 2
                    ? rawOffset + total
                    : rawOffset;
                const isVisible = total <= 9 || Math.abs(loopOffset) <= 4;
                if (!isVisible) return null;
                const isActive = loopOffset === 0;
                const charTheme = resolveTheme(char.theme);
                const activeCardStyle = charTheme?.isCustom ? {
                  backgroundColor: charTheme.styles?.bgColor,
                  borderColor: charTheme.styles?.borderColor,
                  color: charTheme.styles?.textColor
                } : undefined;
                const activeDotStyle = charTheme?.isCustom ? {
                  backgroundColor: charTheme.styles?.bgDark || charTheme.accent
                } : undefined;
                const x = loopOffset * 78;
                const y = Math.abs(loopOffset) * 1.2;
                const scale = isActive ? 1.15 : Math.max(0.8, 1 - Math.abs(loopOffset) * 0.05);
                const opacity = isActive ? 1 : Math.max(0.35, 1 - Math.abs(loopOffset) * 0.2);

                return (
                  <button
                    key={char.id}
                    onClick={(e) => { e.stopPropagation(); setActiveIndex(index); setStoryIndex(0); }}
                    className="group absolute left-1/2 top-1/2 transition-all duration-500"
                    style={{
                      transform: `translate(-50%, -60%) translate(${x}px, ${y}px) scale(${scale})`,
                      opacity,
                      zIndex: 200 - Math.abs(loopOffset)
                    }}
                  >
                    <div className={`w-14 py-3 rounded-2xl border-2 transition-all duration-500 flex flex-col items-center gap-2 ${isActive ? `${charTheme.isCustom ? '' : `${charTheme.bg} ${charTheme.border} ${charTheme.text}`} shadow-2xl` : 'bg-white/60 border-slate-100 text-slate-400 hover:border-slate-300 hover:bg-white/90'}`} style={isActive ? activeCardStyle : undefined}>
                      <span className="writing-vertical text-[10px] font-black tracking-widest uppercase" style={{ writingMode: 'vertical-rl' }}>{String(char?.name || '未知').substring(0, 4)}</span>
                      <div className={`w-9 h-9 rounded-full overflow-hidden border-2 bg-white flex items-center justify-center transition-transform group-hover:rotate-12 ${isActive ? 'border-current shadow-inner' : 'border-slate-100 opacity-60'}`}>
                        {char.image ? <img src={char.image} className="w-full h-full object-cover object-top" alt="icon" /> : <div className="text-[10px] font-bold text-slate-300">{String(char?.name || '?').substring(0,1)}</div>}
                      </div>
                    </div>
                    {isActive && <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${charTheme.isCustom ? '' : charTheme.bgDark} animate-ping`} style={activeDotStyle}></div>}
                  </button>
                );
              })}
              <button
                onClick={(e) => { e.stopPropagation(); addNewCharacter(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-[250] w-14 py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-300 hover:border-slate-400 hover:text-slate-500 flex flex-col items-center justify-center transition-all hover:bg-white/50"
              >
                <Plus size={18} />
                <span className="writing-vertical text-[9px] font-black mt-2 tracking-widest" style={{ writingMode: 'vertical-rl' }}>新增档案</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {appMode === 'archive' && (
        <div className={`relative w-full h-full mx-auto flex flex-col md:flex-row items-stretch animate-fade-in ${viewMode === 'combat' ? 'max-w-none px-0 pb-0 overflow-visible mt-0 pt-1 min-h-0 z-[5]' : 'max-w-[1440px] px-6 gap-6 pb-6 overflow-hidden'}`}>
          {viewMode !== 'portrait' && (
            <div className={`absolute inset-0 z-0 rounded-t-2xl overflow-hidden shadow-inner border-t border-white/40 ${viewMode === 'combat' ? '' : 'mt-2 mx-4'}`}>
              <div className="absolute inset-0 transition-all duration-1000 ease-in-out bg-center bg-cover opacity-80 mix-blend-multiply" style={{ backgroundImage: currentBg ? `url(${currentBg})` : 'none' }}></div>
            </div>
          )}
          {viewMode === 'portrait' && (<PortraitView activeChar={activeChar} theme={theme} isEditMode={isEditMode} updateCharacter={updateCharacter} deleteCharacter={deleteCharacter} mousePos={mousePos} globalBgInputRef={globalBgInputRef} bgInputRef={bgInputRef} fileInputRef={fileInputRef} handleImageUpload={handleImageUpload} onPortraitChange={setCurrentPortraitSrc} onBackgroundChange={setCurrentBackgroundSrc} onBgVideoChange={setCurrentBgVideo} appBackgroundSrc={currentBg} appBackgroundVideo={currentBgVideo} />)}
          {viewMode === 'combat' && (<CombatView activeChar={activeChar} theme={theme} isEditMode={isEditMode} updateCharacter={updateCharacter} updateHexagram={updateHexagram} combatInputRef={combatInputRef} handleImageUpload={handleImageUpload} mousePos={mousePos} />)}
          {viewMode === 'story' && (
            <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-white/40 text-sm">画廊加载中...</div>}>
              <GalleryView3D
                key={`${appMode}-${viewMode}-${activeChar?.id ?? 'none'}`}
                activeChar={activeChar} theme={theme} isEditMode={isEditMode}
                storyIndex={storyIndex} setStoryIndex={setStoryIndex}
                changeStoryImage={changeStoryImage}
                deleteCurrentStoryImage={deleteCurrentStoryImage}
                clearStoryImages={clearStoryImages}
                updateStoryCaption={updateStoryCaption}
                onMetaVisibilityChange={setIsStoryMetaVisible}
                storyInputRef={storyInputRef}
                handleImageUpload={handleImageUpload}
              />
            </Suspense>
          )}
        </div>
      )}
      {appMode === 'scrapbook' && (
        <ScrapbookView scrapbook={scrapbook} isEditMode={isEditMode} updateScrapbookItem={updateScrapbookItem} deleteScrapbookItem={deleteScrapbookItem} setScrapbook={setScrapbook} triggerScrapbookImageUpload={triggerScrapbookImageUpload} activeScrapbookId={activeScrapbookId} scrapbookFileInputRef={scrapbookFileInputRef} handleImageUpload={handleImageUpload} activeTextEndpoint={activeTextEndpoint} />
      )}
      {appMode === 'novel' && (
        <NovelView
          novel={novel}
          setNovel={setNovel}
          characters={characters}
          isAiLoading={isNovelAiLoading}
          onContinueNovel={handleContinueNovel}
          onSaveNow={() => handleSave(false)}
          scrapbook={scrapbook}
          activeTextEndpoint={activeTextEndpoint}
          ragConfig={ragConfig}
        />
      )}
      {isEditMode && appMode === 'archive' && (
        <div className="fixed bottom-28 right-10 z-40 flex flex-col gap-4 animate-fade-in">
          <button onClick={triggerUpload} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all hover:scale-110 hover:shadow-2xl ${theme.isCustom ? '' : theme.bgDark}`} style={uploadFabStyle} title="上传图片">
            {viewMode === 'story' ? <Plus size={28} /> : <Upload size={24} />}
          </button>
        </div>
      )}
      <div className="fixed bottom-10 right-10 z-50 animate-fade-in">
        <button onClick={() => setShowAI(!showAI)} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all hover:scale-110 hover:shadow-2xl ${showAI ? 'bg-slate-800' : 'bg-blue-600'}`} title="设定助手">
          {showAI ? <X size={24} /> : <MessageSquare size={24} />}
        </button>
      </div>
      {showAI && (
        <AIPanel
          aiSessions={aiSessions} activeSessionId={activeSessionId} setActiveSessionId={setActiveSessionId}
          activeSession={activeSession}
          activeTextEndpoint={activeTextEndpoint}
          activeVisionEndpoint={activeVisionEndpoint}
          activeTextEndpointId={activeEndpointId}
          activeVisionEndpointId={activeVisionEndpointId}
          aiEndpoints={aiEndpoints} setAiEndpoints={setAiEndpoints}
          showAiSettings={showAiSettings} setShowAiSettings={setShowAiSettings}
          showModelDropdown={showModelDropdown} setShowModelDropdown={setShowModelDropdown}
          naiConfig={naiConfig} setNaiConfig={setNaiConfig}
          systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
          naiTagPrompt={naiTagPrompt} setNaiTagPrompt={setNaiTagPrompt}
          ideaCultivatePrompt={ideaCultivatePrompt} setIdeaCultivatePrompt={setIdeaCultivatePrompt}
          ragConfig={ragConfig} setRagConfig={setRagConfig}
          referenceConfig={referenceConfig} setReferenceConfig={setReferenceConfig}
          aiInputText={aiInputText} setAiInputText={setAiInputText}
          aiInputImage={aiInputImage} setAiInputImage={setAiInputImage}
          aiDrawBatchMode={aiDrawBatchMode} setAiDrawBatchMode={setAiDrawBatchMode}
          isMultiImageDraw={isMultiImageDraw}
          onAbortBatchImage={() => { batchImageAbortRef.current = true; }}
          isAiLoading={isChatAiLoading}
          imageRequestStatus={imageRequestStatus}
          lastResolvedSystemPrompt={lastResolvedSystemPrompt}
          lastContextPreview={lastContextPreview}
          chatScrollRef={chatScrollRef} aiImageInputRef={aiImageInputRef}
          handleAiSendMessage={handleAiSendMessage} handleDrawImage={handleDrawImage}
          handleAiImageUpload={handleAiImageUpload}
          onSaveIdeaToScrapbook={handleSaveIdeaToScrapbook}
          resolvedChar={activeSessionResolvedChar}
          safeCharacters={safeCharacters}
          handleCreateSession={handleCreateSession}
          handleCreateInspirationSession={handleCreateInspirationSession}
          handleDeleteSession={handleDeleteSession}
          handleRenameSession={handleRenameSession}
          handleBackFromInspiration={handleBackFromInspiration}
          onInspirationPreviewUpdate={handleInspirationPreviewUpdate}
          patchActiveSession={patchActiveSession}
          generateTitle={generateTitle}
          clearAiChats={clearAiChats}
          saveActiveEndpoint={saveActiveEndpoint} saveAiEndpoints={saveAiEndpoints} saveNaiConfig={saveNaiConfig}
          onRebuildRag={handleRebuildRag}
          setShowAI={setShowAI}
          renderSafeContent={renderSafeContent} renderAiMessage={renderAiMessage}
          activeCharPortraitSrc={currentPortraitSrc}
          activeStoryImageSrc={activeChar?.storyImgs?.[storyIndex]?.src || null}
        />
      )}
      {appMode === 'archive' && (
        <div className="fixed bottom-10 left-10 z-40 flex gap-2 animate-fade-in">
          <button onClick={() => setViewMode('portrait')} className={`px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all duration-300 shadow-lg ${viewMode === 'portrait' ? `${theme.isCustom ? '' : theme.bgDark} text-white ring-2 ring-offset-2 ring-slate-200` : 'bg-white/90 backdrop-blur-md text-slate-500 hover:bg-white hover:text-slate-900 border border-slate-200'}`} style={viewMode === 'portrait' ? activeThemeButtonStyle : undefined}><User size={14} /> 立绘</button>
          <button onClick={() => setViewMode('combat')} className={`px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all duration-300 shadow-lg ${viewMode === 'combat' ? `${theme.isCustom ? '' : theme.bgDark} text-white ring-2 ring-offset-2 ring-slate-200` : 'bg-white/90 backdrop-blur-md text-slate-500 hover:bg-white hover:text-slate-900 border border-slate-200'}`} style={viewMode === 'combat' ? activeThemeButtonStyle : undefined}><Zap size={14} /> 标题</button>
          <button onClick={() => setViewMode('story')} className={`px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all duration-300 shadow-lg ${viewMode === 'story' ? `${theme.isCustom ? '' : theme.bgDark} text-white ring-2 ring-offset-2 ring-slate-200` : 'bg-white/90 backdrop-blur-md text-slate-500 hover:bg-white hover:text-slate-900 border border-slate-200'}`} style={viewMode === 'story' ? activeThemeButtonStyle : undefined}><Library size={14} /> 图库</button>
        </div>
      )}
      
      {scrapbookEditDialog && (
        <ScrapbookEditDialog
          draft={scrapbookEditDialog}
          onDraftChange={setScrapbookEditDialog}
          onCancel={() => setScrapbookEditDialog(null)}
          onSave={() => {
            const { title, content, tags, resolvedChar } = scrapbookEditDialog;
            if (!title.trim() || !content.trim()) {
              alert('标题和内容不能为空');
              return;
            }
            const finalTags = tags.length > 0 ? tags : (resolvedChar?.name ? [`角色:${resolvedChar.name}`] : []);
            setScrapbook(prev => [
              {
                id: Date.now(),
                title: title.trim(),
                content: content.trim(),
                image: null,
                tags: normalizeTags(finalTags)
              },
              ...(Array.isArray(prev) ? prev : [])
            ]);
            setScrapbookEditDialog(null);
            setAppMode('scrapbook');
            setIsEditMode(true);
          }}
        />
      )}
      
      <style>{`
        html, body, #root {
          height: 100%;
          overflow: hidden;
        }
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;500;700;900&display=swap');
        .font-serif { font-family: "Noto Serif SC", serif; }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .mask-gradient-bottom { mask-image: linear-gradient(to bottom, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent 100%); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .writing-vertical { text-orientation: upright; }
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes shine { 0% { transform: translateX(-150%) skewX(-20deg); } 50% { transform: translateX(150%) skewX(-20deg); } 100% { transform: translateX(150%) skewX(-20deg); } }
        .animate-shine { animation: shine 6s infinite; }
        @keyframes hex-ripple { 0% { opacity: 0.2; } 10% { opacity: 1; filter: brightness(1.2); } 60% { opacity: 0.2; filter: brightness(1); } 100% { opacity: 0.2; } }
        .animate-hex-ripple { animation: hex-ripple 2.4s infinite linear; }
      `}</style>
    </div>
  );
}
