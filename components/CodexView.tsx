import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Universe, CodexEntry } from '../types';
import { Globe2, Clock, Shield, Scale, BookOpen, Users, ChevronDown } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X',
               'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];

const FACTION_PALETTES = [
  { from: '#1a0f00', to: '#2a1900', line: '#C5A059', text: '#e8d4a8' },
  { from: '#0d1520', to: '#172030', line: '#7c8fa8', text: '#b8cadb' },
  { from: '#1a0608', to: '#280a10', line: '#ef4444', text: '#f8b4b4' },
  { from: '#081a10', to: '#102818', line: '#22c55e', text: '#a7f3c0' },
  { from: '#100d1a', to: '#1a1428', line: '#a855f7', text: '#d4b8f8' },
  { from: '#1a0d0d', to: '#281414', line: '#f97316', text: '#fed7aa' },
];

const toRoman = (n: number) => ROMAN[n] ?? String(n + 1);

const SECTION_IDS = [
  { id: 'overview', icon: <Globe2 className="w-4 h-4" />, labelKey: 'codex.section.overview' as const },
  { id: 'timeline', icon: <Clock  className="w-4 h-4" />, labelKey: 'codex.section.chronicle' as const },
  { id: 'factions', icon: <Shield className="w-4 h-4" />, labelKey: 'codex.section.factions'  as const },
  { id: 'rules',    icon: <Scale  className="w-4 h-4" />, labelKey: 'codex.section.rules'     as const },
];

// ─── Sticky TOC ───────────────────────────────────────────────────────────────

type TranslateFn = (key: string) => string;

const StickyTOC: React.FC<{ active: string; onNav: (id: string) => void; universe: Universe; t: TranslateFn }> = ({ active, onNav, universe, t }) => (
  <aside className="hidden lg:block">
    <div className="sticky top-6 space-y-1">
      <div className="mb-5 px-4 py-3 bg-stone-900 rounded-xl border border-stone-800 text-center">
        <p className="text-[9px] uppercase tracking-[0.3em] text-nobel/50 mb-0.5">{t('codex.toc.universe')}</p>
        <p className="font-serif font-bold text-white text-sm leading-tight">{universe.name}</p>
      </div>

      {SECTION_IDS.map(s => (
        <button
          key={s.id}
          onClick={() => onNav(s.id)}
          className={`group w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-left text-sm transition-all duration-150 ${
            active === s.id
              ? 'bg-stone-900 text-white border border-stone-700'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
          }`}
        >
          <span className={active === s.id ? 'text-nobel' : 'text-stone-400 group-hover:text-stone-600'}>
            {s.icon}
          </span>
          <span className="font-medium">{t(s.labelKey)}</span>
          {active === s.id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-nobel" />}
        </button>
      ))}

      <div className="mt-6 pt-4 border-t border-stone-200 space-y-1.5">
        {[
          { icon: <Clock className="w-3 h-3" />,  val: universe.codex.timeline.length,  label: t('codex.toc.events') },
          { icon: <Shield className="w-3 h-3" />, val: universe.codex.factions.length,  label: t('codex.toc.factions') },
          { icon: <Scale className="w-3 h-3" />,  val: universe.codex.rules.length,     label: t('codex.toc.laws') },
          { icon: <Users className="w-3 h-3" />,  val: universe.characters?.length ?? 0, label: t('codex.toc.entities') },
        ].map(({ icon, val, label }) => (
          <div key={label} className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px]">{label}</span></div>
            <span className="text-[11px] font-mono font-bold text-stone-700">{val}</span>
          </div>
        ))}
      </div>
    </div>
  </aside>
);

// ─── Section wrapper ──────────────────────────────────────────────────────────

const SectionBlock: React.FC<{
  id: string;
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}> = ({ id, icon, title, count, children }) => (
  <section id={id} className="scroll-mt-6 mb-16">
    <div className="flex items-center gap-3 mb-6 pb-3 border-b border-stone-200">
      <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center text-nobel flex-shrink-0">
        {icon}
      </div>
      <h2 className="font-serif font-bold text-xl text-stone-900">{title}</h2>
      {count !== undefined && (
        <span className="ml-1 text-[10px] bg-stone-100 text-stone-400 font-mono px-2 py-0.5 rounded-full border border-stone-200">
          {count}
        </span>
      )}
    </div>
    {children}
  </section>
);

