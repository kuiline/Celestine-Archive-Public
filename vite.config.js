import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fetch from 'node-fetch'
import { ChromaClient } from 'chromadb'
import { findChapterOutlineScrapbookItem } from './src/chapterOutlineMatch.js'
import { buildIdleCloudGenericBody } from './src/idlecloudGenericMap.js'
import { mergeChatCompletionThinking } from './src/llmThinking.js'
import JSZip from 'jszip'

if (!globalThis.__celestineUnhandledRejectionGuardInstalled) {
  globalThis.__celestineUnhandledRejectionGuardInstalled = true;
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    console.error('[UnhandledRejection guarded]', msg);
  });
}

const CHROMA_COLLECTION_NOVEL = 'celestine_novel'
const CHROMA_COLLECTION_SCRAPBOOK = 'celestine_scrapbook'

const PROXY_URL = String(process.env.IMAGE_PROXY_URL || process.env.NAI_PROXY_URL || '').trim();
const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : null;
const imageProxyEnabled = !!proxyAgent;
/** Set IMAGE_PROXY_URL (for example http://127.0.0.1:7897) to route image upstream requests via a local proxy. */
const idleCloudPreferProxy = imageProxyEnabled && process.env.IDLECLOUD_USE_PROXY !== '0';
/** Set IDLECLOUD_STABILITY_GUARD=1 to enable local cooldown/circuit-breaker protection. */
const IDLECLOUD_STABILITY_GUARD_ENABLED = process.env.IDLECLOUD_STABILITY_GUARD === '1';

/** 解析 Authorization：Bearer &lt;key&gt;；也兼容整段即为 key 的写法 */
function parseBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return '';
  const t = authHeader.trim();
  const m = t.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : t).trim();
}

const IMAGE_NOVELAI = 'https://image.novelai.net';
const IDLECLOUD_GENERATE_IMAGE = 'https://api.idlecloud.cc/api/ai/generate-image';
const IDLECLOUD_API_BASE = 'https://api.idlecloud.cc/api';
const IDLECLOUD_GENERATE_IMAGE_GENERIC = `${IDLECLOUD_API_BASE}/generate_image`;
const idleCloudGetResultUrl = (jobId) => `${IDLECLOUD_API_BASE}/get_result/${encodeURIComponent(jobId)}`;

