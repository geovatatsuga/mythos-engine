
import React, { useState } from 'react';
import { hasAllApiKeys, loadApiKeys } from '../utils/apiKeys';
import { motion, AnimatePresence } from 'framer-motion';
import type { Universe, View, GenerationStep, StoryProfile, StoryFormat, StoryTheme, LiteraryArchetype, NarrativePOV } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';
import Tooltip from './ui/Tooltip';
import InlineHelp from './ui/InlineHelp';
import CharacterPortrait from './ui/CharacterPortrait';
import { BookOpen, Users, FileText, Sparkles, Clock, Zap, Hammer, Loader2, Download, Upload, Check, ArrowRight, Shuffle, Square, Globe } from 'lucide-react';
import type { AutogenProgress } from '../services/geminiService';
import { useLanguage } from '../LanguageContext';

// ─── Raw ID specs (labels come from i18n) ────────────────────────────────────

const FORMAT_SPECS: { id: StoryFormat; words: string }[] = [
  { id: 'light_novel', words: 'Diálogos rápidos' },
  { id: 'web_novel',   words: 'Cliffhangers' },
  { id: 'novel',       words: 'Prosa densa' },
];

const THEME_SPECS: { id: StoryTheme }[] = [
  { id: 'redenção' },
  { id: 'poder_e_corrupção' },
  { id: 'amor_proibido' },
  { id: 'identidade' },
  { id: 'vingança' },
  { id: 'revolução' },
  { id: 'sobrevivência' },
  { id: 'traição' },
];

const ARCHETYPE_SPECS: { id: LiteraryArchetype }[] = [
  { id: 'tolkien' }, { id: 'dostoevski' }, { id: 'shakespeare' },
  { id: 'realismo_magico' }, { id: 'opera_espacial' }, { id: 'isekai' },
  { id: 'romance_gothico' }, { id: 'noir' },
];

const TONE_SPECS: { id: StoryProfile['tone'] }[] = [
  { id: 'Sombrio' }, { id: 'Épico' }, { id: 'Misterioso' },
  { id: 'Dramático' }, { id: 'Lírico' }, { id: 'Humorístico' },
];

const POV_SPECS: { id: NarrativePOV }[] = [
  { id: 'primeira_pessoa' },
  { id: 'terceiro_limitado' },
  { id: 'terceiro_onisciente' },
];

const DEFAULT_PROFILE: StoryProfile = {
  themes: [],
  archetypes: [],
};

const FORGE_PANEL_WIDTH_CLASS = 'w-full max-w-[860px]';

// ─── Randomize helpers ────────────────────────────────────────────────────────
const randomFrom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomN = <T,>(arr: T[], min: number, max: number): T[] => {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, min + Math.floor(Math.random() * (max - min + 1)));
};

const RANDOM_PREMISES_PT = [
  'Uma escola de magia escondida no Rio de Janeiro onde os alunos descobrem que os Orixás ainda interferem no mundo moderno.',
  'Um detetive imortal em Tóquio que investiga crimes cometidos por entidades do folclore japonês.',
  'Um império espacial decadente onde a magia e a tecnologia são a mesma coisa — e ambas estão falhando.',
  'Duas nações em guerra secreta dentro das ruínas de uma civilização submarina esquecida.',
  'Um jovem camponês descobre que os monstros que assombram sua aldeia são, na verdade, refugiados de outro mundo.',
  'Uma corte imperial onde cada aristocrata possui um espelho que mostra sua versão mais sombria.',
  'Um grupo de escritores que percebe que seus personagens estão escapando para o mundo real à noite.',
  'Uma irmandade de assassinos que só mata pessoas que pediram para morrer — e investigam por quê.',
  'Uma cidade flutuante mantida no ar pela vida de um único imortal que deseja morrer.',
  'Heróis de uma profecia que falham — e o que acontece com o mundo depois.',
];

