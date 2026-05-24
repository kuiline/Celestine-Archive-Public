import { processImageForNAI } from './utils';
import { blobToDataUrl } from './appHelpers';

/**
 * V4.5 Director 参考描述：以 NovelAI / IdleCloud 文档为准。
 * Precise Reference 仅列 Character、Style、Character & Style；IdleCloud 对 director 列 character / style / character&style。
 * 旧存档若含已移除的 background 选项，按角色参考处理。
 */
function directorReferenceCaptionFromV45RefType(v45RefType) {
  switch (v45RefType) {
    case 'style':
      return 'style reference';
    case 'character&style':
      return 'character&style';
    case 'character':
    case 'background':
    default:
      return 'character reference';
  }
}

function extractBase64FromDataUrl(input) {
  const text = String(input || '');
  const m = text.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return m?.[1] ? m[1].trim() : '';
}

async function ensureReferenceDataUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image/')) return raw;
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) return raw;
  try {
    const res = await fetch(raw, { cache: 'no-store' });
    if (!res.ok) return raw;
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('image/')) return raw;
    return await blobToDataUrl(await res.blob());
  } catch (e) {
    return raw;
  }
}

function isCloudflareChallengeLike(text) {
  const s = String(text || '');
  return /__CF\$cv\$params|challenge-platform\/scripts\/jsd\/main\.js|cdn-cgi\/challenge-platform|cf_challenge_page|Cloudflare 挑战页|风控页/i.test(s);
}

// Default public behavior: keep IdleCloud official adapter on the NAI-compatible endpoint.
const IDLECLOUD_AUTO_GENERIC_FALLBACK = false;

function parseImageErrorText(errText) {
  try {
    const j = JSON.parse(errText);
    const upstream = j?.upstream ? `upstream=${j.upstream}` : '';
    const route = j?.route ? `route=${j.route}` : '';
    const stage = j?.stage ? `stage=${j.stage}` : '';
    const status = j?.status ? `upstreamStatus=${j.status}` : '';
    const meta = [upstream, route, stage, status].filter(Boolean).join(', ');
    const message = j?.message
      ? (meta ? `${j.message} [${meta}]` : j.message)
      : (meta ? `${String(errText).substring(0, 350)} [${meta}]` : String(errText).substring(0, 350));
    return { raw: j, message };
  } catch (e) {
    return { raw: null, message: String(errText).substring(0, 350) };
  }
}

async function readImageFromResponse(naiRes) {
  const contentType = naiRes.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await naiRes.json();
    if (data.image) return `data:image/png;base64,${data.image}`;
    if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
    throw new Error('未能从 JSON 中解析图像');
  }
  if (contentType.includes('image/')) {
    return await blobToDataUrl(await naiRes.blob());
  }
  if (!window.JSZip) throw new Error('缺少 JSZip，请刷新重试');
  const zip = await new window.JSZip().loadAsync(await naiRes.arrayBuffer());
  const filename = Object.keys(zip.files)[0];
  if (!filename) throw new Error('ZIP 里没有图片');
  return `data:image/png;base64,${await zip.file(filename).async('base64')}`;
}

