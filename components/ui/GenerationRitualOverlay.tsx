import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  Compass,
  Feather,
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

const SidebarVeil: React.FC = () => (
  <>
    <div className="pointer-events-auto fixed inset-y-0 left-0 z-40 hidden w-[80px] border-r border-[#e7d8be]/80 bg-[linear-gradient(180deg,rgba(248,241,226,0.74),rgba(241,231,210,0.78))] backdrop-blur-md lg:block" />
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden w-[80px] lg:block">
      <div className="absolute inset-x-3 top-10 rounded-[24px] border border-[#d6c09a]/70 bg-white/35 px-2 py-4 text-center shadow-[0_20px_45px_rgba(126,94,40,0.08)]">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[#d6c09a]/70 bg-[#fff8eb]/90 text-[#89652f]">
          <Compass className="h-4 w-4" />
        </div>
        <p className="mt-3 text-[9px] uppercase tracking-[0.24em] text-[#9f875f]">Rito</p>
        <p className="mt-1 text-[10px] leading-4 text-[#745d3a]">Admin sob selo</p>
      </div>
    </div>
  </>
);

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
            style={{ marginLeft: '-56px', marginTop: '-20px' }}
          >
            <div
              className={[
                'w-[112px] rounded-full border px-3 py-2 text-center text-[10px] uppercase tracking-[0.22em] shadow-sm backdrop-blur-sm',
                item.state === 'active'
                  ? `bg-white/95 ${item.meta.accentBorder} ${item.meta.accentText} ${item.meta.accentGlow}`
                  : item.state === 'done'
                  ? 'border-[#d9c6a4] bg-[#fffaf1] text-[#72562b]'
                  : 'border-[#e5d8c7] bg-white/70 text-[#a49175]',
              ].join(' ')}
            >
              {item.label}
            </div>
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
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
  const blueprint = progress.currentUniverse.longformBlueprint;
  const progressState = progress.currentUniverse.longformProgress;
  const currentChapter = progress.phase === 'aborted'
    ? Math.max(progress.chaptersDone, 1)
    : Math.min(progress.chaptersDone + 1, progress.totalChapters);
  const phaseFunction = formatChapterFunction(progressState?.currentFunction);

  const railBody = (
    <div className="w-full rounded-[34px] border border-[#ddcfbb] bg-[linear-gradient(180deg,rgba(255,252,246,0.94),rgba(248,240,225,0.94))] p-4 text-[#4e3f30] shadow-[0_26px_80px_rgba(145,114,69,0.14)] backdrop-blur-md">
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
            <h3 className={`mt-2 text-lg font-serif ${phaseMeta.accentText}`}>{phaseMeta.technical[lang]}</h3>
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

      <div className="mt-5 space-y-5">
        <div className={`rounded-[24px] border bg-white/76 p-3.5 ${phaseMeta.accentBorder}`}>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#9e8a69]">
            <Sparkles className={`h-3.5 w-3.5 ${phaseMeta.accentText}`} />
            <span>{lang === 'pt' ? 'Pulso atual do rito' : 'Current ritual pulse'}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#5b4a37]">{phaseMeta.mythicAction[lang]}</p>
        </div>

        <div className="rounded-[24px] border border-[#eadfcf] bg-white/75 p-3.5">
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

        <div className="grid grid-cols-2 gap-2">
          {PHASE_ORDER.map((phase, index) => {
            const isDone = getPhaseState(progress.phase, phase) === 'done';
            const isActive = getPhaseState(progress.phase, phase) === 'active';
            const itemMeta = PHASE_META[phase];
            return (
              <div
                key={phase}
                className={[
                  'rounded-[22px] border px-3 py-3 transition-colors',
                  isActive
                    ? `${itemMeta.accentBorder} bg-white/95 ${itemMeta.accentText}`
                    : isDone
                    ? 'border-[#dbc69b] bg-[#fff7e5] text-[#7b6133]'
                    : 'border-[#eadfcf] bg-white/60 text-[#aa9573]',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-xl border ${isActive ? itemMeta.accentBorder : 'border-[#e6d9c4]'} bg-white/80`}>
                    <itemMeta.icon className={`h-3.5 w-3.5 ${isActive ? itemMeta.accentText : isDone ? 'text-[#8c7041]' : 'text-[#aa9573]'}`} />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.18em]">{itemMeta.technical[lang]}</p>
                </div>
                <p className="mt-2 text-xs leading-5">
                  {isActive
                    ? (lang === 'pt' ? 'Em curso' : 'In progress')
                    : isDone
                    ? (lang === 'pt' ? 'Concluido' : 'Done')
                    : (lang === 'pt' ? 'Aguardando' : 'Waiting')}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-3 rounded-[24px] border border-[#eadfcf] bg-white/70 p-3.5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9e8a69]">
              {lang === 'pt' ? 'Funcao narrativa' : 'Narrative function'}
            </p>
            <p className="mt-1 text-sm text-[#4e3f30]">
              {phaseFunction ?? (lang === 'pt' ? 'Rito em abertura' : 'Ritual opening')}
            </p>
          </div>
          {progressState?.currentMilestone && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9e8a69]">
                {lang === 'pt' ? 'Marco em foco' : 'Milestone in focus'}
              </p>
              <p className="mt-1 text-sm leading-6 text-[#5a4a38]">{progressState.currentMilestone}</p>
            </div>
          )}
          {blueprint?.title && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9e8a69]">
                {lang === 'pt' ? 'Blueprint ativo' : 'Active blueprint'}
              </p>
              <p className="mt-1 text-sm text-[#4e3f30]">{blueprint.title}</p>
            </div>
          )}
        </div>

        <div className="rounded-[22px] border border-dashed border-[#d9cab6] bg-[#fcf8ef] p-3.5 text-xs leading-6 text-[#8d7a5a]">
          {lang === 'pt'
            ? 'O painel Agent Pipeline continua disponivel para tokens, providers e detalhes sem matar a cena principal.'
            : 'The Agent Pipeline panel remains available for tokens, providers, and details without killing the main scene.'}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:block lg:w-[360px] xl:w-[390px]">{railBody}</div>

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
  const currentChapter = progress.phase === 'aborted'
    ? Math.max(progress.chaptersDone, 1)
    : Math.min(progress.chaptersDone + 1, progress.totalChapters);
  const blueprint = progress.currentUniverse.longformBlueprint;
  const chapterMeta = blueprint?.chapterMap.find(entry => entry.chapterNumber === currentChapter);
  const PhaseIcon = phaseMeta.icon;

  return (
    <div className="relative mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
      <div className="relative flex h-[330px] w-[330px] items-center justify-center sm:h-[400px] sm:w-[400px] lg:h-[480px] lg:w-[480px]">
        <motion.div
          className={`absolute inset-[18%] rounded-full blur-3xl ${phaseMeta.accentSoft}`}
          animate={reducedMotion ? { opacity: 0.45 } : { opacity: [0.26, 0.52, 0.3], scale: [0.9, 1.12, 0.95] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
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

        <PhaseNodes phase={progress.phase} reducedMotion={reducedMotion} lang={lang} />

        <motion.div
          className={`relative z-10 flex h-[176px] w-[176px] flex-col items-center justify-center rounded-full border bg-[linear-gradient(180deg,rgba(255,253,248,0.96),rgba(247,238,220,0.92))] px-6 shadow-[0_26px_80px_rgba(145,114,69,0.16)] backdrop-blur-sm sm:h-[196px] sm:w-[196px] lg:h-[214px] lg:w-[214px] ${phaseMeta.accentBorder} ${phaseMeta.accentGlow}`}
          animate={reducedMotion ? { opacity: 1 } : { y: [0, -4, 0] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[#dbc8a7] bg-white/85">
            <PhaseIcon className={`h-5 w-5 ${phaseMeta.accentText}`} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.26em] text-[#9a845d]">
            {lang === 'pt' ? 'Capitulo' : 'Chapter'}
          </p>
          <p className="mt-1 font-serif text-4xl text-[#4c3923]">{currentChapter}</p>
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
        className="mt-3 max-w-[660px]"
      >
        <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[#a1875b]">
          <Sparkles className={`h-3.5 w-3.5 ${phaseMeta.accentText}`} />
          {lang === 'pt' ? 'Forja da obra' : 'Work forging'}
        </div>
        <h2 className="mt-4 font-serif text-3xl leading-tight text-[#3f3123] sm:text-5xl">
          {phaseMeta.poeticHeadline[lang]}
        </h2>
        <p className="mx-auto mt-4 max-w-[590px] text-sm leading-7 text-[#6e5d47] sm:text-base">
          {phaseMeta.poeticSubline[lang]}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.18em] text-[#7f6a49]">
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
      <SidebarVeil />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(215,187,126,0.28),_transparent_28%),radial-gradient(circle_at_20%_30%,_rgba(115,146,185,0.12),_transparent_30%),linear-gradient(180deg,_rgba(252,247,237,0.98),_rgba(243,232,211,0.98))]" />
      <div
        className="absolute inset-0 opacity-[0.23]"
        style={{
          backgroundImage:
            'linear-gradient(115deg, rgba(149,123,82,0.05) 0%, transparent 16%, rgba(149,123,82,0.035) 33%, transparent 50%, rgba(149,123,82,0.05) 66%, transparent 84%)',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.2),_transparent_52%)]" />
      <GreekKeyBand className="top-0 border-b border-[#e3d2b7]/70 bg-[#faf4e6]" />
      <GreekKeyBand className="bottom-0 border-t border-[#e3d2b7]/70 bg-[#faf4e6]" />
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

      <div className="relative ml-0 flex min-h-screen flex-col px-4 pb-28 pt-8 sm:px-6 lg:ml-[80px] lg:px-8 lg:py-8 xl:px-10">
        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
            <div className="w-full max-w-[980px]">
              <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-[#dbc8aa]/70 bg-white/55 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-[#917448] backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{lang === 'pt' ? 'Santuario de escrita em curso' : 'Writing sanctuary in progress'}</span>
              </div>

              <div className="relative overflow-hidden rounded-[40px] border border-[#e6d7bf]/80 bg-[linear-gradient(180deg,rgba(255,252,246,0.55),rgba(250,242,229,0.58))] px-5 py-8 shadow-[0_32px_120px_rgba(126,94,40,0.10)] backdrop-blur-md sm:px-8 lg:px-10">
                <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#d4b77d] to-transparent opacity-70" />
                <div className="absolute inset-y-8 left-0 w-px bg-gradient-to-b from-transparent via-[#eadbbc] to-transparent opacity-70" />
                <div className="absolute inset-y-8 right-0 w-px bg-gradient-to-b from-transparent via-[#eadbbc] to-transparent opacity-70" />

                <RitualCore progress={progress} lang={lang} />

                <div className="mt-8">
                  <AgentConstellation progress={progress} lang={lang} />
                </div>

                <div className="mt-8">
                  <CurrentDirectivePanel progress={progress} lang={lang} />
                </div>

                <div className="mt-8">
                  <RitualManifest progress={progress} lang={lang} />
                </div>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex lg:items-center lg:justify-end">
            <GenerationTechnicalRail
              progress={progress}
              lang={lang}
              onAbort={onAbort}
              mobileOpen={mobileRailOpen}
              onToggleMobile={() => setMobileRailOpen(open => !open)}
            />
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