async function idleCloudGenericResolveImageResult(j, fetchImpl, agent) {
  if (j.image_base64) {
    let b = j.image_base64;
    if (typeof b === 'string' && b.startsWith('data:')) {
      const m = b.match(/^data:[^;]+;base64,(.+)$/i);
      if (m) b = m[1];
    }
    return { image: typeof b === 'string' ? b.replace(/\s/g, '') : Buffer.from(b).toString('base64') };
  }
  if (j.image_url) {
    const r = agent === '__AUTO_IDLECLOUD__'
      ? await fetchIdleCloudWithFallback(j.image_url, (routeAgent) => ({ ...(routeAgent ? { agent: routeAgent } : {}) }), 90000)
      : await fetchImpl(j.image_url, { ...(agent ? { agent } : {}) });
    if (!r.ok) throw new Error(`拉取 IdleCloud image_url 失败: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('image/')) {
      return { image: buf.toString('base64') };
    }
    if (ct.includes('zip') || /\.zip(\?|$)/i.test(j.image_url)) {
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      if (!names.length) throw new Error('IdleCloud 返回的 ZIP 内无文件');
      const first = names.sort()[0];
      const b64 = await zip.file(first).async('base64');
      return { image: b64 };
    }
    throw new Error(`无法解析 IdleCloud image_url 内容类型: ${ct || 'unknown'}`);
  }
  throw new Error('IdleCloud 完成态未包含 image_base64 或 image_url');
}
const REFERENCE_PIXEL_COUNT = 1011712; 
const SIGMA_MAGIC_NUMBER = 19;
const SIGMA_MAGIC_NUMBER_V45 = 58;

function saveBase64ToFile(base64String, destPath) {
  const matches = base64String.match(/^data:([a-zA-Z0-9+/]+\/[a-zA-Z0-9+/]+);base64,(.+)$/);
  if (!matches) return null;
  const ext = matches[1].includes('png') ? 'png' : 'jpg';
  const finalPath = /\.(jpg|jpeg|png|gif|webp)$/i.test(destPath) ? destPath : `${destPath}.${ext}`;
  const fsNode = fs; const pathNode = path;
  fsNode.mkdirSync(pathNode.dirname(finalPath), { recursive: true });
  fsNode.writeFileSync(finalPath, Buffer.from(matches[2], 'base64'));
  return finalPath;
}
function toDataUrl(absPath, cwd) { return '/' + path.relative(cwd, absPath).replace(/\\/g, '/'); }
function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath));
  } catch (e) {
    return null;
  }
}
function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function getNovelContinuationHistoryPath(dataDir) {
  return path.join(dataDir, 'novel_continuation_history.json');
}
function readNovelContinuationHistory(dataDir) {
  const fp = getNovelContinuationHistoryPath(dataDir);
  const data = safeReadJson(fp);
  return Array.isArray(data?.events) ? data.events : [];
}
function writeNovelContinuationHistory(dataDir, events) {
  const fp = getNovelContinuationHistoryPath(dataDir);
  const list = Array.isArray(events) ? events : [];
  fs.writeFileSync(fp, JSON.stringify({
    version: 1,
    updatedAt: Date.now(),
    events: list
  }, null, 2));
}
function clipLargeText(value, max = 12000) {
  const txt = String(value ?? '');
  if (txt.length <= max) return txt;
  return `${txt.slice(0, max)}\n\n...（已截断，原始长度 ${txt.length}）`;
}
function sanitizeNovelHistoryPayload(input, depth = 0) {
  if (depth > 5) return null;
  if (typeof input === 'string') return clipLargeText(input);
  if (typeof input === 'number' || typeof input === 'boolean' || input == null) return input;
  if (Array.isArray(input)) return input.slice(0, 120).map((x) => sanitizeNovelHistoryPayload(x, depth + 1));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input).slice(0, 200)) {
      out[k] = sanitizeNovelHistoryPayload(v, depth + 1);
    }
    return out;
  }
  return String(input);
}
function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}
function copyDirIfExists(fromPath, toPath) {
  if (!fs.existsSync(fromPath) || !fs.statSync(fromPath).isDirectory()) {
    return { copiedFiles: 0, copiedDirs: 0, skipped: true };
  }
  ensureDir(toPath);
  const queue = [[fromPath, toPath]];
  let copiedFiles = 0;
  let copiedDirs = 0;
  while (queue.length > 0) {
    const [srcDir, dstDir] = queue.shift();
    ensureDir(dstDir);
    copiedDirs += 1;
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name);
      const dst = path.join(dstDir, entry.name);
      if (entry.isDirectory()) {
        queue.push([src, dst]);
      } else if (entry.isFile()) {
        fs.copyFileSync(src, dst);
        copiedFiles += 1;
      }
    }
  }
  return { copiedFiles, copiedDirs, skipped: false };
}
function copyDirIfExistsSafe(fromPath, toPath, label = '', onError = null) {
  try {
    return copyDirIfExists(fromPath, toPath);
  } catch (e) {
    console.warn(`[Archive] 快照复制跳过 (${label || fromPath}):`, e.message);
    try {
      if (typeof onError === 'function') onError(e);
    } catch (err) {}
    return { copiedFiles: 0, copiedDirs: 0, skipped: true, error: e && e.message ? e.message : String(e) };
  }
}
function writeDatabaseJsonCompact(dbPath, obj) {
  fs.writeFileSync(dbPath, JSON.stringify(obj));
}
function copyGlobalBackgroundFiles(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return;
  const files = fs.readdirSync(fromDir).filter(f => /^global_background\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const file of files) {
    fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
  }
}
/** 快照：仅复制主 database.json，媒体文件始终保留在主 data 目录。 */
function createSnapshot(dataDir, mainDbPath, versionId, onStep = null) {
  const step = (event, meta = {}) => {
    try {
      if (typeof onStep === 'function') onStep(event, meta);
    } catch (e) {}
  };
  const versionsRoot = path.join(dataDir, 'versions');
  ensureDir(versionsRoot);
  const snapshotDir = path.join(versionsRoot, versionId);
  step('snapshot.prepare.start', { snapshotDir });
  cleanDir(snapshotDir);
  step('snapshot.prepare.done', { snapshotDir });
  if (fs.existsSync(mainDbPath)) {
    step('snapshot.copy.database.start');
    fs.copyFileSync(mainDbPath, path.join(snapshotDir, 'database.json'));
    step('snapshot.copy.database.done');
  }
  step('snapshot.copy.media.skipped', { reason: 'snapshot_db_only' });
  try {
    fs.writeFileSync(
      path.join(snapshotDir, 'snapshot_meta.json'),
      JSON.stringify({ versionId, createdAt: Date.now(), mode: 'database_only', includesAiGenerated: false }, null, 2)
    );
    step('snapshot.meta.done');
  } catch (e) {}
  return snapshotDir;
}
function replaceNovelAiResultUrl(content, newUrl) {
  return String(content).replace(
    /(===NOVELAI_RESULT===\s*)([\s\S]*?)(\s*=============)/,
    `$1${newUrl}$3`
  );
}
function ensureCharacterMediaDirs(charDir) {
  ensureDir(charDir);
  ensureDir(path.join(charDir, 'portraits'));
  ensureDir(path.join(charDir, 'backgrounds'));
  ensureDir(path.join(charDir, 'combats'));
}
function getFirstExistingUrl(baseDir, files, urlPrefix) {
  for (const file of files) {
    if (fs.existsSync(path.join(baseDir, file))) return `${urlPrefix}/${file}`;
  }
  return null;
}
function getImageUrlsInDir(dirPath, urlPrefix) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  return fs.readdirSync(dirPath)
    .filter(isImageFileName)
    .sort()
    .map(file => `${urlPrefix}/${file}`);
}
/** 保存时 combats：轮播多图 + *_depth 伴侣图未必都在 database.json，应按磁盘目录整夹列入 keep，避免误移入 stash */
function collectCombatFolderKeepUrls(charName, dataDir) {
  const charDir = path.join(dataDir, 'characters', charName);
  if (!fs.existsSync(charDir)) return [];
  const basePrefix = `/data/characters/${charName}`;
  const urls = [];
  for (const dirName of ['combats', 'combat']) {
    const absDir = path.join(charDir, dirName);
    urls.push(...getImageUrlsInDir(absDir, `${basePrefix}/${dirName}`));
  }
  for (const file of fs.readdirSync(charDir).filter(f => isImageFileName(f) && f.toLowerCase().startsWith('combat.'))) {
    urls.push(`${basePrefix}/${file}`);
  }
  return [...new Set(urls)];
}
function chooseCurrentOrFirstVariant(currentUrl, variants, legacyUrl = null) {
  if (currentUrl && variants.includes(currentUrl)) return currentUrl;
  if (legacyUrl && variants.includes(legacyUrl)) return legacyUrl;
  return variants[0] || legacyUrl || null;
}

/** 战斗深度图：combats/combat_depth.png，或与 combat 同主名的 IMG_9748_depth.png */
function resolveCombatDepthImgUrl(charDir, basePrefix, combatImgUrl) {
  const combats = path.join(charDir, 'combats');
  const combatLegacy = path.join(charDir, 'combat');
  if (fs.existsSync(path.join(combats, 'combat_depth.png'))) return `${basePrefix}/combats/combat_depth.png`;
  if (fs.existsSync(path.join(combatLegacy, 'combat_depth.png'))) return `${basePrefix}/combat/combat_depth.png`;
  if (!combatImgUrl || typeof combatImgUrl !== 'string') return null;
  const base = path.basename(combatImgUrl, path.extname(combatImgUrl));
  const exts = ['.png', '.jpg', '.jpeg', '.webp'];
  for (const e of exts) {
    const fname = `${base}_depth${e}`;
    if (fs.existsSync(path.join(combats, fname))) return `${basePrefix}/combats/${fname}`;
    if (fs.existsSync(path.join(combatLegacy, fname))) return `${basePrefix}/combat/${fname}`;
  }
  return null;
}
function isImageFileName(name) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name || '');
}
function buildStampedStashTarget(baseDir, originalName) {
  ensureDir(baseDir);
  const safeName = String(originalName || 'item').replace(/[\\/:*?"<>|]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let targetPath = path.join(baseDir, `${stamp}_${safeName}`);
  let i = 1;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(baseDir, `${stamp}_${safeName}_${i}`);
    i += 1;
  }
  return targetPath;
}
function movePathToStash(srcPath, stashDir, preferredName = '') {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  const targetPath = buildStampedStashTarget(stashDir, preferredName || path.basename(srcPath));
  try {
    fs.renameSync(srcPath, targetPath);
    return targetPath;
  } catch (e) {
    const code = String(e && e.code ? e.code : '');
    if (code !== 'EPERM' && code !== 'EXDEV') throw e;
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirIfExists(srcPath, targetPath);
      try {
        fs.rmSync(srcPath, { recursive: true, force: true });
      } catch (rmErr) {}
      return targetPath;
    }
    fs.copyFileSync(srcPath, targetPath);
    try {
      fs.rmSync(srcPath, { force: true });
    } catch (rmErr) {}
    return targetPath;
  }
}
function writeJsonToStash(stashDir, preferredName, payload) {
  const targetPath = buildStampedStashTarget(stashDir, preferredName).replace(/$/,'');
  const finalPath = targetPath.endsWith('.json') ? targetPath : `${targetPath}.json`;
  ensureDir(path.dirname(finalPath));
  fs.writeFileSync(finalPath, JSON.stringify(payload, null, 2));
  return finalPath;
}
function stashUnusedFiles(charName, type, currentUrls, dataDir) {
  const charDir = path.join(dataDir, 'characters', charName);
  const targetDir = type === 'stories' ? path.join(charDir, 'stories') : charDir;
  if (!fs.existsSync(targetDir)) return;

  const files = fs.readdirSync(targetDir).filter(f => isImageFileName(f));
  const stashDir = path.join(dataDir, 'stash', charName, type);
  
  files.forEach(file => {
    const fileUrl = `/data/characters/${charName}/${type === 'stories' ? 'stories/' : ''}${file}`;
    // 如果这个物理文件不在当前最新的 URL 列表里，就移走它
    if (!currentUrls.includes(fileUrl)) {
      ensureDir(stashDir);
      try {
        fs.renameSync(path.join(targetDir, file), path.join(stashDir, file));
        console.log(`[Archive] Stashed unused file: ${fileUrl} -> ${stashDir}`);
      } catch (e) {
        console.warn(`[Archive] Failed to stash file: ${file}`, e.message);
      }
    }
  });
}
function getCharacterFolderNames(dataDir, deletedNames = []) {
  const charsDir = path.join(dataDir, 'characters');
  if (!fs.existsSync(charsDir)) return [];
  const deletedSet = new Set((Array.isArray(deletedNames) ? deletedNames : []).filter(Boolean));
  return fs.readdirSync(charsDir)
    .filter(name => {
      if (deletedSet.has(name)) return false;
      const full = path.join(charsDir, name);
      return fs.existsSync(full) && fs.statSync(full).isDirectory();
    })
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
function moveCharacterDirToStash(charName, dataDir) {
  if (!charName) return null;
  const srcDir = path.join(dataDir, 'characters', charName);
  if (!fs.existsSync(srcDir)) return null;
  const stashRoot = path.join(dataDir, 'stash', 'characters');
  return movePathToStash(srcDir, stashRoot, charName);
}
/** 同一素材在「子目录」与「角色根 legacy」两种 URL 互认，避免只引用其一却误 stash 另一处文件 */
function expandCharacterMediaKeepAliases(keep, charName, mediaType) {
  const cfg = {
    portraits: { sub: 'portraits', legacy: /^portrait\./i },
    backgrounds: { sub: 'backgrounds', legacy: /^background\./i },
    combats: { sub: 'combats', legacy: /^combat\./i },
  }[mediaType];
  if (!cfg || !(keep instanceof Set)) return;
  const pfx = `/data/characters/${charName}/`;
  const subPfx = `${pfx}${cfg.sub}/`;
  const extra = [];
  for (const u of keep) {
    if (typeof u !== 'string' || !u.startsWith(pfx)) continue;
    if (u.startsWith(subPfx)) {
      const file = u.slice(subPfx.length);
      if (cfg.legacy.test(file)) extra.push(pfx + file);
    } else {
      const rest = u.slice(pfx.length);
      if (rest.includes('/')) continue;
      if (cfg.legacy.test(rest)) extra.push(subPfx + rest);
    }
  }
  for (const u of extra) keep.add(u);
}
function stashCharacterMediaFiles(charName, mediaType, currentUrls, dataDir) {
  if (!charName) return;
  const charDir = path.join(dataDir, 'characters', charName);
  if (!fs.existsSync(charDir)) return;
  const keep = new Set((Array.isArray(currentUrls) ? currentUrls : []).filter(Boolean));
  expandCharacterMediaKeepAliases(keep, charName, mediaType);
  const configs = {
    portraits: { dirs: ['portraits', 'portrait'], legacyPrefix: 'portrait' },
    backgrounds: { dirs: ['backgrounds', 'background'], legacyPrefix: 'background' },
    combats: { dirs: ['combats', 'combat'], legacyPrefix: 'combat' }
  };
  const config = configs[mediaType];
  if (!config) return;
  const stashDir = path.join(dataDir, 'stash', charName, mediaType);

  for (const dirName of config.dirs) {
    const absDir = path.join(charDir, dirName);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
    for (const file of fs.readdirSync(absDir).filter(isImageFileName)) {
      const fileUrl = `/data/characters/${charName}/${dirName}/${file}`;
      if (keep.has(fileUrl)) continue;
      try {
        const movedTo = movePathToStash(path.join(absDir, file), stashDir, file);
        if (movedTo) console.log(`[Archive] Stashed unused file: ${fileUrl} -> ${movedTo}`);
      } catch (e) {
        console.warn(`[Archive] Failed to stash file: ${file}`, e.message);
      }
    }
  }

  for (const file of fs.readdirSync(charDir).filter(f => isImageFileName(f) && f.toLowerCase().startsWith(`${config.legacyPrefix}.`))) {
    const fileUrl = `/data/characters/${charName}/${file}`;
    if (keep.has(fileUrl)) continue;
    try {
      const movedTo = movePathToStash(path.join(charDir, file), stashDir, file);
      if (movedTo) console.log(`[Archive] Stashed unused file: ${fileUrl} -> ${movedTo}`);
    } catch (e) {
      console.warn(`[Archive] Failed to stash legacy file: ${file}`, e.message);
    }
  }
}
function stashUnusedScrapbookFiles(currentUrls, dataDir) {
  const scrapDir = path.join(dataDir, 'scrapbook');
  if (!fs.existsSync(scrapDir)) return;
  const keep = new Set((Array.isArray(currentUrls) ? currentUrls : []).filter(Boolean));
  const stashDir = path.join(dataDir, 'stash', 'scrapbook', 'images');
  for (const file of fs.readdirSync(scrapDir).filter(isImageFileName)) {
    const fileUrl = `/data/scrapbook/${file}`;
    if (keep.has(fileUrl)) continue;
    try {
      const movedTo = movePathToStash(path.join(scrapDir, file), stashDir, file);
      if (movedTo) console.log(`[Archive] Stashed unused scrapbook file: ${fileUrl} -> ${movedTo}`);
    } catch (e) {
      console.warn(`[Archive] Failed to stash scrapbook file: ${file}`, e.message);
    }
  }
}
function stashGlobalBackgroundFiles(currentUrl, dataDir) {
  const keep = currentUrl ? new Set([currentUrl]) : new Set();
  const stashDir = path.join(dataDir, 'stash', 'global_background');
  for (const file of fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter(f => /^global_background\.(jpg|jpeg|png|webp)$/i.test(f)) : []) {
    const fileUrl = toDataUrl(path.join(dataDir, file), process.cwd());
    if (keep.has(fileUrl)) continue;
    try {
      const movedTo = movePathToStash(path.join(dataDir, file), stashDir, file);
      if (movedTo) console.log(`[Archive] Stashed unused global background: ${fileUrl} -> ${movedTo}`);
    } catch (e) {
      console.warn(`[Archive] Failed to stash global background: ${file}`, e.message);
    }
  }
}
function stashRemovedScrapbookEntries(previousItems, incomingItems, dataDir) {
  const prev = Array.isArray(previousItems) ? previousItems : [];
  const next = Array.isArray(incomingItems) ? incomingItems : [];
  const nextIds = new Set(next.map(item => item?.id).filter(Boolean));
  const stashDir = path.join(dataDir, 'stash', 'scrapbook', 'entries');
  for (const item of prev) {
    if (!item?.id || nextIds.has(item.id)) continue;
    try {
      writeJsonToStash(stashDir, item.title || `scrapbook_${item.id}`, { reason: 'deleted', deletedAt: Date.now(), entry: item });
    } catch (e) {
      console.warn('[Archive] Failed to stash scrapbook entry:', e.message);
    }
  }
}
function stashNovelIfShrunk(previousNovel, nextNovel, dataDir) {
  const prevContent = String(previousNovel?.content || '');
  const nextContent = String(nextNovel?.content || '');
  if (!prevContent) return;
  if (nextContent.length >= prevContent.length && nextContent) return;
  try {
    writeJsonToStash(path.join(dataDir, 'stash', 'novel'), previousNovel?.title || 'novel', {
      reason: nextContent ? 'shrunk' : 'cleared',
      stashedAt: Date.now(),
      previous: previousNovel,
      next: nextNovel || null
    });
  } catch (e) {
    console.warn('[Archive] Failed to stash novel snapshot:', e.message);
  }
}
function stashAiSessionsIfShrunk(previousSessions, nextSessions, dataDir) {
  const prev = Array.isArray(previousSessions) ? previousSessions : [];
  const next = Array.isArray(nextSessions) ? nextSessions : [];
  if (prev.length === 0) return;
  const countMessages = (sessions) => sessions.reduce((sum, s) => {
    return sum + (Array.isArray(s?.messages) ? s.messages.length : 0);
  }, 0);
  const prevMsgCount = countMessages(prev);
  const nextMsgCount = countMessages(next);
  const shrunk =
    next.length < prev.length ||
    nextMsgCount < prevMsgCount ||
    nextMsgCount === 0;
  if (!shrunk) return;
  try {
    writeJsonToStash(path.join(dataDir, 'stash', 'ai_sessions'), 'ai_sessions', {
      reason: nextMsgCount === 0 ? 'cleared' : 'shrunk',
      stashedAt: Date.now(),
      previousStats: { sessions: prev.length, messages: prevMsgCount },
      nextStats: { sessions: next.length, messages: nextMsgCount },
      previous: prev
    });
  } catch (e) {
    console.warn('[Archive] Failed to stash ai sessions snapshot:', e.message);
  }
}
function mergeStoryImagesForSave(incomingStories, diskStories, previousStories, charName) {
  if (!Array.isArray(incomingStories)) return Array.isArray(diskStories) ? diskStories : [];
  const localPrefix = charName ? `/data/characters/${charName}/stories/` : '';
  const previousLocalUrls = new Set(
    (Array.isArray(previousStories) ? previousStories : [])
      .map(item => item?.src)
      .filter(src => typeof src === 'string' && localPrefix && src.startsWith(localPrefix))
  );
  const incomingLocalUrls = new Set(
    incomingStories
      .map(item => item?.src)
      .filter(src => typeof src === 'string' && localPrefix && src.startsWith(localPrefix))
  );
  const preservedNewDiskStories = (Array.isArray(diskStories) ? diskStories : []).filter(item => {
    const src = item?.src;
    if (typeof src !== 'string' || !localPrefix || !src.startsWith(localPrefix)) return false;
    if (incomingLocalUrls.has(src)) return false;
    return !previousLocalUrls.has(src);
  });
  return [...incomingStories, ...preservedNewDiskStories];
}
function mergeCharacterForSave(diskChar, incomingChar, previousChar) {
  if (!diskChar) return incomingChar;
  if (!incomingChar) return diskChar;
  const merged = { ...diskChar, ...incomingChar };
  merged.storyImgs = mergeStoryImagesForSave(incomingChar.storyImgs, diskChar.storyImgs, previousChar?.storyImgs, merged.name || diskChar.name || incomingChar.name);
  return merged;
}

function scanAndSyncCharacters(characters, dataDir, deletedNames = []) {
  const charsDir = path.join(dataDir, 'characters');
  if (!fs.existsSync(charsDir)) return characters || [];

  const deletedSet = new Set((Array.isArray(deletedNames) ? deletedNames : []).filter(Boolean));
  const existingChars = Array.isArray(characters) ? [...characters].filter(char => !deletedSet.has(char?.name)) : [];

  return existingChars.map(char => {
    if (!char?.name) return char;
    const charDir = path.join(charsDir, char.name);
    if (!fs.existsSync(charDir)) return char;
    ensureCharacterMediaDirs(charDir);
    const basePrefix = `/data/characters/${char.name}`;
    const updated = { ...char };

    const portraitVariants = [
      ...getImageUrlsInDir(path.join(charDir, 'portraits'), `${basePrefix}/portraits`),
      ...getImageUrlsInDir(path.join(charDir, 'portrait'), `${basePrefix}/portrait`)
    ];
    const backgroundVariants = [
      ...getImageUrlsInDir(path.join(charDir, 'backgrounds'), `${basePrefix}/backgrounds`),
      ...getImageUrlsInDir(path.join(charDir, 'background'), `${basePrefix}/background`)
    ];
    const combatVariants = [
      ...getImageUrlsInDir(path.join(charDir, 'combats'), `${basePrefix}/combats`),
      ...getImageUrlsInDir(path.join(charDir, 'combat'), `${basePrefix}/combat`)
    ].filter(u => !/[^/]*_depth\.(png|jpg|jpeg|webp)$/i.test(u));

    const legacyPortraitUrl = getFirstExistingUrl(charDir, ['portrait.jpg', 'portrait.png'], basePrefix);
    const legacyCombatUrl = getFirstExistingUrl(charDir, ['combat.jpg', 'combat.png'], basePrefix);
    const legacyBackgroundUrl = getFirstExistingUrl(charDir, ['background.jpg', 'background.png'], basePrefix);

    updated.image = chooseCurrentOrFirstVariant(updated.image, portraitVariants, legacyPortraitUrl);
    updated.combatImg = chooseCurrentOrFirstVariant(updated.combatImg, combatVariants, legacyCombatUrl);
    updated.background = chooseCurrentOrFirstVariant(updated.background, backgroundVariants, legacyBackgroundUrl);
    const combatDepthUrl = resolveCombatDepthImgUrl(charDir, basePrefix, updated.combatImg);
    if (combatDepthUrl) updated.combatDepthImg = combatDepthUrl;

    // 2. 图库插图扫描 (StoryImgs)
    const storiesDir = path.join(charDir, 'stories');
    const localPrefix = `${basePrefix}/stories/`;
    
    if (fs.existsSync(storiesDir)) {
      const physicalFiles = fs.readdirSync(storiesDir).filter(isImageFileName).sort();
      const physicalUrls = physicalFiles.map(f => `${localPrefix}${f}`);
      
      const oldStories = Array.isArray(updated.storyImgs) ? updated.storyImgs : [];
      
      // 过滤物理磁盘上消失的条目
      const validOldStories = oldStories.filter(item => {
        if (!item.src || !item.src.startsWith(localPrefix)) return true;
        return physicalUrls.includes(item.src);
      });

      // 同步磁盘新增
      const existingUrls = new Set(validOldStories.map(s => s.src));
      const newFromDisk = physicalUrls
        .filter(url => !existingUrls.has(url))
        .map(url => ({ 
          src: url, 
          caption: path.basename(url, path.extname(url)) 
        }));

      updated.storyImgs = [...validOldStories, ...newFromDisk];
    }
    
    return updated;
  });
}
function scanAndSyncScrapbook(scrapbook, dataDir) {
  const scrapDir = path.join(dataDir, 'scrapbook');
  if (!fs.existsSync(scrapDir)) return scrapbook;
  const updated = [...(scrapbook || [])].map(item => ({ ...item }));
  for (let i = 0; i < updated.length; i += 1) {
    const item = updated[i];
    const imageUrl = String(item?.image || '');
    if (imageUrl.startsWith('/data/scrapbook/')) {
      const filePath = path.join(dataDir, imageUrl.replace(/^\/data\//, ''));
      if (!fs.existsSync(filePath)) updated[i] = { ...item, image: null };
    }
  }
  const fileNameToUrl = new Map(
    fs.readdirSync(scrapDir)
      .filter(isImageFileName)
      .map(f => [path.basename(f, path.extname(f)), `/data/scrapbook/${f}`])
  );
  for (let i = 0; i < updated.length; i += 1) {
    const item = updated[i];
    const title = String(item?.title || '');
    if (!title) continue;
    const matchedUrl = fileNameToUrl.get(title);
    if (matchedUrl) updated[i] = { ...item, image: matchedUrl };
  }
  return updated;
}
function scanAndSyncAiSessions(aiSessions, dataDir) {
  if (!Array.isArray(aiSessions)) return aiSessions;
  return aiSessions.map(sess => ({
    ...sess,
    messages: (Array.isArray(sess.messages) ? sess.messages : []).map(msg => {
      if (msg?.role !== 'assistant' || typeof msg?.content !== 'string') return msg;
      const m = msg.content.match(/===NOVELAI_RESULT===\s*([\s\S]*?)(?:=============|$)/);
      if (!m) return msg;
      const url = (m[1] || '').trim();
      if (!url.startsWith('/data/ai_generated/')) return msg;
      const filePath = path.join(dataDir, url.replace(/^\/data\//, ''));
      if (fs.existsSync(filePath)) return msg;
      return { ...msg, content: msg.content.replace(/===NOVELAI_RESULT===\s*[\s\S]*?=============/g, '[AI图片文件已删除]') };
    })
  }));
}
function syncDatabaseFromDisk(dbPath, dataDir) {
  const db = safeReadJson(dbPath);
  if (!db) return false;
  const before = JSON.stringify(db);
  const deletedCharacterNames = Array.isArray(db.deletedCharacterNames) ? Array.from(new Set(db.deletedCharacterNames.filter(Boolean))) : [];
  db.deletedCharacterNames = deletedCharacterNames;
  db.characters = scanAndSyncCharacters(db.characters || [], dataDir, deletedCharacterNames);
  db.scrapbook = scanAndSyncScrapbook(db.scrapbook || [], dataDir);
  db.aiSessions = scanAndSyncAiSessions(db.aiSessions || [], dataDir);
  const after = JSON.stringify(db);
  if (before === after) return false;
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  return true;
}
function calculateSkipCfgAboveSigma(width, height, modelName) {
  const magicConstant = modelName?.includes('nai-diffusion-4-5')
    ? SIGMA_MAGIC_NUMBER_V45
    : SIGMA_MAGIC_NUMBER;
  const pixelCount = width * height;
  const ratio = pixelCount / REFERENCE_PIXEL_COUNT;
  return Math.sqrt(ratio) * magicConstant;
}
function getRagPaths(dataDir) {
  const dir = path.join(dataDir, 'rag');
  return { 
    dir, 
    indexPath: path.join(dir, 'index.json'), 
    metaPath: path.join(dir, 'meta.json'),
    novelIndexPath: path.join(dir, 'novel_index.json'),
    novelSummaryIndexPath: path.join(dir, 'novel_summary_index.json'),
    novelSummaryRagIndexPath: path.join(dir, 'novel_summary_rag_index.json'),
    novelMetaPath: path.join(dir, 'novel_meta.json'),
    scrapbookIndexPath: path.join(dir, 'scrapbook_index.json'),
    scrapbookMetaPath: path.join(dir, 'scrapbook_meta.json')
  };
}
function readRagJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath));
  } catch (e) { return fallback; }
}
function writeRagJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload));
}
function ensureNovelSummarySeparated(dataDir) {
  const { novelIndexPath, novelSummaryIndexPath } = getRagPaths(dataDir);
  const novelIndex = readRagJson(novelIndexPath, { updatedAt: Date.now(), docs: [] });
  const novelSummaryIndex = readRagJson(novelSummaryIndexPath, { updatedAt: Date.now(), summaries: {} });
  if (!novelSummaryIndex || typeof novelSummaryIndex !== 'object') {
    throw new Error('novel_summary_index 数据损坏');
  }
  if (!novelSummaryIndex.summaries || typeof novelSummaryIndex.summaries !== 'object') {
    novelSummaryIndex.summaries = {};
  }

  const docs = Array.isArray(novelIndex?.docs) ? novelIndex.docs : [];
  let novelChanged = false;
  let summaryChanged = false;
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const legacyMeta = doc?.ai_metadata;
    if (!legacyMeta || typeof legacyMeta !== 'object') continue;
    if (!novelSummaryIndex.summaries[doc.id]) {
      novelSummaryIndex.summaries[doc.id] = legacyMeta;
      summaryChanged = true;
    }
    const { ai_metadata, ...rest } = doc;
    docs[i] = rest;
    novelChanged = true;
  }

  if (novelChanged) {
    novelIndex.docs = docs;
    novelIndex.updatedAt = Date.now();
    writeRagJson(novelIndexPath, novelIndex);
  }
  if (summaryChanged || !fs.existsSync(novelSummaryIndexPath)) {
    novelSummaryIndex.updatedAt = Date.now();
    writeRagJson(novelSummaryIndexPath, novelSummaryIndex);
  }

  return { novelIndex, novelSummaryIndex };
}
function parseNovelSummaryChunkId(id) {
  const s = String(id || '');
  if (!s.startsWith('novel_')) return null;
  const rest = s.slice(6);
  const last = rest.lastIndexOf('_');
  if (last < 0) return null;
  const pieceIdx = Number(rest.slice(last + 1));
  const chapterKey = rest.slice(0, last);
  if (!Number.isFinite(pieceIdx)) return null;
  return { chapterKey, pieceIdx };
}
async function ensureNovelSummaryRagVectorIndex(dataDir, ragConfig, novelSummaryIndex) {
  const { novelSummaryRagIndexPath } = getRagPaths(dataDir);
  const src = novelSummaryIndex?.summaries || {};
  const sourceUpdatedAt = Number(novelSummaryIndex?.updatedAt || 0);
  const existing = readRagJson(novelSummaryRagIndexPath, { updatedAt: 0, sourceUpdatedAt: 0, docs: [] });
  const existingDocs = Array.isArray(existing?.docs) ? existing.docs : [];
  const srcIds = Object.keys(src).sort();
  const dstIds = existingDocs.map((d) => String(d.id || '')).filter(Boolean).sort();
  const sameShape = srcIds.length === dstIds.length && srcIds.every((id, i) => id === dstIds[i]);
  if (sameShape && Number(existing?.sourceUpdatedAt || 0) >= sourceUpdatedAt && existingDocs.length > 0) {
    return existing;
  }
  const docs = [];
  for (const id of srcIds) {
    const meta = src[id] || {};
    const summary = String(meta.summary || '').trim();
    if (!summary) continue;
    const parsed = parseNovelSummaryChunkId(id);
    const chapterLabel = parsed?.chapterKey?.split('_').slice(1).join('_') || parsed?.chapterKey || '未知章节';
    const pieceNo = Number.isFinite(parsed?.pieceIdx) ? parsed.pieceIdx + 1 : null;
    const isPrequel = String(parsed?.chapterKey || '').startsWith('preq_');
    const preqMatch = String(parsed?.chapterKey || '').match(/^preq_([^_]+)_/);
    const workType = isPrequel ? 'prequel' : 'main';
    const workId = isPrequel ? String(preqMatch?.[1] || 'unknown') : 'main';
    const chars = Array.isArray(meta.characters_present) ? meta.characters_present.map((x) => String(x || '')).filter(Boolean) : [];
    const locs = Array.isArray(meta.locations) ? meta.locations.map((x) => String(x || '')).filter(Boolean) : [];
    const events = Array.isArray(meta.key_events) ? meta.key_events.map((x) => String(x || '')).filter(Boolean) : [];
    const storyTimeNote = String(meta.story_time_note || '').trim();
    const text = [
      `章节:${chapterLabel}`,
      `片段:${pieceNo != null ? pieceNo : '未知'}`,
      `摘要:${summary}`,
      storyTimeNote ? `时间定位:${storyTimeNote}` : '',
      chars.length ? `在场角色:${chars.join('、')}` : '',
      locs.length ? `地点:${locs.join('、')}` : '',
      events.length ? `事件关键词:${events.join('、')}` : ''
    ].filter(Boolean).join('\n');
    const vector = await embedTextForRag(text, ragConfig);
    docs.push({
      id,
      type: 'novel_summary',
      chapterKey: parsed?.chapterKey || '',
      pieceIndex: Number.isFinite(parsed?.pieceIdx) ? parsed.pieceIdx : -1,
      workType,
      workId,
      title: `摘要 · ${chapterLabel} · 片段 ${pieceNo != null ? pieceNo : '?'}`,
      text,
      vector
    });
  }
  const payload = {
    updatedAt: Date.now(),
    sourceUpdatedAt,
    docs
  };
  writeRagJson(novelSummaryRagIndexPath, payload);
  return payload;
}
function stripJsonFences(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}
function parseJsonFromModelText(text) {
  const cleaned = stripJsonFences(text);
  try { return JSON.parse(cleaned); } catch (e) {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    try { return JSON.parse(sliced); } catch (e) {}
  }
  throw new Error('模型返回内容不是有效 JSON');
}
function getModelMessageText(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map(part => (typeof part?.text === 'string' ? part.text : (typeof part === 'string' ? part : '')))
      .join('\n')
      .trim();
  }
  return '';
}
/** 旧版 reference_trace 数组 → 可读段落（仅兼容展示） */
function legacyReferenceTraceArrayToText(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const lines = [];
  for (const item of arr.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const inf = String(item.inference || item.claim || '').trim();
    let src = '';
    if (Array.isArray(item.sources)) src = item.sources.map((s) => String(s || '').trim()).filter(Boolean).join('、');
    else if (item.sources != null && item.sources !== '') src = String(item.sources).trim();
    else if (item.source != null && item.source !== '') src = Array.isArray(item.source) ? item.source.join('、') : String(item.source);
    if (!inf && !src) continue;
    lines.push(src ? `${inf || '（推断）'}（依据：${src}）` : inf);
  }
  return lines.join('\n');
}

function normalizeAiMetadataShape(input) {
  const toArray = (value) => {
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
    if (value == null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
  };
  const storyTimeNote = String(input?.story_time_note || '').trim().slice(0, 10);
  const reference_thinking = String(input?.reference_thinking ?? '').trim().slice(0, 4000);
  return {
    summary: String(input?.summary || '').trim(),
    story_time_note: storyTimeNote,
    characters_present: toArray(input?.characters_present),
    locations: toArray(input?.locations),
    key_events: toArray(input?.key_events).slice(0, 3),
    reference_thinking
  };
}
function parseChineseNumber(raw) {
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
      continue;
    }
  }
  total += current;
  return Number.isFinite(total) && total > 0 ? total : null;
}
function numberToChinese(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n < 20) return n === 10 ? '十' : `十${d[n % 10]}`;
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return `${d[t]}十${u ? d[u] : ''}`;
  }
  return String(n);
}
function extractChapterNumber(text) {
  const m = String(text || '').match(/第([一二三四五六七八九十百零〇两\d]+)章/);
  if (!m) return null;
  return parseChineseNumber(m[1]);
}
/** RAG 分片：正文编辑 / 笔记 语义切分参数 */
const RAG_NOVEL_MAX_LEN = 420
const RAG_NOVEL_OVERLAP = 90
const RAG_SCRAP_MAX_LEN = 380
const RAG_SCRAP_OVERLAP = 60

function slugifyRagKey(s, maxLen = 24) {
  const t = String(s || '').trim().replace(/[\s\\/:*?"<>|]+/g, '_')
  return t.slice(0, maxLen) || 'sec'
}
function splitIntoParagraphs(text) {
  return String(text || '').split(/\n\s*\n+/).map(t => t.trim()).filter(Boolean)
}
function splitTextByMaxLenRespectSentence(text, maxLen, overlapChars) {
  const s = String(text || '').trim()
  if (!s) return []
  if (s.length <= maxLen) return [s]
  const chunks = []
  let start = 0
  while (start < s.length) {
    let end = Math.min(s.length, start + maxLen)
    if (end < s.length) {
      const slice = s.slice(start, end)
      let breakAt = -1
      for (let i = slice.length - 1; i >= Math.max(0, slice.length - 120); i -= 1) {
        if (/[。！？…\n]/.test(slice[i])) {
          breakAt = start + i + 1
          break
        }
      }
      if (breakAt > start) end = breakAt
    }
    const piece = s.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= s.length) break
    const next = end - overlapChars
    start = next > start ? next : end
    if (start >= s.length) break
  }
  return chunks
}
function chunkTextSemantic(text, maxLen, overlapChars) {
  const paras = splitIntoParagraphs(text)
  if (!paras.length) {
    const t = String(text || '').trim()
    return t ? splitTextByMaxLenRespectSentence(t, maxLen, overlapChars) : []
  }
  const merged = []
  let buf = ''
  for (const p of paras) {
    if (!buf) {
      buf = p
    } else if (buf.length + 2 + p.length <= maxLen) {
      buf += `\n\n${p}`
    } else {
      merged.push(buf)
      if (p.length <= maxLen) buf = p
      else {
        merged.push(...splitTextByMaxLenRespectSentence(p, maxLen, overlapChars))
        buf = ''
      }
    }
  }
  if (buf) merged.push(buf)
  const out = []
  for (const m of merged) {
    if (m.length <= maxLen) out.push(m)
    else out.push(...splitTextByMaxLenRespectSentence(m, maxLen, overlapChars))
  }
  return out
}
function splitNovelContentIntoChapters(content) {
  const raw = String(content || '')
  if (!raw.trim()) return []
  let segments = []
  if (raw.includes('<<<CHAPTER_SPLIT>>>')) {
    segments = raw.split(/<<<CHAPTER_SPLIT>>>/).map(s => s.trim()).filter(Boolean)
  } else {
    const parts = raw.split(/(?=^@@chapter:)/m).map(s => s.trim()).filter(Boolean)
    segments = parts.length > 1 ? parts : [raw.trim()]
  }
  return segments.map((seg, idx) => {
    let chapterTitle = `第${idx + 1}节`
    let body = seg
    const m = seg.match(/^@@chapter:([^\n\r]+)/)
    if (m) {
      chapterTitle = m[1].trim() || chapterTitle
      body = seg.replace(/^@@chapter:[^\n\r]+\s*/, '').trim()
    }
    const chapterKey = `ch${idx}_${slugifyRagKey(chapterTitle)}`
    return { chapterIndex: idx, chapterKey, chapterTitle, body }
  })
}
function buildNovelRagDocSkeletons(payload) {
  const novel = payload?.novel || {}
  const bookTitle = novel.title || '正文编辑'
  const content = String(novel.content || '')
  const chapters = splitNovelContentIntoChapters(content)
  const docs = []
  for (const ch of chapters) {
    const pieces = chunkTextSemantic(ch.body, RAG_NOVEL_MAX_LEN, RAG_NOVEL_OVERLAP)
    pieces.forEach((text, pieceIdx) => {
      const title = `《${bookTitle}》·${ch.chapterTitle} · 片段 ${pieceIdx + 1}`
      docs.push({
        id: `novel_${ch.chapterKey}_${pieceIdx}`,
        type: 'novel',
        title,
        text,
        chapterKey: ch.chapterKey,
        chapterTitle: ch.chapterTitle,
        chunkIndex: pieceIdx,
        workType: 'main',
        workId: 'main'
      })
    })
  }
  const prequels = Array.isArray(novel.prequels) ? novel.prequels : [];
  for (const p of prequels) {
    const pid = String(p?.id || '').trim();
    if (!pid) continue;
    const pTitle = String(p?.title || '前传').trim() || '前传';
    const charName = String(p?.characterName || '').trim();
    const pContent = String(p?.content || '');
    const pChapters = splitNovelContentIntoChapters(pContent);
    /** 单卷前传通常一整章：用前传标题作小节名，避免出现无意义的「第1节」 */
    let sourceChapters;
    if (!pChapters.length) {
      sourceChapters = [{ chapterTitle: pTitle, body: pContent }];
    } else if (pChapters.length === 1) {
      sourceChapters = [{ chapterTitle: pTitle, body: pChapters[0].body }];
    } else {
      sourceChapters = pChapters.map((ch) => {
        const rawTitle = String(ch?.chapterTitle || '').trim() || pTitle;
        const chTitle = /^第\d+节$/.test(rawTitle) ? `${pTitle}·${rawTitle}` : rawTitle;
        return { chapterTitle: chTitle, body: ch.body };
      });
    }
    const prequelSectionCount = sourceChapters.length;
    sourceChapters.forEach((ch, chIdx) => {
      const chTitle = ch.chapterTitle;
      const body = String(ch?.body || '');
      const scopedChapterKey = `preq_${slugifyRagKey(pid)}_ch${chIdx}_${slugifyRagKey(chTitle)}`;
      const pieces = chunkTextSemantic(body, RAG_NOVEL_MAX_LEN, RAG_NOVEL_OVERLAP);
      /** 仅多节前传或节名≠前传卷名时标注「小节」，单节同名时避免重复一行 */
      const needSectionLine = prequelSectionCount > 1 || chTitle !== pTitle;
      const metaPrefix = [
        charName && `【绑定角色】${charName}`,
        `【前传】${pTitle}`,
        needSectionLine && `【小节】${chTitle}`
      ].filter(Boolean).join('\n');
      pieces.forEach((text, pieceIdx) => {
        const roleSeg = charName ? `绑定角色：${charName} · ` : '';
        const sliceTitle = chTitle === pTitle
          ? `【前传】${roleSeg}《${bookTitle}》「${pTitle}」 · 片段 ${pieceIdx + 1}`
          : `【前传】${roleSeg}《${bookTitle}》「${pTitle}」·${chTitle} · 片段 ${pieceIdx + 1}`;
        const textForEmbed = metaPrefix ? `${metaPrefix}\n\n${text}` : text;
        docs.push({
          id: `novel_${scopedChapterKey}_${pieceIdx}`,
          type: 'novel',
          title: sliceTitle,
          text: textForEmbed,
          chapterKey: scopedChapterKey,
          chapterTitle: chTitle,
          chunkIndex: pieceIdx,
          workType: 'prequel',
          workId: pid,
          prequelTitle: pTitle,
          characterName: charName
        });
      });
    });
  }
  return docs
}
function buildScrapbookRagDocPieces(entry, maxLen, overlap) {
  const title = entry?.title || '未命名'
  const tags = Array.isArray(entry?.tags) ? entry.tags : []
  const content = String(entry?.content || '')
  const header = `标题:${title}\n标签:${tags.join(', ')}\n\n`
  const full = header + content
  if (full.length <= maxLen) return [{ text: full, pieceIdx: 0 }]
  const innerMax = Math.max(80, maxLen - header.length)
  const innerChunks = chunkTextSemantic(content, innerMax, Math.floor(overlap / 2))
  if (!innerChunks.length) return [{ text: header, pieceIdx: 0 }]
  return innerChunks.map((inner, i) => ({ text: header + inner, pieceIdx: i }))
}
function buildScrapbookRagDocSkeletons(payload) {
  const scrapbook = payload?.scrapbook || []
  const docs = []
  const maxLen = RAG_SCRAP_MAX_LEN
  const overlap = RAG_SCRAP_OVERLAP
  for (const entry of scrapbook) {
    if (!entry || typeof entry !== 'object') continue
    const sid = entry?.id != null ? String(entry.id) : `noid_${docs.length}`
    const et = entry?.title || '笔记'
    const pieces = buildScrapbookRagDocPieces(entry, maxLen, overlap)
    pieces.forEach((p, pieceIdx) => {
      docs.push({
        id: `scrap_${sid}_${pieceIdx}`,
        type: 'scrapbook',
        title: pieces.length > 1 ? `${et} · 片段 ${pieceIdx + 1}` : et,
        text: p.text,
        scrapbookId: sid,
        chunkIndex: p.pieceIdx
      })
    })
  }
  return docs
}
/** 兼容旧版：纯定长滑窗（仅作备用） */
function chunkTextForRag(text, size = 520, overlap = 80) {
  return chunkTextSemantic(String(text || '').trim(), size, overlap)
}
function normalizeRagConfig(input) {
  const cfg = input || {};
  let baseUrl = String(cfg.baseUrl || 'https://api.siliconflow.cn/v1').trim();
  // Allow users to input host only (e.g. "www.dmxapi.cn/v1")
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl.replace(/^\/+/, '')}`;
  }
  const port = Number(cfg.chromaPort)
  return {
    enabled: cfg.enabled !== false,
    baseUrl,
    apiKey: String(cfg.apiKey || '').trim(),
    embeddingModel: String(cfg.embeddingModel || 'Qwen/Qwen3-Embedding-8B').trim(),
    useChroma: cfg.useChroma !== false,
    chromaHost: String(cfg.chromaHost || '127.0.0.1').trim(),
    chromaPort: Number.isFinite(port) && port > 0 ? port : 8000,
    chromaSsl: cfg.chromaSsl === true
  };
}
function buildEmbeddingUrl(baseUrl) {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/embeddings$/i.test(clean)) return clean;
  return `${clean}/embeddings`;
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function shouldRetryStatus(status) {
  return [429, 500, 502, 503, 504].includes(Number(status));
}
function shouldRetryIdleCloudSubmitStatus(status) {
  // 500 is often a Cloudflare challenge page on IdleCloud; return it to the client
  // so the caller can choose the fallback path instead of burning retries here.
  return [429, 502, 503, 504].includes(Number(status));
}
function isRetryableError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('aborted')
    || msg.includes('timed out')
    || msg.includes('timeout')
    || msg.includes('socket hang up')
    || msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('enotfound')
    || msg.includes('etimedout');
}

