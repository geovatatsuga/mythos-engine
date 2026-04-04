import React from 'react';
import type { View } from '../types';
import { ICONS } from '../constants';
import Tooltip from './ui/Tooltip';
import { Globe } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

interface SidebarProps {
  currentView: View;
  setCurrentView: (view: View) => void;
  universeExists: boolean;
}

const NavItem: React.FC<{
  view: View;
  label: string;
  currentView: View;
  onClick: (view: View) => void;
  disabled?: boolean;
}> = ({ view, label, currentView, onClick, disabled = false }) => {
  const isActive = currentView === view;

  return (
    <Tooltip content={label} position="right">
      <button
        onClick={() => !disabled && onClick(view)}
        disabled={disabled}
        className={`flex items-center justify-center w-12 h-12 rounded-lg transition-all duration-200 ease-in-out relative group
          ${
            isActive
              ? 'bg-primary text-white shadow-lg shadow-primary/30'
              : 'text-text-secondary hover:bg-paper hover:text-primary'
          }
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        `}
      >
        {ICONS[view]}
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white/30 rounded-r-full"></span>
        )}
      </button>
    </Tooltip>
  );
};

export default function Sidebar({ currentView, setCurrentView, universeExists }: SidebarProps) {
  const { t, lang, toggleLang } = useLanguage();
  const navItems: { view: View; label: string }[] = [
    { view: 'dashboard', label: t('nav.dashboard') },
    { view: 'codex', label: t('nav.codex') },
    { view: 'chapters', label: t('nav.chapters') },
    { view: 'assets', label: t('nav.assets') },
  ];

  return (
    <nav className="flex flex-col items-center gap-y-6 bg-surface p-4 border-r border-stone-200 shadow-sm z-20">
      <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-paper border border-nobel/20 text-primary">
        {ICONS.logo}
      </div>
      <div className="flex flex-col gap-y-4">
        {navItems.map(item => (
          <NavItem
            key={item.view}
            view={item.view}
            label={item.label}
            currentView={currentView}
            onClick={setCurrentView}
            disabled={item.view !== 'dashboard' && !universeExists}
          />
        ))}
      </div>

      <div className="mt-auto mb-14 flex flex-col items-center gap-2">
        <Tooltip content={lang === 'pt' ? 'Switch to English' : 'Mudar para Português'} position="right">
          <button
            onClick={toggleLang}
            className="w-12 flex flex-col items-center justify-center gap-1 py-2 rounded-xl border border-stone-200 bg-paper hover:bg-nobel/10 hover:border-nobel/50 transition-all group shadow-sm"
          >
            <Globe className="w-4 h-4 text-stone-400 group-hover:text-nobel transition-colors" />
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-stone-500 group-hover:text-nobel transition-colors leading-none">
              {lang === 'pt' ? 'PT' : 'EN'}
            </span>
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
