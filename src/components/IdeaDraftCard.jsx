import React, { useEffect, useState } from 'react';

const IdeaDraftCard = ({ draft, draftRaw, onRefine, onSave, disabled }) => {
  const [title, setTitle] = useState(draft?.title || '新设定草稿');
  const [text, setText] = useState(draft?.text || '');
  const [question, setQuestion] = useState(draft?.question || '');
  const [references, setReferences] = useState(Array.isArray(draft?.references) ? draft.references : []);
  const [rationale, setRationale] = useState(draft?.rationale || '');
  const [tagsText, setTagsText] = useState((draft?.tags || []).join(', '));
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setTitle(draft?.title || '新设定草稿');
    setText(draft?.text || '');
    setQuestion(draft?.question || '');
    setReferences(Array.isArray(draft?.references) ? draft.references : []);
    setRationale(draft?.rationale || '');
    setTagsText((draft?.tags || []).join(', '));
  }, [draftRaw]);

  return (
    <div className="w-full p-3 bg-amber-50 border border-amber-200/70 rounded-xl shadow-sm">
      <div className="text-[11px] tracking-wider text-amber-700 font-bold mb-2">灵感草稿缓冲区</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="草稿标题"
        className="w-full mb-2 px-2 py-1.5 rounded border border-amber-200 bg-white text-sm outline-none"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="AI 草稿内容"
        className="w-full min-h-[100px] mb-2 px-2 py-1.5 rounded border border-amber-200 bg-white text-sm outline-none resize-y whitespace-pre-wrap"
      />
      <div className="text-xs text-slate-600 mb-2">
        <span className="font-bold text-slate-700">AI 追问：</span>{question || '（暂无追问）'}
      </div>
      {references.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-xs font-bold text-slate-700">参考内容清单（可审计）</summary>
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600 space-y-1">
            {references.map((item, idx) => <li key={`${idx}_${item}`}>{item}</li>)}
          </ul>
        </details>
      )}
      {rationale && (
        <div className="mb-2 text-xs text-slate-600">
          <span className="font-bold text-slate-700">推演摘要：</span>{rationale}
        </div>
      )}
      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="你可以补一句反馈，例如：颜色偏深海蓝，声音更凄凉"
        className="w-full mb-2 px-2 py-1.5 rounded border border-amber-200 bg-white text-xs outline-none"
      />
      <input
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="标签（支持中英文逗号）：全局，角色:示例角色"
        className="w-full mb-2 px-2 py-1.5 rounded border border-amber-200 bg-white text-xs outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onRefine?.({ title, text, tagsText, feedback })}
          disabled={disabled || !feedback.trim()}
          className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors"
        >
          继续润色
        </button>
        <button
          onClick={() => onSave?.({ title, text, tagsText })}
          disabled={disabled || !text.trim()}
          className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors"
        >
          确定加入手札
        </button>
      </div>
    </div>
  );
};

export default IdeaDraftCard;
