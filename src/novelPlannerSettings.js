/**
 * 「星辰续写规划」专用参数（与简单续写 / 润色模式完全独立）
 * 持久化：localStorage celestial_novel_planner_settings_v1
 */

export const PLANNER_SETTINGS_STORAGE_KEY = 'celestial_novel_planner_settings_v1';

export function defaultPlannerSettings() {
  return {
    /** 在规划面板标题与流程日志中展示的名称 */
    label: '星辰续写',
    /** 审题 / 静默锚点 / 跨章前文：光标前取多少字 */
    referenceChars: 1000,
    /** 构建 vector 与光标后上下文：光标后取多少字 */
    afterContextChars: 300,
    /** 阶段 3 生成正文的目标体量（字） */
    targetLength: 500,
    /** 服务端 planner/collect 阶段 1：摘要 RAG 最终入库条数 */
    phase1Summary: 6,
    /** 阶段 1：手札向量检索最终条数（不含必选梗概） */
    phase1Scrapbook: 6,
    /** 阶段 1：向量检索候选池大小（摘要 + 手札召回前各取多少条参与筛选） */
    phase1SearchPool: 48,
    /** 阶段 2（轮回）：摘要条数 */
    phase2Summary: 2,
    /** 阶段 2：手札条数（向量与关键词合并去重后） */
    phase2Scrapbook: 2,
    /** 阶段 2：向量检索候选池 */
    phase2SearchPool: 48,
    /** 阶段 2：手札关键词补充检索最多取几条（与向量结果合并） */
    phase2KeywordExtra: 8,
    /** 名称命中时最多带入几名角色档案（0 表示不带；默认 48 与上限一致，接近改版前「不截断」） */
    characterProfileMax: 48
  };
}

export function normalizePlannerSettings(raw) {
  const d = defaultPlannerSettings();
  const x = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) };
  x.label = String(x.label ?? d.label).trim() || d.label;
  x.referenceChars = Math.max(200, Math.min(8000, Number(x.referenceChars) || d.referenceChars));
  x.afterContextChars = Math.max(0, Math.min(2000, Number(x.afterContextChars) ?? d.afterContextChars));
  x.targetLength = Math.max(120, Math.min(1200, Number(x.targetLength) || d.targetLength));
  x.phase1Summary = Math.max(0, Math.min(24, Number(x.phase1Summary) ?? d.phase1Summary));
  x.phase1Scrapbook = Math.max(0, Math.min(24, Number(x.phase1Scrapbook) ?? d.phase1Scrapbook));
  x.phase1SearchPool = Math.max(8, Math.min(128, Number(x.phase1SearchPool) || d.phase1SearchPool));
  x.phase2Summary = Math.max(0, Math.min(24, Number(x.phase2Summary) ?? d.phase2Summary));
  x.phase2Scrapbook = Math.max(0, Math.min(24, Number(x.phase2Scrapbook) ?? d.phase2Scrapbook));
  x.phase2SearchPool = Math.max(8, Math.min(128, Number(x.phase2SearchPool) || d.phase2SearchPool));
  x.phase2KeywordExtra = Math.max(0, Math.min(48, Number(x.phase2KeywordExtra) ?? d.phase2KeywordExtra));
  x.characterProfileMax = Math.max(0, Math.min(48, Number(x.characterProfileMax) ?? d.characterProfileMax));
  return x;
}

export function loadPlannerSettings() {
  try {
    const raw = localStorage.getItem(PLANNER_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return normalizePlannerSettings(parsed);
    }
  } catch (e) {}
  return normalizePlannerSettings({});
}

export function savePlannerSettings(state) {
  try {
    localStorage.setItem(PLANNER_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePlannerSettings(state)));
  } catch (e) {}
}

/** 打开星辰面板时写入 plannerSession、请求 /api/rag/planner/collect 时使用 */
export function buildPlannerCollectPayload(settings) {
  const x = normalizePlannerSettings(settings);
  return {
    phase1Summary: x.phase1Summary,
    phase1Scrapbook: x.phase1Scrapbook,
    phase1SearchPool: x.phase1SearchPool,
    phase2Summary: x.phase2Summary,
    phase2Scrapbook: x.phase2Scrapbook,
    phase2SearchPool: x.phase2SearchPool,
    phase2KeywordExtra: x.phase2KeywordExtra,
    characterProfileMax: x.characterProfileMax
  };
}
