/**
 * 将应用内「扁平」生图参数转为 IdleCloud 通用接口 POST /api/generate_image 的请求体。
 * 文档：IdleCloud_API_文档.txt（与 Nai 官方 JSON 不同）。
 */

export function stripBase64DataUrl(s) {
  if (!s || typeof s !== 'string') return '';
  const m = s.match(/^data:[^;]+;base64,(.+)$/i);
  return m ? m[1].replace(/\s/g, '') : String(s).replace(/\s/g, '');
}

/** 官方适配里 caption 为 "character reference" 等；通用接口要 character / style / character&style */
export function directorDescToIdleCloudShort(officialCaption) {
  const c = (officialCaption || '').trim().toLowerCase();
  if (c === 'style reference') return 'style';
  if (c === 'character&style' || c.includes('character&style')) return 'character&style';
  return 'character';
}

/**
 * @param {Record<string, unknown>} data - buildNaiPayloadByPrompt 产物
 */
export function buildIdleCloudGenericBody(data) {
  const positivePrompt = data.prompt ?? data.input ?? '';
  const negativePrompt = data.negative_prompt ?? '';
  const width = data.width ?? 512;
  const height = data.height ?? 512;
  const seed =
    typeof data.seed === 'number' && data.seed >= 0
      ? data.seed
      : Math.floor(Math.random() * 4294967295);

  const body = {
    model: data.model ?? 'nai-diffusion-4-5-full',
    positivePrompt,
    negativePrompt,
    qualityToggle: data.qualityToggle ?? false,
    scale: typeof data.scale === 'number' ? data.scale : parseFloat(data.scale) || 5,
    steps: typeof data.steps === 'number' ? data.steps : parseInt(data.steps, 10) || 28,
    width,
    height,
    promptGuidanceRescale: data.cfg_rescale ?? 0,
    noise_schedule: data.noise_schedule ?? 'karras',
    seed,
    sampler: data.sampler ?? 'k_euler',
    sm: data.sm ?? false,
    sm_dyn: data.sm_dyn ?? false,
    decrisp: false,
    variety: false,
    n_samples: 1,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    legacy: false,
    legacy_uc: false,
    legacy_v3_extend: false,
    ucPreset: data.ucPreset ?? 1,
    autoSmea: false,
    use_coords: false,
    use_upscale_credits: false,
  };

  const directorImages = data.director_reference_images;
  if (Array.isArray(directorImages) && directorImages[0]) {
    const raw = stripBase64DataUrl(directorImages[0]);
    if (raw) {
      let desc = 'character';
      const cap = data.director_reference_descriptions?.[0]?.caption?.base_caption;
      if (cap) desc = directorDescToIdleCloudShort(cap);

      let secondary = 0;
      if (desc === 'character&style') {
        const fid =
          typeof data.v45_refFidelity === 'number'
            ? data.v45_refFidelity
            : parseFloat(data.v45_refFidelity);
        secondary = Number.isFinite(fid) ? Math.min(1, Math.max(0, fid)) : 0;
      }

      /*
       * 文档 4.3 Director 仅列三项（图 / 描述 / secondary），勿附加 NovelAI 专有数组字段，
       * 否则服务端可能丢弃整段 Director → 不扣角色参考点、参考也不生效。
       */
      body.director_reference_images = raw;
      body.director_reference_descriptions = desc;
      body.director_reference_secondary_strength_values = secondary;
      // 勿与 4.3 Director 同时塞 V4 reference_image_multiple（同图双通道曾导致对方轮询阶段 HTTP 500）
    }
  } else if (Array.isArray(data.reference_image_multiple) && data.reference_image_multiple.length) {
    body.reference_image_multiple = data.reference_image_multiple.map((x) => stripBase64DataUrl(x));
    body.reference_strength_multiple = data.reference_strength_multiple ?? [];
    if (
      Array.isArray(data.reference_information_extracted_multiple) &&
      data.reference_information_extracted_multiple.length
    ) {
      body.reference_information_extracted_multiple = data.reference_information_extracted_multiple;
    }
  }

  return body;
}
