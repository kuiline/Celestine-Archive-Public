import { useEffect, useRef, useCallback } from 'react';
import { DEFAULT_CHARACTERS } from '../constants';
import { computeInvolvedCharacterNames, scanSessionForFlags } from '../appHelpers';

export default function useAiSessionMeta({
  aiSessions,
  activeSessionId,
  activeSession,
  characters,
  lastContextPreview,
  setAiSessions,
  setActiveSessionId,
  setLastContextPreview,
  setLastResolvedSystemPrompt,
}) {
  const safeCharacters = Array.isArray(characters) ? characters : DEFAULT_CHARACTERS;

  useEffect(() => {
    if (!aiSessions.length) return;
    if (!activeSessionId || !aiSessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(aiSessions[0].id);
    }
  }, [aiSessions, activeSessionId, setActiveSessionId]);

  useEffect(() => {
    const isInsp = activeSession?.mode === 'inspiration';
    const pm = lastContextPreview?.mode;
    if (!isInsp && pm === 'inspiration') {
      setLastContextPreview(null);
      setLastResolvedSystemPrompt('');
      return;
    }
    if (isInsp && pm === 'chat') {
      setLastContextPreview(null);
      setLastResolvedSystemPrompt('');
    }
  }, [activeSessionId, activeSession?.mode, lastContextPreview?.mode, setLastContextPreview, setLastResolvedSystemPrompt]);

  const prevInspirationSessionIdRef = useRef(null);
  useEffect(() => {
    if (activeSession?.mode !== 'inspiration') {
      prevInspirationSessionIdRef.current = activeSessionId;
      return;
    }
    const sid = activeSessionId;
    const prev = prevInspirationSessionIdRef.current;
    if (prev != null && sid !== prev) {
      setLastContextPreview(null);
      setLastResolvedSystemPrompt('');
    }
    prevInspirationSessionIdRef.current = sid;
  }, [activeSessionId, activeSession?.mode, setLastContextPreview, setLastResolvedSystemPrompt]);

  const mergeSessionMeta = useCallback((messages) => ({
    involvedCharacterNames: computeInvolvedCharacterNames(messages, safeCharacters),
    sessionFlags: scanSessionForFlags(messages)
  }), [safeCharacters]);

  useEffect(() => {
    const chars = Array.isArray(characters) ? characters : DEFAULT_CHARACTERS;
    setAiSessions((prev) =>
      prev.map((s) => ({
        ...s,
        involvedCharacterNames: computeInvolvedCharacterNames(s.messages || [], chars),
        sessionFlags: scanSessionForFlags(s.messages || [])
      }))
    );
  }, [characters, setAiSessions]);

  const patchActiveSession = useCallback((patch) => {
    setAiSessions((prev) => prev.map((s) => {
      if (s.id !== activeSessionId) return s;
      const next = { ...s, ...patch };
      if (patch.messages) {
        Object.assign(next, mergeSessionMeta(patch.messages));
      }
      return next;
    }));
  }, [setAiSessions, activeSessionId, mergeSessionMeta]);

  return { mergeSessionMeta, patchActiveSession };
}