// ─── Overview ─────────────────────────────────────────────────────────────────

const OverviewSection: React.FC<{ universe: Universe; t: TranslateFn }> = ({ universe, t }) => (
  <SectionBlock id="overview" icon={<Globe2 className="w-4 h-4" />} title={t('codex.section.overview')}>
    <div className="relative rounded-2xl overflow-hidden mb-6 bg-stone-900" style={{ minHeight: 180 }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_0%,rgba(197,160,89,0.18),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_100%,rgba(100,80,40,0.15),transparent_60%)]" />
      <svg className="absolute right-0 top-0 w-48 h-48 opacity-[0.06]" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="80" stroke="#C5A059" strokeWidth="0.8" fill="none" strokeDasharray="3 6" />
        <circle cx="100" cy="100" r="55" stroke="#C5A059" strokeWidth="0.5" fill="none" />
        <circle cx="100" cy="100" r="30" stroke="#C5A059" strokeWidth="0.5" fill="none" strokeDasharray="1 4" />
        <line x1="20" y1="100" x2="180" y2="100" stroke="#C5A059" strokeWidth="0.4" />
        <line x1="100" y1="20" x2="100" y2="180" stroke="#C5A059" strokeWidth="0.4" />
      </svg>
      <div className="relative p-7 md:p-9">
        <p className="text-[9px] uppercase tracking-[0.35em] text-nobel/50 mb-2">{t('codex.hero.label')}</p>
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-white mb-3 leading-tight">{universe.name}</h1>
        {universe.description && (
          <p className="text-stone-300/90 font-serif italic text-base leading-relaxed max-w-2xl">
            "{universe.description}"
          </p>
        )}
      </div>
    </div>

    {universe.codex.overview ? (
      <div className="relative bg-amber-50/40 border border-amber-100 rounded-xl p-6 md:p-8">
        <div className="absolute left-0 top-6 bottom-6 w-0.5 bg-gradient-to-b from-transparent via-nobel/50 to-transparent rounded-full" />
        <p className="font-serif text-stone-700 leading-[1.9] text-[1.05rem] pl-4">
          {universe.codex.overview}
        </p>
      </div>
    ) : (
      <p className="italic text-stone-400 text-sm">{t('codex.empty.overview')}</p>
    )}
  </SectionBlock>
);

// ─── Timeline ─────────────────────────────────────────────────────────────────