const upstreamRateLimitState = {
  novelai: { cooldownUntil: 0, consecutive429: 0, consecutiveTransientFailures: 0, circuitOpenUntil: 0 },
  idlecloud: { cooldownUntil: 0, consecutive429: 0, consecutiveTransientFailures: 0, circuitOpenUntil: 0 },
};
const IDLECLOUD_MAX_DEGRADED_COOLDOWN_MS = 180_000;
const IDLECLOUD_CIRCUIT_FAILURE_THRESHOLD = 6;
const IDLECLOUD_CIRCUIT_OPEN_MS = 180_000;
const IDLECLOUD_MIN_SUBMIT_INTERVAL_MS = 22_000;
const idleCloudSubmitQueueByToken = new Map();
const idleCloudLastSubmitAtByToken = new Map();

function enqueueByKey(queueMap, key, task) {
  const prev = queueMap.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(task);
  const tracked = run
    .catch(() => {})
    .finally(() => {
      if (queueMap.get(key) === tracked) queueMap.delete(key);
    });
  queueMap.set(
    key,
    tracked
  );
  return run;
}

function maskTokenForLog(token) {
  const t = String(token || '');
  if (!t) return 'unknown';
  if (t.length <= 8) return `***${t.slice(-2)}`;
  return `${t.slice(0, 4)}***${t.slice(-3)}`;
}

async function runIdleCloudSubmissionWithGuard(token, submitter, label = 'submit') {
  const tokenKey = String(token || '').trim() || '__unknown__';
  return enqueueByKey(idleCloudSubmitQueueByToken, tokenKey, async () => {
    if (IDLECLOUD_STABILITY_GUARD_ENABLED) {
      const now = Date.now();
      const lastSubmitAt = Number(idleCloudLastSubmitAtByToken.get(tokenKey) || 0);
      const waitMs = Math.max(0, lastSubmitAt + IDLECLOUD_MIN_SUBMIT_INTERVAL_MS - now);
      if (waitMs > 0) {
        console.warn(`[IdleCloud guard] token=${maskTokenForLog(token)} label=${label} wait=${waitMs}ms (min interval ${IDLECLOUD_MIN_SUBMIT_INTERVAL_MS}ms)`);
        await sleep(waitMs);
      }
    }
    idleCloudLastSubmitAtByToken.set(tokenKey, Date.now());
    return await submitter();
  });
}

function getRetryAfterMs(response) {
  const header = response?.headers?.get?.('retry-after');
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    const delta = at - Date.now();
    return delta > 0 ? delta : 0;
  }
  return 0;
}

function getIdleCloudAgentCandidates() {
  if (process.env.IDLECLOUD_ROUTE_FALLBACK === '1' && proxyAgent) {
    return idleCloudPreferProxy ? [proxyAgent, undefined] : [undefined, proxyAgent];
  }
  return idleCloudPreferProxy && proxyAgent ? [proxyAgent] : [undefined];
}

function idleCloudRouteLabel(agent) {
  return agent && PROXY_URL ? `proxy(${PROXY_URL})` : 'direct';
}

function classifyNetworkError(err) {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('request timeout') || msg.includes('timeout_after_') || msg.includes('etimedout') || msg.includes('timeout')) {
    return 'timeout';
  }
  if (msg.includes('before secure tls connection was established') || msg.includes('tls')) {
    return 'tls_handshake_failed';
  }
  if (msg.includes('econnreset') || msg.includes('socket hang up') || msg.includes('client network socket disconnected')) {
    return 'connection_reset';
  }
  if (msg.includes('econnrefused')) {
    return 'proxy_or_target_refused';
  }
  if (msg.includes('enotfound')) {
    return 'dns_failed';
  }
  if (msg.includes('fetch failed')) {
    return 'fetch_failed';
  }
  return 'network_error';
}

function formatClassifiedNetworkError(prefix, routeLabel, err, extra = '') {
  const kind = classifyNetworkError(err);
  const rawMsg = String(err?.message || err || '').trim();
  const raw = rawMsg || String(err?.code || err?.cause?.code || 'unknown_error');
  const suffix = extra ? `；${extra}` : '';
  switch (kind) {
    case 'timeout':
      return `${prefix}[${routeLabel}] 请求超时：${raw}${suffix}`;
    case 'tls_handshake_failed':
      return `${prefix}[${routeLabel}] TLS 握手失败：${raw}${suffix}`;
    case 'connection_reset':
      return `${prefix}[${routeLabel}] 连接被重置/中断：${raw}${suffix}`;
    case 'proxy_or_target_refused':
      return `${prefix}[${routeLabel}] 连接被拒绝：${raw}${suffix}`;
    case 'dns_failed':
      return `${prefix}[${routeLabel}] DNS 解析失败：${raw}${suffix}`;
    case 'fetch_failed':
      return `${prefix}[${routeLabel}] 网络请求失败：${raw}${suffix}`;
    default:
      return `${prefix}[${routeLabel}] 网络异常：${raw}${suffix}`;
  }
}

