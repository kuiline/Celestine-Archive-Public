import { useEffect, useRef, useCallback } from 'react';
import { DEFAULT_CHARACTERS } from '../constants';
import {
  sanitizeCharacters,
  sanitizeScrapbook,
  createNewSession,
  sanitizeAiSessions,
} from '../utils';
import { SIMPLE_MODES_STORAGE_KEY } from '../novelSimpleModes';
import { normalizeEndpoints } from '../appHelpers';
import { normalizeReferenceConfig } from '../referenceConfigUtils';

export default function useArchiveBootstrap({
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
}) {
  const applyLoadedArchiveData = useCallback((data) => {
    if (!data || data.error) return false;
    setCharacters(sanitizeCharacters(data.characters));
    setGlobalBackground(data.globalBackground || null);
    setScrapbook(sanitizeScrapbook(data.scrapbook));
    setNovel(data.novel || { title: '未命名正文', content: '', updatedAt: 0 });
    if (data.aiEndpoints) { setAiEndpoints(normalizeEndpoints(data.aiEndpoints)); localStorage.setItem('celestial_ai_endpoints', JSON.stringify(data.aiEndpoints)); }
    if (data.activeEndpointId) { setActiveEndpointId(data.activeEndpointId); localStorage.setItem('celestial_ai_active_endpoint', data.activeEndpointId); }
    if (data.activeVisionEndpointId) { setActiveVisionEndpointId(data.activeVisionEndpointId); localStorage.setItem('celestial_ai_active_vision_endpoint', data.activeVisionEndpointId); }
    if (data.naiConfig) { setNaiConfig((prev) => ({ ...prev, ...data.naiConfig })); localStorage.setItem('celestial_nai_config_v8', JSON.stringify(data.naiConfig)); }
    if (data.systemPrompt) { setSystemPrompt(data.systemPrompt); localStorage.setItem('celestial_system_prompt', data.systemPrompt); }
    if (data.naiTagPrompt) { setNaiTagPrompt(data.naiTagPrompt); localStorage.setItem('celestial_nai_tag_prompt', data.naiTagPrompt); }
    if (data.ideaCultivatePrompt) { setIdeaCultivatePrompt(data.ideaCultivatePrompt); localStorage.setItem('celestial_idea_cultivate_prompt', data.ideaCultivatePrompt); }
    if (data.ragConfig) {
      setRagConfig((prev) => {
        const merged = { ...prev, ...data.ragConfig };
        if (data.ragConfig.useChroma === undefined) merged.useChroma = false;
        delete merged.topK;
        try {
          localStorage.setItem('celestial_rag_config_v1', JSON.stringify(merged));
        } catch (e) {}
        return merged;
      });
    }
    if (data.referenceConfig) {
      const n = normalizeReferenceConfig(data.referenceConfig);
      setReferenceConfig(n);
      try { localStorage.setItem('celestial_reference_config_v1', JSON.stringify(n)); } catch (e) {}
    }
    if (data.novelContinueSettings) { localStorage.setItem('celestial_novel_continue_settings_v1', JSON.stringify(data.novelContinueSettings)); }
    if (data.novelSimpleModes) { localStorage.setItem(SIMPLE_MODES_STORAGE_KEY, JSON.stringify(data.novelSimpleModes)); }
    const s = sanitizeAiSessions(data.aiSessions, data.aiChats, sanitizeCharacters(data.characters || []));
    setAiSessions(s); setActiveSessionId(s[0].id);
    setIsDataLoaded(true);
    return true;
  }, [
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
    setReferenceConfig,
    setAiSessions,
    setActiveSessionId,
  ]);

  useEffect(() => {
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    try {
      const savedEndpoints = localStorage.getItem('celestial_ai_endpoints');
      const savedActiveId = localStorage.getItem('celestial_ai_active_endpoint');
      const savedActiveVisionId = localStorage.getItem('celestial_ai_active_vision_endpoint');
      const savedNai = localStorage.getItem('celestial_nai_config_v8');
      const savedSysPrompt = localStorage.getItem('celestial_system_prompt');
      const savedNaiTagPrompt = localStorage.getItem('celestial_nai_tag_prompt');
      const savedIdeaPrompt = localStorage.getItem('celestial_idea_cultivate_prompt');
      const savedRagConfig = localStorage.getItem('celestial_rag_config_v1');
      const savedRefConfig = localStorage.getItem('celestial_reference_config_v1');
      if (savedEndpoints) setAiEndpoints(normalizeEndpoints(JSON.parse(savedEndpoints)));
      if (savedActiveId) setActiveEndpointId(savedActiveId);
      if (savedActiveVisionId) setActiveVisionEndpointId(savedActiveVisionId);
      if (savedNai) { const p = JSON.parse(savedNai); if (!p.version) p.version = p.model?.includes('4-5') ? 'v4.5' : 'v3'; setNaiConfig((prev) => ({ ...prev, ...p })); }
      if (savedSysPrompt) setSystemPrompt(savedSysPrompt);
      if (savedNaiTagPrompt) setNaiTagPrompt(savedNaiTagPrompt);
      if (savedIdeaPrompt) setIdeaCultivatePrompt(savedIdeaPrompt);
      if (savedRagConfig) {
        setRagConfig((prev) => {
          const merged = { ...prev, ...JSON.parse(savedRagConfig) };
          delete merged.topK;
          return merged;
        });
      }
      if (savedRefConfig) {
        try {
          setReferenceConfig(normalizeReferenceConfig(JSON.parse(savedRefConfig)));
        } catch (e) {}
      }
    } catch (e) {}
    const initLoad = async () => {
      let loadedFromApi = false;
      try {
        const res = await fetch('/api/load');
        if (res.ok) {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            if (data && applyLoadedArchiveData(data)) {
              loadedFromApi = true;
            }
          } catch (err) { console.warn('JSON parse failed'); }
        }
      } catch (e) { console.warn('no backend'); }
      if (!loadedFromApi) {
        try { const s = localStorage.getItem('celestial_chars_v8'); if (s) setCharacters(sanitizeCharacters(JSON.parse(s))); } catch (e) {}
        try { const s = localStorage.getItem('celestial_global_bg'); if (s) setGlobalBackground(s); } catch (e) {}
        try { const s = localStorage.getItem('celestial_scrapbook_v1'); if (s) setScrapbook(sanitizeScrapbook(JSON.parse(s))); } catch (e) {}
        try { const s = localStorage.getItem('celestial_novel_v1'); if (s) setNovel(JSON.parse(s)); } catch (e) {}
        try {
          const ss = localStorage.getItem('celestial_ai_sessions_v2');
          const sc = localStorage.getItem('celestial_ai_chats_v1');
          let charsForSessions = DEFAULT_CHARACTERS;
          try {
            const cs = localStorage.getItem('celestial_chars_v8');
            if (cs) charsForSessions = sanitizeCharacters(JSON.parse(cs));
          } catch (e2) { /* keep default */ }
          const sanitized = sanitizeAiSessions(ss ? JSON.parse(ss) : null, sc ? JSON.parse(sc) : null, charsForSessions);
          setAiSessions(sanitized); setActiveSessionId(sanitized[0].id);
        } catch (e) { const f = [createNewSession()]; setAiSessions(f); setActiveSessionId(f[0].id); }
        setIsDataLoaded(true);
      }
    };
    initLoad();
  }, [
    applyLoadedArchiveData,
    setAiEndpoints,
    setActiveEndpointId,
    setActiveVisionEndpointId,
    setNaiConfig,
    setSystemPrompt,
    setNaiTagPrompt,
    setIdeaCultivatePrompt,
    setRagConfig,
    setReferenceConfig,
    setCharacters,
    setGlobalBackground,
    setScrapbook,
    setNovel,
    setAiSessions,
    setActiveSessionId,
  ]);

  const referenceConfigPersistGate = useRef(false);
  useEffect(() => {
    if (!referenceConfigPersistGate.current) {
      referenceConfigPersistGate.current = true;
      return;
    }
    try {
      localStorage.setItem('celestial_reference_config_v1', JSON.stringify(referenceConfig));
    } catch (e) {}
  }, [referenceConfig]);

  useEffect(() => {
    const migrateLegacyGeneratedImages = async () => {
      try {
        const res = await fetch('/api/migrate-ai-generated', { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.migrated > 0 && Array.isArray(data.aiSessions)) {
          const sanitized = sanitizeAiSessions(data.aiSessions, null, DEFAULT_CHARACTERS);
          setAiSessions(sanitized);
          alert(`已迁移 ${data.migrated} 张历史对话图片到 data/ai_generated。`);
        }
      } catch (e) {}
    };
    migrateLegacyGeneratedImages();
  }, [setAiSessions]);

  return { applyLoadedArchiveData };
}