const RANDOM_PREMISES_EN = [
  'A magic academy hidden in Rio de Janeiro where students discover the Orixás still interfere with the modern world.',
  'An immortal detective in Tokyo who investigates crimes committed by creatures from Japanese folklore.',
  'A decaying space empire where magic and technology are the same thing — and both are failing.',
  'Two nations at secret war within the ruins of a forgotten underwater civilization.',
  'A young peasant discovers the monsters haunting his village are actually refugees from another world.',
  'An imperial court where every aristocrat owns a mirror that shows their darkest version.',
  'A group of writers who realize their characters are escaping into the real world at night.',
  'A brotherhood of assassins who only kill people who asked to die — and investigate why.',
  'A floating city kept airborne by the life of a single immortal who wishes to die.',
  'Heroes of a prophecy who fail — and what happens to the world afterward.',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const PillToggle = <T extends string>({
  options, selected, onToggle, max, dark = false
}: {
  options: { id: T; label: string; emoji?: string; desc?: string }[];
  selected: T[];
  onToggle: (id: T) => void;
  max?: number;
  dark?: boolean;
}) => (
  <div className="flex flex-wrap gap-2">
    {options.map(opt => {
      const active = selected.includes(opt.id);
      const disabled = !active && max !== undefined && selected.length >= max;
      const btn = (
        <button
          onClick={() => !disabled && onToggle(opt.id)}
          disabled={disabled}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all duration-200
            ${active
              ? 'bg-nobel border-nobel text-white shadow-md shadow-nobel/30'
              : dark
                ? 'border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-30'
                : 'border-stone-300 text-stone-600 hover:border-stone-500 hover:text-stone-800 disabled:opacity-30'
            }
          `}
        >
          {opt.emoji && <span className="text-xs">{opt.emoji}</span>}
          <span>{opt.label}</span>
          {active && <Check className="w-3 h-3" />}
        </button>
      );
      return opt.desc ? (
        <Tooltip key={opt.id} content={opt.desc} position="top">
          {btn}
        </Tooltip>
      ) : (
        <React.Fragment key={opt.id}>{btn}</React.Fragment>
      );
    })}
  </div>
);

const ForgeProfilePanel: React.FC<{
  profile: StoryProfile;
  onChange: (p: StoryProfile) => void;
  onGenerate: () => void;
  isLoading: boolean;
  footerContent?: React.ReactNode;
}> = ({ profile, onChange, onGenerate, isLoading, footerContent }) => {
  const { t, lang } = useLanguage();

  // Build translated option lists
  const formats = FORMAT_SPECS.map(f => ({ ...f, label: t(`fmt.${f.id}.label`), sub: t(`fmt.${f.id}.sub`), tooltip: t(`fmt.${f.id}.tooltip`) }));
  const themes  = THEME_SPECS.map(th => ({ ...th, label: t(`theme.${th.id}`), desc: t(`theme.${th.id}.tooltip`) }));
  const archetypes = ARCHETYPE_SPECS.map(a => ({ ...a, label: t(`arch.${a.id}`), desc: t(`arch.${a.id}.tooltip`) }));
  const tones   = TONE_SPECS.map(tn => ({ ...tn, label: t(`tone.${tn.id}`), desc: t(`tone.${tn.id}.tooltip`) }));
  const povs    = POV_SPECS.map(p => ({ id: p.id, label: t(`pov.${p.id}.label`), desc: t(`pov.${p.id}.desc`), tooltip: t(`pov.${p.id}.tooltip`) }));

  const set = <K extends keyof StoryProfile>(key: K, val: StoryProfile[K]) =>
    onChange({ ...profile, [key]: val });

  const toggleTheme = (id: StoryTheme) => {
    const has = profile.themes.includes(id);
    set('themes', has ? profile.themes.filter(t => t !== id) : [...profile.themes, id]);
  };

  const toggleArchetype = (id: LiteraryArchetype) => {
    const has = profile.archetypes.includes(id);
    set('archetypes', has ? profile.archetypes.filter(a => a !== id) : [...profile.archetypes, id]);
  };

  const randomizeAll = () => {
    const premises = lang === 'pt' ? RANDOM_PREMISES_PT : RANDOM_PREMISES_EN;
    onChange({
      premise: randomFrom(premises),
      format: randomFrom(FORMAT_SPECS).id,
      tone: randomFrom(TONE_SPECS).id,
      themes: randomN(THEME_SPECS, 1, 3).map(x => x.id),
      archetypes: randomN(ARCHETYPE_SPECS, 1, 3).map(x => x.id),
      pov: randomFrom(POV_SPECS).id,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`${FORGE_PANEL_WIDTH_CLASS} bg-white border border-stone-200 rounded-2xl shadow-xl`}
    >
      {/* Header */}
      <div className="bg-stone-900 px-6 py-4 flex items-center justify-between rounded-t-2xl">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-nobel mb-0.5">{t('forge.title')}</p>
          <h3 className="text-white font-serif text-lg leading-tight">{t('forge.subtitle')}</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={randomizeAll}
            title={t('forge.randomizeAll')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-stone-600 text-stone-400 hover:border-nobel hover:text-nobel text-xs transition-all duration-200"
          >
            <Shuffle className="w-3 h-3" />
            <span className="hidden sm:inline">{t('forge.randomizeAll')}</span>
          </button>
          <Sparkles className="w-5 h-5 text-nobel" />
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* STORY LANGUAGE */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-500 flex items-center gap-1.5 mb-3">
            <Globe className="w-3 h-3 text-nobel" />
            {t('forge.lang')}
          </label>
          <div className="flex gap-2">
            {(['pt', 'en'] as const).map(code => (
              <button
                key={code}
                onClick={() => set('lang', profile.lang === code ? undefined : code)}
                className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-all duration-200 ${
                  profile.lang === code
                    ? 'border-nobel bg-amber-50 text-stone-900 shadow-sm'
                    : 'border-stone-200 text-stone-600 hover:border-stone-400'
                }`}
              >
                {t(`forge.lang.${code}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-stone-100" />

        {/* PREMISE */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-nobel" />
              {t('forge.premise')}
              <InlineHelp content={t('help.dashboard.premise')} />
            </label>
            <button
              onClick={() => {
                const premises = lang === 'pt' ? RANDOM_PREMISES_PT : RANDOM_PREMISES_EN;
                set('premise', randomFrom(premises));
              }}
              className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-nobel transition-colors"
            >
              <Shuffle className="w-3 h-3" />{t('forge.randomizePremise')}
            </button>
          </div>
          <textarea
            value={profile.premise ?? ''}
            onChange={e => set('premise', e.target.value)}
            placeholder={t('forge.premisePlaceholder')}
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 hover:border-stone-400 focus:border-nobel focus:ring-1 focus:ring-nobel/30 outline-none resize-none text-sm text-stone-800 placeholder:text-stone-400 transition-colors"
          />
          <p className="text-[11px] text-stone-400 mt-1 font-serif italic">{t('forge.premiseHint')}</p>
        </div>

        <div className="border-t border-stone-100" />

        {/* FORMAT */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500">{t('forge.format')}</label>
            <button onClick={() => set('format', randomFrom(FORMAT_SPECS).id)} className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-600 transition-colors">
              <Shuffle className="w-3 h-3" />{t('forge.randomizeSection')}
            </button>
          </div>
          {!profile.format && (
            <p className="text-[11px] text-stone-400 italic">{t('forge.anyRandom')}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {formats.map(f => (
              <Tooltip key={f.id} content={f.tooltip} position="top">
                <button
                  onClick={() => set('format', profile.format === f.id ? undefined : f.id)}
                  className={`w-full h-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                    profile.format === f.id
                      ? 'border-nobel bg-amber-50 shadow-sm'
                      : 'border-stone-200 hover:border-stone-400'
                  }`}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-1.5">
                    <span className={`text-base font-semibold leading-none ${
                      profile.format === f.id ? 'text-stone-900' : 'text-stone-700'
                    }`}>{f.label}</span>
                    <span className="text-[11px] text-stone-400 font-mono tracking-wide sm:text-right">{f.words}</span>
                  </div>
                  <span className="text-sm text-stone-500 leading-snug block">{f.sub}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* TONE */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500">{t('forge.tone')}</label>
            <button onClick={() => set('tone', randomFrom(TONE_SPECS).id)} className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-600 transition-colors">
              <Shuffle className="w-3 h-3" />{t('forge.randomizeSection')}
            </button>
          </div>
          {!profile.tone && <p className="text-[11px] text-stone-400 italic mb-2">{t('forge.anyRandom')}</p>}
          <PillToggle
            options={tones}
            selected={profile.tone ? [profile.tone] : []}
            onToggle={(id) => set('tone', profile.tone === id ? undefined : id)}
            max={1}
          />
        </div>

        {/* THEMES */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500">
              {t('forge.themes')} <span className="text-stone-400 font-normal normal-case">({t('forge.themesMax')})</span>
            </label>
            <button onClick={() => set('themes', randomN(THEME_SPECS, 1, 3).map(x => x.id))} className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-600 transition-colors">
              <Shuffle className="w-3 h-3" />{t('forge.randomizeSection')}
            </button>
          </div>
          <PillToggle
            options={themes}
            selected={profile.themes}
            onToggle={toggleTheme}
            max={3}
          />
        </div>

        {/* ARCHETYPES */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500">
              {t('forge.archetypes')} <span className="text-stone-400 font-normal normal-case">({t('forge.archetypesMax')})</span>
            </label>
            <button onClick={() => set('archetypes', randomN(ARCHETYPE_SPECS, 1, 3).map(x => x.id))} className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-600 transition-colors">
              <Shuffle className="w-3 h-3" />{t('forge.randomizeSection')}
            </button>
          </div>
          <PillToggle
            options={archetypes}
            selected={profile.archetypes}
            onToggle={toggleArchetype}
            max={3}
          />
        </div>

        {/* POV */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold uppercase tracking-widest text-stone-500">{t('forge.pov')}</label>
            <button onClick={() => set('pov', randomFrom(POV_SPECS).id)} className="flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-600 transition-colors">
              <Shuffle className="w-3 h-3" />{t('forge.randomizeSection')}
            </button>
          </div>
          {!profile.pov && <p className="text-[11px] text-stone-400 italic mb-2">{t('forge.anyRandom')}</p>}
          <div className="flex gap-2 flex-wrap">
            {povs.map(p => (
              <Tooltip key={p.id} content={p.tooltip} position="top">
                <button
                  onClick={() => set('pov', profile.pov === p.id ? undefined : p.id)}
                  className={`px-3 py-2 rounded-lg border text-left transition-all duration-200 ${
                    profile.pov === p.id ? 'border-nobel bg-amber-50' : 'border-stone-200 hover:border-stone-400'
                  }`}
                >
                  <div className={`text-sm font-semibold ${
                    profile.pov === p.id ? 'text-stone-900' : 'text-stone-700'
                  }`}>{p.label}</div>
                  <div className="text-[11px] text-stone-500">{p.desc}</div>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="px-6 py-4 bg-stone-50 border-t border-stone-100 rounded-b-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-stone-400 font-serif italic">
              {profile.themes.length === 0 && profile.archetypes.length === 0 && !profile.format && !profile.tone && !profile.pov
                ? t('forge.footerFree')
                : `${profile.themes.length} ${t('forge.themes').toLowerCase()} - ${profile.archetypes.length} ${t('forge.archetypes').toLowerCase()}`
              }
            </p>
            {footerContent}
          </div>
          <Button onClick={onGenerate} isLoading={isLoading} className="bg-stone-900 text-white hover:bg-black self-start md:self-auto">
            <Sparkles className="w-4 h-4 mr-2" />
            {t('forge.cta')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

interface DashboardProps {
  universe: Universe | null;
  onBuildUniverseManual?: (name: string, description: string) => void;
  onDivineGenesis?: (profile: StoryProfile) => void;
  onAutoGen?: (profile: StoryProfile, chaptersCount: number) => void;
  onAbortAutoGen?: () => void;
  onGenerateCharacter?: () => void;
  onGenerateChapter?: () => void;
  setCurrentView?: (view: View) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
  isLoading: boolean;
  genesisStep?: GenerationStep;
  autoGenProgress?: AutogenProgress | null;
}

const AUTOGEN_CHAPTER_OPTIONS = [2, 3];

const AutogenProgressOverlay: React.FC<{ progress: AutogenProgress; onAbort: () => void }> = ({ progress, onAbort }) => {
    const { lang } = useLanguage();
    const allDone = progress.phase === 'done';
    const aborted = progress.phase === 'aborted';

    const phaseLabel = progress.phase === 'director'
        ? (lang === 'pt' ? 'Director analisando narrativa...' : 'Director analysing narrative...')
        : progress.phase === 'weaver'
        ? (lang === 'pt' ? 'Weaver planejando...' : 'Weaver planning...')
        : progress.phase === 'bard'
        ? (lang === 'pt' ? 'Bard escrevendo...' : 'Bard writing...')
        : progress.phase === 'chronicler'
        ? (lang === 'pt' ? 'Chronicler atualizando...' : 'Chronicler updating...')
        : '';

    return (
        <div className="fixed inset-0 bg-paper/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8">
            <div className="max-w-md w-full space-y-6">
                <Zap className="w-12 h-12 text-nobel mx-auto animate-pulse" />
                <h2 className="text-2xl font-serif text-center text-stone-dark">
                    {allDone
                        ? (lang === 'pt' ? 'Geração concluída!' : 'Generation complete!')
                        : aborted
                        ? (lang === 'pt' ? 'Motor interrompido' : 'Engine stopped')
                        : (lang === 'pt' ? 'Motor Autônomo rodando...' : 'Autonomous Engine running...')}
                </h2>

                <div className="space-y-3">
                    {Array.from({ length: progress.totalChapters }).map((_, i) => {
                        const isPast = i < progress.chaptersDone;
                        const isCurrent = !allDone && !aborted && i === progress.chaptersDone;
                        return (
                            <div key={i} className={`flex items-center gap-3 transition-all ${isCurrent ? 'text-nobel font-bold' : isPast ? 'text-stone-500' : 'text-stone-300'}`}>
                                {isPast
                                    ? <div className="w-4 h-4 rounded-full bg-green-400 flex-shrink-0" />
                                    : isCurrent
                                    ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                                    : <div className="w-4 h-4 rounded-full border border-stone-200 flex-shrink-0" />
                                }
                                <span>
                                    {lang === 'pt' ? `Capítulo ${i + 1}` : `Chapter ${i + 1}`}
                                    {isCurrent && <span className="text-xs font-normal ml-2 text-stone-400">{phaseLabel}</span>}
                                    {isPast && <span className="text-xs font-normal ml-2 text-green-500">✓</span>}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {!allDone && !aborted && (
                    <button onClick={onAbort} className="w-full flex items-center justify-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors py-2">
                        <Square className="w-3 h-3" /> {lang === 'pt' ? 'Parar motor' : 'Stop engine'}
                    </button>
                )}
                <p className="text-center text-xs text-stone-400 font-serif italic">
                    {lang === 'pt' ? 'Cada capítulo é salvo automaticamente.' : 'Each chapter is saved automatically.'}
                </p>
            </div>
        </div>
    );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({ icon, label, value }) => (
  <Card withAstrolabe className="flex flex-col items-center justify-center p-4 text-center transition-transform duration-300 hover:scale-105 hover:shadow-md border-stone-200">
    <div className="text-secondary mb-2">{icon}</div>
    <p className="text-2xl font-serif font-bold text-stone-dark">{value}</p>
    <p className="text-text-secondary text-xs uppercase tracking-widest">{label}</p>
  </Card>
);

const GenesisProgress: React.FC<{ step: GenerationStep }> = ({ step }) => {
    const { t } = useLanguage();
    const steps = [
        { id: 'anchors',       label: t('genesis.step.anchors') },
        { id: 'characters',    label: t('genesis.step.characters') },
        { id: 'writing_intro', label: t('genesis.step.writing_intro') },
        { id: 'chronicler',    label: t('genesis.step.chronicler') },
    ];

    return (
        <div className="fixed inset-0 bg-paper/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8">
            <div className="max-w-md w-full space-y-6">
                <Sparkles className="w-12 h-12 text-nobel animate-spin-slow mx-auto" />
                <h2 className="text-2xl font-serif text-center text-stone-dark">{t('genesis.title')}</h2>
                <div className="space-y-4">
                    {steps.map((s, idx) => {
                        const isActive = s.id === step;
                        // Simple logic: if step is later in array than current, it's waiting. If earlier, done.
                        const stepIndex = steps.findIndex(x => x.id === step);
                        const myIndex = idx;
                        let statusClass = "text-stone-300";
                        let icon = <div className="w-4 h-4 rounded-full border border-stone-200" />;
                        
                        if (myIndex < stepIndex) {
                            statusClass = "text-stone-500 line-through";
                            icon = <div className="w-4 h-4 rounded-full bg-nobel" />;
                        } else if (myIndex === stepIndex) {
                            statusClass = "text-nobel font-bold";
                            icon = <Loader2 className="w-4 h-4 animate-spin" />;
                        }

                        return (
                            <div key={s.id} className={`flex items-center space-x-3 transition-all ${statusClass}`}>
                                {icon}
                                <span>{s.label}</span>
                            </div>
                        );
                    })}
                </div>
                <p className="text-center text-xs text-stone-400 mt-8">{t('genesis.sub')}</p>
            </div>
        </div>
    );
};

export default function Dashboard({
    universe,
    onBuildUniverseManual,
    onDivineGenesis,
    onAutoGen,
    onAbortAutoGen,
    onGenerateCharacter,
    onGenerateChapter,
    setCurrentView,
    onExport,
    onImport,
    isLoading,
    genesisStep = 'idle',
    autoGenProgress,
}: DashboardProps) {
  const { t, lang } = useLanguage();
  const [activePath, setActivePath] = useState<null | 'architect' | 'genesis' | 'autogen'>(null);
  const [universeName, setUniverseName] = useState('');
  const [universeDesc, setUniverseDesc] = useState('');
  const [profile, setProfile] = useState<StoryProfile>(() => ({ ...DEFAULT_PROFILE, lang: lang as 'pt' | 'en' }));
  const [autoGenChapters, setAutoGenChapters] = useState(3);
  const apiKeysFilled = hasAllApiKeys(loadApiKeys());

  // SHOW AUTOGEN PROGRESS OVERLAY
  if (autoGenProgress && autoGenProgress.phase !== 'done') {
      return <AutogenProgressOverlay progress={autoGenProgress} onAbort={() => onAbortAutoGen?.()} />;
  }

  // SHOW PROGRESS OVERLAY IF GENESIS IS RUNNING
  if (genesisStep !== 'idle' && genesisStep !== 'done') {
      return <GenesisProgress step={genesisStep} />;
  }

  // ── State 1: Welcome — Choose Your Path ─────────────────────────────────────
  if (!universe) {
    // Checa se todas as API keys estão preenchidas
    // Bloqueia inicialização se qualquer key existir no .env
    const canStartManual = universeName.trim().length > 0 && apiKeysFilled;

    return (
      <div className="flex flex-col items-center justify-center min-h-full py-10 px-4">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-5 border border-nobel/20">
            <Sparkles className="h-7 w-7 text-nobel" />
          </div>
          <h1 className="text-4xl font-serif font-bold text-stone-dark mb-2">Mythos Engine</h1>
          <p className="text-stone-500 text-sm max-w-sm mx-auto leading-relaxed">
            {t('dash.subtitle')}
          </p>
        </div>

        {/* Path Cards */}
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-5 ${FORGE_PANEL_WIDTH_CLASS} mb-0`}>
          {[
            {
              id: 'architect' as const,
              icon: <Hammer className="w-8 h-8" />,
              title: t('dash.architect.title'),
              tagline: t('dash.architect.tagline'),
              desc: t('dash.architect.desc'),
              accentClass: 'border-stone-400 from-stone-50',
              iconClass: 'text-stone-600',
              activeClass: 'border-stone-700 shadow-md',
            },
            {
              id: 'genesis' as const,
              icon: <Zap className="w-8 h-8" />,
              title: t('dash.genesis.title'),
              tagline: t('dash.genesis.tagline'),
              desc: t('dash.genesis.desc'),
              accentClass: 'border-nobel/40 from-amber-50/40',
              iconClass: 'text-nobel',
              activeClass: 'border-nobel shadow-lg shadow-nobel/10',
              badge: 'AI',
            },
            {
              id: 'autogen' as const,
              icon: <Zap className="w-8 h-8" />,
              title: lang === 'pt' ? 'Motor Autônomo' : 'Autonomous Engine',
              tagline: lang === 'pt' ? 'Genesis + N Capítulos' : 'Genesis + N Chapters',
              desc: lang === 'pt'
                  ? 'Cria o universo e escreve múltiplos capítulos em sequência, sem intervenção.'
                  : 'Creates the universe and writes multiple chapters in sequence, unattended.',
              accentClass: 'border-stone-400 from-stone-50',
              iconClass: 'text-stone-600',
              activeClass: 'border-stone-700 shadow-md',
              badge: 'AUTO',
            },
          ].map(card => {
            const isActive = activePath === card.id;
            return (
              <button
                key={card.id}
                onClick={() => setActivePath(isActive ? null : card.id)}
                className={`
                  relative text-left p-6 rounded-2xl border-2 bg-gradient-to-br transition-all duration-300
                  ${card.accentClass}
                  ${isActive ? card.activeClass : 'hover:shadow-md hover:border-stone-300'}
                `}
              >
                {card.badge && (
                  <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest bg-nobel text-white px-2 py-0.5 rounded-full">
                    {card.badge}
                  </span>
                )}
                <div className={`mb-4 ${card.iconClass} ${isActive ? '' : 'opacity-70'}`}>
                  {card.icon}
                </div>
                <h3 className="font-serif text-xl font-bold text-stone-dark mb-0.5">{card.title}</h3>
                <div className={`mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${card.id === 'genesis' || card.id === 'autogen' ? 'text-nobel' : 'text-stone-400'}`}>
                  <span>{card.tagline}</span>
                  {card.id === 'genesis' && <InlineHelp content={t('help.dashboard.genesis')} />}
                  {card.id === 'autogen' && <InlineHelp content={t('help.dashboard.autogen')} />}
                </div>
                <p className="text-stone-500 text-sm leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Expanded Panel */}
        <div className={`${FORGE_PANEL_WIDTH_CLASS} mt-5`}>
          <AnimatePresence mode="wait">
            {activePath === 'architect' && (
              <motion.div
                key="architect-panel"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="bg-white border border-stone-200 rounded-2xl shadow-lg overflow-hidden"
              >
                <div className="bg-stone-900 px-6 py-4 flex items-center gap-3">
                  <Hammer className="w-5 h-5 text-stone-400" />
                  <div>
                    <p className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-0.5">{t('dash.arch.panelTitle')}</p>
                    <h3 className="text-white font-serif text-base leading-tight">{t('dash.arch.panelSub')}</h3>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">
                      {t('dash.arch.nameLabel')} <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={universeName}
                      onChange={e => setUniverseName(e.target.value)}
                      placeholder={t('dash.arch.namePlaceholder')}
                      className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400/50 font-serif text-sm text-stone-800 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">
                      {t('dash.arch.descLabel')}
                    </label>
                    <textarea
                      value={universeDesc}
                      onChange={e => setUniverseDesc(e.target.value)}
                      placeholder={t('dash.arch.descPlaceholder')}
                      rows={3}
                      className="w-full px-4 py-2.5 border border-stone-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-stone-400/50 font-serif text-sm text-stone-800 leading-relaxed bg-white"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 bg-stone-50 border-t border-stone-100 flex items-center gap-3">
                  {!apiKeysFilled && (
                    <p className="text-xs text-amber-700 font-medium">
                      {lang === 'pt'
                        ? 'Este usu&aacute;rio precisa salvar as API Keys no navegador antes de iniciar o engine.'
                        : 'This user must save API keys in the browser before starting the engine.'}
                    </p>
                  )}
                  {/* Import */}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) onImport?.(file);
                        e.target.value = '';
                      }}
                    />
                    <span className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors border border-stone-200 rounded-md px-3 py-2 bg-white hover:bg-stone-50">
                      <Upload className="w-3.5 h-3.5" />
                      {t('dash.arch.import')}
                    </span>
                  </label>

                  <Button
                    onClick={() => onBuildUniverseManual?.(universeName.trim(), universeDesc.trim())}
                    disabled={!canStartManual}
                    isLoading={isLoading}
                    className="ml-auto bg-stone-900 text-white hover:bg-black"
                  >
                    {apiKeysFilled ? t('dash.arch.cta') : (lang === 'pt' ? 'Salve as API Keys' : 'Save API Keys')}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {activePath === 'genesis' && (
              <motion.div
                key="genesis-panel"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="flex justify-center"
              >
                <ForgeProfilePanel
                  profile={profile}
                  onChange={setProfile}
                  onGenerate={() => onDivineGenesis?.(profile)}
                  isLoading={isLoading}
                />
              </motion.div>
            )}

            {activePath === 'autogen' && (
              <motion.div
                key="autogen-panel"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="flex justify-center"
              >
                <ForgeProfilePanel
                  profile={profile}
                  onChange={setProfile}
                  onGenerate={() => onAutoGen?.(profile, autoGenChapters)}
                  isLoading={isLoading}
                  footerContent={
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <span className="text-xs font-bold uppercase tracking-widest text-stone-500">
                        {lang === 'pt' ? 'Capítulos totais:' : 'Total chapters:'}
                      </span>
                      <div className="flex items-center gap-2">
                        {AUTOGEN_CHAPTER_OPTIONS.map(n => (
                          <button
                            key={n}
                            onClick={() => setAutoGenChapters(n)}
                            className={`min-w-[42px] h-10 px-3 rounded-xl border text-sm font-bold transition-all ${
                              autoGenChapters === n
                                ? 'border-nobel bg-amber-50 text-stone-900 shadow-sm'
                                : 'border-stone-300 text-stone-500 hover:border-stone-500'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // State 3: Main Dashboard
  if (universe) {
    const visualAssets = universe.assets?.visual ?? [];
    const chapters = universe.chapters ?? [];
    const characters = universe.characters ?? [];
    const codex = universe.codex ?? { factions: [], rules: [], timeline: [] };
    const latestImage = visualAssets[visualAssets.length - 1]?.url;
    const latestChapter = chapters[chapters.length - 1];
    const latestChapterTitle = typeof latestChapter?.title === 'string' && latestChapter.title.trim().length > 0
        ? latestChapter.title
        : 'Capítulo sem título';
    const latestChapterPreview = typeof latestChapter?.content === 'string' && latestChapter.content.trim().length > 0
        ? latestChapter.content.replace(/<[^>]*>?/gm, '')
        : (typeof latestChapter?.summary === 'string' && latestChapter.summary.trim().length > 0
            ? latestChapter.summary
            : t('dash3.blank'));
    const protagonist = characters.find(character => character.role === 'Protagonista') || characters[0] || null;
    const recentCharacters = [...characters].reverse().slice(0, 5);

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            {/* 1. Epic Hero Banner with Animated Mini-Astrolabe */}
            <div className="relative w-full h-80 md:h-96 rounded-2xl overflow-hidden shadow-2xl group border border-stone-800">
                {latestImage ? (
                    <img src={latestImage} alt="Universe" className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-stone-900 to-stone-800" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent" />
                
                {/* Animated Mini-Astrolabe Background */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-10 pointer-events-none animate-[spin_60s_linear_infinite]">
                    <svg viewBox="0 0 100 100" className="w-full h-full stroke-[#C5A059] fill-none" strokeWidth="0.2">
                        <circle cx="50" cy="50" r="40" strokeDasharray="1 2" />
                        <circle cx="50" cy="50" r="30" />
                        <circle cx="50" cy="50" r="20" strokeDasharray="4 1" />
                        <line x1="10" y1="50" x2="90" y2="50" />
                        <line x1="50" y1="10" x2="50" y2="90" />
                        <circle cx="50" cy="10" r="1" fill="#C5A059" />
                        <circle cx="90" cy="50" r="1" fill="#C5A059" />
                        <circle cx="50" cy="90" r="1" fill="#C5A059" />
                        <circle cx="10" cy="50" r="1" fill="#C5A059" />
                    </svg>
                </div>

                <div className="absolute bottom-0 left-0 p-8 md:p-12 w-full">
                    <h1 className="text-5xl md:text-7xl font-serif font-bold text-white mb-4 drop-shadow-lg tracking-tight">{universe.name}</h1>
                    <p className="text-stone-300 max-w-2xl text-lg md:text-xl drop-shadow-md font-serif italic">"{universe.description}"</p>
                </div>
                {onExport && (
                    <button
                        onClick={onExport}
                        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 text-xs bg-black/40 hover:bg-black/60 text-white px-3 py-1.5 rounded-full backdrop-blur-sm transition-colors border border-white/10"
                    >
                        <Download className="w-3 h-3" /> {t('dash3.export')}
                    </button>
                )}
            </div>

            {/* Bento Box Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[180px]">
                
                {/* Card 1: The Chronicles (Latest Chapter) */}
                <Card className="col-span-1 md:col-span-2 lg:col-span-2 row-span-2 p-8 flex flex-col justify-between relative overflow-hidden group border-stone-200 hover:border-nobel/50 transition-colors bg-white">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-nobel/5 rounded-bl-full -z-10 transition-transform duration-700 group-hover:scale-125" />
                    <div>
                        <div className="flex items-center text-nobel mb-6">
                            <BookOpen className="w-5 h-5 mr-2" />
                            <h3 className="text-xs font-bold uppercase tracking-widest">{t('dash3.chronicles')}</h3>
                        </div>
                        {latestChapter ? (
                            <>
                                <h2 className="text-3xl font-serif font-bold text-stone-dark mb-4 group-hover:text-nobel transition-colors">{latestChapterTitle}</h2>
                                <p className="text-stone-600 font-serif leading-relaxed line-clamp-4 text-lg">
                                    {latestChapterPreview}
                                </p>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-stone-400 mt-12">
                                <FileText className="w-12 h-12 mb-4 opacity-50" />
                                <p className="font-serif italic">{t('dash3.noChapters')}</p>
                            </div>
                        )}
                    </div>
                    <div className="mt-8 flex gap-4">
                        <Button onClick={() => onGenerateChapter && onGenerateChapter()} isLoading={isLoading} className="bg-stone-900 text-white hover:bg-stone-800 shadow-lg">
                            <Sparkles className="w-4 h-4 mr-2" /> {t('dash3.draftChapter')}
                        </Button>
                        <Button variant="secondary" onClick={() => setCurrentView?.('chapters')}>
                            {t('dash3.viewArchives')}
                        </Button>
                    </div>
                </Card>

                {/* Card 2: Protagonist Spotlight */}
                <Card className="col-span-1 md:col-span-1 lg:col-span-1 row-span-2 p-0 relative overflow-hidden group border-stone-200 cursor-pointer" onClick={() => setCurrentView?.('characters')}>
                  {protagonist ? (
                    <div className="h-full flex flex-col bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950">
                      <div className="relative flex-1 overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#c5a05922_0%,transparent_60%)]" />
                        <CharacterPortrait
                          name={protagonist.name}
                          imageUrl={protagonist.imageUrl}
                          role={protagonist.role}
                          faction={protagonist.faction}
                          size={768}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/15 to-transparent" />
                        <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-nobel backdrop-blur-sm border border-white/10">
                          <Sparkles className="w-3.5 h-3.5" />
                          <h3 className="text-[10px] font-bold uppercase tracking-widest">{protagonist.role}</h3>
                        </div>
                      </div>
                      <div className="p-6 border-t border-white/5">
                        <h2 className="text-2xl font-serif font-bold text-white mb-2">{protagonist.name}</h2>
                        {protagonist.faction && (
                          <p className="text-nobel text-[11px] uppercase tracking-[0.24em] mb-3">{protagonist.faction}</p>
                        )}
                        <p className="text-stone-300 text-sm font-serif italic line-clamp-4 leading-relaxed">{protagonist.bio}</p>
                      </div>
                    </div>
                    ) : (
                        <div className="p-6 h-full flex flex-col items-center justify-center text-center bg-stone-50">
                            <Users className="w-8 h-8 text-stone-300 mb-2" />
                            <p className="text-stone-500 font-serif text-sm">{t('dash3.emptyPantheon')}</p>
                        </div>
                    )}
                </Card>

                {/* Card 3: The Pantheon (Characters mini) */}
                <Card className="col-span-1 md:col-span-1 lg:col-span-1 row-span-1 p-6 flex flex-col justify-between border-stone-200 hover:shadow-md transition-shadow cursor-pointer bg-white" onClick={() => setCurrentView?.('characters')}>
                    <div className="flex justify-between items-start">
                        <div className="flex items-center text-stone-500">
                            <Users className="w-4 h-4 mr-2" />
                            <h3 className="text-xs font-bold uppercase tracking-widest">{t('dash3.pantheon')}</h3>
                        </div>
                        <span className="text-3xl font-serif font-bold text-stone-dark">{characters.length}</span>
                    </div>
                    <div className="flex -space-x-3 overflow-hidden mt-4">
                        {recentCharacters.map((char, i) => (
                        <CharacterPortrait key={char.id} name={char.name} imageUrl={char.imageUrl} role={char.role} faction={char.faction} className="inline-block h-12 w-12 rounded-full ring-2 ring-white object-cover shadow-sm" style={{ zIndex: 10 - i }} />
                        ))}
                        {characters.length === 0 && <span className="text-xs text-stone-400 italic">{t('dash3.noEntities')}</span>}
                    </div>
                </Card>

                {/* Card 4: Codex Stats */}
                <Card className="col-span-1 md:col-span-1 lg:col-span-1 row-span-1 p-6 flex flex-col justify-between border-stone-200 hover:shadow-md transition-shadow cursor-pointer bg-stone-50" onClick={() => setCurrentView?.('codex')}>
                    <div className="flex justify-between items-start">
                        <div className="flex items-center text-stone-500">
                            <BookOpen className="w-4 h-4 mr-2" />
                            <h3 className="text-xs font-bold uppercase tracking-widest">{t('dash3.codex')}</h3>
                        </div>
                        <span className="text-3xl font-serif font-bold text-stone-dark">{(codex.factions?.length ?? 0) + (codex.rules?.length ?? 0) + (codex.timeline?.length ?? 0)}</span>
                    </div>
                    <p className="text-sm text-stone-500 font-serif mt-2 leading-relaxed">{t('dash3.codexDesc')}</p>
                </Card>

                {/* Card 5: Recent Activity (Timeline) */}
                <Card className="col-span-1 md:col-span-3 lg:col-span-4 row-span-1 p-6 border-stone-200 overflow-hidden relative bg-white flex flex-col justify-center">
                    <div className="flex items-center text-stone-500 mb-4">
                        <Clock className="w-4 h-4 mr-2" />
                        <h3 className="text-xs font-bold uppercase tracking-widest">{t('dash3.timeline')}</h3>
                    </div>
                    <div className="flex items-center gap-8 overflow-x-auto pb-2 scrollbar-hide">
                        {latestChapter && (
                            <div className="flex items-center gap-4 min-w-max group cursor-pointer" onClick={() => setCurrentView?.('chapters')}>
                                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center border border-stone-200 group-hover:bg-nobel/10 group-hover:border-nobel/30 transition-colors">
                                    <FileText className="w-5 h-5 text-stone-500 group-hover:text-nobel transition-colors" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-stone-800">{t('dash3.chapterWritten')}</p>
                                    <p className="text-xs text-stone-500 font-serif italic">{latestChapterTitle}</p>
                                </div>
                            </div>
                        )}
                        {recentCharacters.slice(0, 3).map(char => (
                            <div key={char.id} className="flex items-center gap-4 min-w-max group cursor-pointer" onClick={() => setCurrentView?.('characters')}>
                            <CharacterPortrait name={char.name} imageUrl={char.imageUrl} role={char.role} faction={char.faction} className="w-10 h-10 rounded-full object-cover border border-stone-200 group-hover:border-nobel transition-colors" />
                                <div>
                                    <p className="text-sm font-bold text-stone-800">{t('dash3.entityForged')}</p>
                                    <p className="text-xs text-stone-500 font-serif italic">{char.name}</p>
                                </div>
                            </div>
                        ))}
                        {chapters.length === 0 && characters.length === 0 && (
                            <p className="text-sm text-stone-400 italic font-serif">{t('dash3.universeQuiet')}</p>
                        )}
                    </div>
                </Card>

            </div>
        </div>
    );
  }

  return null;
}