function toSingleLine(text, maxLen = 500) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}...(len=${clean.length})`;
}

function summarizeRefInput(val) {
  if (Array.isArray(val)) return { count: val.length, hasData: val.some((x) => typeof x === 'string' && x.length > 20) };
  if (typeof val === 'string') return { count: 1, hasData: val.length > 20 };
  if (val == null) return { count: 0, hasData: false };
  return { count: 1, hasData: true };
}

function buildImageRequestLogSummary(payload, upstreamKind) {
  const p = payload?.parameters || {};
  const ref1 = summarizeRefInput(p.reference_image_multiple);
  const ref2 = summarizeRefInput(p.director_reference_images);
  const prompt = String(payload?.input || '');
  const negative = String(p?.negative_prompt || '');
  return {
    upstream: upstreamKind || 'novelai',
    model: payload?.model || '',
    width: p?.width ?? null,
    height: p?.height ?? null,
    steps: p?.steps ?? null,
    scale: p?.scale ?? null,
    sampler: p?.sampler ?? null,
    noise_schedule: p?.noise_schedule ?? null,
    promptLen: prompt.length,
    negativeLen: negative.length,
    reference_image_multiple: ref1,
    director_reference_images: ref2,
  };
}

function extractUpstreamErrorMessage(buffer, contentType = '') {
  const raw = Buffer.from(buffer || []).toString('utf-8');
  if (/__CF\$cv\$params|challenge-platform\/scripts\/jsd\/main\.js|cdn-cgi\/challenge-platform/i.test(raw)) {
    return {
      message: 'Cloudflare 挑战页/风控页（非业务 JSON）',
      detail: 'cf_challenge_page'
    };
  }
  const rawText = toSingleLine(raw, 700);
  if (!rawText) return { message: '', detail: '' };
  if (String(contentType || '').toLowerCase().includes('application/json')) {
    try {
      const j = JSON.parse(raw);
      const m = toSingleLine(j?.message || j?.error || j?.detail || '', 700);
      return { message: m || rawText, detail: rawText };
    } catch (e) {}
  }
  return { message: rawText, detail: rawText };
}

function isIdleCloudNetworkError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('socket hang up')
    || msg.includes('client network socket disconnected')
    || msg.includes('tls connection was established')
    || msg.includes('before secure tls connection was established')
    || msg.includes('fetch failed')
    || msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('etimedout')
    || msg.includes('enotfound')
    || msg.includes('timeout');
}

async function fetchIdleCloudWithFallback(url, buildOptions, timeoutMs) {
  const candidates = getIdleCloudAgentCandidates();
  let lastErr = null;
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const agent = candidates[idx];
    const routeLabel = idleCloudRouteLabel(agent);
    try {
      const response = await fetchWithTimeout(url, buildOptions(agent), timeoutMs);
      try {
        response.__routeLabel = routeLabel;
      } catch (e) {}
      return response;
    } catch (err) {
      const decorated = err instanceof Error ? err : new Error(String(err));
      decorated.__routeLabel = routeLabel;
      decorated.__networkKind = classifyNetworkError(decorated);
      lastErr = decorated;
      const shouldFallback = isIdleCloudNetworkError(decorated) && idx < candidates.length - 1;
      console.warn(`[IdleCloud route failed] route=${routeLabel} kind=${decorated.__networkKind} reason=${decorated.message || String(decorated)}`);
      if (!shouldFallback) throw decorated;
    }
  }
  throw lastErr || new Error('idlecloud_request_failed');
}

async function waitForUpstreamCooldown(upstreamKey) {
  if (upstreamKey === 'idlecloud' && !IDLECLOUD_STABILITY_GUARD_ENABLED) return 0;
  const state = upstreamRateLimitState[upstreamKey];
  if (!state) return 0;
  const now = Date.now();
  if (Number(state.circuitOpenUntil || 0) > now) {
    const remain = state.circuitOpenUntil - now;
    const err = new Error(`circuit_open_${upstreamKey}_${remain}ms`);
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }
  const remain = state.cooldownUntil - Date.now();
  if (remain > 0) {
    console.warn(`[Image upstream cooldown] upstream=${upstreamKey} waiting=${remain}ms before next request`);
    await sleep(remain);
    return remain;
  }
  return 0;
}

function markUpstreamRateLimit(upstreamKey, response) {
  if (upstreamKey === 'idlecloud' && !IDLECLOUD_STABILITY_GUARD_ENABLED) return 0;
  const state = upstreamRateLimitState[upstreamKey];
  if (!state) return 0;
  state.consecutive429 = Math.max(1, Number(state.consecutive429 || 0) + 1);
  const retryAfterMs = getRetryAfterMs(response);
  const progressiveMs = Math.min(3 * 60 * 1000, 30_000 * (2 ** Math.max(0, state.consecutive429 - 1)));
  const cooldownMs = Math.max(retryAfterMs, progressiveMs);
  state.cooldownUntil = Date.now() + cooldownMs;
  console.warn(`[Image upstream 429] upstream=${upstreamKey} consecutive=${state.consecutive429} cooldown=${cooldownMs}ms retryAfter=${retryAfterMs}ms`);
  return cooldownMs;
}

function markUpstreamTransientFailure(upstreamKey, reason = 'network_error') {
  if (upstreamKey === 'idlecloud' && !IDLECLOUD_STABILITY_GUARD_ENABLED) return 0;
  const state = upstreamRateLimitState[upstreamKey];
  if (!state) return 0;
  state.consecutiveTransientFailures = Math.max(1, Number(state.consecutiveTransientFailures || 0) + 1);
  const n = state.consecutiveTransientFailures;
  const isTimeoutLike = String(reason).includes('timeout');
  const baseMs = isTimeoutLike ? 25_000 : 15_000;
  const progressiveMs = Math.min(IDLECLOUD_MAX_DEGRADED_COOLDOWN_MS, baseMs * (1 + Math.min(8, n)));
  const nextUntil = Date.now() + progressiveMs;
  state.cooldownUntil = Math.max(Number(state.cooldownUntil || 0), nextUntil);
  if (upstreamKey === 'idlecloud' && state.consecutiveTransientFailures >= IDLECLOUD_CIRCUIT_FAILURE_THRESHOLD) {
    state.circuitOpenUntil = Math.max(Number(state.circuitOpenUntil || 0), Date.now() + IDLECLOUD_CIRCUIT_OPEN_MS);
    console.warn(`[Image upstream circuit-open] upstream=${upstreamKey} failures=${state.consecutiveTransientFailures} open=${IDLECLOUD_CIRCUIT_OPEN_MS}ms`);
  }
  console.warn(`[Image upstream degraded] upstream=${upstreamKey} reason=${reason} consecutive=${state.consecutiveTransientFailures} cooldown=${progressiveMs}ms`);
  return progressiveMs;
}

function clearUpstreamRateLimit(upstreamKey) {
  const state = upstreamRateLimitState[upstreamKey];
  if (!state) return;
  state.consecutive429 = 0;
  state.consecutiveTransientFailures = 0;
  state.circuitOpenUntil = 0;
  state.cooldownUntil = 0;
}

function getIdleCloudAdaptiveRetryPolicy() {
  if (!IDLECLOUD_STABILITY_GUARD_ENABLED) {
    return { attempts: 1, timeoutMs: 180_000 };
  }
  const state = upstreamRateLimitState.idlecloud || {};
  const fails = Math.max(0, Number(state.consecutiveTransientFailures || 0));
  const attempts = fails >= 4 ? 1 : fails >= 2 ? 2 : 3;
  const timeoutMs = fails >= 4 ? 75_000 : fails >= 2 ? 90_000 : 120_000;
  return { attempts, timeoutMs };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_after_${timeoutMs}ms`)), timeoutMs);
  try {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err?.name === 'AbortError' || String(err?.message || '').includes('timeout_after_');
    if (aborted) {
      const e = new Error(`request timeout after ${timeoutMs}ms`);
      e.name = 'TimeoutError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(fetcher, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 1200,
    maxDelayMs = 8000,
    shouldRetry = () => false,
    onRetry = null,
    beforeAttempt = null,
    onSuccess = null,
  } = options;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (typeof beforeAttempt === 'function') await beforeAttempt(attempt);
      const result = await fetcher(attempt);
      if (shouldRetry(null, result) && attempt < attempts - 1) {
        const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt)) + Math.floor(Math.random() * 350);
        try {
          if (typeof onRetry === 'function') onRetry({ attempt: attempt + 1, delay, result });
        } catch (e) {}
        await sleep(delay);
        continue;
      }
      try {
        if (typeof onSuccess === 'function') onSuccess(result);
      } catch (e) {}
      return result;
    } catch (err) {
      lastError = err;
      if (shouldRetry(err, null) && attempt < attempts - 1) {
        const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt)) + Math.floor(Math.random() * 350);
        try {
          if (typeof onRetry === 'function') onRetry({ attempt: attempt + 1, delay, error: err });
        } catch (e) {}
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  if (lastError) throw lastError;
  throw new Error('fetch_retry_exhausted');
}
async function embedTextForRag(text, ragConfig) {
  const cfg = normalizeRagConfig(ragConfig);
  if (!cfg.enabled) throw new Error('rag_disabled');
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.embeddingModel) throw new Error('rag_config_missing');
  const url = buildEmbeddingUrl(cfg.baseUrl);
  const requestEmbedding = async (modelName) => {
    let lastErr = null;
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeoutMs = 20000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${cfg.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: modelName,
              input: String(text || '')
            })
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const brief = String(errText || '').replace(/\s+/g, ' ').slice(0, 180);
          const err = new Error(`embedding_failed_${res.status}${brief ? `:${brief}` : ''}`);
          if (shouldRetryStatus(res.status) && attempt < maxAttempts - 1) {
            const backoff = Math.min(6000, 350 * (2 ** attempt));
            const jitter = Math.floor(Math.random() * 350);
            await sleep(backoff + jitter);
            continue;
          }
          throw err;
        }
        const data = await res.json();
        const vector = data?.data?.[0]?.embedding;
        if (!Array.isArray(vector) || vector.length === 0) throw new Error('embedding_invalid');
        return { vector, modelUsed: modelName };
      } catch (e) {
        lastErr = e;
        if ((isRetryableError(e) || String(e?.message || '').includes('embedding_failed_5') || String(e?.message || '').includes('embedding_failed_429')) && attempt < maxAttempts - 1) {
          const backoff = Math.min(6000, 350 * (2 ** attempt));
          const jitter = Math.floor(Math.random() * 350);
          await sleep(backoff + jitter);
          continue;
        }
      }
    }
    throw lastErr || new Error('embedding_failed_unknown');
  };

  const ret = await requestEmbedding(cfg.embeddingModel);
  return ret.vector;
}
function cosineSim(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}
async function getChromaClientIfAvailable(ragConfig) {
  const n = normalizeRagConfig(ragConfig);
  if (!n.useChroma) return null;
  try {
    const client = new ChromaClient({ host: n.chromaHost, port: n.chromaPort, ssl: n.chromaSsl })
    await client.heartbeat()
    return client
  } catch (e) {
    console.warn('[RAG/Chroma] 连接失败，将使用本地 JSON 向量索引：', e.message)
    return null
  }
}
async function getOrCreateChromaCollection(client, name) {
  return client.getOrCreateCollection({
    name,
    embeddingFunction: null,
    configuration: { hnsw: { space: 'cosine' } }
  })
}
async function chromaClearCollection(coll) {
  const page = 400
  for (;;) {
    const g = await coll.get({ limit: page, offset: 0 })
    const ids = g.ids
    if (!ids?.length) break
    await coll.delete({ ids })
    if (ids.length < page) break
  }
}
async function chromaReplaceDocs(client, collectionName, docs) {
  const coll = await getOrCreateChromaCollection(client, collectionName)
  await chromaClearCollection(coll)
  if (!docs.length) return
  const batch = 64
  for (let i = 0; i < docs.length; i += batch) {
    const slice = docs.slice(i, i + batch)
    await coll.add({
      ids: slice.map(d => d.id),
      embeddings: slice.map(d => d.vector),
      documents: slice.map(d => d.text || ''),
      metadatas: slice.map(d => ({
        type: d.type,
        title: d.title || '',
        chapterKey: d.chapterKey != null ? String(d.chapterKey) : '',
        chapterTitle: d.chapterTitle != null ? String(d.chapterTitle) : '',
        scrapbookId: d.scrapbookId != null ? String(d.scrapbookId) : ''
      }))
    })
  }
}
function applyExcludeToChromaHits(ids, documents, metadatas, distances, topK, shouldExclude) {
  const out = []
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]
    if (shouldExclude(id)) continue
    const dist = distances[i]
    const score = typeof dist === 'number' ? 1 - dist : 0
    const meta = metadatas[i] || {}
    out.push({
      id,
      type: meta.type,
      title: meta.title,
      text: documents[i] || '',
      score
    })
    if (out.length >= topK) break
  }
  return out
}
async function chromaQueryCollection(client, collectionName, qv, topK, shouldExclude) {
  const coll = await getOrCreateChromaCollection(client, collectionName)
  const nFetch = Math.min(80, Math.max(topK * 4, topK + 8))
  const res = await coll.query({
    queryEmbeddings: [qv],
    nResults: nFetch,
    include: ['documents', 'metadatas', 'distances']
  })
  const ids = res.ids?.[0] || []
  const documents = res.documents?.[0] || []
  const metadatas = res.metadatas?.[0] || []
  const distances = res.distances?.[0] || []
  return applyExcludeToChromaHits(ids, documents, metadatas, distances, topK, shouldExclude)
}
async function searchRagChroma(dataDir, query, topK, ragConfig, type, excludeIds) {
  const n = normalizeRagConfig(ragConfig)
  if (!n.useChroma) return null
  let client
  try {
    client = new ChromaClient({ host: n.chromaHost, port: n.chromaPort, ssl: n.chromaSsl })
  } catch {
    return null
  }
  let qv
  try {
    qv = await embedTextForRag(query || '', ragConfig)
  } catch {
    return null
  }
  const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : [])
  const shouldExclude = (id) => {
    if (excludeSet.has(id)) return true
    for (const excludeId of excludeSet) {
      if (id.startsWith(excludeId + '_')) return true
    }
    return false
  }
  const cap = Math.max(1, Math.min(20, topK))
  let results = []
  try {
    if (type === 'all' || type === 'novel') {
      const hits = await chromaQueryCollection(client, CHROMA_COLLECTION_NOVEL, qv, cap, shouldExclude)
      results = results.concat(hits)
    }
    if (type === 'all' || type === 'scrapbook') {
      const hits = await chromaQueryCollection(client, CHROMA_COLLECTION_SCRAPBOOK, qv, cap, shouldExclude)
      results = results.concat(hits)
    }
  } catch (e) {
    console.warn('[RAG/Chroma] 查询失败：', e.message)
    return null
  }
  return results
}
function buildSettingCorpus(payload) {
  // 只返回笔记内容，角色设定已经通过 charSettingContext 单独提供
  const scraps = (payload?.scrapbook || []).map(s => `标题:${s?.title || ''}\n标签:${(s?.tags || []).join(', ')}\n内容:${s?.content || ''}`).join('\n\n');
  return scraps.trim();
}
function rebuildRagTypeDocs(index, type, docs) {
  // 不再混合存储，直接替换该类型的所有文档
  index.docs = docs;
}
async function updateRagIndexByPayload(dataDir, payload, ragConfig, options = {}) {
  const { novelIndexPath, novelMetaPath, scrapbookIndexPath, scrapbookMetaPath, novelSummaryRagIndexPath } = getRagPaths(dataDir);
  
  // 分别读取小说和笔记的索引
  const novelIndex = readRagJson(novelIndexPath, { updatedAt: Date.now(), docs: [] });
  const novelMeta = readRagJson(novelMetaPath, { lastNovelLen: 0, pendingNovelDelta: 0 });
  
  const scrapbookIndex = readRagJson(scrapbookIndexPath, { updatedAt: Date.now(), docs: [] });
  const scrapbookMeta = readRagJson(scrapbookMetaPath, { lastSettingLen: 0, pendingSettingDelta: 0 });
  const summaryRagIndex = readRagJson(novelSummaryRagIndexPath, { updatedAt: 0, sourceUpdatedAt: 0, docs: [] });
  
  const settingText = buildSettingCorpus(payload);
  const novelText = String(payload?.novel?.content || '');
  const settingLen = settingText.length;
  const novelLen = novelText.length;
  
  novelMeta.pendingNovelDelta += Math.abs(novelLen - (novelMeta.lastNovelLen || 0));
  novelMeta.lastNovelLen = novelLen;
  
  scrapbookMeta.pendingSettingDelta += Math.abs(settingLen - (scrapbookMeta.lastSettingLen || 0));
  scrapbookMeta.lastSettingLen = settingLen;
  
  const forceBuild = options?.force === true || (novelIndex.docs || []).length === 0 || (scrapbookIndex.docs || []).length === 0;
  const needNovel = forceBuild || novelMeta.pendingNovelDelta >= 2000;
  const needSetting = forceBuild || scrapbookMeta.pendingSettingDelta >= 100;
  
  const cfg = normalizeRagConfig(ragConfig || payload?.ragConfig);
  if (!cfg.enabled || !cfg.apiKey || !cfg.embeddingModel || !cfg.baseUrl) {
    writeRagJson(novelMetaPath, novelMeta);
    writeRagJson(scrapbookMetaPath, scrapbookMeta);
    const summaryDocs = (summaryRagIndex.docs || []).length;
    return {
      needSetting: false,
      needNovel: false,
      needSummary: false,
      docs: (novelIndex.docs || []).length + (scrapbookIndex.docs || []).length + summaryDocs,
      skipped: true,
      novelDocs: (novelIndex.docs || []).length,
      settingDocs: (scrapbookIndex.docs || []).length,
      summaryDocs
    };
  }

  // 未达字数阈值且非强制：只累计并保存 meta，不跑 embedding、不写索引文件、不跑剧情摘要向量（与「超过一定字数才重建」一致）
  if (!options?.force && !needNovel && !needSetting) {
    writeRagJson(novelMetaPath, novelMeta);
    writeRagJson(scrapbookMetaPath, scrapbookMeta);
    const novelDocs = (novelIndex.docs || []).length;
    const scrapbookDocs = (scrapbookIndex.docs || []).length;
    const summaryDocs = (summaryRagIndex.docs || []).length;
    return {
      skipped: true,
      belowThreshold: true,
      needNovel: false,
      needSetting: false,
      needSummary: false,
      docs: novelDocs + scrapbookDocs + summaryDocs,
      novelDocs,
      settingDocs: scrapbookDocs,
      summaryDocs,
      embedded: false
    };
  }

  // 构建小说索引（按章节标记 → 段落/句界 → 长度兜底）
  if (needNovel) {
    const skeletons = buildNovelRagDocSkeletons(payload);
    const docs = [];
    for (let i = 0; i < skeletons.length; i += 1) {
      const sk = skeletons[i];
      const vector = await embedTextForRag(sk.text, cfg);
      docs.push({ ...sk, vector });
    }
    novelIndex.docs = docs;
    novelMeta.pendingNovelDelta = 0;
  }
  
  // 构建笔记索引（按条目切分，条内再语义切）
  if (needSetting) {
    const skeletons = buildScrapbookRagDocSkeletons(payload);
    const docs = [];
    for (let i = 0; i < skeletons.length; i += 1) {
      const sk = skeletons[i];
      const vector = await embedTextForRag(sk.text, cfg);
      docs.push({ ...sk, vector });
    }
    scrapbookIndex.docs = docs;
    scrapbookMeta.pendingSettingDelta = 0;
  }
  
  if (cfg.useChroma) {
    const chromaClient = await getChromaClientIfAvailable(ragConfig);
    if (chromaClient) {
      try {
        if (needNovel) await chromaReplaceDocs(chromaClient, CHROMA_COLLECTION_NOVEL, novelIndex.docs || []);
        if (needSetting) await chromaReplaceDocs(chromaClient, CHROMA_COLLECTION_SCRAPBOOK, scrapbookIndex.docs || []);
      } catch (e) {
        console.warn('[RAG/Chroma] 写入 Chroma 失败（JSON 索引已保存）：', e.message);
      }
    }
  }

  // 同步构建「剧情摘要向量库」（独立于正文/笔记，供 planner 摘要检索）
  const { novelSummaryIndex } = ensureNovelSummarySeparated(dataDir);
  const summaryVectorIndex = await ensureNovelSummaryRagVectorIndex(dataDir, cfg, novelSummaryIndex);
  
  novelIndex.updatedAt = Date.now();
  scrapbookIndex.updatedAt = Date.now();
  
  writeRagJson(novelIndexPath, novelIndex);
  writeRagJson(novelMetaPath, novelMeta);
  writeRagJson(scrapbookIndexPath, scrapbookIndex);
  writeRagJson(scrapbookMetaPath, scrapbookMeta);
  
  const novelDocs = (novelIndex.docs || []).length;
  const scrapbookDocs = (scrapbookIndex.docs || []).length;
  const summaryDocs = (summaryVectorIndex.docs || []).length;
  return {
    needSetting,
    needNovel,
    needSummary: true,
    docs: novelDocs + scrapbookDocs + summaryDocs,
    novelDocs,
    settingDocs: scrapbookDocs,
    summaryDocs,
    forced: options?.force === true,
    embedded: true,
    failedSettingEmbeddings: 0,
    failedNovelEmbeddings: 0
  };
}
async function searchRag(dataDir, query, topK = 8, ragConfig = null, type = 'all', excludeIds = []) {
  const ncfg = normalizeRagConfig(ragConfig)
  if (ncfg.useChroma && String(query || '').trim()) {
    try {
      const chromaHits = await searchRagChroma(dataDir, query, topK, ragConfig, type, excludeIds)
      if (chromaHits !== null) return chromaHits
    } catch (e) {
      console.warn('[RAG/Chroma] 检索失败，回退 JSON：', e.message)
    }
  }
  const { novelIndexPath, novelSummaryRagIndexPath, scrapbookIndexPath } = getRagPaths(dataDir);
  const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  
  // 检查 ID 是否应该被排除（支持前缀匹配）
  const shouldExclude = (id) => {
    if (excludeSet.has(id)) return true;
    // 支持前缀匹配，例如 "novel_0" 会匹配 "novel_0_1234567890"
    for (const excludeId of excludeSet) {
      if (id.startsWith(excludeId + '_')) return true;
    }
    return false;
  };
  
  let results = [];
  
  // 查询小说索引
  if (type === 'all' || type === 'novel') {
    const novelIndex = readRagJson(novelIndexPath, { docs: [] });
    const qv = await embedTextForRag(query || '', ragConfig);
    const novelHits = (novelIndex.docs || [])
      .filter(d => Array.isArray(d.vector) && d.vector.length > 0 && !shouldExclude(d.id))
      .map(d => ({ ...d, score: cosineSim(qv, d.vector || []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, topK)))
      .map(d => ({ id: d.id, type: d.type, title: d.title, text: d.text, chapterKey: d.chapterKey || '', workType: d.workType || 'main', workId: d.workId || 'main', score: d.score }));
    results = results.concat(novelHits);
  }
  
  // 查询剧情摘要向量索引
  if (type === 'all' || type === 'novel_summary') {
    const summaryIndex = readRagJson(novelSummaryRagIndexPath, { docs: [] });
    const qv = await embedTextForRag(query || '', ragConfig);
    const summaryHits = (summaryIndex.docs || [])
      .filter(d => Array.isArray(d.vector) && d.vector.length > 0 && !shouldExclude(d.id))
      .map(d => ({ ...d, score: cosineSim(qv, d.vector || []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(60, topK)))
      .map(d => ({
        id: d.id,
        type: d.type || 'novel_summary',
        title: d.title,
        text: d.text,
        chapterKey: d.chapterKey || '',
        pieceIndex: Number.isFinite(d.pieceIndex) ? d.pieceIndex : -1,
        workType: d.workType || 'main',
        workId: d.workId || 'main',
        score: d.score
      }));
    results = results.concat(summaryHits);
  }
  
  // 查询笔记索引
  if (type === 'all' || type === 'scrapbook') {
    const scrapbookIndex = readRagJson(scrapbookIndexPath, { docs: [] });
    const qv = await embedTextForRag(query || '', ragConfig);
    const scrapbookHits = (scrapbookIndex.docs || [])
      .filter(d => Array.isArray(d.vector) && d.vector.length > 0 && !shouldExclude(d.id))
      .map(d => ({ ...d, score: cosineSim(qv, d.vector || []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, topK)))
      .map(d => ({ id: d.id, type: d.type, title: d.title, text: d.text, score: d.score }));
    results = results.concat(scrapbookHits);
  }
  
  return results;
}

/** 与 appHelpers.generateRollingSummaries 一致的小说切片顺序（用于「第几段」与邻近段） */
function sortNovelDocsForSummaryChain(docs) {
  const getChapterOrder = (doc) => {
    const key = String(doc?.chapterKey || '');
    const m = key.match(/^ch(\d+)_/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return (Array.isArray(docs) ? [...docs] : [])
    .filter((d) => d?.type === 'novel')
    .sort((a, b) => {
      const o = getChapterOrder(a) - getChapterOrder(b);
      if (o !== 0) return o;
      const byChapter = String(a.chapterTitle || '').localeCompare(String(b.chapterTitle || ''), 'zh-Hans-CN');
      if (byChapter !== 0) return byChapter;
      return Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
    });
}

function chapterSegmentLabelForSummary(sortedDocs, idx) {
  const d = sortedDocs[idx];
  if (!d) return '未知章段';
  const ch = String(d.chapterTitle || d.chapterKey || '未命名章节').trim() || '未命名章节';
  const key = d.chapterKey || d.chapterTitle || '';
  let seg = 1;
  for (let j = 0; j < idx; j++) {
    const k2 = sortedDocs[j].chapterKey || sortedDocs[j].chapterTitle || '';
    if (String(k2) === String(key)) seg += 1;
  }
  return `${ch} 第${seg}段`;
}

/** 将已落库的摘要结构体格式化为 prompt 文本（不含 sourceModel/ragStats 等内部字段，保留时间锚 story_time_note） */
function formatStoredSummaryMetaForPrompt(rawMeta) {
  if (!rawMeta || typeof rawMeta !== 'object') return '（无元数据）';
  const m = rawMeta;
  const joinZh = (arr) =>
    Array.isArray(arr) && arr.length
      ? arr.map((x) => String(x || '').trim()).filter(Boolean).join('、')
      : '（空）';
  const thinking =
    String(m.reference_thinking || '').trim() ||
    legacyReferenceTraceArrayToText(m.reference_trace) ||
    '';

  return [
    `summary：${String(m.summary || '').trim() || '（空）'}`,
    `story_time_note：${String(m.story_time_note || '').trim() || '（空）'}`,
    `characters_present：${joinZh(m.characters_present)}`,
    `locations：${joinZh(m.locations)}`,
    `key_events：${joinZh(m.key_events)}`,
    `reference_thinking：${thinking || '（空）'}`
  ].join('\n');
}

/** 摘要专用：对全书小说切片按查询做余弦相似度排序（不做 topK 截断，供距离过滤后择优） */
async function rankAllNovelChunksByQuery(dataDir, query, ragConfig, excludeIds) {
  const { novelIndexPath } = getRagPaths(dataDir);
  const novelIndex = readRagJson(novelIndexPath, { docs: [] });
  const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const shouldExclude = (id) => {
    if (excludeSet.has(id)) return true;
    for (const excludeId of excludeSet) {
      if (String(id).startsWith(String(excludeId) + '_')) return true;
    }
    return false;
  };
  const qv = await embedTextForRag(query || '', ragConfig);
  return (novelIndex.docs || [])
    .filter((d) => d?.type === 'novel' && Array.isArray(d.vector) && d.vector.length > 0 && !shouldExclude(d.id))
    .map((d) => ({ ...d, score: cosineSim(qv, d.vector || []) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 按向量相似度降序顺延；仅排除请求侧已剔除的邻段 id（前 5+当前+后 2），不再做序号距/条间距二次过滤。
 * 无摘要至多 4 段正文；已有摘要至多 6 段且写入整段结构化元数据。
 */
function pickDistantNovelRefsForSummarize({
  rankedHits,
  sortedDocs,
  summariesMap,
  maxFull,
  maxSummaryOnly
}) {
  const idToIndex = new Map(sortedDocs.map((d, i) => [String(d.id), i]));
  const selected = [];
  let fullC = 0;
  let sumC = 0;

  for (const hit of rankedHits) {
    const idx = idToIndex.get(String(hit.id));
    if (idx === undefined || idx < 0) continue;

    const meta = summariesMap[String(hit.id)] || {};
    const sum = String(meta.summary || '').trim();
    const label = chapterSegmentLabelForSummary(sortedDocs, idx);

    if (sum) {
      if (sumC >= maxSummaryOnly) continue;
      selected.push({
        id: hit.id,
        mode: 'summary_only',
        label,
        score: hit.score,
        text: formatStoredSummaryMetaForPrompt(meta)
      });
      sumC += 1;
    } else {
      if (fullC >= maxFull) continue;
      selected.push({
        id: hit.id,
        mode: 'full_text',
        label,
        score: hit.score,
        text: String(hit.text || '')
      });
      fullC += 1;
    }
    if (fullC >= maxFull && sumC >= maxSummaryOnly) break;
  }

  return { selected, fullC, sumC };
}

/** 客户端已合并进 chunkMap 的切片 id，用于多轮检索时从向量池排除并顺延名额 */
function normalizePlannerExistingChunkIds(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const id of arr) {
    const t = String(id ?? '').trim();
    if (!t || t.length > 240) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 2000) break;
  }
  return out;
}

function mergeExcludeIdLists(...lists) {
  const seen = new Set();
  for (const list of lists) {
    for (const id of Array.isArray(list) ? list : []) {
      const t = String(id ?? '').trim();
      if (t) seen.add(t);
    }
  }
  return Array.from(seen);
}

function computeNovelOverlapExcludeIds(novelContent, chapterIndex, cursorInChapter, referenceChars) {
  const chapters = splitNovelContentIntoChapters(String(novelContent || ''));
  if (!chapters.length) return [];
  const ci = Math.max(0, Math.min(Number(chapterIndex) || 0, chapters.length - 1));
  let globalCursor = 0;
  for (let i = 0; i < ci; i += 1) {
    globalCursor += String(chapters[i].body || '').length;
  }
  const body = String(chapters[ci].body || '');
  const cur = Math.min(Math.max(0, Number(cursorInChapter) || 0), body.length);
  globalCursor += cur;
  const refChars = Math.max(1, Number(referenceChars) || 1000);
  const refStart = Math.max(0, globalCursor - refChars);
  const refEnd = globalCursor;
  const exclude = new Set();
  let g = 0;
  for (const ch of chapters) {
    const pieces = chunkTextSemantic(ch.body, RAG_NOVEL_MAX_LEN, RAG_NOVEL_OVERLAP);
    for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx += 1) {
      const t = pieces[pieceIdx];
      const start = g;
      const end = g + t.length;
      g = end;
      const id = `novel_${ch.chapterKey}_${pieceIdx}`;
      if (Math.max(refStart, start) < Math.min(refEnd, end)) {
        exclude.add(id);
      }
    }
  }
  return Array.from(exclude);
}

function selectSummaryHitsByChapter(summaryPool, chapterIndex, limit, chapterScopeType = 'main', chapterWorkId = 'main') {
  const rows = (Array.isArray(summaryPool) ? summaryPool : [])
    .slice()
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  return selectUniqueSequential(rows, limit, (h) => String(h.id || ''));
}

function findMandatoryChapterOutlineScrapbook(db, chapterIndex1Based) {
  return findChapterOutlineScrapbookItem(db?.scrapbook, chapterIndex1Based);
}

function scrapbookKeywordSearchHits(db, query, limit = 8) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const cap = Number(limit);
  const top = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 8;
  const lower = q.toLowerCase();
  const scrapbook = Array.isArray(db.scrapbook) ? db.scrapbook : [];
  const matches = scrapbook.filter((s) => {
    const title = String(s.title || '');
    const content = String(s.content || '');
    const tags = Array.isArray(s.tags) ? s.tags.map((t) => String(t)) : [];
    return title.toLowerCase().includes(lower)
      || content.toLowerCase().includes(lower)
      || tags.some((t) => t.toLowerCase().includes(lower));
  }).slice(0, top);
  return matches.map((s) => {
    const sid = String(s.id);
    const title = s.title || '未命名';
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const header = `标题:${title}\n标签:${tags.join(', ')}\n\n`;
    const full = header + String(s.content || '');
    return {
      id: `scrap_${sid}_0`,
      type: 'scrapbook',
      title,
      text: full,
      score: 0.99,
      source: 'keyword',
      scrapbookId: sid
    };
  });
}

function normalizeFeedbackKeywords(rawKeywords, fallbackText = '', limit = 10) {
  const fromArray = Array.isArray(rawKeywords) ? rawKeywords : [];
  const cleaned = fromArray
    .map((k) => String(k || '').trim())
    .filter((k) => k.length >= 2)
    .slice(0, Math.max(1, limit));
  if (cleaned.length > 0) return [...new Set(cleaned)];
  // 兜底：避免关键词提取失败时完全空检索
  const fallback = String(fallbackText || '')
    .match(/[\u4e00-\u9fa5]{2,8}/g);
  return [...new Set((fallback || []).slice(0, Math.max(1, limit)))];
}

function selectUniqueSequential(hits, limit, keyGetter) {
  const limRaw = Number(limit);
  const lim = Number.isFinite(limRaw) ? Math.max(0, Math.floor(limRaw)) : 6;
  if (lim === 0) return [];
  const seen = new Set();
  const out = [];
  for (const h of hits || []) {
    const key = String((typeof keyGetter === 'function' ? keyGetter(h) : h?.id) || '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= lim) break;
  }
  return out;
}

function collectCharacterProfileHits(db, queryText, maxProfiles = 48, existingChunkIds = []) {
  const text = String(queryText || '');
  if (!text) return [];
  const max = Number.isFinite(Number(maxProfiles)) ? Math.max(0, Math.floor(Number(maxProfiles))) : 48;
  if (max === 0) return [];
  const excludeSet = new Set(Array.isArray(existingChunkIds) ? existingChunkIds : []);
  const chars = Array.isArray(db?.characters) ? db.characters : [];
  const out = [];
  for (const c of chars) {
    const name = String(c?.name || '').trim();
    if (!name || !text.includes(name)) continue;
    const cid = `char_${String(c?.id || name)}`;
    if (excludeSet.has(cid)) continue;
    const hex = Array.isArray(c?.hexagram) ? c.hexagram.join(' / ') : '';
    const details = String(c?.details || '').trim();
    const lore = String(c?.lore || '').trim();
    const combatPoem = String(c?.combatPoem || '').trim();
    const combatDesc = String(c?.combatDesc || '').trim();
    out.push({
      id: cid,
      type: 'character',
      name,
      title: String(c?.title || '').trim(),
      text: [
        `角色:${name}`,
        c?.title ? `称谓:${String(c.title)}` : '',
        details ? `人物概要:${details}` : '',
        lore ? `背景:${lore}` : '',
        combatPoem ? `展示短句:${combatPoem}` : '',
        combatDesc ? `能力描述:${combatDesc}` : '',
        hex ? `六项属性: ${hex}` : ''
      ].filter(Boolean).join('\n')
    });
    if (out.length >= max) break;
  }
  return out;
}

function attachArchiveApi(server) {
        const cwd = process.cwd();
        const dataDir = path.resolve(cwd, 'data');
        const dbPath = path.resolve(dataDir, 'database.json');
        const legacyPath = path.resolve(dataDir, 'archive.json');

        // 自动 RAG 重建已关闭：仅保留设置面板中的「强制重建」入口（/api/rag/rebuild）。

        fs.mkdirSync(path.join(dataDir, 'characters'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'scrapbook'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'ai_generated'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'versions'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'rag'), { recursive: true });

        if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
          try {
            const legacy = JSON.parse(fs.readFileSync(legacyPath));
            const migrated = { version: legacy.version || 'v11', timestamp: legacy.timestamp || Date.now(), characters: legacy.characters || [], scrapbook: legacy.scrapbook || [], novel: legacy.novel || { title: '未命名正文', content: '', updatedAt: 0 }, globalBackground: legacy.globalBackground || null, aiSessions: legacy.aiSessions || [] };
            fs.writeFileSync(dbPath, JSON.stringify(migrated, null, 2));
            console.log('[Archive] database.json 已从 archive.json 迁移完成。');
          } catch (e) { console.warn('[Archive] 迁移失败：', e.message); }
        }

        if (fs.existsSync(dbPath)) {
          console.log('[Archive] 启动完成（数据库保护模式：关闭自动磁盘反写）。');
        }

        const logPath = path.join(dataDir, 'last_server_error.log');
        const runtimeLogPath = path.join(dataDir, 'server_runtime.log');
        let saveReqSeq = 0;
        const writeRuntimeLog = (level, event, meta = {}) => {
          try {
            const line = JSON.stringify({
              ts: new Date().toISOString(),
              level,
              event,
              ...meta
            }) + '\n';
            fs.appendFileSync(runtimeLogPath, line);
          } catch (e) {}
        };
        const logCrash = (label, err) => {
          try {
            const line = `${new Date().toISOString()} ${label} ${err && err.stack ? err.stack : String(err)}\n`;
            fs.appendFileSync(logPath, line);
          } catch (e) {}
          console.error(`[Archive] ${label}`, err);
          writeRuntimeLog('error', 'process.crash', {
            label,
            message: err && err.message ? err.message : String(err)
          });
        };
        /*
        if (!globalThis.__celestineArchiveProcessHooks) {
          globalThis.__celestineArchiveProcessHooks = true;
          process.on('uncaughtException', (err) => {
            logCrash('uncaughtException', err);
            process.exit(1);
          });
          process.on('unhandledRejection', (reason) => {
            logCrash('unhandledRejection', reason);
          });
        }
 */
        let isDiskSyncing = false;
        let diskSyncTimer = null;
        const scheduleDiskSync = (reason = '') => {
          if (diskSyncTimer) clearTimeout(diskSyncTimer);
          diskSyncTimer = setTimeout(() => {
            if (isDiskSyncing) return;
            isDiskSyncing = true;
            try {
              writeRuntimeLog('info', 'disk_sync.skipped', { reason: reason || 'watch', mode: 'database_protect' });
            } catch (e) {
              console.warn('[Archive] 磁盘反写失败：', e.message);
            } finally {
              isDiskSyncing = false;
            }
          }, 600);
        };

        try {
          const watchers = [];
          const watchAndGuard = (watchPath, options, label, onChange) => {
            try {
              const watcher = fs.watch(watchPath, options, (_eventType, filename) => {
                onChange(filename);
              });
              watcher.on('error', (err) => {
                console.warn(`[Archive] 文件监听异常(${label})：`, err && err.message ? err.message : err);
                writeRuntimeLog('error', 'watcher.error', {
                  label,
                  path: watchPath,
                  message: err && err.message ? err.message : String(err)
                });
              });
              watchers.push(watcher);
            } catch (e) {
              console.warn(`[Archive] 文件监听初始化失败(${label})：`, e.message);
              writeRuntimeLog('error', 'watcher.init_failed', {
                label,
                path: watchPath,
                message: e && e.message ? e.message : String(e)
              });
            }
          };
          const watchedDirs = ['characters', 'scrapbook', 'ai_generated'];
          for (const dirName of watchedDirs) {
            const absDir = path.join(dataDir, dirName);
            ensureDir(absDir);
            watchAndGuard(
              absDir,
              { recursive: true },
              dirName,
              (filename) => {
                const p = String(filename || '').replace(/\\/g, '/');
                scheduleDiskSync(p ? `${dirName}/${p}` : dirName);
              }
            );
          }
          watchAndGuard(
            dataDir,
            { recursive: false },
            'data-root',
            (filename) => {
              const p = String(filename || '').replace(/\\/g, '/');
              if (!p) return scheduleDiskSync('data-root');
              if (p === 'database.json') return;
              if (/^archive(_backup)?\.json$/i.test(path.basename(p))) return;
              if (/^global_background\.(jpg|jpeg|png|webp)$/i.test(path.basename(p))) {
                scheduleDiskSync(p);
              }
            }
          );
          server.httpServer?.once('close', () => {
            for (const watcher of watchers) {
              try { watcher.close(); } catch (e) {}
            }
          });
        } catch (e) {
          console.warn('[Archive] 文件监听初始化失败：', e.message);
        }

        server.middlewares.use(async (req, res, next) => {

          let pathname = '/';
          try {
            pathname = new URL(req.url || '/', 'http://localhost').pathname;
          } catch {
            pathname = (String(req.url || '').split('?')[0]) || '/';
          }

          if (pathname === '/api/load' && req.method === 'GET') {
            if (fs.existsSync(dbPath)) {
              try {
                const db = safeReadJson(dbPath);
                if (db && typeof db === 'object') {
                  const deletedCharacterNames = Array.isArray(db.deletedCharacterNames)
                    ? db.deletedCharacterNames.filter(Boolean)
                    : [];
                  db.characters = scanAndSyncCharacters(db.characters || [], dataDir, deletedCharacterNames);
                  db.scrapbook = scanAndSyncScrapbook(db.scrapbook || [], dataDir);
                  db.aiSessions = scanAndSyncAiSessions(db.aiSessions || [], dataDir);
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify(db));
                } else {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(fs.readFileSync(dbPath));
                }
              } catch (e) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(fs.readFileSync(dbPath));
              }
            } else {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'not_found' }));
            }
            return;
          }

          if (pathname === '/api/versions' && req.method === 'GET') {
            try {
              const versionsRoot = path.join(dataDir, 'versions');
              ensureDir(versionsRoot);
              const versions = fs.readdirSync(versionsRoot)
                .map(name => {
                  const full = path.join(versionsRoot, name);
                  const stat = fs.statSync(full);
                  if (!stat.isDirectory()) return null;
                  return { id: name, mtime: stat.mtimeMs };
                })
                .filter(Boolean)
                .sort((a, b) => b.mtime - a.mtime);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ versions }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          if (pathname === '/api/rag/search' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const query = String(data.query || '').trim();
                const topK = Number(data.topK || 8);
                const type = String(data.type || 'all').trim(); // 'novel', 'scrapbook', 'all', or 'title'
                const excludeIds = Array.isArray(data.excludeIds) ? data.excludeIds : [];
                const db = safeReadJson(dbPath) || {};
                const ragConfig = data.ragConfig || db.ragConfig;

                let hits = [];
                if (type === 'title' && query) {
                  // 新增：精确/模糊标题匹配工具
                  const scrapbook = db.scrapbook || [];
                  hits = scrapbook
                    .filter(s => String(s.title || '').includes(query))
                    .map(s => ({
                      id: `scrap_${s.id}`,
                      type: 'scrapbook',
                      title: s.title,
                      text: s.content,
                      score: 1.0
                    }))
                    .slice(0, topK);
                } else {
                  hits = query ? await searchRag(dataDir, query, topK, ragConfig, type, excludeIds) : [];
                }

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ hits }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/rag/character-hits' && req.method === 'POST') {
            let body = [];
            req.on('data', (chunk) => body.push(chunk));
            req.on('end', () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const queryText = String(data.queryText || '');
                const maxProfiles = Number(data.maxProfiles);
                const charExcludeIds = normalizePlannerExistingChunkIds(data.excludeIds || data.existingChunkIds);
                const db = safeReadJson(dbPath) || {};
                const hits = collectCharacterProfileHits(
                  db,
                  queryText,
                  Number.isFinite(maxProfiles) ? maxProfiles : 12,
                  charExcludeIds
                );
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, hits }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: e.message, hits: [] }));
              }
            });
            return;
          }

          if (pathname === '/api/rag/planner/collect' && req.method === 'POST') {
            let body = [];
            req.on('data', (chunk) => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const novelContent = String(data.novelContent || '');
                const chapterIndex = Number(data.chapterIndex) || 0;
                const cursorInChapter = Number(data.cursorInChapter) || 0;
                const referenceChars = Math.max(200, Number(data.referenceChars) || 1000);
                const vectorQuery = String(data.vectorQuery || '').trim();
                const phase = Number(data.phase) === 2 ? 2 : 1;
                const feedbackText = String(data.feedbackText || '').trim();
                const feedbackKeywords = normalizeFeedbackKeywords(data.feedbackKeywords, feedbackText, 10);
                const chapterIndex1Based = Math.max(1, Number(data.chapterIndex1Based) || 1);
                const chapterScopeType = String(data.chapterScopeType || 'main');
                const chapterWorkId = String(data.chapterWorkId || 'main');
                const db = safeReadJson(dbPath) || {};
                const ragConfig = data.ragConfig || db.ragConfig || {};

                const { novelSummaryIndex } = ensureNovelSummarySeparated(dataDir);
                await ensureNovelSummaryRagVectorIndex(dataDir, ragConfig, novelSummaryIndex);
                const overlapExcludeIds = computeNovelOverlapExcludeIds(novelContent, chapterIndex, cursorInChapter, referenceChars);
                const existingChunkIds = normalizePlannerExistingChunkIds(data.existingChunkIds);

                const pcRaw = data.plannerCollect && typeof data.plannerCollect === 'object' ? data.plannerCollect : {};
                function limPlannerInt(v, lo, hi, d) {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return d;
                  return Math.max(lo, Math.min(hi, Math.floor(n)));
                }
                const lim = {
                  phase1Summary: limPlannerInt(pcRaw.phase1Summary, 0, 24, 6),
                  phase1Scrapbook: limPlannerInt(pcRaw.phase1Scrapbook, 0, 24, 6),
                  phase1SearchPool: limPlannerInt(pcRaw.phase1SearchPool, 8, 128, 48),
                  phase2Summary: limPlannerInt(pcRaw.phase2Summary, 0, 24, 2),
                  phase2Scrapbook: limPlannerInt(pcRaw.phase2Scrapbook, 0, 24, 2),
                  phase2SearchPool: limPlannerInt(pcRaw.phase2SearchPool, 8, 128, 48),
                  phase2KeywordExtra: limPlannerInt(pcRaw.phase2KeywordExtra, 0, 48, 8),
                  characterProfileMax: limPlannerInt(pcRaw.characterProfileMax, 0, 48, 48)
                };
                const summaryLimit = phase === 2 ? lim.phase2Summary : lim.phase1Summary;
                const scrapLimit = phase === 2 ? lim.phase2Scrapbook : lim.phase1Scrapbook;
                const searchPool = phase === 2 ? lim.phase2SearchPool : lim.phase1SearchPool;
                const summaryQuery = phase === 2
                  ? [vectorQuery, feedbackKeywords.join(' ')].filter(Boolean).join('\n')
                  : vectorQuery;
                const summaryExcludeIds = mergeExcludeIdLists(overlapExcludeIds, existingChunkIds);
                const summaryPool = await searchRag(dataDir, summaryQuery, searchPool, ragConfig, 'novel_summary', summaryExcludeIds);
                const summaryHits = selectSummaryHitsByChapter(summaryPool, chapterIndex, summaryLimit, chapterScopeType, chapterWorkId);
                const novelHits = summaryHits;
                const neighborSummaries = [];

                const outlineEntry = chapterScopeType === 'prequel'
                  ? null
                  : findMandatoryChapterOutlineScrapbook(db, chapterIndex1Based);
                const mandatorySid = outlineEntry ? String(outlineEntry.id) : '';
                const scrapbookIndexPath = getRagPaths(dataDir).scrapbookIndexPath;
                const scrapbookIndex = readRagJson(scrapbookIndexPath, { docs: [] });
                const mandatoryDocs = mandatorySid
                  ? (scrapbookIndex.docs || []).filter((d) => String(d.scrapbookId) === mandatorySid)
                  : [];
                let mandatoryHits = mandatoryDocs.map((d) => ({
                  id: d.id,
                  type: 'scrapbook',
                  title: d.title,
                  text: d.text,
                  score: 1,
                  mandatory: true,
                  scrapbookId: String(d.scrapbookId || '')
                }));
                if (mandatoryHits.length === 0 && outlineEntry) {
                  const et = outlineEntry;
                  mandatoryHits = [{
                    id: `scrap_${mandatorySid}_fallback`,
                    type: 'scrapbook',
                    title: et.title || '梗概',
                    text: `标题:${et.title || ''}\n标签:${(Array.isArray(et.tags) ? et.tags : []).join(',')}\n\n${String(et.content || '')}`,
                    score: 1,
                    mandatory: true,
                    scrapbookId: mandatorySid
                  }];
                }

                const excludeScrapPrefix = mandatorySid ? [`scrap_${mandatorySid}`] : [];
                const scrapbookExcludeIds = mergeExcludeIdLists(excludeScrapPrefix, existingChunkIds);

                let scrapbookHits = [];
                if (phase === 1) {
                  const pool = await searchRag(dataDir, vectorQuery, searchPool, ragConfig, 'scrapbook', scrapbookExcludeIds);
                  const filtered = (Array.isArray(pool) ? pool : []).filter((h) => {
                    const sid = String(h.id || '').match(/^scrap_([^_]+)_/)?.[1];
                    return sid && sid !== mandatorySid;
                  });
                  scrapbookHits = selectUniqueSequential(
                    filtered.map((h) => ({
                      id: h.id,
                      type: 'scrapbook',
                      title: h.title,
                      text: h.text,
                      score: h.score,
                      scrapbookId: String(h.scrapbookId || '')
                    })),
                    scrapLimit,
                    (h) => String(h.scrapbookId || (String(h.id || '').match(/^scrap_([^_]+)_/) || [])[1] || h.id)
                  );
                } else {
                  const existingIdSet = new Set(existingChunkIds);
                  const q2 = [vectorQuery, feedbackKeywords.join(' ')].filter(Boolean).join('\n');
                  const vecPool = await searchRag(dataDir, q2, searchPool, ragConfig, 'scrapbook', scrapbookExcludeIds);
                  const vecFiltered = (Array.isArray(vecPool) ? vecPool : []).filter((h) => {
                    const sid = String(h.id || '').match(/^scrap_([^_]+)_/)?.[1];
                    return sid && sid !== mandatorySid;
                  });
                  const kwRaw = scrapbookKeywordSearchHits(db, feedbackKeywords.join(' '), lim.phase2KeywordExtra);
                  const kwFiltered = (Array.isArray(kwRaw) ? kwRaw : []).filter((h) => {
                    if (existingIdSet.has(String(h.id || ''))) return false;
                    const sid = String(h.scrapbookId || (String(h.id || '').match(/^scrap_([^_]+)_/) || [])[1] || '');
                    return !mandatorySid || sid !== mandatorySid;
                  });
                  const merged = selectUniqueSequential([...vecFiltered.map((h) => ({
                    id: h.id,
                    type: 'scrapbook',
                    title: h.title,
                    text: h.text,
                    score: h.score,
                    scrapbookId: String(h.scrapbookId || ''),
                    source: 'vector'
                  })), ...kwFiltered], scrapLimit, (h) =>
                    String(h.scrapbookId || (String(h.id || '').match(/^scrap_([^_]+)_/) || [])[1] || h.id)
                  );
                  scrapbookHits = merged;
                }

                const characterHits = collectCharacterProfileHits(
                  db,
                  [vectorQuery, feedbackText, feedbackKeywords.join(' '), summaryHits.map((h) => h.text).join('\n')].filter(Boolean).join('\n'),
                  lim.characterProfileMax,
                  existingChunkIds
                );

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  ok: true,
                  excludeIds: overlapExcludeIds,
                  existingChunkIdsCount: existingChunkIds.length,
                  summaryHits,
                  novelHits,
                  neighborSummaries,
                  mandatoryOutlineHits: mandatoryHits,
                  scrapbookHits,
                  characterHits,
                  phase,
                  chapterScopeType,
                  chapterWorkId,
                  feedbackKeywords
                }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/rag/novel-overlap-exclude' && req.method === 'POST') {
            let body = [];
            req.on('data', (chunk) => body.push(chunk));
            req.on('end', () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const novelContent = String(data.novelContent || '');
                const chapterIndex = Number(data.chapterIndex) || 0;
                const cursorInChapter = Number(data.cursorInChapter) || 0;
                const referenceChars = Math.max(200, Math.min(8000, Number(data.referenceChars) || 1000));
                const excludeIds = computeNovelOverlapExcludeIds(novelContent, chapterIndex, cursorInChapter, referenceChars);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, excludeIds }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: e.message, excludeIds: [] }));
              }
            });
            return;
          }

          if (pathname === '/api/rag/test' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const db = safeReadJson(dbPath) || {};
                const ragConfig = data.ragConfig || db.ragConfig || {};
                const text = String(data.text || 'RAG connection test').trim();
                const cfg = normalizeRagConfig(ragConfig);
                const vector = await embedTextForRag(text, ragConfig);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  ok: true,
                  model: cfg.embeddingModel,
                  dimension: vector.length,
                  preview: vector.slice(0, 5)
                }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/rag/rebuild' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const db = safeReadJson(dbPath) || {};
                const ragConfig = data.ragConfig || db.ragConfig || {};
                const stat = await updateRagIndexByPayload(dataDir, db, ragConfig, { force: true });
                if (db && typeof db === 'object') {
                  db.ragConfig = ragConfig;
                  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, ...stat }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: e.message }));
              }
            });
            return;
          }

          /** 全局重跑前清空 novel_summary_index（仅摘要元数据，不动小说正文索引） */
          if (pathname === '/api/rag/clear-novel-summaries' && req.method === 'POST') {
            try {
              const { novelSummaryIndexPath } = getRagPaths(dataDir);
              const { novelSummaryIndex } = ensureNovelSummarySeparated(dataDir);
              novelSummaryIndex.summaries = {};
              novelSummaryIndex.updatedAt = Date.now();
              writeRagJson(novelSummaryIndexPath, novelSummaryIndex);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
          }

          if (pathname.startsWith('/api/rag/chunks') && req.method === 'GET') {
            try {
              const { scrapbookIndexPath } = getRagPaths(dataDir);
              const { novelIndex, novelSummaryIndex } = ensureNovelSummarySeparated(dataDir);
              const scrapbookIndex = readRagJson(scrapbookIndexPath, { docs: [] });
              const chunks = [
                ...((novelIndex.docs || []).map(d => ({ ...d, type: 'novel' }))),
                ...((scrapbookIndex.docs || []).map(d => ({ ...d, type: 'scrapbook' })))
              ].map(d => ({
                id: d.id,
                type: d.type,
                title: d.title || '',
                text: d.text || '',
                chunkIndex: Number.isFinite(Number(d.chunkIndex)) ? Number(d.chunkIndex) : 0,
                chapterKey: d.chapterKey || null,
                chapterTitle: d.chapterTitle || null,
                scrapbookId: d.scrapbookId || null,
                workType: d.workType || null,
                workId: d.workId || null,
                prequelTitle: d.prequelTitle || null,
                characterName: d.characterName || null,
                ai_metadata: d.type === 'novel'
                  ? (novelSummaryIndex?.summaries?.[d.id] || null)
                  : null
              }));

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({
                chunks,
                total: chunks.length,
                novelTotal: chunks.filter(c => c.type === 'novel').length,
                scrapbookTotal: chunks.filter(c => c.type === 'scrapbook').length
              }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          if (pathname === '/api/rag/summarize-one' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const endpoint = data?.endpoint || {};
                if (!endpoint?.url || !endpoint?.key || !endpoint?.model) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: '缺少可用文本模型节点（url/key/model）' }));
                  return;
                }

                const { novelSummaryIndexPath } = getRagPaths(dataDir);
                const { novelIndex, novelSummaryIndex } = ensureNovelSummarySeparated(dataDir);
                const docs = Array.isArray(novelIndex?.docs) ? novelIndex.docs : [];
                const docId = String(data?.docId || '').trim();
                const docIndex = docs.findIndex(d => String(d?.id || '') === docId);
                if (docIndex < 0) {
                  res.statusCode = 404;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: `未找到目标切片：${docId}` }));
                  return;
                }

                const doc = docs[docIndex];
                const forceRegenerate = data?.forceRegenerate === true;
                const existingAiMeta = novelSummaryIndex?.summaries?.[docId] || null;
                if (!forceRegenerate && String(existingAiMeta?.summary || '').trim()) {
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ ok: true, skipped: true, doc: { ...doc, ai_metadata: existingAiMeta } }));
                  return;
                }

                const db = safeReadJson(dbPath) || {};
                const ragConfig = db.ragConfig || null;
                const summariesMap = novelSummaryIndex?.summaries || {};
                const ragQuery = [doc.chapterTitle || '', doc.title || '', String(doc.text || '')].filter(Boolean).join('\n');

                const sortedNovelDocs = sortNovelDocsForSummaryChain(novelIndex.docs);
                const currentGlobalIndex = sortedNovelDocs.findIndex((d) => String(d?.id || '') === docId);
                if (currentGlobalIndex < 0) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: '无法在全书排序链中定位当前切片' }));
                  return;
                }

                const prevSummaries = [];
                for (let i = Math.max(0, currentGlobalIndex - 5); i < currentGlobalIndex; i += 1) {
                  const sid = String(sortedNovelDocs[i].id);
                  const metaPrev = summariesMap[sid] || {};
                  const s = String(metaPrev.summary || '').trim();
                  if (!s) continue;
                  prevSummaries.push({
                    id: sid,
                    label: chapterSegmentLabelForSummary(sortedNovelDocs, i),
                    text: formatStoredSummaryMetaForPrompt(metaPrev)
                  });
                }

                const nextOriginals = [];
                for (let i = currentGlobalIndex + 1; i <= Math.min(sortedNovelDocs.length - 1, currentGlobalIndex + 2); i += 1) {
                  nextOriginals.push({
                    id: String(sortedNovelDocs[i].id),
                    label: chapterSegmentLabelForSummary(sortedNovelDocs, i),
                    text: String(sortedNovelDocs[i].text || '')
                  });
                }

                const excludeNeighborIds = [];
                for (
                  let i = Math.max(0, currentGlobalIndex - 5);
                  i <= Math.min(sortedNovelDocs.length - 1, currentGlobalIndex + 2);
                  i += 1
                ) {
                  excludeNeighborIds.push(String(sortedNovelDocs[i].id));
                }

                const chapterNo = extractChapterNumber(doc.chapterTitle || doc.title || '');
                const chapterTagArabic = chapterNo ? `第${chapterNo}章` : '';
                const chapterTagChinese = chapterNo ? `第${numberToChinese(chapterNo)}章` : '';
                const chapterTagSet = new Set([chapterTagArabic, chapterTagChinese].filter(Boolean));

                const scrapbookEntries = Array.isArray(db?.scrapbook) ? db.scrapbook : [];
                const { scrapbookIndexPath } = getRagPaths(dataDir);
                const scrapbookIndex = readRagJson(scrapbookIndexPath, { docs: [] });
                const scrapbookDocs = Array.isArray(scrapbookIndex?.docs) ? scrapbookIndex.docs : [];

                const mandatoryScrapbookIds = new Set(
                  scrapbookEntries
                    .filter((entry) => {
                      const title = String(entry?.title || '').trim();
                      const tags = Array.isArray(entry?.tags) ? entry.tags.map((t) => String(t || '').trim()) : [];
                      const hasChapterTag = tags.some((tag) => chapterTagSet.has(tag));
                      const isChapterSummary = Array.from(chapterTagSet).some(
                        (tag) => title === `${tag}梗概` || title.includes(`${tag}梗概`)
                      );
                      return hasChapterTag && isChapterSummary;
                    })
                    .map((entry) => String(entry?.id))
                    .filter(Boolean)
                );

                const mandatoryScrapbookHits = scrapbookDocs
                  .filter((d) => mandatoryScrapbookIds.has(String(d?.scrapbookId || '')))
                  .sort((a, b) => Number(a?.chunkIndex || 0) - Number(b?.chunkIndex || 0))
                  .map((d) => ({
                    id: d.id,
                    type: 'scrapbook',
                    title: d.title || '',
                    text: d.text || '',
                    score: 1
                  }));

                let scrapVectorHits = [];
                try {
                  const scrapHitsRaw = await searchRag(dataDir, ragQuery, 24, ragConfig, 'scrapbook', []);
                  const mandatoryHitIds = new Set(mandatoryScrapbookHits.map((h) => h.id));
                  const mandatorySrcIds = new Set(mandatoryScrapbookIds);
                  scrapVectorHits = (Array.isArray(scrapHitsRaw) ? scrapHitsRaw : [])
                    .filter((h) => {
                      if (mandatoryHitIds.has(h.id)) return false;
                      for (const sid of mandatorySrcIds) {
                        if (String(h.id || '').startsWith(`scrap_${sid}_`)) return false;
                      }
                      return true;
                    })
                    .slice(0, 6);
                } catch (e) {
                  console.warn('[summarize-one] scrapbook vec failed', e.message);
                  scrapVectorHits = [];
                }

                let rankedNovel = [];
                try {
                  rankedNovel = await rankAllNovelChunksByQuery(dataDir, ragQuery, ragConfig, excludeNeighborIds);
                } catch (e) {
                  console.warn('[summarize-one] rank novel failed', e.message);
                  rankedNovel = [];
                }

                const { selected: distantNovelRefs, fullC: ragFullCount, sumC: ragSummaryCount } =
                  pickDistantNovelRefsForSummarize({
                    rankedHits: rankedNovel,
                    sortedDocs: sortedNovelDocs,
                    summariesMap,
                    maxFull: 4,
                    maxSummaryOnly: 6
                  });

                const formatMandatoryGaiyao = () => {
                  if (!mandatoryScrapbookHits.length) {
                    return '（当前章未配置「第N章梗概」笔记或尚未编入索引）';
                  }
                  return mandatoryScrapbookHits
                    .map((h, i) => `#${i + 1} [章节梗概 · ${chapterTagArabic || '本章节'}] ${h.title || '未命名'}\n${h.text || ''}`)
                    .join('\n\n');
                };

                const formatScrapbookVecRefs = () => {
                  if (!scrapVectorHits.length) return '（无额外笔记向量命中）';
                  return scrapVectorHits
                    .map((h, i) => `#${i + 1} [笔记向量] ${h.title || '未命名'}\n${h.text || ''}`)
                    .join('\n\n');
                };

                const formatDistantRefs = () => {
                  if (!distantNovelRefs.length) {
                    return '（无符合条件的远距切片，仍以当前正文为主）';
                  }
                  return distantNovelRefs
                    .map((r, i) => {
                      const tag = r.mode === 'full_text' ? '正文片段' : '已生成摘要·结构化';
                      return `#${i + 1} [向量 ${tag}] ${r.label}\n${r.text || ''}`;
                    })
                    .join('\n\n');
                };

                const prevBlock =
                  prevSummaries.length === 0
                    ? '（前序 5 段内尚无可复用的已生成摘要）'
                    : prevSummaries
                        .map((p) => `【${p.label}】（已生成摘要 · 含 story_time_note 等全字段）\n${p.text}`)
                        .join('\n\n');

                const nextBlock =
                  nextOriginals.length === 0
                    ? '（后续已无更多正文段）'
                    : nextOriginals.map((n) => `【${n.label}】（后续原文）\n${n.text}`).join('\n\n');

                const systemPrompt = [
                  '你是一个专业的小说编辑和剧情分析师。任务是阅读小说片段并提取结构化信息。',
                  '【当前片段正文】是本场判断事实与细节的第一依据；同时你必须通读并综合使用下列全部参考块：前序已生成摘要、后续两段原文、本章梗概、笔记向量命中、远距小说向量命中。',
                  'characters_present 中须写**人物姓名**（或文本中已给出的固定称呼），禁止使用「少女」「男子」等无名的代称；若参考块与正文可推断姓名，应写姓名。',
                  '若参考与当前正文冲突，以当前正文为准，但须在合理范围内保持与前序摘要的时间线、人物关系一致；不得凭空编造参考块与正文中均未出现的情节。',
                  '你必须输出 reference_thinking 字段：用自然语言写一段「参考溯源」——先简要说明你综合了哪些材料，再说明本段 summary、时间、人物等结论分别主要依据哪几处（可点名上文中的章节段标签、笔记标题、章节梗概、后续原文、笔记向量或远距小说命中）；若仅依据当前片段正文也要写明。不要用 JSON 数组，是一段可读中文。',
                  '输出必须是严格 JSON，不要包含 Markdown。'
                ].join('\n');

                const userPrompt = [
                  `【当前所在章节】：${doc.chapterTitle || '未命名章节'}`,
                  `【当前全文序号】：全书小说切片第 ${currentGlobalIndex + 1} 段（起算 1；段内「第几章第几段」见各条标签）`,
                  '',
                  '【邻近参考 · 前序已生成摘要】（当前段之前至多 5 个位置上、且该位置已跑过摘要的段落；若尚未生成则该位置不会出现，条数可能少于 5）',
                  prevBlock,
                  '',
                  '【邻近参考 · 后续原文】（紧随其后的至多 2 段正文）',
                  nextBlock,
                  '',
                  '【当前章节的章节梗概】（笔记「第N章梗概」按条目写入索引的部分，必选）',
                  formatMandatoryGaiyao(),
                  '',
                  '【向量检索 · 笔记（不含上文章节梗概）】（与正文同 query 语义检索，最多 6 条；与章节梗概条目去重）',
                  formatScrapbookVecRefs(),
                  '',
                  '【向量检索 · 远距小说正文/摘要】（已排除当前段及前 5 + 后 2 邻段；按相似度顺延；无摘要至多 4 段正文，已有摘要至多 6 段且写入整段结构化元数据）',
                  formatDistantRefs(),
                  '',
                  '【当前片段正文】（核心依据）',
                  String(doc.text || ''),
                  '',
                  '【综合要求】',
                  '请先完整阅读上文所有参考块，再对照本段正文撰写 JSON。summary 须概括本段核心事件，并自然承接前序摘要与后续原文所暗示的叙事走向；须结合笔记与远距小说参考中的设定线索。禁止只复述本段正文而忽略邻段与远距参考。',
                  '',
                  '【要求输出的 JSON 格式】：',
                  '{',
                  '  "summary": "概括核心事件",',
                  '  "story_time_note": "单行、10字以内；用自然语言描述该片段发生的时间，带时段词（清晨/上午/中午/下午/日落/夜晚/深夜/凌晨 其一或组合），禁止编造。",',
                  '  "characters_present": ["在场人物姓名，勿用少女/男子等代称"],',
                  '  "locations": ["发生的地点，若未知，或者没有专有名词都填null"],',
                  '  "key_events": ["提取1-3个关键词"],',
                  '  "reference_thinking": "自然语言段落：说明本段判断依据了哪些参考（可点名章节段、梗概、笔记、远距命中等）；勿用数组。"',
                  '}'
                ].join('\n');

                const aiRes = await fetch(endpoint.url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${endpoint.key}` },
                  body: JSON.stringify(
                    mergeChatCompletionThinking(endpoint, {
                      model: endpoint.model,
                      temperature: 0.2,
                      response_format: { type: 'json_object' },
                      messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                      ]
                    })
                  )
                });
                if (!aiRes.ok) throw new Error(`摘要请求失败: ${await aiRes.text()}`);
                const modelData = await aiRes.json();
                const modelText = getModelMessageText(modelData);
                const parsed = parseJsonFromModelText(modelText);
                const ai_metadata = normalizeAiMetadataShape(parsed);

                const ragRefsForMeta = [
                  ...mandatoryScrapbookHits.map((h) => ({ id: h.id, type: h.type, title: h.title })),
                  ...scrapVectorHits.map((h) => ({ id: h.id, type: 'scrapbook', source: 'vector', title: h.title })),
                  ...distantNovelRefs.map((r) => ({
                    id: r.id,
                    type: 'novel',
                    mode: r.mode,
                    label: r.label
                  }))
                ];

                const mergedMeta = {
                  ...ai_metadata,
                  sourceModel: endpoint.model,
                  generatedAt: Date.now(),
                  contextHints: {
                    currentGlobalIndex,
                    prevSummariesNear: prevSummaries.map((p) => ({ id: p.id, label: p.label })),
                    nextOriginalsNear: nextOriginals.map((n) => ({ id: n.id, label: n.label })),
                    vectorMatchDescription:
                      '小说远距：用「章节标题+切片标题+本切片正文」embedding 与 novel_index 余弦排序，仅排除已选邻段 id，再按有/无摘要分流结构化或正文。笔记向量：同 query 对笔记索引检索 6 条，排除章节梗概条目。'
                  },
                  ragStats: {
                    total:
                      mandatoryScrapbookHits.length + scrapVectorHits.length + distantNovelRefs.length,
                    novel: distantNovelRefs.length,
                    scrapbook: scrapVectorHits.length,
                    mandatoryChapterSummary: mandatoryScrapbookHits.length,
                    neighborPrevWithSummary: prevSummaries.length,
                    neighborNextOriginal: nextOriginals.length,
                    distantNovelFull: ragFullCount,
                    distantNovelSummaryOnly: ragSummaryCount,
                    chapterGaiyaoChunks: mandatoryScrapbookHits.length,
                    excludeNeighborCount: excludeNeighborIds.length
                  },
                  ragRefs: ragRefsForMeta
                };
                novelSummaryIndex.summaries[docId] = mergedMeta;
                novelSummaryIndex.updatedAt = Date.now();
                writeRagJson(novelSummaryIndexPath, novelSummaryIndex);

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, doc: { ...docs[docIndex], ai_metadata: mergedMeta }, ai_metadata: mergedMeta }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          /** 多轮工具检索（search_novel / search_scrapbook / get_character_all_info）；前端已下线，供日后复用 */
          if (pathname === '/api/ai/agentic-write' && req.method === 'POST') {
            let bodyData = [];
            req.on('data', chunk => bodyData.push(chunk));
            req.on('end', async () => {
              try {
                const body = JSON.parse(Buffer.concat(bodyData).toString());
                const { context, messages, endpoint, mode } = body;
                const db = safeReadJson(dbPath) || {};

                // 1. 构建工具库
                const tools = [
                  {
                    type: 'function',
                    function: {
                      name: 'search_scrapbook',
                      description: '在笔记中检索设定、剧情大纲或项目设定信息。',
                      parameters: {
                        type: 'object',
                        properties: {
                          query: { type: 'string', description: '检索关键词，如"大纲"、"角色设定"、"森林地形"' },
                          use_title_match: { type: 'boolean', description: '是否优先匹配标题（推荐用于找大纲、特定标题的笔记）' }
                        },
                        required: ['query']
                      }
                    }
                  },
                  {
                    type: 'function',
                    function: {
                      name: 'search_novel',
                      description: '在已写好的小说正文中检索之前的剧情细节。',
                      parameters: {
                        type: 'object',
                        properties: {
                          query: { type: 'string', description: '检索关键词' }
                        },
                        required: ['query']
                      }
                    }
                  },
                  {
                    type: 'function',
                    function: {
                      name: 'get_character_all_info',
                      description: '获取指定角色的完整档案设定（包含六项属性数据和背景资料）。',
                      parameters: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: '角色姓名' }
                        },
                        required: ['name']
                      }
                    }
                  }
                ];

                // 2. 调度循环逻辑
                let currentMessages = [...messages];
                let loopCount = 0;
                const maxLoops = 5; // 最大思考轮次
                let finalResponse = null;
                let agentCollectedHits = []; // 新增：收集 Agent 过程中发现的所有检索命中

                while (loopCount < maxLoops) {
                  loopCount++;

                  const aiRes = await fetch(endpoint.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${endpoint.key}` },
                    body: JSON.stringify(
                      mergeChatCompletionThinking(endpoint, {
                        model: endpoint.model,
                        messages: currentMessages,
                        tools: tools,
                        tool_choice: 'auto'
                      })
                    )
                  });

                  if (!aiRes.ok) throw new Error(`AI 请求失败: ${await aiRes.text()}`);
                  const data = await aiRes.json();
                  const message = data.choices[0].message;

                  // 如果 AI 没有调用工具，则说明思考结束，直接返回
                  if (!message.tool_calls || message.tool_calls.length === 0) {
                    finalResponse = message;
                    break;
                  }

                  // 处理工具调用
                  currentMessages.push(message);
                  for (const toolCall of message.tool_calls) {
                    const func = toolCall.function;
                    const args = JSON.parse(func.arguments);
                    let result = '';

                    if (func.name === 'search_scrapbook') {
                      const type = args.use_title_match ? 'title' : 'scrapbook';
                      const hits = await searchRag(dataDir, args.query, 5, db.ragConfig, type);
                      agentCollectedHits.push(...hits.map(h => ({ ...h, agentSource: 'scrapbook' })));
                      result = hits.length > 0 ? hits.map(h => `[${h.title}]\n${h.text}`).join('\n---\n') : '未找到相关笔记。';
                    } else if (func.name === 'search_novel') {
                      const hits = await searchRag(dataDir, args.query, 5, db.ragConfig, 'novel');
                      agentCollectedHits.push(...hits.map(h => ({ ...h, agentSource: 'novel' })));
                      result = hits.length > 0 ? hits.map(h => `[${h.title}]\n${h.text}`).join('\n---\n') : '未在正文中找到相关情节。';
                    } else if (func.name === 'get_character_all_info') {
                      const char = (db.characters || []).find(c => c.name === args.name);
                      if (char) {
                        agentCollectedHits.push({ id: `char_${char.id}`, type: 'character', title: char.name, text: char.lore, score: 1.0 });
                      }
                      result = char ? JSON.stringify(char, null, 2) : '未找到该角色的详细档案。';
                    }

                    currentMessages.push({
                      role: 'tool',
                      tool_call_id: toolCall.id,
                      name: func.name,
                      content: result
                    });
                  }
                }

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  choices: [{ message: finalResponse || { role: 'assistant', content: 'AI 思考轮次过多，已强制中断。' } }],
                  usage: { total_loops: loopCount },
                  agentCollectedHits: agentCollectedHits,
                  agentTrace: currentMessages.filter(m => m.role === 'assistant' || m.role === 'tool') // 新增：返回完整的思考痕迹
                }));

              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/novel/continuation-history' && req.method === 'GET') {
            try {
              const u = new URL(req.url || '/', 'http://localhost');
              const limit = Math.max(1, Math.min(2000, Number(u.searchParams.get('limit') || 300) || 300));
              const events = readNovelContinuationHistory(dataDir);
              const sliced = events.slice(-limit).reverse();
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ success: true, events: sliced, total: events.length }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          if (pathname === '/api/novel/continuation-history/append' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString() || '{}');
                const rawEvent = data?.event && typeof data.event === 'object' ? data.event : {};
                const events = readNovelContinuationHistory(dataDir);
                const entry = {
                  id: rawEvent.id || `nch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  traceId: rawEvent.traceId || null,
                  eventType: String(rawEvent.eventType || 'unknown'),
                  taskType: String(rawEvent.taskType || ''),
                  chapterId: rawEvent.chapterId || null,
                  chapterTitle: rawEvent.chapterTitle || null,
                  chapterScopeType: rawEvent.chapterScopeType || 'main',
                  createdAt: Number(rawEvent.createdAt || Date.now()) || Date.now(),
                  payload: sanitizeNovelHistoryPayload(rawEvent.payload || {})
                };
                events.push(entry);
                writeNovelContinuationHistory(dataDir, events);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, id: entry.id, total: events.length }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/save' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              const reqId = `save_${Date.now()}_${++saveReqSeq}`;
              const reqStart = Date.now();
              try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const payload = data.payload || data;
                writeRuntimeLog('info', 'save.request_received', {
                  reqId,
                  newVersion: !!data.newVersion,
                  bodyBytes: body.reduce((n, b) => n + (b ? b.length : 0), 0),
                  characters: Array.isArray(payload.characters) ? payload.characters.length : 0,
                  scrapbook: Array.isArray(payload.scrapbook) ? payload.scrapbook.length : 0,
                  novelChars: String(payload?.novel?.content || '').length
                });
                const previousDb = safeReadJson(dbPath) || {};
                const previousCharacters = Array.isArray(previousDb.characters) ? previousDb.characters : [];
                const previousScrapbook = Array.isArray(previousDb.scrapbook) ? previousDb.scrapbook : [];
                const previousNovel = previousDb.novel || { title: '未命名正文', content: '', updatedAt: 0 };
                const incomingCharacters = Array.isArray(payload.characters) ? payload.characters : [];
                const incomingNames = new Set(incomingCharacters.map(char => char?.name).filter(Boolean));
                const explicitDeletedCharacterNames = Array.isArray(payload.deletedCharacterNames)
                  ? payload.deletedCharacterNames.filter(Boolean)
                  : [];

                const diskDb = safeReadJson(dbPath) || {};
                const diskCharacters = Array.isArray(diskDb.characters) ? diskDb.characters : [];
                const effectiveDeletedCharacterNames = Array.from(new Set([
                  ...(Array.isArray(diskDb.deletedCharacterNames) ? diskDb.deletedCharacterNames : []).filter(Boolean),
                  ...explicitDeletedCharacterNames
                ])).filter(name => !incomingNames.has(name));
                const previousByName = new Map(previousCharacters.filter(char => char?.name).map(char => [char.name, char]));
                const diskByName = new Map(diskCharacters.filter(char => char?.name).map(char => [char.name, char]));
                const mergedCharactersBase = [];
                const touchedNames = new Set();

                for (const incomingChar of incomingCharacters) {
                  if (!incomingChar?.name) {
                    mergedCharactersBase.push(incomingChar);
                    continue;
                  }
                  const mergedChar = mergeCharacterForSave(
                    diskByName.get(incomingChar.name) || null,
                    incomingChar,
                    previousByName.get(incomingChar.name) || null
                  );
                  mergedCharactersBase.push(mergedChar);
                  touchedNames.add(incomingChar.name);
                }

                for (const diskChar of diskCharacters) {
                  if (!diskChar?.name || touchedNames.has(diskChar.name) || effectiveDeletedCharacterNames.includes(diskChar.name)) continue;
                  mergedCharactersBase.push(diskChar);
                }

                const processedCharacters = mergedCharactersBase.map(char => {
                  if (!char.name) return char;
                  const charDir = path.join(dataDir, 'characters', char.name);
                  ensureCharacterMediaDirs(charDir);
                  const storiesDir = path.join(charDir, 'stories');
                  let u = { ...char };
                  
                  // 处理 Base64 保存逻辑...
                  if (u.image && u.image.startsWith('data:')) { const s = saveBase64ToFile(u.image, path.join(charDir, 'portraits', 'portrait.jpg')); if (s) u.image = toDataUrl(s, cwd); }
                  if (u.combatImg && u.combatImg.startsWith('data:')) { const s = saveBase64ToFile(u.combatImg, path.join(charDir, 'combats', 'combat.jpg')); if (s) u.combatImg = toDataUrl(s, cwd); }
                  if (u.background && u.background.startsWith('data:')) { const s = saveBase64ToFile(u.background, path.join(charDir, 'backgrounds', 'background.jpg')); if (s) u.background = toDataUrl(s, cwd); }
                  
                  if (Array.isArray(u.storyImgs)) {
                    const nameCounts = {};
                    u.storyImgs = u.storyImgs.map((item, idx) => {
                      if (!item || !item.src) return item;

                      // 1. 如果是新的 Base64，保存时直接以 caption 命名
                      if (item.src.startsWith('data:')) {
                        fs.mkdirSync(storiesDir, { recursive: true });
                        const safeName = (item.caption || `插图_${idx + 1}`).replace(/[\\\/:*?"<>|]/g, '_');
                        const s = saveBase64ToFile(item.src, path.join(storiesDir, safeName));
                        if (s) return { ...item, src: toDataUrl(s, cwd) };
                      }

                      // 1b. 对话 / AI 生成落在 ai_generated 的图库：复制到本角色 stories，与本地图库同一套路径
                      else if (item.src.startsWith('/data/ai_generated/')) {
                        const relFromData = item.src.replace(/^\/data\//, '');
                        const srcAbs = path.join(dataDir, relFromData);
                        if (!fs.existsSync(srcAbs)) {
                          console.warn(`[Archive] ai_generated 源文件不存在，跳过复制: ${srcAbs}`);
                        } else {
                          fs.mkdirSync(storiesDir, { recursive: true });
                          const ext = path.extname(srcAbs) || '.png';
                          let cleanCaption = (item.caption || `插图_${idx + 1}`).replace(/[\\\/:*?"<>|]/g, '_').trim();
                          if (!cleanCaption) cleanCaption = `插图_${idx + 1}`;
                          nameCounts[cleanCaption] = (nameCounts[cleanCaption] || 0) + 1;
                          const suffix = nameCounts[cleanCaption] > 1 ? `_${nameCounts[cleanCaption] - 1}` : '';
                          const newFileName = `${cleanCaption}${suffix}${ext}`;
                          const destAbs = path.join(storiesDir, newFileName);
                          try {
                            fs.copyFileSync(srcAbs, destAbs);
                            return { ...item, src: `/data/characters/${char.name}/stories/${newFileName}` };
                          } catch (e) {
                            console.error(`[Archive] ai_generated -> stories 复制失败: ${srcAbs} -> ${destAbs}`, e.message);
                          }
                        }
                      }

                      // 2. 如果是已有文件且改名了，执行物理重命名联动
                      else if (item.src.startsWith('/data/characters/')) {
                        const oldAbsPath = path.join(cwd, item.src);
                        if (fs.existsSync(oldAbsPath)) {
                          const ext = path.extname(oldAbsPath);
                          const cleanCaption = (item.caption || '').replace(/[\\\/:*?"<>|]/g, '_').trim();
                          
                          if (cleanCaption) {
                            // 计数防止重名
                            nameCounts[cleanCaption] = (nameCounts[cleanCaption] || 0) + 1;
                            const suffix = nameCounts[cleanCaption] > 1 ? `_${nameCounts[cleanCaption] - 1}` : '';
                            const newFileName = `${cleanCaption}${suffix}${ext}`;
                            const newAbsPath = path.join(storiesDir, newFileName);
                            const newRelPath = `/data/characters/${char.name}/stories/${newFileName}`;

                            if (oldAbsPath !== newAbsPath) {
                              try {
                                fs.renameSync(oldAbsPath, newAbsPath);
                                return { ...item, src: newRelPath };
                              } catch (e) {
                                console.error(`[Archive] Rename failed: ${oldAbsPath} -> ${newAbsPath}`, e.message);
                              }
                            }
                          }
                        }
                      }
                      return item;
                    });
                  }

                  const syncedStories = scanAndSyncCharacters([u], dataDir, effectiveDeletedCharacterNames)?.[0]?.storyImgs;
                  if (Array.isArray(syncedStories)) {
                    u.storyImgs = syncedStories;
                  }

                  return u;
                });
                const processedScrapbook = (payload.scrapbook || []).map(entry => {
                  let u = { ...entry };
                  if (u.image && u.image.startsWith('data:')) {
                    const safeTitle = (entry.title || 'untitled').replace(/[\/\:*?"<>|]/g, '_');
                    const s = saveBase64ToFile(u.image, path.join(dataDir, 'scrapbook', `${safeTitle}.jpg`));
                    if (s) u.image = toDataUrl(s, cwd);
                  }
                  return u;
                });
                let globalBackground = payload.globalBackground || null;
                if (globalBackground && globalBackground.startsWith('data:')) {
                  const s = saveBase64ToFile(globalBackground, path.join(dataDir, 'global_background.jpg'));
                  if (s) globalBackground = toDataUrl(s, cwd);
                }
                // 安全模式：保存时不再自动移动/暂存磁盘资源，避免误伤本地素材
                const finalPayload = {
                  ...diskDb,
                  ...payload,
                  characters: processedCharacters,
                  deletedCharacterNames: effectiveDeletedCharacterNames,
                  scrapbook: processedScrapbook,
                  novel: payload.novel || diskDb.novel || { title: '未命名正文', content: '', updatedAt: 0 },
                  ragConfig: payload.ragConfig || payload.rag_config || diskDb.ragConfig || null,
                  globalBackground
                };
                // 覆盖写入前：把“旧有新无”的内容统一放入 stash，避免误删不可追溯
                try {
                  const nextCharacters = Array.isArray(finalPayload.characters) ? finalPayload.characters : [];
                  const nextNames = new Set(nextCharacters.map(char => char?.name).filter(Boolean));
                  const prevCharacters = Array.isArray(previousCharacters) ? previousCharacters : [];
                  const removedCharacters = prevCharacters.filter(char => char?.name && !nextNames.has(char.name));
                  for (const removedChar of removedCharacters) {
                    try {
                      const movedTo = moveCharacterDirToStash(removedChar.name, dataDir);
                      if (movedTo) console.log(`[Archive] 角色目录已移至暂存区：${removedChar.name} -> ${movedTo}`);
                    } catch (e) {
                      console.warn(`[Archive] 角色目录暂存失败：${removedChar.name}`, e.message);
                    }
                  }

                  for (const nextChar of nextCharacters) {
                    if (!nextChar?.name) continue;
                    const currentStories = Array.isArray(nextChar.storyImgs) ? nextChar.storyImgs : [];
                    const currentStoryUrls = currentStories.map(item => item?.src).filter(Boolean);
                    stashUnusedFiles(nextChar.name, 'stories', currentStoryUrls, dataDir);

                    const keepPortraits = nextChar.image ? [nextChar.image] : [];
                    const keepBackgrounds = nextChar.background ? [nextChar.background] : [];
                    const keepCombatsSet = new Set(collectCombatFolderKeepUrls(nextChar.name, dataDir));
                    if (nextChar.combatImg) keepCombatsSet.add(nextChar.combatImg);
                    if (nextChar.combatDepthImg) keepCombatsSet.add(nextChar.combatDepthImg);
                    // 为了支持前端随机立绘池，不再自动清理 portraits 和 backgrounds 文件夹
                    // stashCharacterMediaFiles(nextChar.name, 'portraits', keepPortraits, dataDir);
                    // stashCharacterMediaFiles(nextChar.name, 'backgrounds', keepBackgrounds, dataDir);
                    stashCharacterMediaFiles(nextChar.name, 'combats', [...keepCombatsSet], dataDir);
                  }

                  const nextScrapbook = Array.isArray(finalPayload.scrapbook) ? finalPayload.scrapbook : [];
                  const nextScrapbookUrls = nextScrapbook.map(item => item?.image).filter(Boolean);
                  stashUnusedScrapbookFiles(nextScrapbookUrls, dataDir);
                  stashRemovedScrapbookEntries(previousScrapbook, nextScrapbook, dataDir);
                  stashGlobalBackgroundFiles(finalPayload.globalBackground || null, dataDir);
                  stashNovelIfShrunk(previousNovel, finalPayload.novel || previousNovel, dataDir);
                  stashAiSessionsIfShrunk(previousDb.aiSessions || [], finalPayload.aiSessions || [], dataDir);
                } catch (e) {
                  console.warn('[Archive] 保存前 stash 处理失败：', e.message);
                }
                writeDatabaseJsonCompact(dbPath, finalPayload);
                let versionId = null;
                if (data.newVersion) {
                  const d = new Date();
                  versionId = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  success: true,
                  versionId,
                  rag: data.newVersion
                    ? { skipped: true, note: '新版本快照仅复制磁盘（versions/），不触发 RAG' }
                    : { deferred: false, note: '覆盖保存不再自动重建 RAG；如需更新请在设置中手动点「强制重建本地索引」。' },
                  reload: true
                }));
                writeRuntimeLog('info', 'save.response_sent', {
                  reqId,
                  newVersion: !!data.newVersion,
                  versionId: versionId || null,
                  costMs: Date.now() - reqStart
                });
                setImmediate(() => {
                  (async () => {
                    try {
                      if (data.newVersion && versionId) {
                        const snapshotStart = Date.now();
                        writeRuntimeLog('info', 'snapshot.start', { reqId, versionId });
                        createSnapshot(dataDir, dbPath, versionId, (event, meta = {}) => {
                          writeRuntimeLog('info', event, { reqId, versionId, ...meta });
                        });
                        console.log('[Archive] 版本快照已写入（仅磁盘复制，未跑 RAG）:', versionId);
                        writeRuntimeLog('info', 'snapshot.success', {
                          reqId,
                          versionId,
                          costMs: Date.now() - snapshotStart
                        });
                      }
                    } catch (e) {
                      console.error('[Archive] 版本快照失败（主存档已保存）:', e.message);
                      writeRuntimeLog('error', 'snapshot.failed', {
                        reqId,
                        versionId: versionId || null,
                        message: e && e.message ? e.message : String(e)
                      });
                    }
                  })();
                });
              } catch (e) {
                console.error('[Archive] 保存错误:', e);
                writeRuntimeLog('error', 'save.failed', {
                  reqId,
                  costMs: Date.now() - reqStart,
                  message: e && e.message ? e.message : String(e)
                });
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname === '/api/version/load' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const versionId = data.versionId;
                if (!versionId) throw new Error('missing_version_id');
                const snapshotDir = path.join(dataDir, 'versions', versionId);
                const snapshotDbPath = path.join(snapshotDir, 'database.json');
                if (!fs.existsSync(snapshotDbPath)) throw new Error('version_not_found');
                // 版本加载仅回写数据库，不覆盖本地媒体目录
                fs.copyFileSync(snapshotDbPath, dbPath);
                const loaded = safeReadJson(dbPath) || {};
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, data: loaded }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname.startsWith('/api/version/download') && req.method === 'GET') {
            try {
              const urlObj = new URL(req.url, 'http://localhost');
              const versionId = urlObj.searchParams.get('versionId');
              if (!versionId) throw new Error('missing_version_id');
              const snapshotDbPath = path.join(dataDir, 'versions', versionId, 'database.json');
              if (!fs.existsSync(snapshotDbPath)) throw new Error('version_not_found');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Content-Disposition', `attachment; filename="snapshot_${versionId}.json"`);
              res.end(fs.readFileSync(snapshotDbPath));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          if (pathname === '/api/migrate-ai-generated' && req.method === 'POST') {
            try {
              const db = safeReadJson(dbPath);
              if (!db || !Array.isArray(db.aiSessions)) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, migrated: 0 }));
                return;
              }
              let migrated = 0;
              const now = new Date();
              const dateDir = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
              for (const sess of db.aiSessions) {
                if (!Array.isArray(sess.messages)) continue;
                sess.messages = sess.messages.map((msg) => {
                  if (msg?.role !== 'assistant' || typeof msg?.content !== 'string') return msg;
                  const match = msg.content.match(/===NOVELAI_RESULT===\s*([\s\S]*?)(?:=============|$)/);
                  if (!match) return msg;
                  const raw = (match[1] || '').trim();
                  if (!raw.startsWith('data:image/')) return msg;
                  const rand = Math.random().toString(36).slice(2, 8);
                  const ts = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                  const saved = saveBase64ToFile(raw, path.join(dataDir, 'ai_generated', dateDir, `${ts}_${rand}`));
                  if (!saved) return msg;
                  const url = toDataUrl(saved, cwd);
                  migrated += 1;
                  return { ...msg, content: replaceNovelAiResultUrl(msg.content, url) };
                });
              }
              if (migrated > 0) fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ success: true, migrated, aiSessions: db.aiSessions }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          if (pathname === '/api/save-generated-image' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', () => {
              try {
                let image = Buffer.concat(body).toString();
                if (image.startsWith('{')) {
                  try {
                    const data = JSON.parse(image);
                    image = data.image || '';
                  } catch (e) {}
                }
                if (!image || !String(image).startsWith('data:image/')) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ error: 'invalid_image_data' }));
                  return;
                }
                const now = new Date();
                const dateDir = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
                const timePart = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                const randPart = Math.random().toString(36).slice(2, 8);
                const rawPath = path.join(dataDir, 'ai_generated', dateDir, `${timePart}_${randPart}`);
                const saved = saveBase64ToFile(image, rawPath);
                if (!saved) throw new Error('save_failed');
                const url = toDataUrl(saved, cwd);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, url }));
              } catch (e) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          if (pathname.startsWith('/data/') && req.method === 'GET') {
            const filePath = path.join(cwd, decodeURIComponent(pathname));
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              const ext = path.extname(filePath).toLowerCase();
              const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
              res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
              res.end(fs.readFileSync(filePath));
              return;
            }
          }

          // ================= 列举角色图片子文件夹 =================
          if (pathname.startsWith('/api/list-images') && req.method === 'GET') {
            try {
              const urlObj = new URL(req.url, 'http://localhost');
              const charName = urlObj.searchParams.get('char');
              const type = urlObj.searchParams.get('type'); // 'portraits' | 'backgrounds' | 'combats'
              if (!charName || !type) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'missing params' }));
                return;
              }
              const allowedTypes = new Set(['portraits', 'backgrounds', 'combats']);
              if (!allowedTypes.has(type)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'invalid type' }));
                return;
              }
              const subDir = path.join(dataDir, 'characters', charName, type);
              if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory()) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ images: [] }));
                return;
              }
              const files = fs.readdirSync(subDir)
                .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
                .filter(f => type !== 'combats' || !/(?:_depth|_background)\.(png|jpg|jpeg|webp)$/i.test(f))
                .sort()
                .map(f => `/data/characters/${encodeURIComponent(charName)}/${type}/${encodeURIComponent(f)}`);
              const videos = fs.readdirSync(subDir)
                .filter(f => /\.(mp4|webm|mov)$/i.test(f))
                .sort()
                .map(f => `/data/characters/${encodeURIComponent(charName)}/${type}/${encodeURIComponent(f)}`);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ images: files, videos }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
            return;
          }

          // IdleCloud 通用接口：POST /api/generate_image → 轮询 GET /api/get_result/{job_id}
          if (pathname === '/api/idlecloud/generate-image' && req.method === 'POST') {
            let body = [];
            req.on('data', (chunk) => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const token = parseBearerToken(req.headers.authorization || '');
                if (!token) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ message: '缺少 IdleCloud API Key（请求头 Authorization: Bearer …）' }));
                  return;
                }
                const genericBody = buildIdleCloudGenericBody(data);
                const idlePolicy = getIdleCloudAdaptiveRetryPolicy();
                const submitRes = await fetchWithRetry(
                  () => runIdleCloudSubmissionWithGuard(
                    token,
                    () => fetchIdleCloudWithFallback(
                      IDLECLOUD_GENERATE_IMAGE_GENERIC,
                      (agent) => ({
                        method: 'POST',
                        headers: { 
                          Authorization: `Bearer ${token}`, 
                          'Content-Type': 'application/json', 
                          Accept: 'application/json',
                          Connection: 'close',
                          'Cache-Control': 'no-cache',
                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        body: JSON.stringify(genericBody),
                        ...(agent ? { agent } : {}),
                      }),
                      idlePolicy.timeoutMs
                    ),
                    'generic_submit'
                  ),
                  {
                    attempts: idlePolicy.attempts,
                    baseDelayMs: 2500,
                    maxDelayMs: 10000,
                    beforeAttempt: () => waitForUpstreamCooldown('idlecloud'),
                    shouldRetry: (err, response) => {
                      if (err) return isRetryableError(err);
                      return shouldRetryIdleCloudSubmitStatus(response?.status);
                    },
                    onRetry: ({ attempt, delay, result, error }) => {
                      const reason = error ? (error.message || String(error)) : `HTTP ${result?.status}`;
                      if (result?.status === 429) markUpstreamRateLimit('idlecloud', result);
                      if (error) {
                        const kind = classifyNetworkError(error);
                        markUpstreamTransientFailure('idlecloud', kind);
                      } else if (result?.status >= 500) {
                        markUpstreamTransientFailure('idlecloud', `http_${result.status}`);
                      }
                      console.warn(`[IdleCloud submit retry] attempt=${attempt} wait=${delay}ms reason=${reason}`);
                    },
                    onSuccess: (result) => {
                      if (result?.status === 429) {
                        markUpstreamRateLimit('idlecloud', result);
                      } else if (result?.ok) {
                        clearUpstreamRateLimit('idlecloud');
                      }
                    }
                  }
                );
                const submitText = await submitRes.text();
                let submitJson;
                try {
                  submitJson = JSON.parse(submitText);
                } catch (e) {
                  res.statusCode = submitRes.status || 502;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ message: `IdleCloud 提交返回非 JSON: ${submitText.slice(0, 400)}` }));
                  return;
                }
                if (!submitRes.ok) {
                  res.statusCode = submitRes.status;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  const idle401 =
                    'IdleCloud 返回 401：请使用 IdleCloud 网站生成的 API Key（不是 NovelAI 的 pst），且文档要求进阶档(¥30/月)及以上才可使用 API。若 Key 无误仍 401：本服务已默认直连 api.idlecloud.cc；若你必须经本地代理访问，请在启动前设置环境变量 IDLECLOUD_USE_PROXY=1 后重启。';
                  const routeLabel = submitRes.__routeLabel || 'unknown';
                  const msg =
                    submitRes.status === 401
                      ? idle401
                      : submitRes.status === 429
                        ? `IdleCloud[${routeLabel}] 并发/频率受限：${submitJson.message || submitJson.error || submitText.slice(0, 400)}`
                        : `IdleCloud[${routeLabel}] HTTP ${submitRes.status}：${submitJson.message || submitJson.error || submitText.slice(0, 400)}`;
                  res.end(JSON.stringify({ message: msg, detail: submitRes.status === 401 ? undefined : submitJson, route: routeLabel }));
                  return;
                }
                const jobId = submitJson.job_id ?? submitJson.jobId;
                if (!jobId) {
                  res.statusCode = 502;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ message: 'IdleCloud 未返回 job_id', detail: submitJson }));
                  return;
                }
                const pollDelayMs = 5000;
                const maxAttempts = 72;
                let lastJson = null;
                let lastPollHttpError = null;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  if (attempt > 0) await new Promise((r) => setTimeout(r, pollDelayMs));
                  const pollRes = await fetchIdleCloudWithFallback(
                    idleCloudGetResultUrl(jobId),
                    (agent) => ({
                      headers: { 
                        Authorization: `Bearer ${token}`, 
                        Accept: 'application/json',
                        Connection: 'close',
                        'Cache-Control': 'no-cache',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                      },
                      ...(agent ? { agent } : {}),
                    }),
                    30000
                  );
                  if (!pollRes.ok) {
                    const errBody = await pollRes.text();
                    lastPollHttpError = { status: pollRes.status, body: errBody.slice(0, 500) };
                    // 生成过程中对方可能短暂返回 5xx，不应立即失败
                    if ([500, 502, 503, 504].includes(pollRes.status)) {
                      continue;
                    }
                    res.statusCode = pollRes.status >= 500 ? 502 : pollRes.status;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(
                      JSON.stringify({
                        message: `轮询失败 HTTP ${pollRes.status}: ${errBody.slice(0, 300)}`,
                      })
                    );
                    return;
                  }
                  const pollText = await pollRes.text();
                  let pollJson;
                  try {
                    pollJson = JSON.parse(pollText);
                  } catch (e) {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify({ message: `轮询返回非 JSON: ${pollText.slice(0, 400)}` }));
                    return;
                  }
                  lastJson = pollJson;
                  if (pollJson.status === 'completed') {
                    const out = await idleCloudGenericResolveImageResult(pollJson, fetch, '__AUTO_IDLECLOUD__');
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify({ image: out.image }));
                    return;
                  }
                  if (pollJson.status === 'failed') {
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(
                      JSON.stringify({
                        message: pollJson.error || 'IdleCloud 任务失败',
                        detail: pollJson,
                      })
                    );
                    return;
                  }
                }
                res.statusCode = 504;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(
                  JSON.stringify({
                    message: 'IdleCloud 轮询超时（约 6 分钟），请稍后重试或减少步数',
                    last: lastJson,
                    lastPollHttpError,
                  })
                );
              } catch (e) {
                if (String(e?.code || '') === 'CIRCUIT_OPEN') {
                  const remainMatch = String(e?.message || '').match(/_(\d+)ms$/);
                  const remainMs = remainMatch ? Number(remainMatch[1]) : 0;
                  res.statusCode = 503;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({
                    message: `IdleCloud 链路暂时不稳定，已进入短时熔断保护，请约 ${Math.ceil(Math.max(0, remainMs) / 1000)} 秒后重试。`,
                    route: 'circuit_open',
                    networkKind: 'circuit_open',
                  }));
                  return;
                }
                const routeLabel = e?.__routeLabel || 'unknown';
                const networkKind = e?.__networkKind || classifyNetworkError(e);
                const isNetworkError = isIdleCloudNetworkError(e) || e?.name === 'TimeoutError';
                if (isNetworkError) markUpstreamTransientFailure('idlecloud', networkKind);
                res.statusCode = isNetworkError ? 502 : 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                const message = isNetworkError
                  ? formatClassifiedNetworkError('IdleCloud ', routeLabel, e, `错误类型=${networkKind}`)
                  : `IdleCloud 内部异常[${routeLabel}]: ${e.message || String(e)}`;
                res.end(JSON.stringify({ message, route: routeLabel, networkKind }));
              }
            });
            return;
          }

          // ================= 修改：正式生图接口 (无预缓存版) =================
          if (pathname === '/api/novelai/generate-image' && req.method === 'POST') {
            let body = [];
            req.on('data', chunk => body.push(chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const token = parseBearerToken(req.headers.authorization || '');

                if (!token) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ message: '缺少 NovelAI Token' }));
                  return;
                }

                const width = data.width ?? 512;
                const height = data.height ?? 512;
                const model = data.model ?? 'nai-diffusion';

                const payload = {
                  action: 'generate',
                  input: data.prompt ?? data.input ?? '',
                  model,
                  parameters: {
                    params_version: 3,
                    prefer_brownian: true,
                    negative_prompt: data.negative_prompt ?? '',
                    height,
                    width,
                    scale: data.scale ?? 9,
                    seed: data.seed >= 0 ? data.seed : Math.floor(Math.random() * 9999999999),
                    sampler: data.sampler ?? 'k_dpmpp_2m',
                    noise_schedule: data.noise_schedule ?? data.scheduler ?? 'karras',
                    steps: data.steps ?? 28,
                    n_samples: 1,
                    ucPreset: data.ucPreset ?? 0,
                    qualityToggle: data.qualityToggle ?? false,
                    add_original_image: false,
                    controlnet_strength: 1,
                    deliberate_euler_ancestral_bug: false,
                    dynamic_thresholding: data.decrisper ?? false,
                    legacy: false,
                    legacy_v3_extend: false,
                    sm: data.sm ?? false,
                    sm_dyn: data.sm_dyn ?? false,
                    uncond_scale: 1,
                    skip_cfg_above_sigma: data.variety_boost ? calculateSkipCfgAboveSigma(width, height, model) : null,
                    use_coords: false,
                    characterPrompts: [],
                    normalize_reference_strength_multiple: data.normalize_reference_strength_multiple ?? true,
                    
                    reference_image_multiple: data.reference_image_multiple ?? [],
                    reference_information_extracted_multiple: data.reference_information_extracted_multiple ?? [],
                    reference_strength_multiple: data.reference_strength_multiple ?? [],

                    director_reference_descriptions: data.director_reference_descriptions ?? [],
                    director_reference_information_extracted: data.director_reference_information_extracted ?? [],
                    director_reference_strength_values: data.director_reference_strength_values ?? [],
                    director_reference_secondary_strength_values: data.director_reference_secondary_strength_values ?? [],
                    director_reference_images: data.director_reference_images ?? [],
                    director_reference_images_cached: [],

                    v4_negative_prompt: {
                      caption: {
                        base_caption: data.negative_prompt ?? '',
                        char_captions: [],
                      },
                    },
                    v4_prompt: {
                      caption: {
                        base_caption: data.prompt ?? data.input ?? '',
                        char_captions: [],
                      },
                      use_coords: false,
                      use_order: true,
                    },
                  },
                };

                const upstreamKind = String(req.headers['x-nai-upstream'] || '').toLowerCase();
                const upstreamUrl = upstreamKind === 'idlecloud' ? IDLECLOUD_GENERATE_IMAGE : `${IMAGE_NOVELAI}/ai/generate-image`;
                console.log('[Image request summary]', JSON.stringify(buildImageRequestLogSummary(payload, upstreamKind || 'novelai')));
                const rateLimitKey = upstreamKind === 'idlecloud' ? 'idlecloud' : 'novelai';
                const idlePolicy = upstreamKind === 'idlecloud' ? getIdleCloudAdaptiveRetryPolicy() : null;
                const buildUpstreamOptions = (agent) => ({
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Connection': 'close',
                    'Cache-Control': 'no-cache',
                    'Origin': 'https://novelai.net',
                    'Referer': 'https://novelai.net/'
                  },
                  body: JSON.stringify(payload),
                  ...(agent ? { agent } : {}),
                });
                const upstreamRes = await fetchWithRetry(
                  () => (
                    upstreamKind === 'idlecloud'
                      ? runIdleCloudSubmissionWithGuard(
                          token,
                          () => fetchIdleCloudWithFallback(upstreamUrl, buildUpstreamOptions, idlePolicy?.timeoutMs || 120000),
                          'nai_compatible_submit'
                        )
                      : fetchWithTimeout(upstreamUrl, buildUpstreamOptions(imageProxyEnabled ? proxyAgent : undefined), 240000)
                  ),
                  {
                    attempts: upstreamKind === 'idlecloud' ? (idlePolicy?.attempts || 2) : 3,
                    baseDelayMs: upstreamKind === 'idlecloud' ? 2500 : 1200,
                    maxDelayMs: 10000,
                    beforeAttempt: () => waitForUpstreamCooldown(rateLimitKey),
                    shouldRetry: (err, response) => {
                      if (err) return isRetryableError(err);
                      return upstreamKind === 'idlecloud'
                        ? shouldRetryIdleCloudSubmitStatus(response?.status)
                        : shouldRetryStatus(response?.status);
                    },
                    onRetry: ({ attempt, delay, result, error }) => {
                      const reason = error ? (error.message || String(error)) : `HTTP ${result?.status}`;
                      if (result?.status === 429) markUpstreamRateLimit(rateLimitKey, result);
                      if (upstreamKind === 'idlecloud') {
                        if (error) {
                          const kind = classifyNetworkError(error);
                          markUpstreamTransientFailure(rateLimitKey, kind);
                        } else if (result?.status >= 500) {
                          markUpstreamTransientFailure(rateLimitKey, `http_${result.status}`);
                        }
                      }
                      console.warn(`[Image upstream retry] upstream=${upstreamKind || 'novelai'} attempt=${attempt} wait=${delay}ms reason=${reason}`);
                    },
                    onSuccess: (result) => {
                      if (result?.status === 429) {
                        markUpstreamRateLimit(rateLimitKey, result);
                      } else if (result?.ok) {
                        clearUpstreamRateLimit(rateLimitKey);
                      }
                    }
                  }
                );

                const arrayBuffer = await upstreamRes.arrayBuffer();
                const contentType = upstreamRes.headers.get('content-type') || 'application/x-zip-compressed';

                if (!upstreamRes.ok) {
                  const routeLabel = upstreamRes.__routeLabel || (upstreamKind === 'idlecloud'
                    ? (idleCloudPreferProxy && proxyAgent ? `proxy(${PROXY_URL})` : 'direct')
                    : (imageProxyEnabled ? `proxy(${PROXY_URL})` : 'direct'));
                  const { message: upstreamMsg, detail } = extractUpstreamErrorMessage(arrayBuffer, contentType);
                  const stage = 'submit_upstream_generate';
                  const fallbackMsg =
                    upstreamRes.status === 429
                      ? '上游并发/频率受限'
                      : upstreamRes.status >= 500
                        ? '上游服务异常'
                        : '上游拒绝请求';
                  res.statusCode = upstreamRes.status;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({
                    message: `[${stage}] ${fallbackMsg}（HTTP ${upstreamRes.status}）${upstreamMsg ? `：${upstreamMsg}` : ''}`,
                    stage,
                    upstream: upstreamKind || 'novelai',
                    route: routeLabel,
                    status: upstreamRes.status,
                    detail
                  }));
                  return;
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', contentType);
                res.end(Buffer.from(arrayBuffer));
              } catch (e) {
                if (String(e?.code || '') === 'CIRCUIT_OPEN') {
                  const remainMatch = String(e?.message || '').match(/_(\d+)ms$/);
                  const remainMs = remainMatch ? Number(remainMatch[1]) : 0;
                  res.statusCode = 503;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    message: `IdleCloud 链路暂时不稳定，已进入短时熔断保护，请约 ${Math.ceil(Math.max(0, remainMs) / 1000)} 秒后重试。`,
                    route: 'circuit_open',
                    networkKind: 'circuit_open',
                  }));
                  return;
                }
                const isIdleCloudUpstream = String(req.headers['x-nai-upstream'] || '').toLowerCase() === 'idlecloud';
                const routeLabel = e?.__routeLabel || (isIdleCloudUpstream
                  ? (idleCloudPreferProxy && proxyAgent ? `proxy(${PROXY_URL})` : 'direct')
                  : (imageProxyEnabled ? `proxy(${PROXY_URL})` : 'direct'));
                const networkKind = e?.__networkKind || classifyNetworkError(e);
                const isNetworkError = isIdleCloudUpstream
                  ? (isIdleCloudNetworkError(e) || e?.name === 'TimeoutError')
                  : (String(e?.message || '').includes('fetch failed') || String(e?.message || '').includes('ECONN') || String(e?.message || '').includes('timeout'));
                if (isIdleCloudUpstream && isNetworkError) markUpstreamTransientFailure('idlecloud', networkKind);
                res.statusCode = isNetworkError ? 502 : 500;
                res.setHeader('Content-Type', 'application/json');
                const errorMsg = isNetworkError
                  ? (isIdleCloudUpstream
                      ? formatClassifiedNetworkError('IdleCloud 上游 ', routeLabel, e, `错误类型=${networkKind}`)
                      : formatClassifiedNetworkError('NovelAI 上游 ', routeLabel, e, `错误类型=${networkKind}`))
                  : `内部异常[${routeLabel}]: ${e.message || String(e)}`;
                res.end(JSON.stringify({ message: errorMsg, route: routeLabel, networkKind }));
              }
            });
            return;
          }
          next();
        });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-file-api',
      configureServer(server) {
        attachArchiveApi(server);
      },
      configurePreviewServer(server) {
        attachArchiveApi(server);
      }
    }
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      'hyingwu.cc.cd'
    ],
    proxy: {
      '/api/novelai': {
        target: 'https://image.novelai.net',
        changeOrigin: true,
        agent: proxyAgent, 
        rewrite: (path) => path.replace(/^\/api\/novelai/, '')
      }
    }
  }
})
