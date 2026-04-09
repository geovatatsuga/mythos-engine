import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Feather,
  Loader2,
  Map as MapIcon,
  ScrollText,
  Sparkles,
  Square,
} from 'lucide-react';
import type { Universe } from '../../types';
import type { AutogenProgress } from '../../services/geminiService';
import { useLanguage } from '../../LanguageContext';
import { AstrolabeSVG } from './AstrolabeSVG';

type RuntimePhase = Exclude<AutogenProgress['phase'], 'done'>;
type ActivePhase = Exclude<RuntimePhase, 'aborted'>;

const PHASE_ORDER: ActivePhase[] = ['director', 'weaver', 'bard', 'chronicler'];

const PHASE_META: Record<
  RuntimePhase,
  {
    technical: { pt: string; en: string };
    poeticHeadline: { pt: string; en: string };
    poeticSubline: { pt: string; en: string };
    mythicRole: { pt: string; en: string };
    mythicAction: { pt: string; en: string };
    accentText: string;
    accentBorder: string;
    accentGlow: string;
    accentFill: string;
    accentSoft: string;
    accentSolid: string;
    icon: React.FC<{ className?: string }>;
  }
> = {
  director: {
    technical: { pt: 'Director', en: 'Director' },
    poeticHeadline: { pt: 'A tensao escolhe onde apertar', en: 'Tension chooses where to tighten' },
    poeticSubline: {
      pt: 'O conflito central ganha direcao, peso e uma consequencia sem volta.',
      en: 'The central conflict gains direction, weight, and an irreversible consequence.',
    },
    mythicRole: { pt: 'Oraculo de tensao', en: 'Oracle of tension' },
    mythicAction: {
      pt: 'Lendo fissuras tematicas, abrindo a pressao do proximo movimento.',
      en: 'Reading thematic fractures and opening pressure for the next movement.',
    },
    accentText: 'text-[#8a5a18]',
    accentBorder: 'border-[#c79b49]/45',
    accentGlow: 'shadow-[0_0_32px_rgba(199,155,73,0.18)]',
    accentFill: 'from-[#f2dfb6] via-[#e7c983] to-[#b77d26]',
    accentSoft: 'bg-[#fff6e4]',
    accentSolid: '#b77d26',
    icon: MapIcon,
  },
  weaver: {
    technical: { pt: 'Weaver', en: 'Weaver' },
    poeticHeadline: { pt: 'A estrutura da obra toma forma', en: 'The work finds its structure' },
    poeticSubline: {
      pt: 'Cenas, eixo dramatico e progressao comecam a fechar o arco ao redor do conflito.',
      en: 'Scenes, dramatic axis, and progression begin to close the arc around the conflict.',
    },
    mythicRole: { pt: 'Tecelao do destino', en: 'Fate weaver' },
    mythicAction: {
      pt: 'Amarrando funcao, objetivo e marco numa espinha narrativa viva.',
      en: 'Binding function, objective, and milestone into a living narrative spine.',
    },
    accentText: 'text-[#345b89]',
    accentBorder: 'border-[#6a8ab1]/45',
    accentGlow: 'shadow-[0_0_32px_rgba(83,120,165,0.16)]',
    accentFill: 'from-[#d9e5f4] via-[#9bb7d9] to-[#4a709e]',
    accentSoft: 'bg-[#edf3fb]',
    accentSolid: '#4a709e',
    icon: ScrollText,
  },
  bard: {
    technical: { pt: 'Bard', en: 'Bard' },
    poeticHeadline: { pt: 'A pagina se rompe', en: 'The page breaks open' },
    poeticSubline: {
      pt: 'A materia da obra ganha ritmo, voz e carne diante do leitor.',
      en: 'The work gains rhythm, voice, and living presence before the reader.',
    },
    mythicRole: { pt: 'Cantor da pagina', en: 'Singer of the page' },
    mythicAction: {
      pt: 'Transformando plano em cena, cadencia e linguagem encarnada.',
      en: 'Turning plan into scene, cadence, and embodied language.',
    },
    accentText: 'text-[#4d7759]',
    accentBorder: 'border-[#7ba088]/45',
    accentGlow: 'shadow-[0_0_32px_rgba(93,132,107,0.15)]',
    accentFill: 'from-[#dce9df] via-[#9ec1a8] to-[#56775f]',
    accentSoft: 'bg-[#edf5ef]',
    accentSolid: '#56775f',
    icon: Feather,
  },
  chronicler: {
    technical: { pt: 'Chronicler', en: 'Chronicler' },
    poeticHeadline: { pt: 'A memoria sela o que nao pode se perder', en: 'Memory seals what cannot be lost' },
    poeticSubline: {
      pt: 'O codex se fixa, o capitulo se fecha e o rastro da obra passa a existir.',
      en: 'The codex settles, the chapter closes, and the trail of the work begins to exist.',
    },
    mythicRole: { pt: 'Guardiao da memoria', en: 'Keeper of memory' },
    mythicAction: {
      pt: 'Selando ecos, memoria canonica e permanencia da obra.',
      en: 'Sealing echoes, canonical memory, and permanence of the work.',
    },
    accentText: 'text-[#6b4b73]',
    accentBorder: 'border-[#8b6a93]/45',
    accentGlow: 'shadow-[0_0_32px_rgba(132,105,145,0.15)]',
    accentFill: 'from-[#eadfed] via-[#b89bc0] to-[#7a5b84]',
    accentSoft: 'bg-[#f4edf7]',
    accentSolid: '#7a5b84',
    icon: BookOpenCheck,
  },
  aborted: {
    technical: { pt: 'Motor interrompido', en: 'Engine stopped' },
    poeticHeadline: { pt: 'O rito foi suspenso', en: 'The ritual was suspended' },
    poeticSubline: {
      pt: 'O que ja foi forjado permanece salvo. O restante pode ser retomado depois.',
      en: 'What has already been forged remains saved. The rest can be resumed later.',
    },
    mythicRole: { pt: 'Rito suspenso', en: 'Suspended rite' },
    mythicAction: {
      pt: 'A forja se recolhe, preservando o que ja foi selado.',
      en: 'The forge withdraws, preserving what has already been sealed.',
    },
    accentText: 'text-[#8f4d4d]',
    accentBorder: 'border-[#b47a7a]/45',
    accentGlow: 'shadow-[0_0_28px_rgba(180,122,122,0.16)]',
    accentFill: 'from-[#f0dfdf] via-[#d6a4a4] to-[#945d5d]',
    accentSoft: 'bg-[#fbefef]',
    accentSolid: '#945d5d',
    icon: Square,
  },
};

