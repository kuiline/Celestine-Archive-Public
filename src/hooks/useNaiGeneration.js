import { useCallback } from 'react';
import { mergeChatCompletionThinking } from '../llmThinking.js';
import {
  expandBatchImageJobs,
  resolveCharacterPortraitDataUrl,
  findCharacterByBatchName,
  parseBatchImageLine
} from '../appHelpers.js';

/** 批量生图时，上一张完全结束（含失败）后再等待此间隔，再开始下一张的 Tag/生图流程 */
const DRAW_BATCH_GAP_MS = 10_000;
/** IdleCloud 文档限制：请求间隔至少 20s。这里留 2s 安全余量，降低 429 概率。 */
const IDLECLOUD_DRAW_BATCH_GAP_MS = 22_000;
const BATCH_STABILITY_PROTECTION_ENABLED = true;
const MAX_CONSECUTIVE_UPSTREAM_FAILURES = 3;
const MAX_BATCH_ROUTE_REFRESHES = 2;
const BATCH_ROUTE_REFRESH_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAI_META_BLOCK_RE = /===NOVELAI_META===\s*([\s\S]*?)(?:=============|$)/g;

function getImageUpstreamLabel(upstream) {
  const key = String(upstream || '').toLowerCase();
  if (key === 'idlecloud') return 'IdleCloud 官方适配';
  if (key === 'idlecloud_generic') return 'IdleCloud 通用接口';
  return 'NovelAI';
}

function parseHttpStatusFromImageError(errorMessage) {
  const m = String(errorMessage || '').match(/请求失败\s*\((\d{3})\)/);
  return m ? Number(m[1]) : null;
}

function formatImageFailureMessage(error, {
  upstream,
  stageLabel,
  elapsedMs = 0,
  jobIndex = 1,
  totalJobs = 1,
} = {}) {
  const raw = String(error?.message || error || '').trim();
  const status = parseHttpStatusFromImageError(raw);
  const secs = Math.max(0, Math.round(Number(elapsedMs || 0) / 1000));
  const scope = totalJobs > 1 ? `第 ${jobIndex}/${totalJobs} 张` : '当前请求';
  const hints = [];
  if (status === 429) {
    hints.push('上游触发并发/频率限制，请等待冷却后重试。');
  } else if (status === 500) {
    hints.push('上游返回 500，通常是服务端暂时异常或任务拥堵。');
  } else if (status === 502 || status === 503 || status === 504) {
    hints.push('网络链路或上游服务不稳定，可稍后重试。');
  }
  const base = [
    `请求阶段：${stageLabel || '未知阶段'}`,
    `上游：${getImageUpstreamLabel(upstream)}`,
    `范围：${scope}`,
    `耗时：${secs}s`,
    status ? `状态码：${status}` : '',
    raw ? `原始错误：${raw}` : '',
    hints.join(' ')
  ].filter(Boolean);
  return base.join('\n');
}

function shouldPauseBatchAfterImageError(text) {
  if (!BATCH_STABILITY_PROTECTION_ENABLED) return false;
  const s = String(text || '');
  return /Cloudflare|风控页|TLS|ECONNRESET|socket disconnected|timeout|请求超时|circuit_open|熔断|请求失败\s*\((?:429|502|503|504)\)/i.test(s);
}

function extractRecentImageSceneNotes(messages, limit = 5) {
  const max = Math.max(0, Number(limit) || 0);
  if (max <= 0) return [];
  const hits = [];
  for (let i = (messages?.length || 0) - 1; i >= 0 && hits.length < max; i -= 1) {
    const m = messages[i];
    const text = typeof m?.content === 'string' ? m.content : '';
    if (!text || !text.includes('===NOVELAI_META===')) continue;
    let match;
    while ((match = NAI_META_BLOCK_RE.exec(text)) !== null && hits.length < max) {
      try {
        const meta = JSON.parse(match[1].trim());
        const scene = String(meta?.sceneSummary || '').trim();
        if (!scene) continue;
        hits.push({ scene });
      } catch (_) {
        // ignore malformed meta
      }
    }
    NAI_META_BLOCK_RE.lastIndex = 0;
  }
  return hits.reverse();
}

