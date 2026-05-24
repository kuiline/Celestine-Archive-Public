import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Save, Settings2, RotateCcw, Check, X, Search, RefreshCw, ChevronRight, ChevronUp, ChevronDown, Book, Library, User, Zap, Sparkles, BookmarkPlus, Bookmark, History } from 'lucide-react';
import NovelContinuationPlanner from './NovelContinuationPlanner';
import { buildBeforeTextAcrossChapters } from '../novelPlannerApi';
import { resolveTheme } from '../constants';
import {
  loadSimpleModes,
  saveSimpleModes,
  BLANK_CONTINUE_MODE,
  BLANK_POLISH_MODE,
  normalizeContinueMode,
  normalizePolishMode
} from '../novelSimpleModes';
import {
  loadPlannerSettings,
  savePlannerSettings,
  normalizePlannerSettings,
  buildPlannerCollectPayload
} from '../novelPlannerSettings';
import {
  appendNovelContinuationHistoryEvent,
  loadNovelContinuationHistory
} from '../novelContinuationHistoryApi';

const NovelView = ({ novel, setNovel, isAiLoading, onContinueNovel, onSaveNow, scrapbook, characters = [], activeTextEndpoint, ragConfig }) => {
  const CHAPTER_SPLIT = '\n\n<<<CHAPTER_SPLIT>>>\n\n';
  const CHAPTER_PREFIX = '@@chapter:';
  const PARAGRAPH_INDENT = '　　';

  const makeChapter = (idx = 1, title = '', scopeType = 'main', workId = 'main') => ({
    id: `chapter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title || `第${idx}章`,
    content: '',
    scopeType,
    workId
  });
  
  const parseContentToChapters = (raw) => {
    const src = String(raw || '');
    if (!src.trim()) return [makeChapter(1, '', 'main', 'main')];
    if (!src.includes(CHAPTER_PREFIX)) return [{ ...makeChapter(1, '第1章', 'main', 'main'), content: src }];
    const blocks = src.split(CHAPTER_SPLIT);
    const out = [];
    blocks.forEach((block, idx) => {
      const lines = String(block || '').split('\n');
      const first = String(lines[0] || '');
      if (!first.startsWith(CHAPTER_PREFIX)) return;
      out.push({
        id: `chapter_${idx + 1}`,
        title: first.slice(CHAPTER_PREFIX.length).trim() || `第${idx + 1}章`,
        content: lines.slice(1).join('\n'),
        scopeType: 'main',
        workId: 'main'
      });
    });
    return out.length > 0 ? out : [{ ...makeChapter(1, '第1章', 'main', 'main'), content: src }];
  };
  const normalizePrequels = (list) => (Array.isArray(list) ? list : [])
    .map((p, idx) => ({
      id: String(p?.id || `prequel_${idx + 1}`),
      title: String(p?.title || `前传 ${idx + 1}`).trim() || `前传 ${idx + 1}`,
      characterName: String(p?.characterName || '').trim(),
      content: String(p?.content || '')
    }))
    .map((p) => ({
      id: `prequel_chapter_${p.id}`,
      title: p.title,
      content: p.content,
      scopeType: 'prequel',
      workId: p.id,
      characterName: p.characterName
    }));
  const normalizeBookmarks = (list) => (Array.isArray(list) ? list : [])
    .map((b) => ({
      id: String(b?.id || ''),
      chapterId: String(b?.chapterId || ''),
      chapterTitle: String(b?.chapterTitle || ''),
      chapterIndex: Number.isFinite(Number(b?.chapterIndex)) ? Number(b.chapterIndex) : null,
      offset: Math.max(0, Number(b?.offset) || 0),
      snippet: String(b?.snippet || ''),
      anchorBefore: String(b?.anchorBefore || ''),
      anchorAfter: String(b?.anchorAfter || ''),
      createdAt: Number(b?.createdAt || 0) || Date.now()
    }))
    .filter((b) => b.id && b.chapterId);
  /** 正文重解析后章节 id 会变成 chapter_1…，与书签里存的 chapter_时间戳 不一致时用标题/序号兜底 */
  const resolveChapterForBookmark = (bookmark, chapterList) => {
    const list = Array.isArray(chapterList) ? chapterList : [];
    const bid = String(bookmark?.chapterId || '').trim();
    if (bid) {
      const byId = list.find((c) => String(c.id) === bid);
      if (byId) return byId;
    }
    const t = String(bookmark?.chapterTitle || '').trim();
    if (t) {
      const normalizedSearch = t.replace(/\s+/g, '');
      const byTitle = list.find((c) => {
        const ct = String(c.title || '').trim();
        return ct === t || ct.replace(/\s+/g, '') === normalizedSearch;
      });
      if (byTitle) return byTitle;
    }
    const idx = Number(bookmark?.chapterIndex);
    if (Number.isFinite(idx) && idx >= 0 && idx < list.length) return list[idx];
    return null;
  };
  const normalizePlain = (s) =>
    String(s || '')
      .replace(/\r/g, '')
      .replace(/\u200b/g, '')
      .replace(/\u00a0/g, ' ');

  const parseChineseNumber = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let total = 0;
    let current = 0;
    for (const ch of s) {
      if (ch === '十') {
        current = current || 1;
        total += current * 10;
        current = 0;
        continue;
      }
      if (ch === '百') {
        current = current || 1;
        total += current * 100;
        current = 0;
        continue;
      }
      if (map[ch] != null) {
        current = map[ch];
      }
    }
    total += current;
    return Number.isFinite(total) && total > 0 ? total : null;
  };

  const inferChapterNoFromTitle = (title) => {
    const t = String(title || '').trim();
    if (!t) return null;
    if (t.includes('序章')) return 0;
    const m = t.match(/第([一二三四五六七八九十百零〇两\d]+)(章|张)/);
    if (!m) return null;
    return parseChineseNumber(m[1]);
  };

  const serializeChapters = (items) => (Array.isArray(items) ? items : [])
    .map((c, idx) => ({ title: String(c?.title || '').trim() || `第${idx + 1}章`, content: String(c?.content || '') }))
    .map(c => `${CHAPTER_PREFIX}${c.title}\n${c.content}`.trimEnd())
    .join(CHAPTER_SPLIT)
    .trim();

  const initMain = parseContentToChapters(novel?.content || '');
  const initPrequels = normalizePrequels(novel?.prequels);
  const [chapters, setChapters] = useState(() => [...initMain, ...initPrequels]);
  const [activeChapterId, setActiveChapterId] = useState(() => [...initMain, ...initPrequels][0]?.id || null);
  const lastSerializedRef = useRef(serializeChapters(initMain));
  const lastPrequelsRef = useRef(JSON.stringify(Array.isArray(novel?.prequels) ? novel.prequels : []));
  const editorWrapRef = useRef(null);
  const editorRef = useRef(null);
  const lastCaretInnerOffsetRef = useRef(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0, text: '' });
  const [caretUi, setCaretUi] = useState({ x: 12, y: 12, visible: false });
  const [showContinueSettings, setShowContinueSettings] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [lastRagRefs, setLastRagRefs] = useState({ novelRefs: [], scrapbookRefs: [], summaryRefs: [], extractedKeywords: '', charSettingContext: '', selectedScrapbookContent: '', agentTrace: [] });
  const [showRagPanel, setShowRagPanel] = useState(false);
  const [showContinuationHistoryPanel, setShowContinuationHistoryPanel] = useState(false);
  const [continuationHistory, setContinuationHistory] = useState([]);
  const [continuationHistoryLoading, setContinuationHistoryLoading] = useState(false);
  const [continuationHistoryError, setContinuationHistoryError] = useState('');
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findHint, setFindHint] = useState('');
  /** 前传目录：绑定角色输入默认收起，仅展开一条 */
  const [prequelBindingOpenId, setPrequelBindingOpenId] = useState(null);
  
  const [simpleModes, setSimpleModes] = useState(loadSimpleModes);
  const [plannerSettings, setPlannerSettings] = useState(loadPlannerSettings);
  const [simpleSettingsTab, setSimpleSettingsTab] = useState('continue'); // 'continue' | 'polish' | 'planner'
  const [draft, setDraft] = useState(null); 
  const [continueMode, setContinueMode] = useState(null); // 'select' | 'free'
  const [userDirection, setUserDirection] = useState('');
  const [showScrapbookPanel, setShowScrapbookPanel] = useState(false);
  const [scrapbookSearchTag, setScrapbookSearchTag] = useState('');
  const [selectedScrapbookIds, setSelectedScrapbookIds] = useState(new Set());
  const [plannerSession, setPlannerSession] = useState(null);
  const [plannerSessionKey, setPlannerSessionKey] = useState(0);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [pendingBookmarkJump, setPendingBookmarkJump] = useState(null);
  const bookmarkJumpQueuedRef = useRef(null);
  const patchContinueMode = (patch) => {
    setSimpleModes((s) => ({
      ...s,
      continueModes: s.continueModes.map((m) =>
        m.id === s.activeContinueModeId ? normalizeContinueMode({ ...m, ...patch }) : m
      )
    }));
  };
  const patchPolishMode = (patch) => {
    setSimpleModes((s) => ({
      ...s,
      polishModes: s.polishModes.map((m) =>
        m.id === s.activePolishModeId ? normalizePolishMode({ ...m, ...patch }) : m
      )
    }));
  };
  const addContinueMode = () => {
    const m = normalizeContinueMode({
      ...BLANK_CONTINUE_MODE(),
      name: `简单续写 ${simpleModes.continueModes.length + 1}`
    });
    setSimpleModes((s) => ({ ...s, continueModes: [...s.continueModes, m], activeContinueModeId: m.id }));
  };
  const addPolishMode = () => {
    const m = normalizePolishMode({
      ...BLANK_POLISH_MODE(),
      name: `润色 ${simpleModes.polishModes.length + 1}`
    });
    setSimpleModes((s) => ({ ...s, polishModes: [...s.polishModes, m], activePolishModeId: m.id }));
  };
  const deleteActiveContinueMode = () => {
    if (simpleModes.continueModes.length <= 1) {
      alert('至少保留一种续写模式');
      return;
    }
    if (!window.confirm('确定删除当前续写模式？')) return;
    const next = simpleModes.continueModes.filter((m) => m.id !== simpleModes.activeContinueModeId);
    setSimpleModes((s) => ({
      ...s,
      continueModes: next,
      activeContinueModeId: next[0]?.id || s.activeContinueModeId
    }));
  };
  const deleteActivePolishMode = () => {
    if (simpleModes.polishModes.length <= 1) {
      alert('至少保留一种润色模式');
      return;
    }
    if (!window.confirm('确定删除当前润色模式？')) return;
    const next = simpleModes.polishModes.filter((m) => m.id !== simpleModes.activePolishModeId);
    setSimpleModes((s) => ({
      ...s,
      polishModes: next,
      activePolishModeId: next[0]?.id || s.activePolishModeId
    }));
  };
  const renameActiveContinueMode = () => {
    const cur = simpleModes.continueModes.find((m) => m.id === simpleModes.activeContinueModeId);
    if (!cur) return;
    const t = window.prompt('模式名称', cur.name);
    if (t === null) return;
    const name = String(t).trim() || cur.name;
    patchContinueMode({ name });
  };
  const renameActivePolishMode = () => {
    const cur = simpleModes.polishModes.find((m) => m.id === simpleModes.activePolishModeId);
    if (!cur) return;
    const t = window.prompt('模式名称', cur.name);
    if (t === null) return;
    const name = String(t).trim() || cur.name;
    patchPolishMode({ name });
  };

  const activeContinueMode = useMemo(
    () => simpleModes.continueModes.find((m) => m.id === simpleModes.activeContinueModeId) || simpleModes.continueModes[0],
    [simpleModes]
  );
  const activePolishMode = useMemo(
    () => simpleModes.polishModes.find((m) => m.id === simpleModes.activePolishModeId) || simpleModes.polishModes[0],
    [simpleModes]
  );

  useEffect(() => {
    saveSimpleModes(simpleModes);
  }, [simpleModes]);

  useEffect(() => {
    savePlannerSettings(plannerSettings);
  }, [plannerSettings]);

  const patchPlannerSettings = (patch) => {
    setPlannerSettings((prev) => normalizePlannerSettings({ ...prev, ...patch }));
  };

  const plannerUi = useMemo(() => normalizePlannerSettings(plannerSettings), [plannerSettings]);
  const continuationHistoryList = useMemo(() => Array.isArray(continuationHistory) ? continuationHistory : [], [continuationHistory]);
  const eventTypeLabel = (t) => ({
    request: '请求',
    response: '返回',
    error: '错误',
    draft_created: '草稿生成',
    draft_accepted: '采纳',
    draft_rejected: '放弃',
    planner_opened: '规划打开'
  }[String(t || '')] || String(t || '事件'));
  const taskTypeLabel = (t) => (t === 'polish' ? '润色' : '续写');
  const formatDateTime = (ts) => {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const createTraceId = () => `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const logContinuationEvent = async (event) => {
    try {
      await appendNovelContinuationHistoryEvent({
        ...event,
        createdAt: event?.createdAt || Date.now()
      });
      if (showContinuationHistoryPanel) {
        refreshContinuationHistory();
      }
    } catch (e) {
      console.warn('续写历史记录失败', e);
    }
  };
  const refreshContinuationHistory = async () => {
    setContinuationHistoryLoading(true);
    setContinuationHistoryError('');
    try {
      const data = await loadNovelContinuationHistory(400);
      setContinuationHistory(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setContinuationHistoryError(String(e?.message || e || '加载失败'));
    } finally {
      setContinuationHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!showContinuationHistoryPanel) return;
    refreshContinuationHistory();
  }, [showContinuationHistoryPanel]);

  useEffect(() => {
    const incoming = String(novel?.content || '');
    const incomingPrequels = JSON.stringify(Array.isArray(novel?.prequels) ? novel.prequels : []);
    if (incoming === lastSerializedRef.current && incomingPrequels === lastPrequelsRef.current) return;
    const parsedMain = parseContentToChapters(incoming);
    const parsedPrequels = normalizePrequels(novel?.prequels);
    const merged = [...parsedMain, ...parsedPrequels];
    setChapters(merged);
    setActiveChapterId(prev => merged.some(c => c.id === prev) ? prev : merged[0]?.id || null);
    lastSerializedRef.current = serializeChapters(parsedMain);
    lastPrequelsRef.current = incomingPrequels;
  }, [novel?.content, novel?.prequels]);

  const activeChapter = useMemo(
    () => chapters.find(c => c.id === activeChapterId) || chapters[0] || makeChapter(1),
    [chapters, activeChapterId]
  );
  const bookmarks = useMemo(() => {
    const raw = normalizeBookmarks(novel?.bookmarks);
    return raw.filter((b) => resolveChapterForBookmark(b, chapters) != null);
  }, [novel?.bookmarks, chapters]);
  const characterThemeMap = useMemo(() => {
    const m = {};
    for (const c of Array.isArray(characters) ? characters : []) {
      const name = String(c?.name || '').trim();
      if (!name) continue;
      m[name] = {
        theme: String(c?.theme || '').trim(),
        title: String(c?.title || '').trim()
      };
    }
    return m;
  }, [characters]);
  const getRoleAccent = (roleName) => {
    const key = String(characterThemeMap[String(roleName || '').trim()]?.theme || '').trim();
    if (!key) return '';
    const th = resolveTheme(key);
    return String(th?.accent || '').trim();
  };
  
  const totalCount = String(novel?.content || '').length;
  const activeCount = String(activeChapter?.content || '').length;

  const syncToNovel = (nextChapters) => {
    const list = Array.isArray(nextChapters) ? nextChapters : [];
    const mainChapters = list.filter((c) => c.scopeType !== 'prequel');
    const prequels = list
      .filter((c) => c.scopeType === 'prequel')
      .map((c) => ({
        id: c.workId || String(c.id).replace(/^prequel_chapter_/, ''),
        title: c.title || '前传',
        characterName: c.characterName || '',
        content: c.content || ''
      }));
    const serialized = serializeChapters(mainChapters);
    lastSerializedRef.current = serialized;
    lastPrequelsRef.current = JSON.stringify(prequels);
    setNovel(prev => ({ ...(prev || {}), content: serialized, prequels, updatedAt: Date.now() }));
  };

  const updateChapter = (id, patch) => {
    const next = chapters.map(c => (c.id === id ? { ...c, ...patch } : c));
    setChapters(next);
    syncToNovel(next);
  };

  const addChapter = () => {
    const mainCount = chapters.filter((c) => c.scopeType !== 'prequel').length;
    const next = [...chapters, makeChapter(mainCount + 1, '', 'main', 'main')];
    setChapters(next);
    setActiveChapterId(next[next.length - 1].id);
    syncToNovel(next);
  };
  const addPrequel = () => {
    const defaultName = String(activeChapter?.characterName || '').trim();
    const role = (window.prompt('输入前传绑定角色名（用于主题色与检索隔离）', defaultName) || '').trim();
    const fallbackTitle = role ? `${role}前传` : `前传 ${chapters.filter((c) => c.scopeType === 'prequel').length + 1}`;
    const title = (window.prompt('输入前传标题', fallbackTitle) || fallbackTitle).trim();
    const item = {
      ...makeChapter(1, title || fallbackTitle, 'prequel', `prequel_${Date.now()}`),
      characterName: role
    };
    const next = [...chapters, item];
    setChapters(next);
    setActiveChapterId(item.id);
    syncToNovel(next);
  };

  const deleteChapter = (id) => {
    if (chapters.length <= 1) return;
    if (!window.confirm('确定删除该章节吗？')) return;
    const next = chapters.filter(c => c.id !== id);
    setChapters(next);
    if (activeChapterId === id) setActiveChapterId(next[0]?.id || null);
    syncToNovel(next);
  };
  const moveChapter = (id, delta) => {
    const idx = chapters.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const to = idx + delta;
    if (to < 0 || to >= chapters.length) return;
    const next = [...chapters];
    const [item] = next.splice(idx, 1);
    next.splice(to, 0, item);
    setChapters(next);
    setActiveChapterId(item.id);
    syncToNovel(next);
  };
  const setBookmarks = (nextBookmarks) => {
    const next = normalizeBookmarks(nextBookmarks).sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
    setNovel(prev => ({ ...(prev || {}), bookmarks: next, updatedAt: Date.now() }));
  };

  const formatParagraphIndent = (text) => String(text || '')
    .split('\n')
    .map(line => (!line.trim() ? '' : (line.startsWith(PARAGRAPH_INDENT) ? line : `${PARAGRAPH_INDENT}${line.trimStart()}`)))
    .join('\n');

  const applyIndentToCurrentChapter = () => {
    setDraft(null);
    updateChapter(activeChapter.id, { content: formatParagraphIndent(activeChapter.content || '') });
  };

  const getEditorText = () => normalizePlain(editorRef.current?.innerText || '');
  const setEditorText = (text) => {
    if (!editorRef.current) return;
    editorRef.current.innerText = String(text || '');
  };

  const clampBookmarkOffset = (raw, len) => Math.max(0, Math.min(Number(raw) || 0, Math.max(0, len)));

  /** 与 chapter.content / getEditorText() 为同一字符串：整章放进单个 TextNode，offset 为第几个字符（0-based） */
  const placeCaretAtPlainOffset = (editor, plainText, offset) => {
    if (!editor) return;
    const text = String(plainText ?? '');
    const o = clampBookmarkOffset(offset, text.length);
    editor.innerHTML = '';
    const tn = document.createTextNode(text);
    editor.appendChild(tn);
    const r = document.createRange();
    const sel = window.getSelection();
    r.setStart(tn, o);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.focus();
  };

  const getCaretOffset = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.endContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  };
  const getCaretInnerOffset = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.endContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.endContainer, range.endOffset);
    return normalizePlain(pre.toString()).length;
  };

  const getSelectionOffsets = () => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const preStart = range.cloneRange();
    preStart.selectNodeContents(editor);
    preStart.setEnd(range.startContainer, range.startOffset);
    const preEnd = range.cloneRange();
    preEnd.selectNodeContents(editor);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const iStart = normalizePlain(preStart.toString()).length;
    const iEnd = normalizePlain(preEnd.toString()).length;
    return { start: Math.min(iStart, iEnd), end: Math.max(iStart, iEnd) };
  };

  const normalizeGeneratedText = (raw) => {
    if (!raw) return '';
    let t = String(raw).trim();
    t = t.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return t;
  };

  const handleEditorInput = () => {
    if (draft) return;
    updateChapter(activeChapter.id, { content: getEditorText() });
    refreshCaretUi();
  };

  const handleKeyDown = (e) => {
    if (draft || isAiLoading) return;
    
    // 处理回车自动缩进
    if (e.key === 'Enter') {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      
      const range = sel.getRangeAt(0);
      range.deleteContents();
      
      // 插入换行符 + 两个全角空格（中国小说标准缩进）
      const indentText = '\n　　';
      const textNode = document.createTextNode(indentText);
      range.insertNode(textNode);
      
      // 将光标移至缩进之后
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(range);
      
      // 触发内容更新
      handleEditorInput();
    }
  };

  const rangeOffsetsToInnerOffsets = (editor, rangeStart, rangeEnd) => {
    const fullRange = document.createRange();
    fullRange.selectNodeContents(editor);
    const rangeContent = normalizePlain(fullRange.toString());
    const innerContent = normalizePlain(editor.innerText || '');
    let ri = 0, ii = 0, innerStart = null, innerEnd = null;
    while (ri <= rangeEnd || ii < innerContent.length) {
      if (ri === rangeStart) innerStart = ii;
      if (ri === rangeEnd) innerEnd = ii;
      if (innerStart != null && innerEnd != null) return [innerStart, innerEnd];
      if (ri < rangeContent.length && ii < innerContent.length && rangeContent[ri] === innerContent[ii]) { ri++; ii++; } 
      else if (ii < innerContent.length && innerContent[ii] === '\n') { ii++; } 
      else if (ri < rangeContent.length) { ri++; } else break;
    }
    return [innerStart ?? rangeStart, innerEnd ?? rangeEnd];
  };

  const innerOffsetsToRangeOffsets = (editor, innerStart, innerEnd) => {
    const innerContent = normalizePlain(editor.innerText || '');
    const fullRange = document.createRange();
    fullRange.selectNodeContents(editor);
    const rangeContent = normalizePlain(fullRange.toString());
    let ri = 0, ii = 0, rStart = null, rEnd = null;
    while (ii <= innerEnd || ri < rangeContent.length) {
      if (ii === innerStart) rStart = ri;
      if (ii === innerEnd) rEnd = ri;
      if (rStart != null && rEnd != null) return [rStart, rEnd];
      if (ri < rangeContent.length && ii < innerContent.length && rangeContent[ri] === innerContent[ii]) { ri++; ii++; }
      else if (ii < innerContent.length && innerContent[ii] === '\n') { ii++; }
      else if (ri < rangeContent.length) { ri++; } else break;
    }
    return [rStart ?? innerStart, rEnd ?? innerEnd];
  };

  const setSelectionByInnerOffsets = (start, end) => {
    const editor = editorRef.current;
    if (!editor) return;
    const fullRangeProbe = document.createRange();
    fullRangeProbe.selectNodeContents(editor);
    const plainDoc = normalizePlain(editor.innerText || '');
    const plainRange = normalizePlain(fullRangeProbe.toString());
    const [rStart, rEnd] =
      plainDoc === plainRange
        ? [start, end]
        : innerOffsetsToRangeOffsets(editor, start, end);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode(), current = 0, startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    while (node) {
      const len = node.nodeValue.length;
      if (!startNode && current + len >= rStart) { startNode = node; startOffset = rStart - current; }
      if (current + len >= rEnd) { endNode = node; endOffset = rEnd - current; break; }
      current += len; node = walker.nextNode();
    }
    if (!startNode) return;
    const r = document.createRange();
    r.setStart(startNode, startOffset);
    const endEl = endNode ?? startNode;
    const endOff = endNode != null ? endOffset : startOffset;
    r.setEnd(endEl, Math.min(Math.max(0, endOff), endEl.nodeValue.length));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    editor.focus();
  };
  const addBookmarkAtCursor = () => {
    const liveContent = getEditorText();
    updateChapter(activeChapter.id, { content: liveContent });
    const fromPos = getCaretInnerOffset();
    const pos = Math.min(
      Math.max(0, fromPos != null ? fromPos : lastCaretInnerOffsetRef.current),
      liveContent.length
    );
    const snippet = String(liveContent.slice(pos, Math.min(liveContent.length, pos + 28))).trim() || '（空白处）';
    const chapterIndex = Math.max(0, chapters.findIndex((c) => c.id === activeChapter?.id));
    const item = {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chapterId: String(activeChapter?.id || ''),
      chapterTitle: String(activeChapter?.title || '未命名章节'),
      chapterIndex: chapterIndex >= 0 ? chapterIndex : 0,
      offset: pos,
      snippet,
      anchorBefore: '',
      anchorAfter: '',
      createdAt: Date.now()
    };
    setBookmarks([item, ...bookmarks]);
  };
  const deleteBookmark = (bookmarkId) => {
    setBookmarks(bookmarks.filter((b) => b.id !== bookmarkId));
  };

  const performBookmarkJump = (bookmark) => {
    if (!bookmark?.chapterId) return;
    if (draft) setDraft(null);
    const targetChapter = resolveChapterForBookmark(bookmark, chapters);
    if (!targetChapter) {
      window.alert('书签找不到对应章节（正文重载后章节 id 可能已变）。请删掉该书签后重新添加。');
      return;
    }
    const resolvedId = String(targetChapter.id);
    const plain = normalizePlain(String(targetChapter.content || ''));
    const off = clampBookmarkOffset(bookmark.offset, plain.length);
    const bookmarkPayload = { ...bookmark, offset: off };
    setPendingBookmarkJump({ chapterId: resolvedId, bookmark: bookmarkPayload });
    if (resolvedId !== String(activeChapterId)) {
      setActiveChapterId(resolvedId);
    }
  };

  const jumpToBookmark = (bookmark) => {
    if (!bookmark?.chapterId) return;
    if (draft) setDraft(null);
    if (isAiLoading || plannerBusy) {
      bookmarkJumpQueuedRef.current = bookmark;
      return;
    }
    performBookmarkJump(bookmark);
  };

  useEffect(() => {
    if (isAiLoading || plannerBusy) return;
    const queued = bookmarkJumpQueuedRef.current;
    if (!queued) return;
    bookmarkJumpQueuedRef.current = null;
    performBookmarkJump(queued);
  }, [isAiLoading, plannerBusy]);

  const findNext = () => {
    if (!findQuery) return;
    const text = getEditorText(), src = findCaseSensitive ? text : text.toLowerCase(), q = findCaseSensitive ? findQuery : findQuery.toLowerCase();
    let idx = src.indexOf(q, cursorPos);
    if (idx < 0) idx = src.indexOf(q, 0);
    if (idx < 0) { setFindHint('未找到匹配项'); return; }
    setFindHint(`匹配位置：${idx + 1}`);
    setSelectionByInnerOffsets(idx, idx + findQuery.length);
    setCursorPos(idx + findQuery.length);
  };

  const replaceOne = () => {
    if (!findQuery) return;
    const text = getEditorText(), src = findCaseSensitive ? text : text.toLowerCase(), q = findCaseSensitive ? findQuery : findQuery.toLowerCase();
    const currentStart = Math.max(0, cursorPos - findQuery.length);
    let idx = src.indexOf(q, currentStart);
    if (idx < 0) idx = src.indexOf(q, 0);
    if (idx < 0) { setFindHint('无可替换内容'); return; }
    const next = text.slice(0, idx) + replaceText + text.slice(idx + findQuery.length);
    updateChapter(activeChapter.id, { content: next });
    requestAnimationFrame(() => {
      setEditorText(next);
      const newEnd = idx + replaceText.length;
      setSelectionByInnerOffsets(idx, newEnd);
      setCursorPos(newEnd);
      setFindHint('已替换 1 处');
    });
  };

  const replaceAll = () => {
    if (!findQuery) return;
    const text = getEditorText(), escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reg = new RegExp(escaped, findCaseSensitive ? 'g' : 'gi');
    const matches = text.match(reg), count = matches ? matches.length : 0;
    if (!count) { setFindHint('无可替换内容'); return; }
    const next = text.replace(reg, replaceText);
    updateChapter(activeChapter.id, { content: next });
    requestAnimationFrame(() => {
      setEditorText(next);
      setCursorPos(0);
      setFindHint(`已替换 ${count} 处`);
    });
  };

  const renderEditorWithDraft = (baseText, d, syncOpts = {}) => {
    const editor = editorRef.current;
    if (!editor) return;
    const safeBase = String(baseText || '');
    const want = normalizePlain(safeBase);
    const forcePlainSync = !!syncOpts.forcePlainSync;

    // 与 getEditorText() 同一套归一化后再比较，否则会误判不相等并 setEditorText，抹掉刚设好的光标
    // 书签跳转时必须强制同步：innerText 与 state 偶有细微差异时会 early return，导致落光标与 DOM 不一致
    if (!forcePlainSync && !d && document.activeElement === editor) {
      const currentText = getEditorText();
      if (currentText === want) return;
    }

    if (!d || d.chapterId !== activeChapter?.id) {
      setEditorText(want);
      return;
    }
    const start = Math.max(0, Math.min(Number(d.start ?? 0), want.length));
    const end = Math.max(start, Math.min(Number(d.end ?? start), want.length));
    const insert = d.mode === 'polish' ? d.text : (d.text.startsWith('\n') ? d.text : `\n${d.text}`);
    editor.innerHTML = '';
    editor.appendChild(document.createTextNode(want.slice(0, start)));
    const ghost = document.createElement('span');
    ghost.className = 'text-stone-400 bg-stone-100/50 px-1 rounded mx-1 animate-pulse border-b border-stone-300';
    ghost.textContent = insert;
    editor.appendChild(ghost);
    editor.appendChild(document.createTextNode(want.slice(end)));
  };

  useLayoutEffect(() => {
    const pendingJump = pendingBookmarkJump;
    const bookmarkNeedsForceSync = !!(
      pendingJump && String(activeChapterId) === String(pendingJump.chapterId)
    );

    if (!acceptingDraftRef.current) {
      const isJumpingCurrent = pendingJump && String(activeChapterId) === String(pendingJump.chapterId);
      if (!isJumpingCurrent || draft) {
        renderEditorWithDraft(activeChapter?.content || '', draft, {
          forcePlainSync: bookmarkNeedsForceSync && !draft
        });
      }
    }

    if (draft) return;

    const editor = editorRef.current;
    if (!editor) return;

    const applyCaretAfterSync = (ch, rawOffset) => {
      const plainBm = normalizePlain(String(ch.content || ''));
      const pos = clampBookmarkOffset(rawOffset, plainBm.length);
      placeCaretAtPlainOffset(editor, plainBm, pos);
      setCursorPos(pos);
      lastCaretInnerOffsetRef.current = pos;
      editor.focus();
      try {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const range = sel.getRangeAt(0);
          const rects = range.getClientRects();
          const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
          const wrap = editorRef.current;
          if (wrap && rect) {
            const wrapRect = wrap.getBoundingClientRect();
            const targetScrollTop = wrap.scrollTop + (rect.top - wrapRect.top) - wrapRect.height / 2;
            wrap.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
          }
        }
      } catch (e) {
        console.error('Bookmark scroll error:', e);
      }
      queueMicrotask(() => refreshCaretUi());
    };

    if (!pendingJump) return;

    const id = String(pendingJump.chapterId);
    if (String(activeChapterId) !== id) return;
    const ch =
      chapters.find((c) => String(c.id) === id) ||
      resolveChapterForBookmark(pendingJump.bookmark, chapters);
    if (!ch) {
      setPendingBookmarkJump(null);
      return;
    }
    applyCaretAfterSync(ch, pendingJump.bookmark.offset);
    setPendingBookmarkJump(null);
  }, [
    activeChapter?.id,
    activeChapter?.content,
    draft,
    pendingBookmarkJump,
    activeChapterId,
    chapters
  ]);

  const refreshCaretUi = () => {
    if (draft || !editorRef.current || document.activeElement !== editorRef.current) { setCaretUi(prev => ({ ...prev, visible: false })); return; }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getClientRects()[0];
    const wrapRect = editorWrapRef.current.getBoundingClientRect();
    if (rect) {
      setCaretUi({ x: rect.left - wrapRect.left + 10, y: rect.top - wrapRect.top + 20, visible: true });
      const pre = range.cloneRange();
      pre.selectNodeContents(editorRef.current);
      pre.setEnd(range.endContainer, range.endOffset);
      const iEnd = normalizePlain(pre.toString()).length;
      const preStart = range.cloneRange();
      preStart.selectNodeContents(editorRef.current);
      preStart.setEnd(range.startContainer, range.startOffset);
      const iStart = normalizePlain(preStart.toString()).length;
      setCursorPos(iEnd);
      lastCaretInnerOffsetRef.current = iEnd;
      setSelectionRange({ start: iStart, end: iEnd, text: range.toString() });
    }
  };

  const handleEditorBlur = () => {
    const p = getCaretInnerOffset();
    if (p != null) lastCaretInnerOffsetRef.current = p;
    setCaretUi((prev) => ({ ...prev, visible: false }));
  };

  const requestContinuation = async ({
    start,
    end,
    taskType = 'continue',
    contentOverride = null,
    userDirection = '',
    selectedScrapbookIds: scrapIds = [],
    chapterContent = null
  }) => {
    const content =
      taskType === 'polish' && contentOverride != null
        ? String(contentOverride)
        : chapterContent != null
          ? String(chapterContent)
          : String(activeChapter?.content || '');
    const safeStart = Math.max(0, Math.min(start, content.length));
    const safeEnd = Math.max(safeStart, Math.min(end ?? safeStart, content.length));
    const isPolish = taskType === 'polish';
    const cMode = activeContinueMode;
    const pMode = activePolishMode;
    const mode = isPolish ? pMode : cMode;
    const refBefore = isPolish ? (pMode?.refBeforeChars ?? 1000) : (cMode?.referenceChars ?? 1000);
    const afterLen = isPolish ? (pMode?.refAfterChars ?? 300) : (cMode?.afterContextChars ?? 300);

    const beforeText = content.slice(Math.max(0, safeStart - refBefore), safeStart);
    const afterText = content.slice(safeEnd, Math.min(content.length, safeEnd + afterLen));
    const selectedText = isPolish ? content.slice(safeStart, safeEnd) : '';

    const activeScopeType = activeChapter?.scopeType || 'main';
    const chaptersForOverlap = chapters.filter((c) => (c.scopeType || 'main') === activeScopeType);
    const chapterIndex0 = Math.max(0, chaptersForOverlap.findIndex((c) => c.id === activeChapterId));
    const novelContentForOverlap = serializeChapters(chaptersForOverlap);
    const traceId = createTraceId();
    const requestPayload = {
      beforeText,
      afterText,
      selectedText,
      taskType,
      referenceChars: refBefore,
      targetLength: Number(cMode?.targetLength ?? 500),
      systemPrompt: String(mode?.systemPrompt || ''),
      userDirection: String(userDirection || ''),
      selectedScrapbookIds: scrapIds,
      simpleToolConfig: mode,
      overlapExcludeContext: {
        novelContent: novelContentForOverlap,
        chapterIndex: chapterIndex0,
        cursorInChapter: safeStart
      }
    };

    await logContinuationEvent({
      traceId,
      eventType: 'request',
      taskType,
      chapterId: activeChapter?.id || null,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: requestPayload
    });

    try {
      const result = await onContinueNovel(requestPayload);
      const responseText = String(result?.text || result || '');
      await logContinuationEvent({
        traceId,
        eventType: 'response',
        taskType,
        chapterId: activeChapter?.id || null,
        chapterTitle: activeChapter?.title || '',
        chapterScopeType: activeChapter?.scopeType || 'main',
        payload: {
          textPreview: responseText.slice(0, 2000),
          textLength: responseText.length,
          ragRefCounts: {
            novel: Array.isArray(result?.ragRefs?.novelRefs) ? result.ragRefs.novelRefs.length : 0,
            scrapbook: Array.isArray(result?.ragRefs?.scrapbookRefs) ? result.ragRefs.scrapbookRefs.length : 0,
            summary: Array.isArray(result?.ragRefs?.summaryRefs) ? result.ragRefs.summaryRefs.length : 0
          }
        }
      });
      if (result && typeof result === 'object') {
        return { ...result, __historyTraceId: traceId, __historyRequest: requestPayload };
      }
      return { text: String(result || ''), __historyTraceId: traceId, __historyRequest: requestPayload };
    } catch (e) {
      await logContinuationEvent({
        traceId,
        eventType: 'error',
        taskType,
        chapterId: activeChapter?.id || null,
        chapterTitle: activeChapter?.title || '',
        chapterScopeType: activeChapter?.scopeType || 'main',
        payload: {
          message: String(e?.message || e || 'unknown error')
        }
      });
      throw e;
    }
  };

  const handleGenerateAtCursor = async () => {
    if (draft) return;
    const livePos = getCaretOffset();
    const resolvedPos = typeof livePos === 'number' ? livePos : cursorPos;
    let liveSel = getSelectionOffsets();
    if (!liveSel && selectionRange.end > selectionRange.start) {
      liveSel = { start: selectionRange.start, end: selectionRange.end };
    }
    const hasSelection = !!(liveSel && liveSel.end > liveSel.start);
    
    if (hasSelection) {
      const taskType = 'polish';
      const start = liveSel.start;
      const end = liveSel.end;
      setCursorPos(resolvedPos);
      updateChapter(activeChapter.id, { content: getEditorText() });
      const editorContent = getEditorText();
      const originalText = editorContent.slice(start, end);
      const result = await requestContinuation({
        start, end, taskType,
        contentOverride: editorContent,
        selectedScrapbookIds: Array.from(selectedScrapbookIds)
      });
      const generated = String(result?.text || result || '').trim();
      const ragRefs = result?.ragRefs || { novelRefs: [], scrapbookRefs: [] };
      if (!generated) return;
      const traceId = result?.__historyTraceId || createTraceId();
      logContinuationEvent({
        traceId,
        eventType: 'draft_created',
        taskType,
        chapterId: activeChapter.id,
        chapterTitle: activeChapter?.title || '',
        chapterScopeType: activeChapter?.scopeType || 'main',
        payload: {
          draftMode: taskType,
          draftText: generated,
          originalText,
          start,
          end
        }
      });
      setLastRagRefs(ragRefs);
      setShowRagPanel(true);
      setDraft({ chapterId: activeChapter.id, start, end, mode: taskType, text: generated, originalText, traceId });
      setShowContinueSettings(false);
    } else {
      setContinueMode('select');
      setCursorPos(resolvedPos);
    }
  };

  const handleOpenPlanner = () => {
    if (draft) return;
    if (!activeTextEndpoint?.key) {
      alert('请先在设置中配置文本模型 API Key');
      return;
    }
    const liveContent = getEditorText();
    const livePos = getCaretOffset();
    const resolvedPos = typeof livePos === 'number' ? livePos : cursorPos;
    const resolvedPosInner = editorRef.current ? (() => {
      const c = rangeOffsetsToInnerOffsets(editorRef.current, resolvedPos, resolvedPos);
      return c ? c[0] : resolvedPos;
    })() : resolvedPos;
    const start = resolvedPosInner;
    const end = resolvedPosInner;
    const ps = normalizePlannerSettings(plannerSettings);
    const refChars = Number(ps.referenceChars || 1000);
    const afterPlanner = Math.max(0, Math.min(2000, Number(ps.afterContextChars ?? 300)));
    const safeStart = Math.max(0, Math.min(start, liveContent.length));
    const safeEnd = Math.max(safeStart, Math.min(end ?? safeStart, liveContent.length));
    const activeScopeType = activeChapter?.scopeType || 'main';
    const chaptersForPlannerAll = chapters.map((c) =>
      c.id === activeChapterId ? { ...c, content: liveContent } : c
    );
    const chaptersForPlanner = chaptersForPlannerAll.filter((c) => (c.scopeType || 'main') === activeScopeType);
    const chapterIndex0 = Math.max(0, chaptersForPlanner.findIndex((c) => c.id === activeChapterId));
    const beforeText = buildBeforeTextAcrossChapters(chaptersForPlanner, activeChapterId, safeStart, refChars);
    const afterText = liveContent.slice(safeEnd, Math.min(liveContent.length, safeEnd + afterPlanner));
    const inferredNo = inferChapterNoFromTitle(activeChapter?.title);
    const fallbackNo = chaptersForPlanner
      .slice(0, chapterIndex0 + 1)
      .filter((c) => !String(c?.title || '').includes('序章')).length;
    const chapterIndex1Based = Math.max(1, Number(inferredNo) > 0 ? Number(inferredNo) : fallbackNo || 1);
    const novelContentForRag = serializeChapters(chaptersForPlanner);
    const plannerTraceId = createTraceId();
    logContinuationEvent({
      traceId: plannerTraceId,
      eventType: 'planner_opened',
      taskType: 'continue',
      chapterId: activeChapter?.id || null,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: {
        referenceChars: refChars,
        targetLength: Number(ps.targetLength || 500),
        chapterIndex1Based
      }
    });
    setCursorPos(resolvedPosInner);
    updateChapter(activeChapter.id, { content: liveContent });
    setPlannerSessionKey((k) => k + 1);
    setPlannerSession({
      beforeText,
      afterText,
      referenceChars: refChars,
      plannerLabel: String(ps.label || '').trim() || '星辰续写',
      targetLength: Number(ps.targetLength || 500),
      plannerCollect: buildPlannerCollectPayload(ps),
      cursorPos: safeStart,
      cursorInChapter: safeStart,
      start: safeStart,
      end: safeEnd,
      chapterIndex1Based,
      chapterIndex0,
      novelContent: novelContentForRag,
      chapterScopeType: activeScopeType,
      chapterWorkId: activeChapter?.workId || 'main',
      traceId: plannerTraceId
    });
    setContinueMode(null);
    setShowContinueSettings(false);
  };

  const handlePlannerGenerateComplete = (prose) => {
    if (!plannerSession || !activeChapter) return;
    const generated = normalizeGeneratedText(prose);
    if (!generated) return;
    setLastRagRefs({ novelRefs: [], scrapbookRefs: [], summaryRefs: [], extractedKeywords: '', charSettingContext: '', selectedScrapbookContent: '', agentTrace: [] });
    setShowRagPanel(false);
    const plannerTraceId = plannerSession?.traceId || createTraceId();
    logContinuationEvent({
      traceId: plannerTraceId,
      eventType: 'draft_created',
      taskType: 'continue',
      chapterId: activeChapter.id,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: {
        draftMode: 'continue',
        source: 'planner',
        draftText: generated,
        start: plannerSession.start,
        end: plannerSession.end
      }
    });
    setDraft({
      chapterId: activeChapter.id,
      start: plannerSession.start,
      end: plannerSession.end,
      mode: 'continue',
      text: generated,
      originalText: '',
      traceId: plannerTraceId
    });
    setPlannerSession(null);
    setShowContinueSettings(false);
  };

  /** 进入简单续写：打开方向输入（沿用当前简单续写模式） */
  const openSimpleContinueFlow = () => {
    if (draft) return;
    const liveContent = getEditorText();
    const livePos = getCaretOffset();
    const resolvedPos = typeof livePos === 'number' ? livePos : cursorPos;
    const resolvedPosInner = editorRef.current
      ? (() => {
          const c = rangeOffsetsToInnerOffsets(editorRef.current, resolvedPos, resolvedPos);
          return c ? c[0] : resolvedPos;
        })()
      : resolvedPos;

    setCursorPos(resolvedPosInner);
    updateChapter(activeChapter.id, { content: liveContent });
    setContinueMode('free');
    setUserDirection('');
  };

  const handleExecuteContinue = async (direction) => {
    if (draft || !continueMode) return;
    const liveContent = getEditorText();
    updateChapter(activeChapter.id, { content: liveContent });
    const livePos = getCaretOffset();
    const resolvedPos = typeof livePos === 'number' ? livePos : cursorPos;
    const resolvedPosInner = editorRef.current ? (() => {
      const c = rangeOffsetsToInnerOffsets(editorRef.current, resolvedPos, resolvedPos);
      return c ? c[0] : resolvedPos;
    })() : resolvedPos;
    const start = resolvedPosInner;
    const end = resolvedPosInner;
    const result = await requestContinuation({
      start,
      end,
      taskType: 'continue',
      userDirection: direction,
      selectedScrapbookIds: Array.from(selectedScrapbookIds),
      chapterContent: liveContent
    });
    const generatedRaw = result?.text || result;
    const ragRefs = result?.ragRefs || { novelRefs: [], scrapbookRefs: [] };
    const generated = normalizeGeneratedText(generatedRaw);
    if (!generated) return;
    const traceId = result?.__historyTraceId || createTraceId();
    logContinuationEvent({
      traceId,
      eventType: 'draft_created',
      taskType: 'continue',
      chapterId: activeChapter.id,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: {
        draftMode: 'continue',
        draftText: generated,
        userDirection: direction,
        start,
        end
      }
    });
    setLastRagRefs(ragRefs);
    setShowRagPanel(true);
    setDraft({ chapterId: activeChapter.id, start, end, mode: 'continue', text: generated, originalText: '', traceId });
    setContinueMode(null);
    setUserDirection('');
    setShowContinueSettings(false);
  };

  const acceptingDraftRef = useRef(false);
  const acceptDraft = () => {
    if (!draft) return;
    const base = String(activeChapter.content || ''), insert = draft.mode === 'polish' ? draft.text : (draft.text.startsWith('\n') ? draft.text : `\n${draft.text}`);
    const next = base.slice(0, draft.start) + insert + base.slice(draft.end);
    logContinuationEvent({
      traceId: draft?.traceId || createTraceId(),
      eventType: 'draft_accepted',
      taskType: draft?.mode || 'continue',
      chapterId: activeChapter?.id || null,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: {
        start: draft.start,
        end: draft.end,
        acceptedText: draft.text,
        originalText: draft.originalText || ''
      }
    });
    acceptingDraftRef.current = true; setDraft(null); updateChapter(activeChapter.id, { content: next });
    requestAnimationFrame(() => { if (editorRef.current) editorRef.current.innerText = next; acceptingDraftRef.current = false; });
  };
  const rejectDraft = () => {
    if (!draft) return;
    logContinuationEvent({
      traceId: draft?.traceId || createTraceId(),
      eventType: 'draft_rejected',
      taskType: draft?.mode || 'continue',
      chapterId: activeChapter?.id || null,
      chapterTitle: activeChapter?.title || '',
      chapterScopeType: activeChapter?.scopeType || 'main',
      payload: {
        start: draft.start,
        end: draft.end,
        rejectedText: draft.text,
        originalText: draft.originalText || ''
      }
    });
    setDraft(null);
  };

  return (
    <div className="w-full h-full max-w-[1440px] mx-auto flex flex-col pt-8 px-8 overflow-y-auto custom-scrollbar relative z-20 pb-20 animate-fade-in text-stone-800">
      {/* 头部状态条 */}
      <div className="flex justify-between items-end mb-6 border-b-2 border-stone-800/10 pb-6">
        <div className="relative">
          <h2 className="text-4xl font-serif font-black tracking-[0.2em] text-stone-900 drop-shadow-sm">正文内容</h2>
          <div className="absolute -bottom-1 left-0 w-12 h-1 bg-indigo-800"></div>
          <p className="text-stone-500 text-[10px] font-bold tracking-[0.3em] mt-4 uppercase opacity-60 font-serif italic">沉淀为可检索的语义档案</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end mr-4">
            <span className="text-[10px] font-black text-stone-400 tracking-widest uppercase">全卷规模</span>
            <span className="text-xs font-bold text-stone-600 tracking-tighter">
              本章: <span className="text-indigo-700">{activeCount}</span> <span className="mx-1 opacity-20">/</span> 总计: <span className="text-stone-900">{totalCount}</span>
            </span>
          </div>
          <button onClick={addChapter} className="px-5 py-2 rounded-xl bg-white border border-stone-200 hover:border-indigo-300 hover:text-indigo-700 text-stone-600 text-xs font-bold tracking-widest transition-all shadow-sm active:scale-95">+ 新增卷轴</button>
          <button onClick={addPrequel} className="px-5 py-2 rounded-xl bg-white border border-rose-200 hover:border-rose-400 hover:text-rose-700 text-rose-600 text-xs font-bold tracking-widest transition-all shadow-sm active:scale-95">+ 新增前传</button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addBookmarkAtCursor}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-amber-200 hover:border-amber-400 hover:text-amber-700 text-amber-600 text-xs font-bold tracking-widest transition-all shadow-sm active:scale-95"
          >
            <BookmarkPlus size={14} /> 添加书签
          </button>
          <button onClick={() => setShowFindReplace(v => !v)} className={`flex items-center gap-2 px-5 py-2 rounded-xl border transition-all text-xs font-bold tracking-widest shadow-sm ${showFindReplace ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'}`}><Search size={14} /> 检索替换</button>
          <button
            type="button"
            onClick={() => setShowContinuationHistoryPanel((v) => !v)}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl border transition-all text-xs font-bold tracking-widest shadow-sm ${
              showContinuationHistoryPanel
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            <History size={14} /> 续写历史
          </button>
          <button onClick={onSaveNow} className="flex items-center gap-2 px-6 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-50 text-xs font-bold tracking-widest shadow-xl active:scale-95 border border-stone-700"><Save size={16} /> 存档记录</button>
        </div>
      </div>

      {showFindReplace && (
        <div className="mb-6 bg-white/80 backdrop-blur-xl border border-stone-200 rounded-2xl p-4 shadow-xl ring-1 ring-black/5 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3">
            <input value={findQuery} onChange={(e) => setFindQuery(e.target.value)} placeholder="查找内容..." className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-sm outline-none focus:border-indigo-400 font-serif shadow-inner" />
            <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="替换内容..." className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-sm outline-none focus:border-indigo-400 font-serif shadow-inner" />
            <button onClick={findNext} className="px-6 py-2 rounded-xl bg-stone-900 text-white text-xs font-bold tracking-widest hover:bg-indigo-700 transition-colors shadow-lg">查找下一个</button>
            <button onClick={replaceOne} className="px-6 py-2 rounded-xl bg-white border border-stone-300 text-xs font-bold tracking-widest hover:border-stone-900 transition-colors shadow-sm">替换当前</button>
          </div>
          <div className="mt-3 flex items-center justify-between px-1">
            <label className="text-[10px] font-bold text-stone-500 uppercase flex items-center gap-2 cursor-pointer hover:text-stone-800 transition-colors">
              <input type="checkbox" checked={findCaseSensitive} onChange={(e) => setFindCaseSensitive(e.target.checked)} className="w-3 h-3 rounded" /> 区分大小写
            </label>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-black text-indigo-600 tracking-widest uppercase animate-pulse">{findHint}</span>
              <button onClick={replaceAll} className="px-4 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-[10px] font-bold text-stone-600 uppercase tracking-widest">全部替换</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <input 
          value={novel?.title === '未命名正文' ? '' : novel?.title} 
          onChange={(e) => setNovel(prev => ({ ...prev, title: e.target.value }))} 
          placeholder="作品标题..." 
          className="w-full text-2xl font-serif font-black bg-transparent border-none outline-none text-stone-900 mb-2 placeholder-stone-200 tracking-[0.1em]" 
        />
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 h-[70vh] min-h-[500px]">
          {/* 左侧：章节索引 */}
          <div className="border border-stone-200/60 rounded-2xl bg-white/40 backdrop-blur-md p-4 h-full min-h-0 overflow-y-auto shadow-sm [scrollbar-width:thin]">
            <div className="text-[10px] font-black text-stone-400 tracking-[0.2em] uppercase mb-4 px-2 border-b border-stone-100 pb-2">卷轴目录索引</div>
            <div className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50/70 p-2.5 shadow-sm ring-1 ring-amber-100/60">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-800 tracking-widest uppercase mb-2 px-0.5">
                <Bookmark size={12} className="text-amber-600 shrink-0" /> 书签
              </div>
              <div className="text-[11px] leading-snug divide-y divide-amber-100/80">
                {bookmarks.length === 0 ? (
                  <div className="text-amber-600/80 py-1 px-0.5">暂无</div>
                ) : (
                  bookmarks.map((b) => {
                    const chForBm = resolveChapterForBookmark(b, chapters);
                    const plainForBm = chForBm ? normalizePlain(String(chForBm.content || '')) : '';
                    const snippetPreview =
                      plainForBm.length > 0
                        ? String(plainForBm.slice(b.offset, b.offset + 40) || '').trim() || b.snippet || ''
                        : b.snippet || '';
                    const tip = snippetPreview ? `「${snippetPreview.replace(/\s+/g, ' ')}」` : '';
                    return (
                      <div
                        key={b.id}
                        className="flex items-center gap-1 py-1.5 first:pt-0 rounded-md px-1 -mx-0.5 hover:bg-amber-100/60 transition-colors"
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          title={tip || undefined}
                          onClick={() => jumpToBookmark(b)}
                          className="min-w-0 flex-1 text-left truncate font-medium text-amber-950 hover:text-amber-900"
                        >
                          <span className="text-amber-900/90">{b.chapterTitle || '未命名'}</span>
                          <span className="text-amber-400 mx-1">·</span>
                          <span className="tabular-nums text-amber-700/90">{b.offset + 1}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBookmark(b.id);
                          }}
                          className="shrink-0 text-amber-300 hover:text-red-600 px-0.5 text-sm leading-none"
                          aria-label="删除书签"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="space-y-2">
              {chapters.map((c, idx) => {
                const isPrequel = c.scopeType === 'prequel';
                const roleAccent = isPrequel ? getRoleAccent(c.characterName) : '';
                const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(roleAccent);
                const isActive = c.id === activeChapterId;
                const prequelRoleBarActive = isPrequel && isHex && isActive;
                const activeCls = 'bg-indigo-600 border-indigo-500 shadow-md translate-x-1';
                const idleCls = 'bg-white/60 border-transparent hover:border-stone-200 hover:bg-white';
                const style = !isPrequel || !isHex
                  ? undefined
                  : (isActive
                    ? { backgroundColor: roleAccent, borderColor: roleAccent, boxShadow: `0 6px 16px ${roleAccent}66` }
                    : undefined);
                const badgeCls = !isActive
                  ? 'text-stone-400'
                  : prequelRoleBarActive
                    ? 'text-white/80'
                    : 'text-indigo-200';
                const activeRowIconCls = prequelRoleBarActive ? 'text-white hover:bg-white/15' : 'text-white hover:bg-indigo-500';
                const titleIdleCls = 'text-stone-700 placeholder-stone-300';
                const idxLabel = String(idx + 1).padStart(2, '0');
                const prequelBadgeChevronCls =
                  isHex && !isActive
                    ? 'text-stone-400'
                    : badgeCls;
                return (
                <div key={c.id} onClick={() => setActiveChapterId(c.id)} className={`group relative p-3 rounded-xl transition-all duration-300 cursor-pointer border ${isActive ? activeCls : idleCls}`} style={style}>
                  <div className="flex flex-col">
                    {isPrequel ? (
                      <div className="flex items-center justify-between gap-1 mb-1 min-w-0">
                        {isHex ? (
                          <span className="text-[9px] font-black uppercase tracking-tighter flex items-baseline gap-1 min-w-0">
                            <span
                              style={prequelRoleBarActive ? undefined : { color: roleAccent }}
                              className={prequelRoleBarActive ? 'text-white shrink-0' : 'shrink-0'}
                            >
                              前传
                            </span>
                            <span
                              className={
                                !isActive
                                  ? 'text-stone-400 tabular-nums'
                                  : prequelRoleBarActive
                                    ? 'text-white/80 tabular-nums'
                                    : 'text-indigo-200 tabular-nums'
                              }
                            >
                              {idxLabel}
                            </span>
                          </span>
                        ) : (
                          <span className={`text-[9px] font-black uppercase tracking-tighter ${badgeCls}`}>
                            前传 {idxLabel}
                          </span>
                        )}
                        <button
                          type="button"
                          title={prequelBindingOpenId === c.id ? '收起绑定角色' : '展开绑定角色'}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveChapterId(c.id);
                            setPrequelBindingOpenId((id) => (id === c.id ? null : c.id));
                          }}
                          className={`shrink-0 p-0.5 rounded outline-none transition-transform ${prequelBadgeChevronCls} ${prequelBindingOpenId === c.id ? 'rotate-180' : ''}`}
                          aria-expanded={prequelBindingOpenId === c.id}
                          aria-label="绑定角色"
                        >
                          <ChevronDown size={12} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : (
                      <span className={`text-[9px] font-black uppercase tracking-tighter mb-1 ${badgeCls}`}>
                        卷录 {idxLabel}
                      </span>
                    )}
                    <input value={c.title || ''} onClick={() => setActiveChapterId(c.id)} onChange={(e) => updateChapter(c.id, { title: e.target.value })} className={`w-full text-left bg-transparent outline-none border-none text-xs font-bold tracking-widest ${isActive ? 'text-white placeholder-white/40' : titleIdleCls}`} placeholder={`第${idx + 1}章`} />
                    {isPrequel && prequelBindingOpenId === c.id && (
                      <input
                        type="text"
                        value={c.characterName ?? ''}
                        placeholder="绑定角色名（与资料一致）"
                        title="与角色册姓名完全一致时可套用主题色"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setActiveChapterId(c.id); }}
                        onChange={(e) => updateChapter(c.id, { characterName: e.target.value })}
                        className={`w-full text-left bg-transparent outline-none border-none text-xs font-bold tracking-widest mt-1 opacity-90 ${isActive ? 'text-white placeholder-white/35' : titleIdleCls}`}
                      />
                    )}
                  </div>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveChapter(c.id, -1); }}
                      className={`p-1 rounded-md ${isActive ? activeRowIconCls : 'text-stone-300 hover:text-indigo-500'}`}
                      disabled={idx === 0}
                      title="上移"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveChapter(c.id, 1); }}
                      className={`p-1 rounded-md ${isActive ? activeRowIconCls : 'text-stone-300 hover:text-indigo-500'}`}
                      disabled={idx === chapters.length - 1}
                      title="下移"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteChapter(c.id); }} className={`p-1 rounded-md ${isActive ? activeRowIconCls : 'text-stone-300 hover:text-red-500'}`} disabled={chapters.length <= 1} title="删除章节"><X size={12} /></button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* 右侧：宣纸编辑器 */}
          <div ref={editorWrapRef} className="border border-stone-200/80 rounded-2xl p-10 bg-[#fcfaf2] relative h-full min-h-0 overflow-x-hidden overflow-y-visible flex flex-col shadow-inner ring-1 ring-black/5 isolate">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-multiply" style={{backgroundImage: `url("https://www.transparenttextures.com/patterns/handmade-paper.png")`}}></div>
            
            <div className="flex items-center justify-between mb-8 border-b border-stone-200/60 pb-4 relative z-10">
              <input value={activeChapter?.title || ''} onChange={(e) => updateChapter(activeChapter.id, { title: e.target.value })} placeholder="输入本章命题..." className="flex-1 text-xl font-serif font-black bg-transparent border-none outline-none text-stone-900 tracking-widest" />
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <button onClick={applyIndentToCurrentChapter} className="px-4 py-1.5 rounded-full border border-stone-200 hover:border-indigo-300 hover:text-indigo-700 text-stone-400 text-[10px] font-black tracking-widest transition-all uppercase">段首缩进整理</button>
                  {!continueMode && !isAiLoading && !plannerBusy && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleGenerateAtCursor}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-[10px] font-black tracking-widest transition-all shadow-sm ${selectionRange.end > selectionRange.start ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-200/80' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-200/80'}`}
                      title={selectionRange.end > selectionRange.start ? '对选区润色' : '在光标处续写'}
                    >
                      <Wand2 size={12} /> {selectionRange.end > selectionRange.start ? '润色' : '续写'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowContinueSettings((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black tracking-widest transition-all uppercase ${showContinueSettings ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-stone-200 text-stone-500 hover:border-indigo-300 hover:text-indigo-800'}`}
                  >
                    <Settings2 size={14} /> 智笔参数
                  </button>
                  {(isAiLoading || plannerBusy) && (
                    <div className="flex items-center gap-2 text-indigo-600 animate-pulse text-xs font-bold tracking-widest">
                      <RefreshCw size={14} className="animate-spin" /> 智笔调度中...
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div ref={editorRef} contentEditable={!draft && !isAiLoading && !plannerBusy} suppressContentEditableWarning onFocus={refreshCaretUi} onBlur={handleEditorBlur} onInput={handleEditorInput} onKeyDown={handleKeyDown} onClick={refreshCaretUi} onKeyUp={refreshCaretUi} onMouseUp={refreshCaretUi} className={`w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-transparent border-none outline-none text-stone-800 leading-[2.2] text-[17px] font-serif whitespace-pre-wrap relative z-10 ${draft || isAiLoading || plannerBusy ? 'cursor-wait select-none opacity-80' : ''}`} style={{ wordBreak: 'break-word', textJustify: 'inter-character' }} />

            {/* 简单续写 / 润色：多模式配置（与「续写规划」独立） */}
            {showContinueSettings && (
              <div
                className="absolute z-[60] w-[min(32rem,94vw)] max-h-[min(52vh,calc(100%-6rem))] overflow-y-auto bg-white border border-stone-200 rounded-2xl p-3 shadow-2xl animate-fade-in ring-1 ring-black/5 [scrollbar-width:thin]"
                style={{
                  right: '0.75rem',
                  top: '5.25rem'
                }}
              >
                <div className="text-[10px] font-black text-stone-400 tracking-widest uppercase mb-2 flex justify-between">
                  <span>魔杖参数</span>
                  <X size={12} className="cursor-pointer hover:text-red-500 shrink-0" onClick={() => setShowContinueSettings(false)} />
                </div>
                <p className="text-[9px] text-stone-400 mb-2 leading-relaxed">「简单续写」「润色」与「星辰续写规划」分栏配置，互不影响。</p>
                <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-stone-200 p-0.5 mb-3 bg-stone-50/80">
                  <button
                    type="button"
                    onClick={() => setSimpleSettingsTab('continue')}
                    className={`py-1.5 rounded-md text-[9px] font-black tracking-widest transition-all leading-tight ${simpleSettingsTab === 'continue' ? 'bg-white shadow-sm text-indigo-800' : 'text-stone-500 hover:text-stone-800'}`}
                  >
                    简单续写
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimpleSettingsTab('polish')}
                    className={`py-1.5 rounded-md text-[9px] font-black tracking-widest transition-all ${simpleSettingsTab === 'polish' ? 'bg-white shadow-sm text-emerald-800' : 'text-stone-500 hover:text-stone-800'}`}
                  >
                    润色
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimpleSettingsTab('planner')}
                    className={`py-1.5 rounded-md text-[9px] font-black tracking-widest transition-all ${simpleSettingsTab === 'planner' ? 'bg-white shadow-sm text-amber-800' : 'text-stone-500 hover:text-stone-800'}`}
                  >
                    星辰规划
                  </button>
                </div>

                {simpleSettingsTab === 'continue' && activeContinueMode && (
                  <div className="space-y-2.5 text-stone-800">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="flex-1 min-w-[10rem] p-2 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold outline-none"
                        value={simpleModes.activeContinueModeId}
                        onChange={(e) => setSimpleModes((s) => ({ ...s, activeContinueModeId: e.target.value }))}
                      >
                        {simpleModes.continueModes.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={addContinueMode} className="px-2 py-1.5 rounded-lg border border-indigo-200 text-[9px] font-black text-indigo-700 hover:bg-indigo-50">＋</button>
                      <button type="button" onClick={renameActiveContinueMode} className="px-2 py-1.5 rounded-lg border border-stone-200 text-[9px] font-black text-stone-600">改名</button>
                      <button type="button" onClick={deleteActiveContinueMode} className="px-2 py-1.5 rounded-lg border border-red-100 text-[9px] font-black text-red-600 hover:bg-red-50">删</button>
                    </div>

                    <label className="flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold text-stone-500">参考角色设定</span>
                      <input type="checkbox" checked={activeContinueMode.useCharacterContext !== false} onChange={(e) => patchContinueMode({ useCharacterContext: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-stone-300" />
                    </label>
                    <label className="flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold text-stone-500">启用 RAG 召回</span>
                      <input type="checkbox" checked={activeContinueMode.useRag !== false} onChange={(e) => patchContinueMode({ useRag: e.target.checked })} className="w-4 h-4 rounded text-indigo-600 border-stone-300" />
                    </label>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">小说条数</label>
                        <input type="number" min={0} max={24} value={activeContinueMode.ragCounts.novel} onChange={(e) => patchContinueMode({ ragCounts: { ...activeContinueMode.ragCounts, novel: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">笔记条数</label>
                        <input type="number" min={0} max={24} value={activeContinueMode.ragCounts.scrapbook} onChange={(e) => patchContinueMode({ ragCounts: { ...activeContinueMode.ragCounts, scrapbook: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">摘要条数</label>
                        <input type="number" min={0} max={24} value={activeContinueMode.ragCounts.summary} onChange={(e) => patchContinueMode({ ragCounts: { ...activeContinueMode.ragCounts, summary: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">光标前参考字数</label>
                        <input type="number" value={activeContinueMode.referenceChars} onChange={(e) => patchContinueMode({ referenceChars: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">光标后参考字数</label>
                        <input type="number" value={activeContinueMode.afterContextChars} onChange={(e) => patchContinueMode({ afterContextChars: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">目标字数</label>
                        <input type="number" value={activeContinueMode.targetLength} onChange={(e) => patchContinueMode({ targetLength: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-stone-500 mb-0.5">温度</label>
                      <input type="number" step={0.05} min={0} max={2} value={activeContinueMode.temperature} onChange={(e) => patchContinueMode({ temperature: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-700 mb-1">系统提示词</label>
                      <textarea
                        value={activeContinueMode.systemPrompt}
                        onChange={(e) => patchContinueMode({ systemPrompt: e.target.value })}
                        className="w-full h-20 p-2 rounded-xl bg-stone-50 border border-indigo-100 text-[11px] font-serif outline-none resize-y focus:border-indigo-300 leading-relaxed"
                      />
                    </div>
                  </div>
                )}

                {simpleSettingsTab === 'planner' && (
                  <div className="space-y-2.5 text-stone-800">
                    <label className="block">
                      <span className="text-[9px] font-bold text-stone-500">面板名称（仅展示）</span>
                      <input
                        type="text"
                        value={plannerSettings.label}
                        onChange={(e) => patchPlannerSettings({ label: e.target.value })}
                        className="mt-1 w-full p-2 rounded-lg bg-amber-50/80 border border-amber-100 text-[11px] font-bold outline-none focus:border-amber-300"
                        placeholder="星辰续写"
                      />
                    </label>
                    <p className="text-[9px] text-amber-900/70 leading-relaxed">
                      以下仅作用于「星辰续写规划」：上下文截取、服务端 RAG 聚合条数、阶段 3 正文目标；与简单续写模式无关。
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">光标前参考字数</label>
                        <input
                          type="number"
                          min={200}
                          max={8000}
                          value={plannerSettings.referenceChars}
                          onChange={(e) => patchPlannerSettings({ referenceChars: Number(e.target.value) })}
                          className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">光标后参考字数</label>
                        <input
                          type="number"
                          min={0}
                          max={2000}
                          value={plannerSettings.afterContextChars}
                          onChange={(e) => patchPlannerSettings({ afterContextChars: Number(e.target.value) })}
                          className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">正文目标字数（阶段 3）</label>
                        <input
                          type="number"
                          min={120}
                          max={1200}
                          value={plannerSettings.targetLength}
                          onChange={(e) => patchPlannerSettings({ targetLength: Number(e.target.value) })}
                          className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-amber-100/80 space-y-2">
                      <div className="text-[9px] font-black text-amber-900/80 tracking-widest uppercase">阶段 1 · 审题（/api/rag/planner/collect）</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">摘要命中条数</label>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={plannerSettings.phase1Summary}
                            onChange={(e) => patchPlannerSettings({ phase1Summary: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">笔记命中条数</label>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={plannerSettings.phase1Scrapbook}
                            onChange={(e) => patchPlannerSettings({ phase1Scrapbook: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">向量候选池</label>
                          <input
                            type="number"
                            min={8}
                            max={128}
                            value={plannerSettings.phase1SearchPool}
                            onChange={(e) => patchPlannerSettings({ phase1SearchPool: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-amber-100/80 space-y-2">
                      <div className="text-[9px] font-black text-amber-900/80 tracking-widest uppercase">阶段 2 · 轮回检索</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">摘要条数</label>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={plannerSettings.phase2Summary}
                            onChange={(e) => patchPlannerSettings({ phase2Summary: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">笔记条数</label>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={plannerSettings.phase2Scrapbook}
                            onChange={(e) => patchPlannerSettings({ phase2Scrapbook: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">向量候选池</label>
                          <input
                            type="number"
                            min={8}
                            max={128}
                            value={plannerSettings.phase2SearchPool}
                            onChange={(e) => patchPlannerSettings({ phase2SearchPool: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-stone-500 mb-0.5">笔记关键词补充</label>
                          <input
                            type="number"
                            min={0}
                            max={48}
                            value={plannerSettings.phase2KeywordExtra}
                            onChange={(e) => patchPlannerSettings({ phase2KeywordExtra: Number(e.target.value) })}
                            className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-amber-100/80 space-y-2">
                      <div className="text-[9px] font-black text-amber-900/80 tracking-widest uppercase">共通</div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">角色档案最多条数（名称命中）</label>
                        <input
                          type="number"
                          min={0}
                          max={48}
                          value={plannerSettings.characterProfileMax}
                          onChange={(e) => patchPlannerSettings({ characterProfileMax: Number(e.target.value) })}
                          className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold"
                        />
                        <p className="text-[8px] text-stone-400 mt-0.5">0 表示不注入角色块</p>
                      </div>
                    </div>
                  </div>
                )}

                {simpleSettingsTab === 'polish' && activePolishMode && (
                  <div className="space-y-2.5 text-stone-800">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="flex-1 min-w-[10rem] p-2 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold outline-none"
                        value={simpleModes.activePolishModeId}
                        onChange={(e) => setSimpleModes((s) => ({ ...s, activePolishModeId: e.target.value }))}
                      >
                        {simpleModes.polishModes.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={addPolishMode} className="px-2 py-1.5 rounded-lg border border-emerald-200 text-[9px] font-black text-emerald-700 hover:bg-emerald-50">＋</button>
                      <button type="button" onClick={renameActivePolishMode} className="px-2 py-1.5 rounded-lg border border-stone-200 text-[9px] font-black text-stone-600">改名</button>
                      <button type="button" onClick={deleteActivePolishMode} className="px-2 py-1.5 rounded-lg border border-red-100 text-[9px] font-black text-red-600 hover:bg-red-50">删</button>
                    </div>

                    <label className="flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold text-stone-500">参考角色设定</span>
                      <input type="checkbox" checked={activePolishMode.useCharacterContext !== false} onChange={(e) => patchPolishMode({ useCharacterContext: e.target.checked })} className="w-4 h-4 rounded text-emerald-600 border-stone-300" />
                    </label>
                    <label className="flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold text-stone-500">启用 RAG 召回</span>
                      <input type="checkbox" checked={activePolishMode.useRag !== false} onChange={(e) => patchPolishMode({ useRag: e.target.checked })} className="w-4 h-4 rounded text-emerald-600 border-stone-300" />
                    </label>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">小说条数</label>
                        <input type="number" min={0} max={24} value={activePolishMode.ragCounts.novel} onChange={(e) => patchPolishMode({ ragCounts: { ...activePolishMode.ragCounts, novel: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">笔记条数</label>
                        <input type="number" min={0} max={24} value={activePolishMode.ragCounts.scrapbook} onChange={(e) => patchPolishMode({ ragCounts: { ...activePolishMode.ragCounts, scrapbook: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">摘要条数</label>
                        <input type="number" min={0} max={24} value={activePolishMode.ragCounts.summary} onChange={(e) => patchPolishMode({ ragCounts: { ...activePolishMode.ragCounts, summary: Number(e.target.value) } })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">选区前参考字数</label>
                        <input type="number" value={activePolishMode.refBeforeChars} onChange={(e) => patchPolishMode({ refBeforeChars: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-500 mb-0.5">选区后参考字数</label>
                        <input type="number" value={activePolishMode.refAfterChars} onChange={(e) => patchPolishMode({ refAfterChars: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-stone-500 mb-0.5">温度</label>
                      <input type="number" step={0.05} min={0} max={2} value={activePolishMode.temperature} onChange={(e) => patchPolishMode({ temperature: Number(e.target.value) })} className="w-full p-1.5 rounded-lg bg-stone-50 border border-stone-200 text-[11px] font-bold" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-800 mb-1">系统提示词</label>
                      <textarea
                        value={activePolishMode.systemPrompt}
                        onChange={(e) => patchPolishMode({ systemPrompt: e.target.value })}
                        className="w-full h-20 p-2 rounded-xl bg-stone-50 border border-emerald-100 text-[11px] font-serif outline-none resize-y focus:border-emerald-300 leading-relaxed"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 模式选择面板 */}
            {continueMode === 'select' && (
              <div className="absolute z-30 inset-x-10 bottom-10 bg-white/95 backdrop-blur-xl border border-indigo-100 rounded-2xl p-6 shadow-2xl animate-fade-in ring-1 ring-indigo-500/10">
                <div className="text-center mb-2">
                  <div className="text-xs font-black tracking-widest text-indigo-900 uppercase">简单续写 · 选方式</div>
                  <div className="text-[10px] text-stone-500 font-bold mt-1.5">
                    当前续写模式：<span className="text-indigo-700">「{String(activeContinueMode?.name || '未命名').trim() || '未命名'}」</span>
                    <span className="text-stone-400 mx-1">·</span>
                    光标前 <span className="tabular-nums text-stone-700">{Number(activeContinueMode?.referenceChars || 1000)}</span> 字
                    <span className="text-stone-400 mx-1">·</span>
                    后 <span className="tabular-nums text-stone-700">{Number(activeContinueMode?.afterContextChars ?? 300)}</span> 字
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 mt-4">
                  <button
                    type="button"
                    onClick={openSimpleContinueFlow}
                    className="py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black tracking-wide shadow-xl active:scale-95 transition-all"
                  >
                    {String(activeContinueMode?.name || '').trim() || '未命名模式'}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenPlanner}
                    className="py-3 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black tracking-widest shadow-xl active:scale-95 transition-all flex flex-col items-center justify-center gap-1 leading-snug"
                  >
                    <span className="flex items-center gap-2"><Sparkles size={14} /> 星辰续写规划</span>
                    <span className="text-[9px] font-bold opacity-90 normal-case tracking-wide text-amber-100/95">
                      审题前 {plannerUi.referenceChars} 字 · 目标约 {plannerUi.targetLength} 字
                    </span>
                  </button>
                  <button onClick={() => setContinueMode(null)} className="py-3 rounded-xl bg-white border border-stone-200 text-stone-600 text-[10px] font-black tracking-widest hover:border-stone-400 transition-all">取消</button>
                </div>
              </div>
            )}

            {/* 自由续写输入 */}
            {continueMode === 'free' && (
              <div className="absolute z-30 inset-x-10 bottom-10 bg-white/95 backdrop-blur-xl border border-indigo-100 rounded-2xl p-6 shadow-2xl animate-fade-in flex flex-col">
                <div className="text-[10px] font-black tracking-widest text-indigo-900 uppercase mb-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                    <span>请输入续写方向引导</span>
                  </div>
                  <div className="text-[9px] font-bold text-stone-500 normal-case tracking-wide pl-3.5">模式「{String(activeContinueMode?.name || '…').trim()}」</div>
                </div>
                <textarea value={userDirection} onChange={(e) => setUserDirection(e.target.value)} placeholder="在此处落笔，描述接下来的剧情走向..." className="w-full h-24 p-4 rounded-xl bg-stone-50 border border-stone-100 text-sm font-serif outline-none resize-none mb-4 focus:border-indigo-400 shadow-inner" />
                <div className="flex items-center gap-3 justify-end">
                  <button onClick={() => handleExecuteContinue(userDirection)} disabled={isAiLoading || !userDirection.trim()} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-widest shadow-lg active:scale-95 flex items-center gap-2">
                    {isAiLoading ? <RefreshCw size={12} className="animate-spin" /> : <ChevronRight size={14} />} 执行创作
                  </button>
                  <button onClick={() => { setContinueMode(null); setUserDirection(''); }} className="px-6 py-2.5 rounded-xl bg-white border border-stone-200 text-stone-600 text-[10px] font-black tracking-widest hover:border-stone-400 transition-all">取消</button>
                </div>
              </div>
            )}

            {/* 草稿预览面板 */}
            {draft && (
              <div className="absolute z-30 inset-x-10 bottom-10 bg-white border border-stone-200 rounded-2xl p-6 shadow-2xl animate-fade-in flex flex-col ring-1 ring-black/5 text-stone-800">
                <div className="text-[10px] font-black tracking-widest text-stone-400 uppercase mb-3 flex items-center justify-between">
                  <span>{draft.mode === 'polish' ? '智笔润色对比' : '智笔草案预览'}</span> 
                  <span className="text-[9px] font-bold italic opacity-60">接受前可在框内手动修正</span>
                </div>
                
                <div className={`grid gap-4 mb-4 ${draft.mode === 'polish' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {draft.mode === 'polish' && (
                    <div className="flex flex-col">
                      <div className="text-[9px] font-black text-stone-400 uppercase mb-2 ml-1 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-stone-300"></div> 原文参考
                      </div>
                      <div className="flex-1 p-4 rounded-xl bg-stone-50 border border-stone-100 text-[13px] font-serif text-stone-500 leading-relaxed overflow-y-auto max-h-[200px] custom-scrollbar shadow-inner opacity-80">
                        {draft.originalText || '（无原文记录）'}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <div className="text-[9px] font-black text-emerald-600 uppercase mb-2 ml-1 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> {draft.mode === 'polish' ? '润色方案' : '续写方案'}
                    </div>
                    <textarea 
                      value={draft.text} 
                      onChange={(e) => setDraft({ ...draft, text: e.target.value })} 
                      className="w-full h-[200px] p-4 rounded-xl bg-white border border-emerald-100 text-[14px] font-serif outline-none resize-none focus:border-emerald-400 leading-relaxed shadow-sm transition-colors" 
                      placeholder="AI 生成的内容..."
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-end pt-2 border-t border-stone-50">
                  <button onClick={acceptDraft} className="px-6 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-[10px] font-black tracking-widest shadow-xl active:scale-95 flex items-center gap-2 transition-all">
                    <Check size={14} /> 采纳并写入
                  </button>
                  <button onClick={rejectDraft} className="px-6 py-2.5 rounded-xl bg-white border border-stone-200 text-stone-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50/30 text-[10px] font-black tracking-widest transition-all active:scale-95 flex items-center gap-2">
                    <X size={14} /> 放弃此稿
                  </button>
                </div>
              </div>
            )}

            {showContinuationHistoryPanel && (
              <div className="absolute z-40 right-10 top-10 w-[28rem] max-h-[80vh] bg-white/95 backdrop-blur-xl border border-stone-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in ring-1 ring-black/5 text-stone-800">
                <div className="flex items-center justify-between p-5 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-700 tracking-widest uppercase">续写流程历史</span>
                    <span className="text-[9px] text-stone-400 font-bold uppercase mt-0.5 tracking-tighter">Independent Runtime Log</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={refreshContinuationHistory}
                      disabled={continuationHistoryLoading}
                      className="text-stone-400 hover:text-slate-700 p-2 rounded-xl hover:bg-white transition-all disabled:opacity-50"
                      title="刷新"
                    >
                      <RefreshCw size={14} className={continuationHistoryLoading ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => setShowContinuationHistoryPanel(false)} className="text-stone-400 hover:text-red-500 p-2 rounded-xl hover:bg-white transition-all"><X size={16} /></button>
                  </div>
                </div>
                <div className="px-5 py-2 text-[10px] text-stone-500 border-b border-stone-100">
                  共 {continuationHistoryList.length} 条（最新在上）
                </div>
                {continuationHistoryError && (
                  <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-[10px] text-red-700">
                    读取失败：{continuationHistoryError}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                  {continuationHistoryList.length === 0 ? (
                    <div className="text-[11px] text-stone-400 italic p-2">暂无记录</div>
                  ) : continuationHistoryList.map((ev) => (
                    <div key={ev.id || `${ev.traceId}_${ev.createdAt}`} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black tracking-widest text-slate-700">
                          {taskTypeLabel(ev.taskType)} · {eventTypeLabel(ev.eventType)}
                        </div>
                        <div className="text-[9px] text-stone-400 font-mono">
                          {formatDateTime(ev.createdAt)}
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] text-stone-500">
                        章节：{ev.chapterTitle || '未命名章节'} · {ev.chapterScopeType === 'prequel' ? '前传' : '正文'}
                      </div>
                      {ev.traceId ? (
                        <div className="mt-1 text-[9px] text-stone-400 font-mono">trace: {ev.traceId}</div>
                      ) : null}
                      {ev.payload ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] text-slate-600 font-bold">查看 payload</summary>
                          <pre className="mt-1 text-[10px] text-stone-700 bg-stone-50 border border-stone-100 rounded p-2 whitespace-pre-wrap break-all max-h-52 overflow-y-auto custom-scrollbar">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 档案检索参考面板 (RAG) */}
            {showRagPanel && (
              <div className="absolute z-40 right-10 top-10 w-96 max-h-[80vh] bg-white/95 backdrop-blur-xl border border-stone-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in ring-1 ring-black/5 text-stone-800">
                <div className="flex items-center justify-between p-5 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-indigo-600 tracking-widest uppercase">档案检索参考</span>
                    <span className="text-[9px] text-stone-400 font-bold uppercase mt-0.5 tracking-tighter">Reference Context Panel</span>
                  </div>
                  <button onClick={() => setShowRagPanel(false)} className="text-stone-400 hover:text-red-500 p-2 rounded-xl hover:bg-white transition-all"><X size={16} /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                  {/* 手动选中的笔记 */}
                  {lastRagRefs.selectedScrapbookContent && (
                    <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                        <div className="text-[10px] font-black text-amber-900 tracking-widest uppercase">手动引用的笔记</div>
                      </div>
                      <div className="text-[11px] text-stone-700 leading-relaxed italic border-l-2 border-amber-300 pl-3">
                        {lastRagRefs.selectedScrapbookContent.length > 300 
                          ? `${lastRagRefs.selectedScrapbookContent.slice(0, 300)}...` 
                          : lastRagRefs.selectedScrapbookContent}
                      </div>
                    </div>
                  )}
                  
                  {/* 角色设定 */}
                  {lastRagRefs.charSettingContext && (
                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                        <div className="text-[10px] font-black text-indigo-900 tracking-widest uppercase">涉及角色设定</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const names = [];
                          const matches = lastRagRefs.charSettingContext.matchAll(/"name"\s*:\s*"([^"]+)"/g);
                          for (const match of matches) {
                            if (!names.includes(match[1])) names.push(match[1]);
                          }
                          return names.length > 0 
                            ? names.map(n => <span key={n} className="px-3 py-1 bg-white border border-indigo-200 text-indigo-700 text-[10px] font-black rounded-lg shadow-sm">{n}</span>)
                            : <span className="text-[10px] text-stone-500 italic">已应用相关角色档案</span>;
                        })()}
                      </div>
                    </div>
                  )}
                  
                  {/* RAG 小说切片 */}
                  {lastRagRefs.novelRefs?.length > 0 && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                        <div className="text-[10px] font-black text-blue-900 tracking-widest uppercase">正文语义召回 ({lastRagRefs.novelRefs.length})</div>
                      </div>
                      <div className="space-y-2">
                        {lastRagRefs.novelRefs.map((ref, idx) => (
                          <div key={idx} className="bg-white border border-blue-50 rounded-xl p-3 shadow-sm hover:border-blue-300 transition-colors">
                            <div className="text-[9px] font-black text-blue-600 mb-1 flex justify-between">
                              <span>#{String(idx + 1).padStart(2, '0')} 卷轴切片</span>
                              <span className="opacity-40">{ref.title}</span>
                            </div>
                            <div className="text-[11px] text-stone-600 line-clamp-2 leading-relaxed">{ref.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* RAG 笔记切片 */}
                  {lastRagRefs.scrapbookRefs?.length > 0 && (
                    <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        <div className="text-[10px] font-black text-emerald-900 tracking-widest uppercase">笔记语义召回 ({lastRagRefs.scrapbookRefs.length})</div>
                      </div>
                      <div className="space-y-2">
                        {lastRagRefs.scrapbookRefs.map((ref, idx) => (
                          <div key={idx} className="bg-white border border-emerald-50 rounded-xl p-3 shadow-sm hover:border-emerald-300 transition-colors">
                            <div className="text-[9px] font-black text-emerald-600 mb-1 flex justify-between">
                              <span>#{String(idx + 1).padStart(2, '0')} 资料卡</span>
                              <span className="opacity-40">{ref.title}</span>
                            </div>
                            <div className="text-[11px] text-stone-600 line-clamp-2 leading-relaxed">{ref.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {lastRagRefs.summaryRefs?.length > 0 && (
                    <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500"></div>
                        <div className="text-[10px] font-black text-violet-900 tracking-widest uppercase">剧情摘要召回 ({lastRagRefs.summaryRefs.length})</div>
                      </div>
                      <div className="space-y-2">
                        {lastRagRefs.summaryRefs.map((ref, idx) => (
                          <div key={idx} className="bg-white border border-violet-50 rounded-xl p-3 shadow-sm">
                            <div className="text-[9px] font-black text-violet-600 mb-1 flex justify-between">
                              <span>#{String(idx + 1).padStart(2, '0')} 摘要切片</span>
                              <span className="opacity-40">{ref.title}</span>
                            </div>
                            <div className="text-[11px] text-stone-600 line-clamp-3 leading-relaxed">{ref.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* 提取的关键词 */}
                  {lastRagRefs.extractedKeywords && (
                    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 shadow-inner">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-stone-500"></div>
                        <div className="text-[10px] font-black text-stone-500 tracking-widest uppercase">意图提取关键词</div>
                      </div>
                      <div className="text-[10px] text-stone-600 font-serif leading-relaxed">{lastRagRefs.extractedKeywords}</div>
                    </div>
                  )}
                </div>
                
                <div className="p-4 border-t border-stone-100 bg-stone-50/50 flex gap-3">
                  <button onClick={() => setShowRagPanel(false)} className="flex-1 py-2.5 rounded-xl bg-stone-900 hover:bg-slate-800 text-stone-50 text-[10px] font-black tracking-widest uppercase transition-all shadow-lg active:scale-95">确认并关闭</button>
                </div>
              </div>
            )}

            {/* 笔记引用选择浮动面板 */}
            <div className="fixed z-40 bottom-10 left-10 flex flex-col items-start gap-3">
              {showScrapbookPanel && (
                <div className="w-80 max-h-[60vh] bg-white/95 backdrop-blur-xl border border-amber-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in ring-1 ring-black/5 mb-2 text-stone-800">
                  <div className="flex items-center justify-between p-4 border-b border-amber-100 bg-amber-50/50">
                    <div className="text-[10px] font-black text-amber-900 tracking-widest uppercase flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div> 笔记参考检索</div>
                    <button onClick={() => setShowScrapbookPanel(false)} className="text-amber-400 hover:text-red-500 p-1 rounded-md transition-colors"><X size={14} /></button>
                  </div>
                  
                  <div className="p-3 border-b border-amber-100 bg-amber-50/30">
                    <input type="text" placeholder="检索笔记标签..." value={scrapbookSearchTag} onChange={(e) => setScrapbookSearchTag(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white border border-amber-100 text-xs outline-none focus:border-amber-400 shadow-inner" />
                    {selectedScrapbookIds.size > 0 && (
                      <button onClick={() => setSelectedScrapbookIds(new Set())} className="mt-2 w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black tracking-widest uppercase transition-all shadow-md">清空已选 ({selectedScrapbookIds.size})</button>
                    )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 bg-stone-50/30">
                    {(scrapbook || []).filter(item => scrapbookSearchTag.trim() === '' || (item.tags || []).some(tag => tag.toLowerCase().includes(scrapbookSearchTag.toLowerCase())) || (item.title || '').toLowerCase().includes(scrapbookSearchTag.toLowerCase())).map(item => (
                      <div key={item.id} onClick={() => { const next = new Set(selectedScrapbookIds); next.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelectedScrapbookIds(next); }} className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedScrapbookIds.has(item.id) ? 'bg-amber-100 border-amber-400 shadow-inner' : 'bg-white/60 border-stone-100 hover:border-amber-200'}`}>
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${selectedScrapbookIds.has(item.id) ? 'bg-amber-600 border-amber-600' : 'border-stone-300'}`}>
                            {selectedScrapbookIds.has(item.id) && <Check size={10} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-black text-stone-800 tracking-wide truncate">{item.title || '未命名笔记'}</div>
                            <div className="text-[9px] text-stone-500 mt-1 line-clamp-2 leading-relaxed italic">{(item.content || '').split('\n')[0] || '（空档案）'}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setShowScrapbookPanel(!showScrapbookPanel)} className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-2xl group ring-4 ${showScrapbookPanel ? 'bg-amber-600 ring-amber-100 text-white rotate-12 scale-110' : 'bg-white ring-stone-100 text-amber-600 hover:ring-amber-50 hover:scale-105'}`}>
                <div className="relative">
                  <Book size={20} className="group-hover:rotate-12 transition-transform" />
                  {selectedScrapbookIds.size > 0 && (
                    <span className="absolute -top-3 -right-3 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border-2 border-white animate-bounce">{selectedScrapbookIds.size}</span>
                  )}
                </div>
              </button>
            </div>

          </div>
        </div>
      </div>

      {plannerSession && (
        <NovelContinuationPlanner
          key={plannerSessionKey}
          open
          onClose={() => setPlannerSession(null)}
          activeTextEndpoint={activeTextEndpoint}
          ragConfig={ragConfig || {}}
          scrapbook={scrapbook}
          chapterIndex1Based={plannerSession.chapterIndex1Based}
          chapterIndex0={plannerSession.chapterIndex0}
          chapterScopeType={plannerSession.chapterScopeType}
          chapterWorkId={plannerSession.chapterWorkId}
          chapterId={activeChapterId}
          chapterTitle={activeChapter?.title || ''}
          novelContent={plannerSession.novelContent}
          cursorInChapter={plannerSession.cursorInChapter}
          beforeText={plannerSession.beforeText}
          afterText={plannerSession.afterText}
          referenceChars={plannerSession.referenceChars}
          plannerLabel={plannerSession.plannerLabel ?? ''}
          plannerCollect={plannerSession.plannerCollect || {}}
          targetLength={plannerSession.targetLength}
          cursorPos={plannerSession.cursorPos}
          onGenerateComplete={handlePlannerGenerateComplete}
          isBusy={plannerBusy}
          setBusy={setPlannerBusy}
          getSilentAnchorBeforeText={() => {
            const liveContent = getEditorText();
            const livePos = getCaretOffset();
            const resolvedPos = typeof livePos === 'number' ? livePos : cursorPos;
            const resolvedPosInner = editorRef.current
              ? (() => {
                  const c = rangeOffsetsToInnerOffsets(editorRef.current, resolvedPos, resolvedPos);
                  return c ? c[0] : resolvedPos;
                })()
              : resolvedPos;
            const safeStart = Math.max(0, Math.min(resolvedPosInner, liveContent.length));
            const refChars = Number(plannerSession.referenceChars || 1000);
            const chaptersForPlanner = chapters.map((c) =>
              c.id === activeChapterId ? { ...c, content: liveContent } : c
            );
            return buildBeforeTextAcrossChapters(chaptersForPlanner, activeChapterId, safeStart, refChars);
          }}
        />
      )}
    </div>
  );
};

export default NovelView;