const formatChapterFunction = (value?: string) =>
  value
    ? value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase())
    : null;

const trimText = (value: string | undefined, max = 150) => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
};

const getProtagonist = (universe: Universe) =>
  universe.characters.find(character => character.role === 'Protagonista') ?? universe.characters[0];

const buildManifest = (progress: AutogenProgress, lang: 'pt' | 'en') => {
  const universe = progress.currentUniverse;
  const blueprint = universe.longformBlueprint;
  const protagonist = getProtagonist(universe);
  const currentChapter = progress.phase === 'aborted'
    ? Math.max(progress.chaptersDone, 1)
    : Math.min(progress.chaptersDone + 1, progress.totalChapters);
  const currentPlan = blueprint?.chapterMap.find(entry => entry.chapterNumber === currentChapter);
  const currentGoal = currentPlan?.goal ?? universe.longformProgress?.currentMilestone ?? universe.codex.overview;

  return [
    {
      key: 'title',
      label: lang === 'pt' ? 'Obra' : 'Work',
      value: blueprint?.title ?? universe.name,
    },
    protagonist?.name
      ? {
          key: 'protagonist',
          label: lang === 'pt' ? 'Protagonista' : 'Protagonist',
          value: protagonist.name,
        }
      : null,
    trimText(blueprint?.promise ?? universe.description, 155)
      ? {
          key: 'promise',
          label: lang === 'pt' ? 'Promessa' : 'Promise',
          value: trimText(blueprint?.promise ?? universe.description, 155)!,
        }
      : null,
    trimText(currentGoal ?? undefined, 145)
      ? {
          key: 'current-goal',
          label: lang === 'pt' ? 'Fragmento atual' : 'Current fragment',
          value: trimText(currentGoal ?? undefined, 145)!,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string }>;
};

const GreekKeyBand: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`pointer-events-none absolute left-0 right-0 h-5 opacity-50 ${className}`}
    style={{
      backgroundImage:
        'repeating-linear-gradient(90deg, rgba(126,94,40,0.18) 0 18px, transparent 18px 22px, rgba(126,94,40,0.18) 22px 40px, transparent 40px 44px)',
      backgroundSize: '44px 100%',
    }}
  />
);

const getPhaseState = (runtimePhase: RuntimePhase, phase: ActivePhase) => {
  if (runtimePhase === 'aborted') return 'idle' as const;
  const currentIndex = PHASE_ORDER.indexOf(runtimePhase as ActivePhase);
  const phaseIndex = PHASE_ORDER.indexOf(phase);
  if (phaseIndex < currentIndex) return 'done' as const;
  if (phaseIndex === currentIndex) return 'active' as const;
  return 'idle' as const;
};

