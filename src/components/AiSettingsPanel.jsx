import React, { useState } from 'react';
import { Plus, Trash2, Palette, Terminal, Shield, Zap } from 'lucide-react';

const AiSettingsPanel = ({
  aiEndpoints, setAiEndpoints,
  naiConfig, setNaiConfig,
  systemPrompt, setSystemPrompt,
  naiTagPrompt, setNaiTagPrompt,
  ideaCultivatePrompt, setIdeaCultivatePrompt,
  ragConfig, setRagConfig,
  saveAiEndpoints, saveNaiConfig,
  onRebuildRag,
  setShowAiSettings,
}) => {
  const [ragTestResult, setRagTestResult] = useState('');
  const [testingRag, setTestingRag] = useState(false);
  const [rebuildingRag, setRebuildingRag] = useState(false);

  const handleTestRag = async () => {
    setTestingRag(true);
    setRagTestResult('正在测试连接...');
    try {
      const res = await fetch('/api/rag/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ragConfig, text: '连接测试' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRagTestResult(`在线：维度 ${data.dimension} / 模型 ${data.model}`);
    } catch (e) {
      setRagTestResult(`离线：${e.message}`);
    } finally {
      setTestingRag(false);
    }
  };

  const handleRebuildRag = async () => {
    if (!onRebuildRag) return;
    setRebuildingRag(true);
    try {
      await onRebuildRag();
    } finally {
      setRebuildingRag(false);
    }
  };

  return (
    <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-8 bg-slate-50/80 backdrop-blur-xl animate-fade-in text-stone-800">
      {/* 头部区域 */}
      <div className="flex justify-between items-end mb-10 border-b border-stone-200 pb-6">
        <div className="relative">
          <h3 className="text-2xl font-serif font-black tracking-widest text-slate-900">系统内核配置</h3>
          <div className="absolute -bottom-1 left-0 w-12 h-1 bg-slate-900"></div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-slate-400 mt-3">核心协议 / 模型节点 / 知识库引擎</p>
        </div>
        <button
          onClick={() => setAiEndpoints([...aiEndpoints, { id: `ep_${Date.now()}`, name: '新模型节点', url: '', model: '', key: '', mode: 'text', thinkingEnabled: false }])}
          className="flex items-center gap-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold tracking-widest transition-all shadow-lg active:scale-95 border border-slate-700"
        >
          <Plus size={14} /> 添加新节点
        </button>
      </div>

      {/* 多模型配置 */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6 text-slate-500 font-bold">
          <Terminal size={18} />
          <span className="text-xs tracking-widest">大型语言模型 (LLM) 节点</span>
        </div>
        <div className="grid grid-cols-1 gap-6">
          {aiEndpoints.map((ep, idx) => (
            <div key={ep.id} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group relative">
              <div className="absolute top-6 left-6 flex items-center gap-2">
                <span className="text-[9px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-400">节点 {String(idx + 1).padStart(2, '0')}</span>
              </div>
              {aiEndpoints.length > 1 && (
                <button onClick={() => setAiEndpoints(aiEndpoints.filter(e => e.id !== ep.id))} className="absolute top-6 right-6 p-2 text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100">
                  <Trash2 size={16} />
                </button>
              )}
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">节点名称</label>
                    <input value={ep.name} onChange={(e) => setAiEndpoints(aiEndpoints.map(x => x.id === ep.id ? { ...x, name: e.target.value } : x))} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 transition-colors font-bold shadow-inner" placeholder="例如：DeepSeek / OpenAI" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">模型代号</label>
                    <input value={ep.model} onChange={(e) => setAiEndpoints(aiEndpoints.map(x => x.id === ep.id ? { ...x, model: e.target.value } : x))} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 transition-colors font-mono shadow-inner" placeholder="例如：deepseek-chat" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">接口类型</label>
                    <select
                      value={ep.mode || 'text'}
                      onChange={(e) => setAiEndpoints(aiEndpoints.map(x => x.id === ep.id ? { ...x, mode: e.target.value } : x))}
                      className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 transition-colors font-bold shadow-inner"
                    >
                      <option value="text">纯文本核心 (线性处理)</option>
                      <option value="multimodal">多模态核心 (支持识图)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">接口地址 (Base URL)</label>
                    <input value={ep.url} onChange={(e) => setAiEndpoints(aiEndpoints.map(x => x.id === ep.id ? { ...x, url: e.target.value } : x))} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 transition-colors font-mono shadow-inner" placeholder="https://api.example.com/v1" />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">访问令牌 (API KEY)</label>
                  <input type="password" value={ep.key} onChange={(e) => setAiEndpoints(aiEndpoints.map(x => x.id === ep.id ? { ...x, key: e.target.value } : x))} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 transition-colors font-mono shadow-inner" placeholder="请输入 API Key" />
                </div>
                <div className="md:col-span-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                  <label className="flex items-center gap-2.5 text-xs font-bold text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-slate-900"
                      checked={ep.thinkingEnabled === true}
                      onChange={(e) => setAiEndpoints(aiEndpoints.map((x) => (x.id === ep.id ? { ...x, thinkingEnabled: e.target.checked } : x)))}
                    />
                    思考模式
                  </label>
                  <p className="text-[10px] text-slate-500 leading-relaxed pl-0.5">
                    仅对支持的接口自动附加参数，其它 Base URL 会忽略，避免报错。DeepSeek 使用 <code className="font-mono text-slate-700">thinking</code> + <code className="font-mono text-slate-700">reasoning_effort</code>；硅基流动使用 <code className="font-mono text-slate-700">enable_thinking</code> + <code className="font-mono text-slate-700">thinking_budget</code>。模型名须在其文档列出的支持列表中。
                  </p>
                  {ep.thinkingEnabled && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-[10px] text-slate-500">
                      <span className="shrink-0 font-bold text-slate-500">硅基 · 思考预算 (token)</span>
                      <input
                        type="number"
                        min={128}
                        max={32768}
                        placeholder="4096"
                        value={ep.thinkingBudget != null && ep.thinkingBudget !== '' ? ep.thinkingBudget : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAiEndpoints(
                            aiEndpoints.map((x) => {
                              if (x.id !== ep.id) return x;
                              if (v === '') return { ...x, thinkingBudget: undefined };
                              const n = parseInt(v, 10);
                              return { ...x, thinkingBudget: Number.isFinite(n) ? n : x.thinkingBudget };
                            })
                          );
                        }}
                        className="w-28 p-2 rounded-lg bg-white border border-slate-200 text-xs font-mono outline-none focus:border-slate-400"
                      />
                      <span className="text-slate-400">留空时默认 4096；仅对硅基流动有效。</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NovelAI 配置 */}
      <div className="mb-12 border-t border-slate-200 pt-10">
        <div className="flex items-center gap-3 mb-6 text-purple-500 font-bold">
          <Palette size={18} />
          <span className="text-xs tracking-widest">图像生成单元 (NovelAI)</span>
        </div>
        <div className="bg-white border border-purple-100 rounded-2xl p-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">
                  {naiConfig.imageUpstream === 'novelai' ? 'NovelAI 密钥' : 'IdleCloud API Key'}
                </label>
                <input type="password" value={naiConfig.key} onChange={(e) => setNaiConfig({ ...naiConfig, key: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 transition-colors shadow-inner" placeholder={naiConfig.imageUpstream === 'novelai' ? 'pst-...' : 'IdleCloud 网站生成的 Key'} />
              </div>
              <div>
                <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">出图上游</label>
                <select
                  value={naiConfig.imageUpstream || 'novelai'}
                  onChange={(e) => setNaiConfig({ ...naiConfig, imageUpstream: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 font-bold shadow-inner"
                >
                  <option value="novelai">NovelAI 官方 (image.novelai.net)</option>
                  <option value="idlecloud">IdleCloud 官方适配（与 Nai 同构 JSON）</option>
                  <option value="idlecloud_generic">IdleCloud 通用接口（/generate_image + 轮询）</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1.5 ml-1 leading-relaxed">
                  {naiConfig.imageUpstream === 'idlecloud_generic'
                    ? '与「官方适配」同一把 IdleCloud 网站生成的 API Key（文档：Bearer 认证，进阶档及以上）。如需本地代理，请在启动前设置 IMAGE_PROXY_URL。'
                    : naiConfig.imageUpstream === 'idlecloud'
                      ? '密钥填 IdleCloud 网站生成的 API Key；本地按 Nai 官方 JSON 封装后转发。对方有间隔、并发等限制。'
                      : '选 NovelAI 时密钥填 pst-…；请求固定经本地后端转发。如需代理，请设置 IMAGE_PROXY_URL。'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">本地转发地址</label>
                <input type="text" value="/api/novelai/generate-image" disabled className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 transition-colors shadow-inner disabled:opacity-50 disabled:cursor-not-allowed" placeholder="/api/novelai/generate-image" />
                <p className="text-[10px] text-slate-400 mt-1.5 ml-1 leading-relaxed">生图请求固定由本地后端转发；代理由环境变量 IMAGE_PROXY_URL 控制。</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6">
               <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">引擎版本</label>
                    <select value={naiConfig.version || 'v4.5'} onChange={(e) => { const v = e.target.value; setNaiConfig({ ...naiConfig, version: v, model: v === 'v4.5' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-3' }); }} className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 font-bold shadow-inner">
                      <option value="v4.5">V4.5 最新版</option>
                      <option value="v3">V3 经典版</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">默认比例</label>
                    <select value={naiConfig.resolution} onChange={(e) => setNaiConfig({ ...naiConfig, resolution: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 font-bold shadow-inner">
                      <option value="portrait">竖屏立绘</option>
                      <option value="landscape">横屏插画</option>
                      <option value="square">正方形</option>
                    </select>
                  </div>
               </div>
               <div>
                <label className="block text-xs font-bold text-purple-400 mb-1.5 ml-1">底层模型代号</label>
                <input type="text" value={naiConfig.model} onChange={(e) => setNaiConfig({ ...naiConfig, model: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-purple-100 text-sm outline-none focus:border-purple-500 font-mono shadow-inner" />
              </div>
            </div>
          </div>

          {/* V4.5 特有参数 */}
          {(naiConfig.version === 'v4.5' || !naiConfig.version) && (
            <div className="mb-8 bg-purple-50/50 p-6 rounded-2xl border border-purple-100/50 shadow-inner flex flex-col gap-4 text-stone-800">
              <div className="flex items-center gap-2 text-purple-800">
                <Shield size={14} />
                <span className="text-xs font-black tracking-widest">精确参考协议 (V4.5)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-[10px] font-bold text-purple-400 mb-1.5 ml-1">参考模式</label>
                  <select value={naiConfig.v45_refType || 'character'} onChange={(e) => setNaiConfig({ ...naiConfig, v45_refType: e.target.value })} className="w-full p-2.5 rounded-xl border border-purple-200 text-xs outline-none bg-white font-bold text-purple-900 shadow-sm">
                    <option value="character">角色特征参考</option>
                    <option value="style">视觉风格参考</option>
                    <option value="character&style">双重协同参考</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-purple-400 mb-1.5 ml-1">参考强度 (0-1)</label>
                  <input type="number" step="0.1" min="0" max="1" value={naiConfig.v45_refStrength ?? 0.6} onChange={(e) => setNaiConfig({ ...naiConfig, v45_refStrength: parseFloat(e.target.value) })} className="w-full p-2.5 rounded-xl border border-purple-200 text-xs outline-none bg-white font-mono shadow-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-purple-400 mb-1.5 ml-1">忠实度 (0-1)</label>
                  <input type="number" step="0.1" min="0" max="1" value={naiConfig.v45_refFidelity ?? 1.0} onChange={(e) => setNaiConfig({ ...naiConfig, v45_refFidelity: parseFloat(e.target.value) })} className="w-full p-2.5 rounded-xl border border-purple-200 text-xs outline-none bg-white font-mono shadow-sm" />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6 mt-8 border-t border-purple-100 pt-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-stone-800">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">渲染步数</label>
                <input type="number" min="10" max="50" value={naiConfig.steps} onChange={(e) => setNaiConfig({ ...naiConfig, steps: parseInt(e.target.value) })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 shadow-inner" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">提示词相关性</label>
                <input type="number" step="0.1" min="1" max="10" value={naiConfig.scale} onChange={(e) => setNaiConfig({ ...naiConfig, scale: parseFloat(e.target.value) })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 shadow-inner" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1">采样器</label>
                <select value={naiConfig.sampler} onChange={(e) => setNaiConfig({ ...naiConfig, sampler: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-slate-900 font-bold shadow-inner">
                  <option value="k_euler">K_EULER (稳定)</option>
                  <option value="k_euler_ancestral">K_EULER_A (多样)</option>
                  <option value="k_dpmpp_2s_ancestral">K_DPMPP_2S_A (精细)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1 text-stone-800">全局正向起手式</label>
              <textarea value={naiConfig.prefix} onChange={(e) => setNaiConfig({ ...naiConfig, prefix: e.target.value })} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs outline-none focus:border-slate-900 font-serif resize-none h-20 shadow-inner leading-relaxed text-stone-800" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5 ml-1 text-stone-800">全局负向提示词</label>
              <textarea value={naiConfig.negative} onChange={(e) => setNaiConfig({ ...naiConfig, negative: e.target.value })} className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs outline-none focus:border-slate-900 font-serif resize-none h-20 shadow-inner leading-relaxed text-stone-800" />
            </div>
          </div>
        </div>
      </div>

      {/* RAG 配置 */}
      <div className="mb-12 border-t border-slate-200 pt-10">
        <div className="flex items-center gap-3 mb-6 text-emerald-500 font-bold">
          <Zap size={18} />
          <span className="text-xs tracking-widest">知识库语义检索 (RAG / Embedding)</span>
        </div>
        <div className="bg-white border border-emerald-100 rounded-2xl p-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 text-stone-800">
            <div>
              <label className="block text-xs font-bold text-emerald-400 mb-1.5 ml-1">向量化接口地址</label>
              <input value={ragConfig?.baseUrl || ''} onChange={(e) => setRagConfig({ ...(ragConfig || {}), baseUrl: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-emerald-500 shadow-inner" placeholder="https://api..." />
            </div>
            <div>
              <label className="block text-xs font-bold text-emerald-400 mb-1.5 ml-1">向量模型名称</label>
              <input value={ragConfig?.embeddingModel || ''} onChange={(e) => setRagConfig({ ...(ragConfig || {}), embeddingModel: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-emerald-500 shadow-inner" placeholder="模型 ID" />
            </div>
          </div>
          <div className="mb-8 text-stone-800">
            <div>
              <label className="block text-xs font-bold text-emerald-400 mb-1.5 ml-1">向量接口密钥</label>
              <input type="password" value={ragConfig?.apiKey || ''} onChange={(e) => setRagConfig({ ...(ragConfig || {}), apiKey: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-emerald-500 shadow-inner" />
            </div>
          </div>
          <div className="mb-6 p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer mb-4">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                checked={ragConfig?.useChroma !== false}
                onChange={(e) => setRagConfig({ ...(ragConfig || {}), useChroma: e.target.checked })}
              />
              <span className="font-bold">使用 Chroma 向量库（Docker）</span>
              <span className="text-xs text-slate-500">默认 127.0.0.1:8000；关闭则仅用本地 JSON 索引</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-stone-800">
              <div>
                <label className="block text-xs font-bold text-emerald-600 mb-1.5 ml-1">Chroma 主机</label>
                <input value={ragConfig?.chromaHost ?? '127.0.0.1'} onChange={(e) => setRagConfig({ ...(ragConfig || {}), chromaHost: e.target.value })} className="w-full p-3 rounded-xl bg-white border border-emerald-100 text-sm outline-none focus:border-emerald-500" placeholder="127.0.0.1" disabled={ragConfig?.useChroma === false} />
              </div>
              <div>
                <label className="block text-xs font-bold text-emerald-600 mb-1.5 ml-1">端口</label>
                <input type="number" min="1" max="65535" value={ragConfig?.chromaPort ?? 8000} onChange={(e) => setRagConfig({ ...(ragConfig || {}), chromaPort: parseInt(e.target.value || '8000', 10) })} className="w-full p-3 rounded-xl bg-white border border-emerald-100 text-sm outline-none focus:border-emerald-500" disabled={ragConfig?.useChroma === false} />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-7">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                  checked={ragConfig?.chromaSsl === true}
                  onChange={(e) => setRagConfig({ ...(ragConfig || {}), chromaSsl: e.target.checked })}
                  disabled={ragConfig?.useChroma === false}
                />
                <span className="font-bold">HTTPS</span>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-4 border-t border-emerald-50 pt-6">
            <button
              onClick={handleTestRag}
              disabled={testingRag}
              className="flex-1 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-xs font-bold tracking-widest shadow-lg transition-all active:scale-95"
            >
              测试检索通畅性
            </button>
            <button
              onClick={handleRebuildRag}
              disabled={rebuildingRag}
              className="flex-1 px-6 py-3 rounded-xl bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-50 text-xs font-bold tracking-widest transition-all active:scale-95 shadow-sm"
            >
              强制重建本地索引
            </button>
          </div>
          {ragTestResult && (
            <div className="mt-4 p-3 rounded-xl bg-stone-900 text-emerald-400 font-mono text-[10px] shadow-inner overflow-hidden animate-fade-in">
              <span className="opacity-50"># 日志输出 &gt;</span> {ragTestResult}
            </div>
          )}
        </div>
      </div>

      {/* 核心指令配置 */}
      <div className="mb-12 border-t border-slate-200 pt-10">
        <div className="flex items-center gap-3 mb-6 text-blue-500 font-bold">
          <Terminal size={18} />
          <span className="text-xs tracking-widest">核心系统指令集 (Directives)</span>
        </div>
        <div className="space-y-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-stone-800">
            <div className="flex items-center justify-between mb-3 px-1">
              <label className="text-xs font-bold text-slate-400 uppercase">对话总纲提示词</label>
              <div className="flex gap-2 text-[9px] font-bold text-slate-300">
                <span>{'{CHAR}'} 当前角色</span>
                <span>{'{SCRAPBOOK}'} 手札内容</span>
              </div>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs outline-none focus:border-blue-500 focus:bg-white transition-all font-serif resize-none h-40 shadow-inner leading-relaxed text-stone-800"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-stone-800">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <label className="block text-xs font-bold text-slate-400 mb-3 ml-1 text-stone-800">生图语义转换指令</label>
              <textarea
                value={naiTagPrompt}
                onChange={(e) => setNaiTagPrompt(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs outline-none focus:border-purple-500 focus:bg-white transition-all font-serif resize-none h-32 shadow-inner leading-relaxed text-stone-800"
              />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <label className="block text-xs font-bold text-slate-400 mb-3 ml-1 text-stone-800">灵感交流室 · 处理指令</label>
              <textarea
                value={ideaCultivatePrompt}
                onChange={(e) => setIdeaCultivatePrompt(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs outline-none focus:border-amber-500 focus:bg-white transition-all font-serif resize-none h-32 shadow-inner leading-relaxed text-stone-800"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 底部保存按钮 */}
      <div className="flex gap-4 border-t border-slate-200 pt-10 pb-8 text-stone-800">
        <button onClick={() => { saveAiEndpoints(aiEndpoints); saveNaiConfig(); }} className="flex-1 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-bold tracking-widest shadow-2xl transition-all hover:scale-[1.02] active:scale-95 border border-slate-700">保存并应用配置</button>
        <button onClick={() => setShowAiSettings(false)} className="flex-1 py-4 bg-white border border-stone-300 hover:bg-slate-50 text-slate-500 rounded-2xl text-sm font-bold tracking-widest transition-all">返回聊天界面</button>
      </div>
    </div>
  );
};

export default AiSettingsPanel;
