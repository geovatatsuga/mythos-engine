import React from 'react';

export const AstrolabeSVG: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox="0 0 100 100" className={`pointer-events-none ${className}`} fill="none" stroke="currentColor" strokeWidth="0.5">
    <circle cx="50" cy="50" r="48" />
    <circle cx="50" cy="50" r="40" strokeDasharray="2 2" />
    <circle cx="50" cy="50" r="30" />
    <circle cx="50" cy="50" r="20" strokeDasharray="1 3" />
    <circle cx="50" cy="50" r="10" />
    
    <line x1="50" y1="2" x2="50" y2="98" />
    <line x1="2" y1="50" x2="98" y2="50" />
    
    <line x1="16" y1="16" x2="84" y2="84" />
    <line x1="16" y1="84" x2="84" y2="16" />
    
    <polygon points="50,20 80,50 50,80 20,50" />
    <polygon points="50,10 90,50 50,90 10,50" strokeDasharray="1 2" />
  </svg>
);
