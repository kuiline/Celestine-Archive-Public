import React from 'react';

/** 从 App 抽离：手札编辑弹窗，行为与原 JSX 一致 */
export default function ScrapbookEditDialog({ draft, onDraftChange, onCancel, onSave }) {
  if (!draft) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-96 max-h-[80vh] flex flex-col overflow-hidden animate-fade-in">
        <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-amber-100">
          <div className="text-lg font-bold text-amber-900">编辑手札</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">标题</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => onDraftChange(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="输入手札标题"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">内容</label>
            <textarea
              value={draft.content}
              onChange={(e) => onDraftChange(prev => ({ ...prev, content: e.target.value }))}
              className="w-full h-40 px-3 py-2 rounded border border-slate-300 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-none"
              placeholder="输入手札内容"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">标签</label>
            <input
              type="text"
              value={draft.tags.join(', ')}
              onChange={(e) => onDraftChange(prev => ({
                ...prev,
                tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
              }))}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="用逗号分隔多个标签"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            className="flex-1 px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
