
import React from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({ children, content, position = 'top', className }) => {
  const posMap: Record<string, string> = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-3',
    left:   'right-full top-1/2 -translate-y-1/2 mr-3',
  };

  return (
    <div className={`relative group ${className ?? ''}`}>
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-52 rounded-lg bg-stone-900 px-3 py-2.5
          text-[11px] leading-relaxed text-stone-200 shadow-xl border border-stone-700/50
          opacity-0 group-hover:opacity-100 transition-opacity duration-150
          ${posMap[position]}`}
      >
        {content}
      </div>
    </div>
  );
};

export default Tooltip;
