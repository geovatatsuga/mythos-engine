import React from 'react';

export const MeanderDivider: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex justify-center items-center py-8 opacity-40 ${className}`}>
    <svg width="200" height="20" viewBox="0 0 200 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 10H20V0H40V20H10V10H30V10H50V0H70V20H40V10H60V10H80V0H100V20H70V10H90V10H110V0H130V20H100V10H120V10H140V0H160V20H130V10H150V10H170V0H190V20H160V10H180V10H200" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />
    </svg>
  </div>
);