function isInternalImageFlowMessage(msg) {
  const text = typeof msg?.content === 'string' ? msg.content : '';
  if (!text) return false;
  if (msg?.role === 'user' && text.startsWith('[召唤画师]')) return true;
  if (msg?.role === 'assistant' && text.includes('已生成 Tag：')) return true;
  if (msg?.role === 'assistant' && text.includes('正在呼叫画师...')) return true;
  if (msg?.role === 'assistant' && text.includes('===NOVELAI_RESULT===')) return true;
  return false;
}

function parseGeneratedTagResponse(rawText, expectScene = false) {
  const raw = String(rawText || '').trim();
  if (!raw) return { tags: '', scene: '' };
  if (!expectScene) return { tags: raw, scene: '' };

  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const tryJson = (txt) => {
    try {
      const obj = JSON.parse(txt);
      if (!obj || typeof obj !== 'object') return null;
      const tags = String(obj.tags || obj.prompt || obj.tagPrompt || '').trim();
      const scene = String(obj.scene || obj.sceneSummary || obj.description || '').trim();
      if (!tags && !scene) return null;
      return { tags, scene };
    } catch (_) {
      return null;
    }
  };

  const asJson = tryJson(cleaned);
  if (asJson) return asJson;
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const nested = tryJson(jsonMatch[0]);
    if (nested) return nested;
  }
  const tagLine = cleaned.match(/(?:^|\n)\s*(?:tags?|prompt)\s*[:：]\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '';
  const sceneLine = cleaned.match(/(?:^|\n)\s*(?:scene|scenesummary|description)\s*[:：]\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '';
  if (tagLine || sceneLine) return { tags: tagLine, scene: sceneLine };
  const fallbackTag = cleaned.split('\n').map((s) => s.trim()).filter(Boolean)[0] || raw;
  return { tags: fallbackTag, scene: '' };
}

function normalizeTagLine(tags) {
  return String(tags || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,+|,+$/g, '')
    .trim();
}

export default function useNaiGeneration({
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
  drawBatchMode,
  safeCharacters,
  batchImageAbortRef,
  onMultiImageRunChange,
  onImageRequestStatusChange,
}) {
  const handleDrawImage = useCallback(async () => {
    if (activeSession?.mode === 'inspiration') return;
    if (!naiConfig.key) { alert('请先在设置里配置图像生成的 API Key（NovelAI 或 IdleCloud）'); setShowAiSettings(true); return; }
    if (!activeTextEndpoint?.key) { alert('请先配置普通 AI (如 DeepSeek)！'); setShowAiSettings(true); return; }
    const resolvedChar = resolveSessionCharacter(activeSession);
    const referenceImageCaptured = aiInputImage || null;
    const imageUpstream = String(naiConfig.imageUpstream || 'novelai').toLowerCase();
    const emitImageStatus = (payload) => {
      onImageRequestStatusChange?.({
        visible: true,
        level: 'running',
        phase: payload?.phase || 'running',
        title: payload?.title || '生图请求进行中',
        detail: payload?.detail || '',
        updatedAt: Date.now(),
        ...payload,
      });
    };

    const runSingleSummonArtist = async (promptReq, messagesBefore, naiRefForThisJob, refSourceForMeta, progressMeta = {}) => {
      const newUserMsg = { role: 'user', content: `[召唤画师] ${promptReq}` };
      let workingMsgs = [...messagesBefore, newUserMsg];
      updateCurrentSession(workingMsgs);

      let finalPrompt = '';
      let sceneSummary = '';
      let stageLabel = '准备请求';
      const startedAt = Date.now();
      const totalJobs = Math.max(1, Number(progressMeta?.totalJobs || 1));
      const jobIndex = Math.max(1, Number(progressMeta?.jobIndex || 1));
      const baseDetail = totalJobs > 1 ? `第 ${jobIndex}/${totalJobs} 张 · ` : '';
      try {
        stageLabel = '生成 Tag';
        emitImageStatus({ phase: 'tagging', detail: `${baseDetail}正在生成 Tag` });
        const strippedChar = resolvedChar ? { name: resolvedChar.name, title: resolvedChar.title, details: resolvedChar.details, lore: resolvedChar.lore } : null;
        const sysPrompt = naiTagPrompt.replace('{CHAR}',
          strippedChar ? JSON.stringify(strippedChar) : '无预设角色（项目设定模式）'
        );
        let generatedTags = '1girl, solo';
        try {
          const imgRag = referenceConfig?.imageTagRagCounts || { novel: 4, scrapbook: 4, summary: 4 };
          const useTagRag = referenceConfig?.useRagContext && referenceConfig?.useRagForImageTag !== false;
          const sceneHistoryCount = Math.max(0, Number(referenceConfig?.imageSceneHistoryCount ?? 5) || 0);
          const useSceneHistory = sceneHistoryCount > 0;
          const expectSceneContract = useTagRag || useSceneHistory;
          const tagRag = useTagRag
            ? await fetchRagForSimpleTool(
                buildRagQuery({
                  input: promptReq,
                  historyMessages: workingMsgs.filter((m) => !isInternalImageFlowMessage(m)),
                  resolvedChar,
                  historyMaxMessages: referenceConfig?.chatRagHistoryMessages,
                  historyMaxChars: referenceConfig?.chatRagHistoryMaxChars,
                  userMessageOnly: referenceConfig?.chatRagUserMessageOnly,
                }),
                ragConfig,
                imgRag,
                []
              )
            : { context: '', refs: [], novelRefs: [], scrapbookRefs: [], summaryRefs: [] };
          const recentSceneNotes = useSceneHistory
            ? extractRecentImageSceneNotes(messagesBefore, sceneHistoryCount)
            : [];
          const sceneHistoryText = recentSceneNotes.length > 0
            ? recentSceneNotes
                .map((item, idx) => `${idx + 1}. ${item.scene}`)
                .join('\n')
            : '';
          const responseContract = expectSceneContract
            ? [
                '你必须仅返回 JSON，不要输出任何额外文字或 markdown。',
                'JSON 格式固定为：{"tags":"英文tag1, tag2, ...","scene":"中文场景说明"}。',
                '其中 tags 必须是严格英文逗号分隔 Tag；scene 用中文概括“这组提示词对应的剧情瞬间/场景动作”。',
                sceneHistoryText
                  ? `若本轮需求不要求复现，请尽量与以下近期生图场景区分，避免重复。优先改变地点、动作、镜头、时间、氛围中的至少两项；如果用户明确要求同一组提示词抽奖，则只做轻微构图差异。\n${sceneHistoryText}`
                  : ''
              ].filter(Boolean).join('\n')
            : '';
          const tagSys =
            tagRag.context && String(tagRag.context).trim()
              ? `${sysPrompt}\n\n===RAG_CONTEXT===\n${tagRag.context}\n================\n\n${responseContract}`
              : (responseContract ? `${sysPrompt}\n\n${responseContract}` : sysPrompt);
          const safeMsgs = [{ role: 'user', content: expectSceneContract ? `用户本轮生图需求：${promptReq}` : promptReq }];
          const res = await fetch(activeTextEndpoint.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeTextEndpoint.key}` },
            body: JSON.stringify(
              mergeChatCompletionThinking(activeTextEndpoint, {
                model: activeTextEndpoint.model,
                messages: [
                  { role: 'system', content: tagSys },
                  ...safeMsgs
                ],
                temperature: 0.7
              })
            )
          });
          if (res.ok) {
            const data = await res.json();
            const rawModelOutput = data.choices?.[0]?.message?.content?.trim() || '';
            const parsed = parseGeneratedTagResponse(rawModelOutput, expectSceneContract);
            generatedTags = normalizeTagLine(parsed.tags || generatedTags);
            sceneSummary = parsed.scene || '';
          }
        } catch (e) { console.warn('翻译失败，使用默认Tag', e); }

        finalPrompt = `${naiConfig.prefix}${normalizeTagLine(generatedTags)}`;
        const sceneLine = sceneSummary ? `\n场景说明：${sceneSummary}` : '';
        const callingMsg = { role: 'assistant', content: `已生成 Tag：\n${finalPrompt}${sceneLine}\n\n正在呼叫画师...` };
        workingMsgs = [...workingMsgs, callingMsg];
        updateCurrentSession(workingMsgs);

        stageLabel = '组装生图参数';
        emitImageStatus({ phase: 'payload', detail: `${baseDetail}Tag 完成，正在组装生图参数` });
        const naiPayload = await buildNaiPayloadByPrompt(naiConfig, finalPrompt, naiRefForThisJob);
        stageLabel = '提交请求并等待上游返回';
        emitImageStatus({ phase: 'submit', detail: `${baseDetail}参数就绪，正在请求 ${getImageUpstreamLabel(imageUpstream)}` });
        const rawImageUrl = await requestNovelAiImage(naiConfig, naiPayload);
        stageLabel = '保存图片';
        emitImageStatus({ phase: 'saving', detail: `${baseDetail}上游已返回，正在保存图片` });
        const finalImageUrl = await persistGeneratedImage(activeSessionId, rawImageUrl, finalPrompt);
        const meta = {
          prompt: finalPrompt,
          resolution: naiConfig.resolution,
          model: naiConfig.model,
          referenceImage: naiRefForThisJob,
          referenceSource: refSourceForMeta || (naiRefForThisJob ? 'upload' : null),
          sceneSummary,
          createdAt: Date.now()
        };
        const resultMsgs = [...workingMsgs];
        const lastIdx = resultMsgs.length - 1;
        if (resultMsgs[lastIdx]?.content?.includes('正在呼叫画师...')) {
          const stableSceneLine = sceneSummary ? `\n场景说明：${sceneSummary}` : '';
          resultMsgs[lastIdx] = { role: 'assistant', content: `已生成 Tag：\n${finalPrompt}${stableSceneLine}` };
        }
        const resultPrefix = sceneSummary ? `场景说明：${sceneSummary}\n` : '';
        resultMsgs.push({ role: 'assistant', content: `${resultPrefix}===NOVELAI_RESULT===\n${finalImageUrl}\n=============\n===NOVELAI_META===\n${JSON.stringify(meta)}\n=============` });
        setAiSessions((prev) => prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          return { ...s, messages: resultMsgs, ...mergeSessionMeta(resultMsgs) };
        }));
        emitImageStatus({
          level: 'success',
          phase: 'success',
          title: '生图完成',
          detail: `${baseDetail}已完成（${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s）`
        });
        return { messages: resultMsgs, ok: true };
      } catch (e) {
        const detailedError = formatImageFailureMessage(e, {
          upstream: imageUpstream,
          stageLabel,
          elapsedMs: Date.now() - startedAt,
          jobIndex,
          totalJobs,
        });
        const msgs = [...workingMsgs];
        const lastIdx = msgs.length - 1;
        if (msgs[lastIdx]?.role === 'assistant' && msgs[lastIdx]?.content?.includes('正在呼叫画师...')) {
          const tagsPart = msgs[lastIdx].content.split('\n\n正在呼叫画师...')[0];
          const errorMeta = { prompt: finalPrompt || '', referenceImage: naiRefForThisJob, error: detailedError };
          msgs[lastIdx] = { role: 'assistant', content: `${tagsPart}\n\n[生图失败]\n${detailedError}\n\n===NOVELAI_RETRY===\n${JSON.stringify(errorMeta)}\n=============` };
        } else {
          const errorMeta = { prompt: finalPrompt || '', referenceImage: naiRefForThisJob, error: detailedError };
          msgs.push({ role: 'assistant', content: `[生图失败]\n${detailedError}\n\n===NOVELAI_RETRY===\n${JSON.stringify(errorMeta)}\n=============` });
        }
        setAiSessions((prev) => prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          return { ...s, messages: msgs, ...mergeSessionMeta(msgs) };
        }));
        emitImageStatus({
          level: 'error',
          phase: 'error',
          title: '生图失败',
          detail: detailedError.replace(/\n+/g, ' | ')
        });
        return { messages: msgs, ok: false, shouldPauseBatch: shouldPauseBatchAfterImageError(detailedError), error: detailedError };
      }
    };

    const raw = aiInputText.trim();
    const defaultSingle = resolvedChar?.name
      ? `请为 ${resolvedChar.name} 画一张符合她设定的插图。`
      : '请基于当前项目设定生成一张插图。';
    let lineList;
    if (drawBatchMode) {
      if (!raw) {
        alert('批量模式请在输入框中填写内容，每行一条描述。');
        return;
      }
      // 正确的批量模式：按行分割，如果有纯 @ 开头的行，将其合并到上一行
      const lines = raw.split('\n').map((s) => s.trim());
      lineList = [];
      for (const line of lines) {
        if (!line) continue;
        if (line.startsWith('@') && lineList.length > 0) {
          lineList[lineList.length - 1] += ' ' + line;
        } else {
          lineList.push(line);
        }
      }
    } else {
      lineList = [raw || defaultSingle];
    }
    const jobs = expandBatchImageJobs(lineList);
    if (jobs.length === 0) {
      alert('没有可用的生图需求（检查是否为空行等）。');
      return;
    }

    onMultiImageRunChange?.(jobs.length > 1);
    if (batchImageAbortRef) batchImageAbortRef.current = false;
    const isFirstUserMsg = activeSession.messages.length === 1;
    setAiInputText('');
    setIsChatAiLoading(true);
    emitImageStatus({
      phase: 'prepare',
      title: '生图请求进行中',
      detail: jobs.length > 1 ? `共 ${jobs.length} 张，正在准备第 1 张` : '正在准备请求参数'
    });
    if (isFirstUserMsg) generateTitle(activeSessionId, jobs[0].prompt, activeTextEndpoint);
    let rolling = [...activeSession.messages];
    const pushBatchAbortMessage = () => {
      setAiSessions((prev) => prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = [...(s.messages || []), { role: 'assistant', content: '[生图] 已终止，余下张数未执行。' }];
        return { ...s, messages: msgs, ...mergeSessionMeta(msgs) };
      }));
    };
    const pushBatchPauseMessage = (reason) => {
      const content = `[生图] 检测到上游连续不稳定，已暂停余下任务，避免继续消耗请求次数。\n${reason || ''}`.trim();
      const nextMsgs = [...rolling, { role: 'assistant', content }];
      rolling = nextMsgs;
      setAiSessions((prev) => prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        return { ...s, messages: nextMsgs, ...mergeSessionMeta(nextMsgs) };
      }));
    };
    const isIdleCloudUpstream = ['idlecloud', 'idlecloud_generic'].includes(imageUpstream);
    const interJobGapMs = isIdleCloudUpstream ? IDLECLOUD_DRAW_BATCH_GAP_MS : DRAW_BATCH_GAP_MS;
    let consecutiveUpstreamFailures = 0;
    let batchRouteRefreshes = 0;
    try {
      for (let i = 0; i < jobs.length; i += 1) {
        if (batchImageAbortRef?.current) {
          pushBatchAbortMessage();
          emitImageStatus({
            level: 'error',
            phase: 'aborted',
            title: '生图已终止',
            detail: `在第 ${i + 1}/${jobs.length} 张前终止，余下请求未执行`
          });
          break;
        }
        if (i > 0) {
          emitImageStatus({
            phase: 'cooldown',
            detail: `第 ${i + 1}/${jobs.length} 张前冷却中（约 ${Math.ceil(interJobGapMs / 1000)}s）`
          });
          await sleep(interJobGapMs);
        }
        if (batchImageAbortRef?.current) {
          pushBatchAbortMessage();
          emitImageStatus({
            level: 'error',
            phase: 'aborted',
            title: '生图已终止',
            detail: `在第 ${i + 1}/${jobs.length} 张前终止，余下请求未执行`
          });
          break;
        }
        const job = jobs[i];
        emitImageStatus({
          phase: 'prepare',
          detail: `第 ${i + 1}/${jobs.length} 张：准备参考图与提示词`
        });
        let portraitData = null;
        let portraitLoadError = null;
        if (job.charName) {
          try {
            portraitData = await resolveCharacterPortraitDataUrl(safeCharacters, job.charName);
          } catch (err) {
            portraitLoadError = err;
            console.warn('生图：立绘转参考失败，回退上传图', err);
          }
          const chForHint = findCharacterByBatchName(safeCharacters, job.charName);
          let refHint;
          if (portraitData) {
            refHint = `[生图·参考] ✓ 已载入「${chForHint?.name || job.charName}」档案主图（image）用于本张出图。`;
          } else if (portraitLoadError) {
            refHint = `[生图·参考] ✗ 主图处理失败：${String(portraitLoadError.message || portraitLoadError)}。本张${referenceImageCaptured ? '已改用上传参考图' : '无参考图'}。`;
          } else if (!chForHint) {
            refHint = `[生图·参考] ✗ 档案中无匹配角色「${job.charName}」（请核对姓名是否一致）。本张${referenceImageCaptured ? '已改用上传参考图' : '无参考图'}。`;
          } else {
            refHint = `[生图·参考] ✗ 「${chForHint.name}」未设置主图字段 image。本张${referenceImageCaptured ? '已改用上传参考图' : '无参考图'}。`;
          }
          rolling = [...rolling, { role: 'assistant', content: refHint }];
          setAiSessions((prev) => prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            return { ...s, messages: rolling, ...mergeSessionMeta(rolling) };
          }));
          console.info('[生图·参考]', job.charName, portraitData ? 'ok' : 'fail', portraitLoadError || '');
        }
        const naiRef = portraitData || referenceImageCaptured;
        let refSource = null;
        if (portraitData) {
          const ch = findCharacterByBatchName(safeCharacters, job.charName);
          refSource = `portrait:${ch?.name || job.charName}`;
        } else if (referenceImageCaptured) {
          refSource = 'upload';
        }
        const outcome = await runSingleSummonArtist(job.prompt, rolling, naiRef, refSource, {
          totalJobs: jobs.length,
          jobIndex: i + 1,
        });
        rolling = outcome.messages;
        if (outcome.ok) {
          consecutiveUpstreamFailures = 0;
        } else if (outcome.shouldPauseBatch) {
          consecutiveUpstreamFailures += 1;
          if (consecutiveUpstreamFailures >= MAX_CONSECUTIVE_UPSTREAM_FAILURES) {
            if (batchRouteRefreshes < MAX_BATCH_ROUTE_REFRESHES) {
              batchRouteRefreshes += 1;
              const refreshSecs = Math.ceil(BATCH_ROUTE_REFRESH_MS / 1000);
              const refreshMsg = `[生图] 检测到上游连续不稳定，正在软刷新链路并冷却 ${refreshSecs} 秒后继续剩余任务（${batchRouteRefreshes}/${MAX_BATCH_ROUTE_REFRESHES}）。`;
              rolling = [...rolling, { role: 'assistant', content: refreshMsg }];
              setAiSessions((prev) => prev.map((s) => {
                if (s.id !== activeSessionId) return s;
                return { ...s, messages: rolling, ...mergeSessionMeta(rolling) };
              }));
              emitImageStatus({
                phase: 'cooldown',
                title: '正在软刷新链路',
                detail: `连续 ${consecutiveUpstreamFailures} 次上游失败，冷却 ${refreshSecs} 秒后继续`
              });
              await sleep(BATCH_ROUTE_REFRESH_MS);
              consecutiveUpstreamFailures = 0;
              continue;
            }
            pushBatchPauseMessage(`连续 ${consecutiveUpstreamFailures} 次失败，最近原因：${String(outcome.error || '').split('\n').find(Boolean) || '上游不稳定'}`);
            emitImageStatus({
              level: 'error',
              phase: 'paused',
              title: '批量生图已暂停',
              detail: `连续 ${consecutiveUpstreamFailures} 次上游失败，余下任务未继续提交`
            });
            break;
          }
        } else {
          consecutiveUpstreamFailures = 0;
        }
      }
    } finally {
      setIsChatAiLoading(false);
      onMultiImageRunChange?.(false);
      setTimeout(() => onImageRequestStatusChange?.(null), 3500);
    }
  }, [
    activeSession,
    naiConfig,
    activeTextEndpoint,
    setShowAiSettings,
    resolveSessionCharacter,
    aiInputText,
    updateCurrentSession,
    setAiInputText,
    setIsChatAiLoading,
    generateTitle,
    activeSessionId,
    aiInputImage,
    naiTagPrompt,
    referenceConfig,
    fetchRagForSimpleTool,
    buildRagQuery,
    ragConfig,
    buildNaiPayloadByPrompt,
    requestNovelAiImage,
    persistGeneratedImage,
    setAiSessions,
    mergeSessionMeta,
    drawBatchMode,
    safeCharacters,
    batchImageAbortRef,
    onMultiImageRunChange,
    onImageRequestStatusChange,
  ]);

  const handleRerollImage = useCallback(async (promptText, referenceImage = null) => {
    const prompt = String(promptText || '').trim();
    if (!prompt) { alert('未找到可复用的提示词。'); return; }
    if (!naiConfig.key) { alert('请先在设置里配置图像生成的 API Key（NovelAI 或 IdleCloud）'); setShowAiSettings(true); return; }
    if (isChatAiLoading) return;
    setIsChatAiLoading(true);
    const imageUpstream = String(naiConfig.imageUpstream || 'novelai').toLowerCase();
    const startedAt = Date.now();
    onImageRequestStatusChange?.({
      visible: true,
      level: 'running',
      phase: 'reroll',
      title: '重新生图进行中',
      detail: '正在组装参数并提交请求',
      updatedAt: Date.now(),
    });
    try {
      const naiPayload = await buildNaiPayloadByPrompt(naiConfig, prompt, referenceImage);
      onImageRequestStatusChange?.({
        visible: true,
        level: 'running',
        phase: 'submit',
        title: '重新生图进行中',
        detail: `正在请求 ${getImageUpstreamLabel(imageUpstream)}`,
        updatedAt: Date.now(),
      });
      const rawImageUrl = await requestNovelAiImage(naiConfig, naiPayload);
      onImageRequestStatusChange?.({
        visible: true,
        level: 'running',
        phase: 'saving',
        title: '重新生图进行中',
        detail: '上游已返回，正在保存图片',
        updatedAt: Date.now(),
      });
      const finalImageUrl = await persistGeneratedImage(activeSessionId, rawImageUrl, prompt);
      const meta = { prompt, resolution: naiConfig.resolution, model: naiConfig.model, referenceImage, createdAt: Date.now() };
      setAiSessions((prev) => prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = [...s.messages, { role: 'assistant', content: `===NOVELAI_RESULT===\n${finalImageUrl}\n=============\n===NOVELAI_META===\n${JSON.stringify(meta)}\n=============` }];
        return { ...s, messages: msgs, ...mergeSessionMeta(msgs) };
      }));
      onImageRequestStatusChange?.({
        visible: true,
        level: 'success',
        phase: 'success',
        title: '重新生图完成',
        detail: `完成（${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s）`,
        updatedAt: Date.now(),
      });
    } catch (e) {
      const detailedError = formatImageFailureMessage(e, {
        upstream: imageUpstream,
        stageLabel: '重新生图请求',
        elapsedMs: Date.now() - startedAt,
        jobIndex: 1,
        totalJobs: 1,
      });
      const errorMeta = { prompt, referenceImage, error: detailedError };
      setAiSessions((prev) => prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = [...s.messages, { role: 'assistant', content: `[生图失败]\n${detailedError}\n\n===NOVELAI_RETRY===\n${JSON.stringify(errorMeta)}\n=============` }];
        return { ...s, messages: msgs, ...mergeSessionMeta(msgs) };
      }));
      onImageRequestStatusChange?.({
        visible: true,
        level: 'error',
        phase: 'error',
        title: '重新生图失败',
        detail: detailedError.replace(/\n+/g, ' | '),
        updatedAt: Date.now(),
      });
    } finally {
      setIsChatAiLoading(false);
      setTimeout(() => onImageRequestStatusChange?.(null), 3500);
    }
  }, [
    naiConfig,
    setShowAiSettings,
    isChatAiLoading,
    setIsChatAiLoading,
    buildNaiPayloadByPrompt,
    requestNovelAiImage,
    persistGeneratedImage,
    setAiSessions,
    activeSessionId,
    mergeSessionMeta,
    onImageRequestStatusChange,
  ]);

  return { handleDrawImage, handleRerollImage };
}