const TimelineSection: React.FC<{ entries: CodexEntry[]; t: TranslateFn }> = ({ entries, t }) => (
  <SectionBlock id="timeline" icon={<Clock className="w-4 h-4" />} title={t('codex.sectionTitle.chronicle')} count={entries.length}>
    {entries.length === 0 ? (
      <p className="italic text-stone-400 text-sm">{t('codex.empty.chronicles')}</p>
    ) : (
      <div className="relative">
        <div className="absolute left-[22px] top-2 bottom-2 w-px bg-gradient-to-b from-nobel/60 via-stone-300 to-transparent" />
        <div className="space-y-0">
          {entries.map((entry, i) => (
            <motion.div
              key={entry.id}
              className="relative flex gap-5 pb-8 last:pb-0"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
            >
              <div className="relative flex-shrink-0 mt-1">
                <div className={`w-[45px] h-[45px] rounded-full flex items-center justify-center text-xs font-serif font-bold border-2 z-10 relative ${
                  i === 0
                    ? 'bg-stone-900 border-nobel text-nobel shadow-[0_0_12px_rgba(197,160,89,0.3)]'
                    : i === entries.length - 1 && entries.length > 1
                    ? 'bg-stone-800 border-stone-600 text-stone-300'
                    : 'bg-white border-stone-300 text-stone-600 shadow-sm'
                }`}>
                  {toRoman(i)}
                </div>
              </div>
              <div className={`flex-1 rounded-xl border p-4 mt-0.5 transition-all ${
                i === 0
                  ? 'bg-stone-900/5 border-stone-300 shadow-sm'
                  : 'bg-white border-stone-200 hover:border-stone-300 hover:shadow-sm'
              }`}>
                <h4 className="font-serif font-bold text-stone-900 text-sm mb-1.5 leading-snug">{entry.title}</h4>
                <p className="text-stone-500 text-xs leading-relaxed">{entry.content}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    )}
  </SectionBlock>
);

// ─── Factions ─────────────────────────────────────────────────────────────────

const FactionCard: React.FC<{ entry: CodexEntry; index: number }> = ({ entry, index }) => {
  const [open, setOpen] = useState(false);
  const palette = FACTION_PALETTES[index % FACTION_PALETTES.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="rounded-xl overflow-hidden border"
      style={{ borderColor: `${palette.line}30` }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left p-5 flex items-start gap-4"
        style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-lg font-serif font-bold mt-0.5"
          style={{ background: `${palette.line}22`, color: palette.line, border: `1px solid ${palette.line}44` }}
        >
          {entry.title[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-serif font-bold text-base leading-tight mb-1" style={{ color: palette.text }}>
            {entry.title}
          </p>
          {!open && (
            <p className="text-[11px] leading-relaxed line-clamp-1 opacity-70" style={{ color: palette.text }}>
              {entry.content}
            </p>
          )}
        </div>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 mt-1 transition-transform duration-200"
          style={{ color: palette.line, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 bg-white border-t" style={{ borderColor: `${palette.line}20` }}>
              <p className="font-serif text-stone-600 text-sm leading-relaxed">{entry.content}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const FactionsSection: React.FC<{ entries: CodexEntry[]; t: TranslateFn }> = ({ entries, t }) => (
  <SectionBlock id="factions" icon={<Shield className="w-4 h-4" />} title={t('codex.sectionTitle.factions')} count={entries.length}>
    {entries.length === 0 ? (
      <p className="italic text-stone-400 text-sm">{t('codex.empty.factionsSection')}</p>
    ) : (
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <FactionCard key={entry.id} entry={entry} index={i} />
        ))}
      </div>
    )}
  </SectionBlock>
);

// ─── Rules ────────────────────────────────────────────────────────────────────

const RulesSection: React.FC<{ entries: CodexEntry[]; t: TranslateFn }> = ({ entries, t }) => (
  <SectionBlock id="rules" icon={<Scale className="w-4 h-4" />} title={t('codex.sectionTitle.rules')} count={entries.length}>
    {entries.length === 0 ? (
      <p className="italic text-stone-400 text-sm">{t('codex.empty.rulesSection')}</p>
    ) : (
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <motion.div
            key={entry.id}
            className="group relative flex gap-5 bg-white border border-stone-200 rounded-xl p-5 hover:border-stone-300 hover:shadow-sm transition-all duration-200"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div className="flex-shrink-0 w-9 text-center pt-0.5">
              <span className="font-serif font-bold text-stone-200 text-2xl group-hover:text-stone-300 transition-colors select-none leading-none">
                {toRoman(i)}
              </span>
            </div>
            <div className="w-px bg-stone-100 group-hover:bg-nobel/30 transition-colors flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-serif font-bold text-stone-900 text-sm mb-1 leading-snug">{entry.title}</h4>
              <p className="text-stone-500 text-xs leading-relaxed">{entry.content}</p>
            </div>
          </motion.div>
        ))}
      </div>
    )}
  </SectionBlock>
);

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CodexView({ universe }: { universe: Universe; isLoading: boolean }) {
  const [activeSection, setActiveSection] = useState('overview');
  const { t } = useLanguage();

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSection(e.target.id);
        }
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 },
    );
    SECTION_IDS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const navTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-8 pb-5 border-b border-stone-200">
        <BookOpen className="w-6 h-6 text-nobel" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            {t('codex.title')} — <span className="text-nobel">{universe.name}</span>
          </h1>
          <p className="text-stone-400 text-sm mt-0.5">{t('codex.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
        <StickyTOC active={activeSection} onNav={navTo} universe={universe} t={t} />
        <main className="min-w-0">
          <OverviewSection universe={universe} t={t} />
          <TimelineSection entries={universe.codex.timeline} t={t} />
          <FactionsSection entries={universe.codex.factions} t={t} />
          <RulesSection entries={universe.codex.rules} t={t} />
        </main>
      </div>
    </div>
  );
}
