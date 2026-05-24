import React, { useState, useEffect } from 'react';

const DetailRow = ({ icon, label, value, onChange, isEdit, theme }) => {
  const isCustom = !!theme?.isCustom;
  const lightStyle = isCustom ? { color: theme.styles?.textLight } : undefined;
  const inputStyle = isCustom && isEdit ? { borderBottomColor: theme.styles?.borderColor } : undefined;

  const [localVal, setLocalVal] = useState(value || '');
  useEffect(() => { setLocalVal(value || ''); }, [value]);

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 group hover:bg-white/50 px-2 rounded transition-colors">
      <div className="flex items-center gap-3 text-slate-400">
        {React.cloneElement(icon, { size: 12, className: isCustom ? '' : theme.textLight, style: lightStyle })}
        <span className={`text-[10px] font-bold tracking-widest ${isCustom ? '' : theme.textLight}`} style={lightStyle}>{label}</span>
      </div>
      <div className="relative flex-1 ml-4">
        <input 
          type="text" 
          value={localVal} 
          onChange={(e) => setLocalVal(e.target.value)} 
          onBlur={(e) => onChange(e.target.value)}
          disabled={!isEdit} 
          className={`w-full text-right bg-transparent border-none outline-none text-slate-700 text-xs font-bold transition-all font-serif ${isEdit ? `border-b border-slate-300 ${isCustom ? '' : theme.inputBorder}` : ''}`} 
          style={inputStyle} 
        />
      </div>
    </div>
  );
};

export default DetailRow;