const ChapterMarkers: React.FC<{ progress: AutogenProgress }> = ({ progress }) => {
  const currentIndex = progress.phase === 'aborted'
    ? progress.chaptersDone
    : Math.min(progress.chaptersDone, progress.totalChapters - 1);

  return (
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: progress.totalChapters }).map((_, index) => {
        const isDone = index < progress.chaptersDone;
        const isCurrent = progress.phase !== 'aborted' && index === currentIndex;
        return (
          <div
            key={index}
            className={[
              'relative h-3 overflow-hidden rounded-full border transition-all duration-500',
              isDone
                ? 'border-[#b99658]/60 bg-[#d7ba84]'
                : isCurrent
                ? 'border-[#7f95b2]/70 bg-[#e7edf6]'
                : 'border-[#d9ccb6] bg-white/70',
            ].join(' ')}
          >
            {isCurrent && (
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent via-white/90 to-transparent"
                animate={{ x: ['-100%', '140%'] }}
                transition={{ repeat: Infinity, duration: 1.7, ease: 'easeInOut' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

const getCurrentChapter = (progress: AutogenProgress) =>
  progress.phase === 'aborted'
    ? Math.max(progress.chaptersDone, 1)
    : Math.min(progress.chaptersDone + 1, progress.totalChapters);

const getPhaseAngle = (phase: ActivePhase) => {
  const index = PHASE_ORDER.indexOf(phase);
  return -25 + index * 75;
};

const PhaseSignatureOverlay: React.FC<{
  phase: RuntimePhase;
  reducedMotion: boolean;
}> = ({ phase, reducedMotion }) => {
  const meta = PHASE_META[phase];

  if (phase === 'aborted') {
    return null;
  }

  if (phase === 'director') {
    return (
      <motion.div
        className="pointer-events-none absolute inset-[10%] z-[2]"
        animate={reducedMotion ? { opacity: 0.7 } : { opacity: [0.3, 0.72, 0.38], rotate: [0, 3, 0] }}
        transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <g stroke={meta.accentSolid} strokeOpacity="0.35" fill="none">
            <path d="M50 10 L64 39 L36 39 Z" strokeWidth="1.3" />
            <path d="M50 90 L64 61 L36 61 Z" strokeWidth="1.1" />
            <path d="M10 50 L38 44 L38 56 Z" strokeWidth="1.1" />
            <path d="M90 50 L62 44 L62 56 Z" strokeWidth="1.1" />
            <line x1="50" y1="14" x2="50" y2="86" strokeWidth="0.9" strokeDasharray="3 5" />
            <line x1="14" y1="50" x2="86" y2="50" strokeWidth="0.9" strokeDasharray="3 5" />
          </g>
        </svg>
      </motion.div>
    );
  }

  if (phase === 'weaver') {
    return (
      <motion.div
        className="pointer-events-none absolute inset-[9%] z-[2]"
        animate={reducedMotion ? { opacity: 0.76 } : { opacity: [0.34, 0.84, 0.42] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <g fill="none" stroke={meta.accentSolid} strokeLinecap="round">
            <motion.path
              d="M18 34 C34 18, 46 18, 62 34 S84 50, 84 50"
              strokeWidth="1.5"
              strokeOpacity="0.45"
              strokeDasharray="6 5"
              animate={reducedMotion ? { strokeDashoffset: 0 } : { strokeDashoffset: [0, -28] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: 'linear' }}
            />
            <motion.path
              d="M16 58 C30 48, 42 48, 56 58 S78 70, 86 64"
              strokeWidth="1.2"
              strokeOpacity="0.4"
              strokeDasharray="5 5"
              animate={reducedMotion ? { strokeDashoffset: 0 } : { strokeDashoffset: [0, 24] }}
              transition={{ duration: 3.8, repeat: Infinity, ease: 'linear' }}
            />
            <motion.path
              d="M28 78 C40 66, 52 66, 68 78"
              strokeWidth="1.2"
              strokeOpacity="0.36"
              strokeDasharray="4 5"
              animate={reducedMotion ? { strokeDashoffset: 0 } : { strokeDashoffset: [0, -20] }}
              transition={{ duration: 2.9, repeat: Infinity, ease: 'linear' }}
            />
          </g>
        </svg>
      </motion.div>
    );
  }

  if (phase === 'bard') {
    return (
      <motion.div
        className="pointer-events-none absolute inset-[9%] z-[2]"
        animate={reducedMotion ? { opacity: 0.76 } : { opacity: [0.32, 0.78, 0.4] }}
        transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <g fill="none" stroke={meta.accentSolid} strokeLinecap="round">
            <motion.path
              d="M18 54 C26 46, 34 46, 42 54 S58 62, 66 54 S82 46, 88 52"
              strokeWidth="1.4"
              strokeOpacity="0.45"
              animate={reducedMotion ? { d: 'M18 54 C26 46, 34 46, 42 54 S58 62, 66 54 S82 46, 88 52' } : { d: [
                'M18 54 C26 46, 34 46, 42 54 S58 62, 66 54 S82 46, 88 52',
                'M18 50 C26 58, 34 58, 42 50 S58 42, 66 50 S82 58, 88 52',
                'M18 54 C26 46, 34 46, 42 54 S58 62, 66 54 S82 46, 88 52',
              ] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.path
              d="M24 68 C34 60, 46 60, 56 68 S76 76, 82 68"
              strokeWidth="1.1"
              strokeOpacity="0.32"
              animate={reducedMotion ? { d: 'M24 68 C34 60, 46 60, 56 68 S76 76, 82 68' } : { d: [
                'M24 68 C34 60, 46 60, 56 68 S76 76, 82 68',
                'M24 64 C34 72, 46 72, 56 64 S76 56, 82 64',
                'M24 68 C34 60, 46 60, 56 68 S76 76, 82 68',
              ] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </g>
        </svg>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="pointer-events-none absolute inset-[10%] z-[2]"
      animate={reducedMotion ? { opacity: 0.74 } : { opacity: [0.3, 0.74, 0.38], rotate: [0, 5, 0] }}
      transition={{ duration: 6.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <g fill="none" stroke={meta.accentSolid}>
          <rect x="24" y="24" width="52" height="52" rx="4" strokeWidth="1.2" strokeOpacity="0.26" />
          <rect x="32" y="32" width="36" height="36" rx="2" strokeWidth="1" strokeOpacity="0.38" strokeDasharray="4 5" />
          <path d="M50 20 L50 30 M50 70 L50 80 M20 50 L30 50 M70 50 L80 50" strokeWidth="1.1" strokeOpacity="0.34" />
          <circle cx="50" cy="50" r="3.5" strokeWidth="1.2" strokeOpacity="0.42" />
        </g>
      </svg>
    </motion.div>
  );
};

const PhaseNodes: React.FC<{
  phase: RuntimePhase;
  reducedMotion: boolean;
  lang: 'pt' | 'en';
}> = ({ phase, reducedMotion, lang }) => {
  const phaseIndex = phase === 'aborted' ? -1 : PHASE_ORDER.indexOf(phase as ActivePhase);
  const orbitItems = PHASE_ORDER.map((item, index) => ({
    id: item,
    label: PHASE_META[item].technical[lang],
    angle: -25 + index * 75,
    state:
      phase === 'aborted'
        ? 'idle'
        : index < phaseIndex
        ? 'done'
        : index === phaseIndex
        ? 'active'
        : 'idle',
    meta: PHASE_META[item],
  }));

  return (
    <div className="pointer-events-none absolute inset-0 hidden md:block">
      {orbitItems.map((item, index) => {
        const radius = 172;
        const radians = (item.angle * Math.PI) / 180;
        const x = Math.cos(radians) * radius;
        const y = Math.sin(radians) * radius;

        return (
          <motion.div
            key={item.id}
            className="absolute left-1/2 top-1/2"
            animate={
              reducedMotion
                ? { x, y }
                : {
                    x: [x, x + Math.cos(radians + 0.35) * 6, x],
                    y: [y, y + Math.sin(radians + 0.35) * 6, y],
                  }
            }
            transition={{
              duration: 5.6 + index,
              repeat: Infinity,
              repeatType: 'mirror',
              ease: 'easeInOut',
            }}
            style={{
              marginLeft: '-56px',
              marginTop: '-20px',
              opacity: item.state === 'active' ? 1 : item.state === 'done' ? 0.88 : 0.56,
              scale: item.state === 'active' ? 1.08 : 1,
            }}
          >
            {item.state === 'active' && (
              <>
                <motion.div
                  className={`absolute left-1/2 top-1/2 h-[88px] w-[88px] -translate-x-1/2 -translate-y-1/2 rounded-full ${item.meta.accentSoft} blur-2xl`}
                  animate={{ opacity: [0.22, 0.55, 0.22], scale: [0.86, 1.18, 0.92] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  className={`absolute left-1/2 top-1/2 h-[132px] w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-full border ${item.meta.accentBorder}`}
                  animate={{ opacity: [0.16, 0.42, 0.16], scale: [0.78, 1.08, 0.82] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              </>
            )}
              <motion.div
                className={[
                  'relative w-[112px] rounded-full border px-3 py-2 text-center text-[10px] uppercase tracking-[0.22em] shadow-sm backdrop-blur-sm',
                  item.state === 'active'
                    ? `bg-white ${item.meta.accentBorder} ${item.meta.accentText} ${item.meta.accentGlow}`
                  : item.state === 'done'
                  ? 'border-[#d9c6a4] bg-[#fffaf1] text-[#72562b]'
                  : 'border-[#e5d8c7] bg-white/70 text-[#a49175]',
                ].join(' ')}
                animate={item.state === 'active' ? { y: [0, -3, 0], scale: [1, 1.04, 1] } : { y: 0, scale: 1 }}
                transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
              >
              {item.state === 'active' && (
                <motion.div
                  className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gradient-to-r ${item.meta.accentFill}`}
                  animate={{ opacity: [0.3, 1, 0.3], scaleX: [0.72, 1, 0.78] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              {item.label}
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
};

const AgentConstellation: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => (
  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
    {PHASE_ORDER.map((phase, index) => {
      const meta = PHASE_META[phase];
      const Icon = meta.icon;
      const state = getPhaseState(progress.phase, phase);

      return (
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.08 + index * 0.06 }}
          className={[
            'relative overflow-hidden rounded-[28px] border p-4 shadow-[0_18px_50px_rgba(123,94,49,0.08)] backdrop-blur-sm',
            state === 'active'
              ? `${meta.accentBorder} bg-white/94`
              : state === 'done'
              ? 'border-[#decaa3] bg-[#fff8ea]/92'
              : 'border-[#eadfcf] bg-white/70',
          ].join(' ')}
        >
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.accentFill} ${state === 'idle' ? 'opacity-30' : 'opacity-80'}`} />
          {state === 'active' && (
            <motion.div
              className={`absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl ${meta.accentSoft}`}
              animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.08, 0.96] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}

          <div className="relative flex items-start justify-between gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border bg-white/80 ${state === 'active' ? meta.accentBorder : 'border-[#e7dbc7]'}`}>
              <Icon className={`h-5 w-5 ${state === 'idle' ? 'text-[#a89576]' : meta.accentText}`} />
            </div>
            <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${
              state === 'active'
                ? `${meta.accentBorder} bg-white/90 ${meta.accentText}`
                : state === 'done'
                ? 'border-[#d9c39b] bg-[#fff7e1] text-[#7d6336]'
                : 'border-[#e7dbc7] bg-white/60 text-[#ab9674]'
            }`}>
              {state === 'active'
                ? (lang === 'pt' ? 'Ativo' : 'Active')
                : state === 'done'
                ? (lang === 'pt' ? 'Selado' : 'Sealed')
                : (lang === 'pt' ? 'Em espera' : 'Waiting')}
            </div>
          </div>

          <div className="relative mt-4">
            <p className={`text-[10px] uppercase tracking-[0.24em] ${state === 'idle' ? 'text-[#a89576]' : 'text-[#9a845d]'}`}>
              {meta.technical[lang]}
            </p>
            <h3 className="mt-2 font-serif text-xl text-[#433526]">{meta.mythicRole[lang]}</h3>
            <p className="mt-2 text-sm leading-6 text-[#6b5a45]">{meta.mythicAction[lang]}</p>
          </div>
        </motion.div>
      );
    })}
  </div>
);

const ChapterSealLedger: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => {
  const currentIndex = progress.phase === 'aborted'
    ? progress.chaptersDone
    : Math.min(progress.chaptersDone, progress.totalChapters - 1);

  return (
    <div className="rounded-[30px] border border-[#e1d1b9] bg-[linear-gradient(180deg,rgba(255,252,247,0.88),rgba(247,238,220,0.84))] p-5 shadow-[0_24px_75px_rgba(128,96,51,0.10)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#9f875f]">
            {lang === 'pt' ? 'Selos dos capitulos' : 'Chapter seals'}
          </p>
          <h3 className="mt-1 font-serif text-2xl text-[#403122]">
            {lang === 'pt' ? 'A obra avanca em lacres sucessivos' : 'The work advances through successive seals'}
          </h3>
        </div>
        <div className="rounded-full border border-[#ddcfbb] bg-white/80 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-[#7c694b]">
          {progress.chaptersDone}/{progress.totalChapters} {lang === 'pt' ? 'selados' : 'sealed'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: progress.totalChapters }).map((_, index) => {
          const chapterNumber = index + 1;
          const isDone = index < progress.chaptersDone;
          const isCurrent = progress.phase !== 'aborted' && index === currentIndex;

          return (
            <motion.div
              key={chapterNumber}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: Math.min(index * 0.02, 0.24) }}
              className={[
                'relative overflow-hidden rounded-[22px] border px-3 py-3',
                isDone
                  ? 'border-[#d8c094] bg-[#fff6e3]'
                  : isCurrent
                  ? 'border-[#9ab2d0] bg-[#eef4fb]'
                  : 'border-[#eadfcf] bg-white/72',
              ].join(' ')}
            >
              {isCurrent && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/75 to-transparent"
                  animate={{ x: ['-120%', '120%'] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                />
              )}
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#4a3b2a]">
                  {lang === 'pt' ? `Cap. ${chapterNumber}` : `Ch. ${chapterNumber}`}
                </span>
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-[#b98b36]" />
                ) : isCurrent ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#557aa7]" />
                ) : (
                  <div className="h-2.5 w-2.5 rounded-full border border-[#d4c5ae]" />
                )}
              </div>
              <p className="relative mt-2 text-[10px] uppercase tracking-[0.18em] text-[#9b8560]">
                {isDone
                  ? (lang === 'pt' ? 'Concluido' : 'Completed')
                  : isCurrent
                  ? (lang === 'pt' ? 'Em forja' : 'Forging')
                  : (lang === 'pt' ? 'Aguardando' : 'Waiting')}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

const AgentForgeBoard: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => (
  <div className="relative rounded-[34px] border border-[#e1d1b9] bg-[linear-gradient(180deg,rgba(255,252,247,0.92),rgba(247,238,220,0.9))] p-5 shadow-[0_28px_85px_rgba(128,96,51,0.11)]">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.24em] text-[#9f875f]">
          {lang === 'pt' ? 'Conclave dos agentes' : 'Agents conclave'}
        </p>
        <h3 className="mt-1 font-serif text-2xl text-[#403122]">
          {lang === 'pt' ? 'Cada oficio assume o capitulo por sua vez' : 'Each craft takes the chapter in turn'}
        </h3>
      </div>
      <div className="rounded-full border border-[#ddcfbb] bg-white/80 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-[#7c694b]">
        {lang === 'pt' ? 'Pipeline ritual' : 'Ritual pipeline'}
      </div>
    </div>

    <div className="relative">
      <div className="absolute left-[12%] right-[12%] top-8 hidden h-px bg-gradient-to-r from-[#e0cfaf] via-[#cfb27a] to-[#e0cfaf] lg:block" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {PHASE_ORDER.map((phase, index) => {
          const meta = PHASE_META[phase];
          const Icon = meta.icon;
          const state = getPhaseState(progress.phase, phase);

          return (
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: 0.08 + index * 0.06 }}
              className={[
                'relative overflow-hidden rounded-[28px] border px-4 pb-4 pt-8 text-center shadow-[0_18px_50px_rgba(123,94,49,0.08)] backdrop-blur-sm',
                state === 'active'
                  ? `${meta.accentBorder} bg-white/94`
                  : state === 'done'
                  ? 'border-[#decaa3] bg-[#fff8ea]/92'
                  : 'border-[#eadfcf] bg-white/72',
              ].join(' ')}
            >
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.accentFill} ${state === 'idle' ? 'opacity-30' : 'opacity-80'}`} />
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  className={[
                    'relative flex h-16 w-16 items-center justify-center rounded-[22px] border bg-white shadow-[0_18px_35px_rgba(123,94,49,0.14)]',
                    state === 'active' ? meta.accentBorder : 'border-[#e7dbc7]',
                  ].join(' ')}
                  animate={state === 'active' ? { y: [0, -5, 0], scale: [1, 1.04, 1] } : { y: 0, scale: 1 }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {state === 'active' && (
                    <motion.div
                      className={`absolute -inset-2 rounded-[28px] ${meta.accentSoft} blur-xl`}
                      animate={{ opacity: [0.28, 0.6, 0.28], scale: [0.92, 1.08, 0.94] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <Icon className={`relative h-6 w-6 ${state === 'idle' ? 'text-[#a89576]' : meta.accentText}`} />
                </motion.div>
              </div>

              <div className="mt-6">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[#9a845d]">
                  {meta.technical[lang]}
                </p>
                <h4 className="mt-2 font-serif text-xl text-[#433526]">{meta.mythicRole[lang]}</h4>
                <p className="mt-2 text-sm leading-6 text-[#6b5a45]">{meta.mythicAction[lang]}</p>
              </div>

              <div className={`mt-4 inline-flex rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] ${
                state === 'active'
                  ? `${meta.accentBorder} bg-white/90 ${meta.accentText}`
                  : state === 'done'
                  ? 'border-[#d9c39b] bg-[#fff7e1] text-[#7d6336]'
                  : 'border-[#e7dbc7] bg-white/60 text-[#ab9674]'
              }`}>
                {state === 'active'
                  ? (lang === 'pt' ? 'Trabalhando agora' : 'Working now')
                  : state === 'done'
                  ? (lang === 'pt' ? 'Passagem concluida' : 'Pass complete')
                  : (lang === 'pt' ? 'Aguardando chamada' : 'Waiting call')}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  </div>
);

const MinimalPhaseRibbon: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => (
  <div className="flex flex-wrap items-center justify-center gap-2">
    {PHASE_ORDER.map((phase) => {
      const meta = PHASE_META[phase];
      const Icon = meta.icon;
      const state = getPhaseState(progress.phase, phase);

      return (
        <div
          key={phase}
          className={[
            'relative overflow-hidden flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.2em] backdrop-blur-sm',
            state === 'active'
              ? `${meta.accentBorder} bg-white/92 ${meta.accentText} shadow-[0_14px_32px_rgba(126,94,40,0.10)]`
              : state === 'done'
              ? 'border-[#dac59d] bg-[#fff7e4] text-[#7b6133]'
              : 'border-[#eadfcf] bg-white/60 text-[#ab9674]',
          ].join(' ')}
        >
          {state === 'active' && (
            <motion.div
              className={`absolute inset-y-0 left-0 w-12 bg-gradient-to-r ${meta.accentFill} opacity-25 blur-md`}
              animate={{ x: ['-120%', '240%'] }}
              transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${state === 'active' ? meta.accentBorder : 'border-[#e6d9c4]'} bg-white/85`}>
            {state === 'active' ? (
              <motion.div
                animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.08, 1] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Icon className={`h-3.5 w-3.5 ${meta.accentText}`} />
              </motion.div>
            ) : state === 'done' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#b98b36]" />
            ) : (
              <Icon className="h-3.5 w-3.5 text-[#aa9573]" />
            )}
          </div>
          <span>{meta.technical[lang]}</span>
        </div>
      );
    })}
  </div>
);

const CurrentDirectivePanel: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => {
  const universe = progress.currentUniverse;
  const phaseMeta = PHASE_META[progress.phase];
  const PhaseIcon = phaseMeta.icon;
  const blueprint = universe.longformBlueprint;
  const currentChapter = progress.phase === 'aborted'
    ? Math.max(progress.chaptersDone, 1)
    : Math.min(progress.chaptersDone + 1, progress.totalChapters);
  const chapterMeta = blueprint?.chapterMap.find(entry => entry.chapterNumber === currentChapter);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-[34px] border border-[#e1d1b9] bg-[linear-gradient(180deg,rgba(255,252,247,0.92),rgba(247,238,220,0.9))] p-5 shadow-[0_28px_85px_rgba(128,96,51,0.11)]"
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${phaseMeta.accentFill}`} />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#9f875f]">
            {lang === 'pt' ? 'Mandato vivo do capitulo' : 'Living chapter mandate'}
          </p>
          <h3 className="mt-2 font-serif text-2xl text-[#403122]">
            {chapterMeta?.goal ?? (lang === 'pt' ? 'A forja esta escolhendo o proximo gesto.' : 'The forge is choosing the next gesture.')}
          </h3>
          <p className="mt-3 text-sm leading-7 text-[#6b5a45]">
            {phaseMeta.mythicAction[lang]}
          </p>
        </div>
        <div className="grid gap-3">
          <div className="rounded-[24px] border border-[#e7dbc7] bg-white/76 p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#9f875f]">
              {lang === 'pt' ? 'Milestone em fogo' : 'Milestone in flame'}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#4d3d2d]">
              {chapterMeta?.milestone ?? universe.longformProgress?.currentMilestone ?? (lang === 'pt' ? 'Ainda convergindo para o primeiro marco.' : 'Still converging toward the first milestone.')}
            </p>
          </div>
          <div className="rounded-[24px] border border-[#e7dbc7] bg-white/76 p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#9f875f]">
              {lang === 'pt' ? 'Agente dominante' : 'Dominant agent'}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border bg-white ${phaseMeta.accentBorder}`}>
                <PhaseIcon className={`h-4 w-4 ${phaseMeta.accentText}`} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${phaseMeta.accentText}`}>{phaseMeta.technical[lang]}</p>
                <p className="text-xs text-[#7a6648]">{phaseMeta.mythicRole[lang]}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const RitualManifest: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => {
  const manifest = useMemo(() => buildManifest(progress, lang), [progress, lang]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {manifest.map((item, index) => (
        <motion.div
          key={item.key}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: index * 0.08 }}
          className="rounded-[26px] border border-[#e6d9c4] bg-white/86 p-4 shadow-[0_18px_50px_rgba(123,94,49,0.08)] backdrop-blur-sm"
        >
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[#9c875e]">{item.label}</p>
          <p className="text-sm leading-6 text-[#44382b]">{item.value}</p>
        </motion.div>
      ))}
    </div>
  );
};

const GenerationTechnicalRail: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
  onAbort: () => void;
  mobileOpen: boolean;
  onToggleMobile: () => void;
}> = ({ progress, lang, onAbort, mobileOpen, onToggleMobile }) => {
  const phaseMeta = PHASE_META[progress.phase];
  const currentChapter = getCurrentChapter(progress);

  const railBody = (
    <div className="w-[320px] rounded-[28px] border border-[#ddcfbb] bg-[linear-gradient(180deg,rgba(255,252,246,0.9),rgba(248,240,225,0.9))] p-4 text-[#4e3f30] shadow-[0_26px_80px_rgba(145,114,69,0.14)] backdrop-blur-md xl:w-[340px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <motion.div
            className={`mt-0.5 flex h-12 w-12 items-center justify-center rounded-[18px] border bg-white/88 ${phaseMeta.accentBorder}`}
            animate={{ scale: [1, 1.06, 1], opacity: [0.92, 1, 0.92] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <phaseMeta.icon className={`h-5 w-5 ${phaseMeta.accentText}`} />
          </motion.div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[#9a835a]">
              {lang === 'pt' ? 'Nave lateral do rito' : 'Ritual side rail'}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <h3 className={`text-lg font-serif ${phaseMeta.accentText}`}>{phaseMeta.technical[lang]}</h3>
              <motion.span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: phaseMeta.accentSolid }}
                animate={{ scale: [1, 1.45, 1], opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
            <p className="mt-1 text-xs leading-5 text-[#8d7a5a]">{phaseMeta.mythicRole[lang]}</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#9a835a]">
            {lang === 'pt' ? 'Comando' : 'Command'}
          </p>
        </div>
        {progress.phase !== 'aborted' && (
          <button
            onClick={onAbort}
            className="inline-flex items-center gap-2 rounded-full border border-[#cda9a1] bg-[#fff5f3] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#9a5555] transition-colors hover:bg-[#feecea]"
          >
            <Square className="h-3.5 w-3.5" />
            {lang === 'pt' ? 'Parar' : 'Stop'}
          </button>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-[22px] border border-[#eadfcf] bg-white/75 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[#9e8a69]">
              {lang === 'pt' ? 'Capitulo atual' : 'Current chapter'}
            </p>
            <span className="text-sm font-medium text-[#6f5b41]">
              {currentChapter}/{progress.totalChapters}
            </span>
          </div>
          <div className="mt-3">
            <ChapterMarkers progress={progress} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#9e8a69]">
            <span>
              {lang === 'pt'
                ? `${progress.chaptersDone} selados`
                : `${progress.chaptersDone} sealed`}
            </span>
            <span>
              {lang === 'pt'
                ? `${Math.max(progress.totalChapters - progress.chaptersDone, 0)} restantes`
                : `${Math.max(progress.totalChapters - progress.chaptersDone, 0)} remaining`}
            </span>
          </div>
        </div>

        <div className="rounded-[22px] border border-[#eadfcf] bg-white/68 p-3.5">
          <MinimalPhaseRibbon progress={progress} lang={lang} />
        </div>

        <div className={`rounded-[22px] border bg-white/76 p-3.5 ${phaseMeta.accentBorder}`}>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#9e8a69]">
            <Sparkles className={`h-3.5 w-3.5 ${phaseMeta.accentText}`} />
            <span>{lang === 'pt' ? 'Pulso atual do rito' : 'Current ritual pulse'}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#5b4a37]">{phaseMeta.mythicAction[lang]}</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed right-4 top-1/2 z-50 hidden -translate-y-1/2 lg:block xl:right-6">{railBody}</div>

      <div className="lg:hidden">
        <button
          onClick={onToggleMobile}
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#d9cab6] bg-[#fffaf1]/95 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-[#6b5635] shadow-[0_14px_32px_rgba(131,101,57,0.15)] backdrop-blur-sm"
        >
          <span>{lang === 'pt' ? 'Trilho tecnico' : 'Technical rail'}</span>
          {mobileOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-4 bottom-20 z-40"
            >
              {railBody}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

const RitualCore: React.FC<{
  progress: AutogenProgress;
  lang: 'pt' | 'en';
}> = ({ progress, lang }) => {
  const reducedMotion = useReducedMotion() ?? false;
  const phaseMeta = PHASE_META[progress.phase];
  const currentChapter = getCurrentChapter(progress);
  const blueprint = progress.currentUniverse.longformBlueprint;
  const chapterMeta = blueprint?.chapterMap.find(entry => entry.chapterNumber === currentChapter);
  const PhaseIcon = phaseMeta.icon;
  const activeAngle = progress.phase === 'aborted' ? 0 : getPhaseAngle(progress.phase as ActivePhase);

  return (
    <div className="relative mx-auto flex w-full max-w-[620px] flex-col items-center text-center">
      <div className="relative flex h-[210px] w-[210px] items-center justify-center sm:h-[258px] sm:w-[258px] lg:h-[306px] lg:w-[306px]">
        {progress.phase !== 'aborted' && (
          <motion.div
            className="absolute left-1/2 top-1/2 z-[1] h-[34%] w-[4px] -translate-x-1/2 -translate-y-full rounded-full"
              style={{
                rotate: `${activeAngle}deg`,
                transformOrigin: 'center bottom',
                background: `linear-gradient(180deg, rgba(255,255,255,0), ${phaseMeta.accentSolid} 38%, rgba(255,255,255,0.96) 72%, rgba(255,255,255,0))`,
                boxShadow: `0 0 20px ${phaseMeta.accentSolid}55`,
              }}
              animate={reducedMotion ? { opacity: 0.85 } : { opacity: [0.2, 0.95, 0.25], scaleY: [0.92, 1.04, 0.96] }}
            transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <PhaseSignatureOverlay phase={progress.phase} reducedMotion={reducedMotion} />
        <motion.div
          className="absolute inset-[8%] rounded-full"
          style={{
            background: `conic-gradient(from ${activeAngle + 92}deg, transparent 0deg, transparent 292deg, rgba(255,255,255,0.0) 300deg, rgba(255,255,255,0.95) 324deg, rgba(255,255,255,0.0) 348deg, transparent 360deg)`,
          }}
          animate={reducedMotion ? { opacity: 0.48 } : { opacity: [0.24, 0.58, 0.3] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className={`absolute inset-[18%] rounded-full blur-3xl ${phaseMeta.accentSoft}`}
          animate={reducedMotion ? { opacity: 0.45 } : { opacity: [0.26, 0.52, 0.3], scale: [0.9, 1.12, 0.95] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-[10%] rounded-full"
          style={{
            background: `radial-gradient(circle, ${phaseMeta.accentSolid}18 0%, rgba(255,255,255,0) 58%)`,
          }}
          animate={reducedMotion ? { opacity: 0.68 } : { opacity: [0.3, 0.68, 0.34], scale: [0.94, 1.04, 0.97] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-[7%] rounded-full border border-[#d4be93]/55"
          animate={reducedMotion ? { opacity: 1 } : { rotate: 360 }}
          transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-[15%] rounded-full border border-[#dcc9a3]/55"
          animate={reducedMotion ? { opacity: 0.85 } : { rotate: -360 }}
          transition={{ duration: 42, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-[5%] text-[#a07e43]/80"
          animate={reducedMotion ? { opacity: 1 } : { rotate: 360 }}
          transition={{ duration: 54, repeat: Infinity, ease: 'linear' }}
        >
          <AstrolabeSVG className="h-full w-full" />
        </motion.div>
        <motion.div
          className="absolute inset-[16%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(240,222,188,0.9) 0%, rgba(245,236,220,0.22) 45%, transparent 72%)' }}
          animate={reducedMotion ? { opacity: 0.92 } : { opacity: [0.68, 0.98, 0.72], scale: [0.97, 1.03, 0.99] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-[22%] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(255,255,255,0.92) 0%, ${phaseMeta.accentSolid}10 42%, rgba(255,255,255,0) 68%)`,
          }}
          animate={reducedMotion ? { opacity: 0.85 } : { opacity: [0.42, 0.82, 0.46] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />

        <PhaseNodes phase={progress.phase} reducedMotion={reducedMotion} lang={lang} />

        <motion.div
          className={`relative z-10 flex h-[132px] w-[132px] flex-col items-center justify-center rounded-full border bg-[linear-gradient(180deg,rgba(255,253,248,0.96),rgba(247,238,220,0.92))] px-5 shadow-[0_26px_80px_rgba(145,114,69,0.16)] backdrop-blur-sm sm:h-[148px] sm:w-[148px] lg:h-[166px] lg:w-[166px] ${phaseMeta.accentBorder} ${phaseMeta.accentGlow}`}
          animate={reducedMotion ? { opacity: 1 } : { y: [0, -4, 0] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <motion.div
            className={`absolute inset-[-8px] rounded-full border ${phaseMeta.accentBorder}`}
            animate={{ opacity: [0.12, 0.42, 0.12], scale: [0.94, 1.05, 0.96] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[#dbc8a7] bg-white/85">
            <PhaseIcon className={`h-4 w-4 ${phaseMeta.accentText}`} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.26em] text-[#9a845d]">
            {lang === 'pt' ? 'Capitulo' : 'Chapter'}
          </p>
          <p className="mt-1 font-serif text-3xl text-[#4c3923]">{currentChapter}</p>
          <p className="mt-1 text-xs text-[#8a7552]">
            {lang === 'pt' ? `de ${progress.totalChapters}` : `of ${progress.totalChapters}`}
          </p>
        </motion.div>
      </div>

        <motion.div
          key={`${progress.phase}-${currentChapter}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 max-w-[520px]"
        >
          <div className="mb-3 flex items-center justify-center">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.26em] ${phaseMeta.accentBorder} bg-white/92 ${phaseMeta.accentText}`}>
              <motion.span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: phaseMeta.accentSolid }}
                animate={{ scale: [1, 1.55, 1], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span>{lang === 'pt' ? 'Agente em foco' : 'Agent in focus'}</span>
              <span className="font-semibold">{phaseMeta.technical[lang]}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[#a1875b]">
            <Sparkles className={`h-3.5 w-3.5 ${phaseMeta.accentText}`} />
            {lang === 'pt' ? 'Forja da obra' : 'Work forging'}
          </div>
          <h2 className="mt-3 font-serif text-[2.1rem] leading-[0.94] text-[#3f3123] sm:text-[3.35rem]">
            {phaseMeta.poeticHeadline[lang]}
          </h2>
          <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-6 text-[#6e5d47] sm:text-sm">
            {phaseMeta.poeticSubline[lang]}
          </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#7f6a49]">
          <span className="rounded-full border border-[#dfcfb7] bg-white/75 px-3 py-1.5">
            {lang === 'pt'
              ? `${progress.chaptersDone} capitulos selados`
              : `${progress.chaptersDone} chapters sealed`}
          </span>
          {chapterMeta?.function && (
            <span className="rounded-full border border-[#dfcfb7] bg-white/75 px-3 py-1.5">
              {formatChapterFunction(chapterMeta.function)}
            </span>
          )}
          {blueprint?.targetChapters && (
            <span className="rounded-full border border-[#dfcfb7] bg-white/75 px-3 py-1.5">
              {lang === 'pt'
                ? `${blueprint.targetChapters} planejados`
                : `${blueprint.targetChapters} planned`}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const GenerationRitualOverlay: React.FC<{
  progress: AutogenProgress;
  onAbort: () => void;
}> = ({ progress, onAbort }) => {
  const { lang } = useLanguage();
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-transparent">
      <div className="absolute inset-y-0 left-0 right-0 lg:left-[80px] bg-[radial-gradient(circle_at_top,_rgba(215,187,126,0.24),_transparent_28%),radial-gradient(circle_at_20%_30%,_rgba(115,146,185,0.10),_transparent_30%),linear-gradient(180deg,_rgba(252,247,237,0.72),_rgba(243,232,211,0.78))] backdrop-blur-[3px]" />
      <div
        className="absolute inset-y-0 left-0 right-0 opacity-[0.23] lg:left-[80px]"
        style={{
          backgroundImage:
            'linear-gradient(115deg, rgba(149,123,82,0.05) 0%, transparent 16%, rgba(149,123,82,0.035) 33%, transparent 50%, rgba(149,123,82,0.05) 66%, transparent 84%)',
        }}
      />
      <div className="absolute inset-y-0 left-0 z-10 hidden w-[80px] cursor-not-allowed lg:block" />
      <div className="absolute inset-y-0 left-0 hidden w-[80px] border-r border-[#e2d4be]/35 lg:block" />
      <div className="absolute inset-y-0 left-0 right-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.2),_transparent_52%)] lg:left-[80px]" />
      <GreekKeyBand className="top-0 border-b border-[#e3d2b7]/70 bg-[#faf4e6] lg:left-[80px]" />
      <GreekKeyBand className="bottom-0 border-t border-[#e3d2b7]/70 bg-[#faf4e6] lg:left-[80px]" />
      <motion.div
        className="absolute left-1/2 top-[-5%] h-[440px] w-[440px] -translate-x-1/2 rounded-full bg-[#f4dca6]/35 blur-3xl"
        animate={{ opacity: [0.24, 0.42, 0.24], scale: [0.96, 1.06, 0.98] }}
        transition={{ duration: 8.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-8%] right-[10%] h-[320px] w-[320px] rounded-full bg-[#9fb5d4]/16 blur-3xl"
        animate={{ opacity: [0.12, 0.24, 0.15], scale: [0.92, 1.08, 0.96] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

        <div className="relative flex h-screen items-center justify-center px-4 py-5 sm:px-6 lg:px-8 xl:px-10">
          <div className="mx-auto w-full max-w-[1820px] lg:pl-[88px] lg:pr-[372px] xl:pr-[400px]">
            <div className="mx-auto flex h-[calc(100vh-2.5rem)] items-center justify-center">
              <div className="flex w-full justify-center origin-center lg:scale-[0.9] xl:scale-[0.96] 2xl:scale-100">
                <div className="flex w-full max-w-[760px] flex-col items-center">
                  <div className="mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-[#dbc8aa]/70 bg-white/55 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-[#917448] backdrop-blur-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{lang === 'pt' ? 'Santuario de escrita em curso' : 'Writing sanctuary in progress'}</span>
                  </div>
  
                  <div className="relative aspect-square w-[min(100%,calc(100vh-6.5rem))] max-w-[680px] overflow-hidden rounded-[36px] border border-[#e6d7bf]/80 bg-[linear-gradient(180deg,rgba(255,252,246,0.55),rgba(250,242,229,0.58))] px-5 py-5 shadow-[0_32px_120px_rgba(126,94,40,0.10)] backdrop-blur-md sm:px-7 lg:px-8">
                    <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#d4b77d] to-transparent opacity-70" />
                    <div className="absolute inset-y-8 left-0 w-px bg-gradient-to-b from-transparent via-[#eadbbc] to-transparent opacity-70" />
                    <div className="absolute inset-y-8 right-0 w-px bg-gradient-to-b from-transparent via-[#eadbbc] to-transparent opacity-70" />
  
                    <div className="flex h-full flex-col items-center justify-center gap-5">
                      <RitualCore progress={progress} lang={lang} />

                      <MinimalPhaseRibbon progress={progress} lang={lang} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,248,235,0.20),transparent_14%,transparent_86%,rgba(255,248,235,0.12))]" />
      </div>

      <GenerationTechnicalRail
        progress={progress}
        lang={lang}
        onAbort={onAbort}
        mobileOpen={mobileRailOpen}
        onToggleMobile={() => setMobileRailOpen(open => !open)}
      />
    </div>
  );
};

export default GenerationRitualOverlay;