export async function buildNaiPayloadByPrompt(naiConfig, finalPrompt, referenceImageDataUrl = null) {
  const { RESOLUTIONS } = await import('./constants');
  const resConfig = RESOLUTIONS[naiConfig.resolution] || RESOLUTIONS.portrait;
  const naiPayload = {
    prompt: finalPrompt,
    model: naiConfig.model,
    width: resConfig.width,
    height: resConfig.height,
    scale: parseFloat(naiConfig.scale),
    sampler: naiConfig.sampler,
    steps: parseInt(naiConfig.steps),
    seed: Math.floor(Math.random() * 4294967295),
    negative_prompt: naiConfig.negative
  };
  const isV45 = naiConfig.version === 'v4.5' || naiConfig.model.includes('4-5') || naiConfig.model.includes('-4-');
  if (isV45) {
    naiPayload.qualityToggle = naiConfig.v45_qualityToggle !== false;
    naiPayload.ucPreset = naiConfig.v45_ucPreset || 0;
    naiPayload.noise_schedule = 'karras';
    naiPayload.legacy_v3_extend = false;
    naiPayload.uncond_scale = 0.0;
    naiPayload.cfg_rescale = 0.0;
    naiPayload.v4_prompt = { caption: { base_caption: finalPrompt, char_captions: [] }, use_coords: false, use_order: true, legacy_uc: false };
    naiPayload.v4_negative_prompt = { caption: { base_caption: naiConfig.negative, char_captions: [] }, use_coords: false, use_order: true, legacy_uc: false };
    if (referenceImageDataUrl) {
      const normalizedReferenceInput = await ensureReferenceDataUrl(referenceImageDataUrl);
      let processedBase64 = await processImageForNAI(normalizedReferenceInput);
      if (!processedBase64) {
        const rawBase64 = extractBase64FromDataUrl(normalizedReferenceInput);
        if (rawBase64) {
          processedBase64 = rawBase64;
          console.warn('参考图预处理失败，已回退使用原始 Base64。');
        } else {
          console.warn('参考图预处理失败，已跳过参考图继续生成。');
        }
      }
      const refStrength = parseFloat(naiConfig.v45_refStrength ?? 0.6);
      const refTypeString = directorReferenceCaptionFromV45RefType(naiConfig.v45_refType || 'character');
      if (processedBase64) {
        naiPayload.director_reference_descriptions = [{ caption: { base_caption: refTypeString, char_captions: [] }, legacy_uc: false }];
        naiPayload.director_reference_information_extracted = [1.0];
        naiPayload.director_reference_strength_values = [refStrength];
        naiPayload.director_reference_secondary_strength_values = [0.0];
        naiPayload.director_reference_images = [processedBase64];
        naiPayload.v45_refFidelity = parseFloat(naiConfig.v45_refFidelity ?? 1.0);
      }
    }
  } else {
    naiPayload.noise_schedule = 'karras';
    naiPayload.qualityToggle = true;
    naiPayload.ucPreset = 0;
    if (naiConfig.v3_sm) naiPayload.sm = true;
    if (naiConfig.v3_sm_dyn) naiPayload.sm_dyn = true;
  }
  return naiPayload;
}

export async function requestNovelAiImage(naiConfig, naiPayload) {
  const upstream = naiConfig.imageUpstream || 'novelai';
  const useIdlecloudGeneric = upstream === 'idlecloud_generic';
  const useIdlecloud = upstream === 'idlecloud';
  const useIdlecloudOfficial = useIdlecloud && !useIdlecloudGeneric;
  const generateUrl = useIdlecloudGeneric
    ? '/api/idlecloud/generate-image'
    : '/api/novelai/generate-image';
  let naiRes = await fetch(generateUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${naiConfig.key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, application/x-zip-compressed, image/*',
      ...(useIdlecloud ? { 'X-NAI-Upstream': 'idlecloud' } : {})
    },
    body: JSON.stringify(naiPayload)
  });
  if (!naiRes.ok) {
    const errText = await naiRes.text();
    const parsedErr = parseImageErrorText(errText);
    const canFallbackToGeneric =
      IDLECLOUD_AUTO_GENERIC_FALLBACK &&
      useIdlecloudOfficial &&
      naiRes.status === 500 &&
      (isCloudflareChallengeLike(errText) || isCloudflareChallengeLike(parsedErr.raw?.message) || isCloudflareChallengeLike(parsedErr.raw?.detail));
    if (canFallbackToGeneric) {
      console.warn('IdleCloud 官方适配命中 Cloudflare 挑战页，自动回退通用接口重试。');
      naiRes = await fetch('/api/idlecloud/generate-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${naiConfig.key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, application/x-zip-compressed, image/*'
        },
        body: JSON.stringify(naiPayload)
      });
      if (naiRes.ok) return await readImageFromResponse(naiRes);
      const fallbackText = await naiRes.text();
      let fallbackMsg = fallbackText.substring(0, 350);
      try {
        const fj = JSON.parse(fallbackText);
        fallbackMsg = String(fj?.message || fallbackMsg);
      } catch (e) {}
      throw new Error(`请求失败 (${naiRes.status}): IdleCloud 官方适配触发 Cloudflare 挑战，回退通用接口仍失败：${fallbackMsg}`);
    }
    throw new Error(`请求失败 (${naiRes.status}): ${parsedErr.message}`);
  }
  return await readImageFromResponse(naiRes);
}

export async function persistGeneratedImage(activeSessionId, imageDataUrl, prompt) {
  if (!imageDataUrl?.startsWith('data:image/')) return imageDataUrl;
  try {
    const res = await fetch('/api/save-generated-image', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: imageDataUrl
    });
    if (!res.ok) return imageDataUrl;
    const data = await res.json();
    return data.url || imageDataUrl;
  } catch (e) {
    return imageDataUrl;
  }
}
