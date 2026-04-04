import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentOutputEvent, TokenUsageEvent } from '../../types';
import { subscribeToAgentOutput, subscribeToTokenUsage } from '../../services/geminiService';
import {
  Compass,
  Feather,
  BookOpenCheck,
  Swords,
  ScrollText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
  Copy,
  Check as CheckIcon,
  PenLine,
  Zap,
  Map as MapIcon,
} from 'lucide-react';

const M = motion as unknown as {
  div: React.FC<React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>>;
};

// ─── Agent metadata ───────────────────────────────────────────────────────────

const AGENT_META: Record<string, { icon: React.FC<{ className?: string }>; color: string; bg: string; label: string }> = {
  director:     { icon: MapIcon,       color: 'text-violet-500',  bg: 'bg-violet-500/10',  label: 'Director' },
  architect:   { icon: Compass,       color: 'text-amber-500',   bg: 'bg-amber-500/10',   label: 'Architect' },
  weaver:      { icon: ScrollText,    color: 'text-indigo-400',  bg: 'bg-indigo-400/10',  label: 'Weaver' },
  bard:        { icon: Feather,       color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Bard' },
  chronicler:  { icon: BookOpenCheck, color: 'text-sky-400',     bg: 'bg-sky-400/10',     label: 'Chronicler' },
  soulforger:  { icon: Swords,        color: 'text-rose-400',    bg: 'bg-rose-400/10',    label: 'Soulforger' },
  lector:      { icon: PenLine,       color: 'text-violet-400',  bg: 'bg-violet-400/10',  label: 'Lector' },
};

const getMeta = (agent: string) =>
  AGENT_META[agent] ?? { icon: Compass, color: 'text-stone-400', bg: 'bg-stone-400/10', label: agent };

const PROVIDER_COLOR: Record<string, string> = {
  groq:     '#f97316',
  gemini:   '#3b82f6',
  cerebras: '#a855f7',
  openrouter: '#10b981',
};
const PROVIDER_LABEL: Record<string, string> = {
  groq: 'Groq', gemini: 'Gemini', cerebras: 'Cerebras', openrouter: 'OpenRouter',
};

const fmt = (n: number) => n.toLocaleString('pt-BR');

// ─── Agent card ──────────────────────────────────────────────────────────────

const AgentCard: React.FC<{ event: AgentOutputEvent; tokenEvent?: TokenUsageEvent }> = ({ event, tokenEvent }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = getMeta(event.agent);
  const Icon = meta.icon;

  const isThinking = event.status === 'thinking';
  const isError    = event.status === 'error';

  return (
    <M.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`relative rounded-xl border overflow-hidden transition-colors duration-300 ${
        isThinking
          ? 'border-stone-300 bg-white shadow-md'
          : isError
            ? 'border-red-300 bg-red-50'
            : 'border-stone-200 bg-stone-50/80'
      }`}
    >
      {isThinking && (
        <M.div
          className={`absolute top-0 left-0 h-0.5 ${meta.color.replace('text-', 'bg-')}`}
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 12, ease: 'linear' }}
        />
      )}

      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => !isThinking && setExpanded(prev => !prev)}
      >
        {/* Agent icon */}
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${meta.color}`} />
        </div>

        {/* Label + summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
            <span className="text-[11px] text-stone-400 truncate">{event.label}</span>
          </div>
          {event.summary && (
            <p className="text-xs text-stone-600 truncate mt-0.5">{event.summary}</p>
          )}
          {/* Token badge inline */}
          {tokenEvent && (
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: `${PROVIDER_COLOR[tokenEvent.provider]}18`,
                  color: PROVIDER_COLOR[tokenEvent.provider],
                  border: `1px solid ${PROVIDER_COLOR[tokenEvent.provider]}33`,
                }}
              >
                {PROVIDER_LABEL[tokenEvent.provider]}
              </span>
              <span className="text-[10px] text-stone-400 font-mono">
                {fmt(tokenEvent.totalTokens)} tok
                <span className="text-stone-300 mx-1">·</span>
                <span className="text-stone-400">↑{fmt(tokenEvent.inputTokens)}</span>
                <span className="text-stone-300 mx-0.5"> </span>
                <span className="text-stone-400">↓{fmt(tokenEvent.outputTokens)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {isThinking ? (
            <Loader2 className={`w-4 h-4 animate-spin ${meta.color}`} />
          ) : isError ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              {event.detail && (
                expanded
                  ? <ChevronUp className="w-3.5 h-3.5 text-stone-400" />
                  : <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
              )}
            </>
          )}
        </div>
      </div>

      {/* Expandable detail */}
      <AnimatePresence>
        {expanded && event.detail && (
          <M.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0">
              <div className="bg-stone-100 rounded-lg p-3 text-xs font-mono text-stone-600 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {event.detail}
              </div>
            </div>
          </M.div>
        )}
      </AnimatePresence>
    </M.div>
  );
};

const Connector: React.FC = () => (
  <div className="flex justify-center py-0.5">
    <div className="w-px h-4 bg-gradient-to-b from-stone-300 to-stone-200" />
  </div>
);

// ─── Build export text (includes token info) ─────────────────────────────────

const buildExportText = (evs: AgentOutputEvent[], tokenMap: Map<string, TokenUsageEvent>): string => {
  const done = evs.filter(e => e.status === 'done' || e.status === 'error');
  const lines: string[] = [
    '══════════════════════════════════════════',
    '  MYTHOS ENGINE — Agent Pipeline Export',
    `  ${new Date().toLocaleString('pt-BR')}`,
    '══════════════════════════════════════════',
    '',
  ];
  done.forEach((ev, idx) => {
    const meta = getMeta(ev.agent);
    const tok = tokenMap.get(ev.id);
    lines.push(`[${idx + 1}] ${meta.label.toUpperCase()} · ${ev.label}`);
    lines.push('─'.repeat(44));
    if (ev.summary) lines.push(`OUTPUT: ${ev.summary}`);
    if (tok) {
      lines.push(`TOKENS: ${fmt(tok.totalTokens)} total (↑${fmt(tok.inputTokens)} entrada · ↓${fmt(tok.outputTokens)} saída) · ${PROVIDER_LABEL[tok.provider]} / ${tok.model}`);
    }
    if (ev.detail) {
      lines.push('');
      lines.push('DETAIL:');
      lines.push(ev.detail);
    }
    lines.push('');
  });
  return lines.join('\n');
};

// ─── Token summary footer ─────────────────────────────────────────────────────

const TokenFooter: React.FC<{ tokenEvents: TokenUsageEvent[] }> = ({ tokenEvents }) => {
  if (tokenEvents.length === 0) return null;

  const totalAll = tokenEvents.reduce((s, e) => s + e.totalTokens, 0);
  const byProvider: Record<string, number> = {};
  for (const e of tokenEvents) {
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + e.totalTokens;
  }

  return (
    <div className="px-3 py-2 border-t border-stone-800 bg-stone-950 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Zap className="w-3 h-3 text-amber-400" />
        <span className="text-[10px] font-mono text-stone-300 font-semibold">{fmt(totalAll)} tok</span>
        <span className="text-[10px] text-stone-600">sessão</span>
      </div>
      <div className="flex items-center gap-2">
        {Object.entries(byProvider).map(([provider, total]) => (
          <div key={provider} className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: PROVIDER_COLOR[provider] ?? '#888' }}
            />
            <span className="text-[10px] font-mono" style={{ color: PROVIDER_COLOR[provider] ?? '#aaa' }}>
              {fmt(total)}
            </span>
            <span className="text-[9px] text-stone-600">{PROVIDER_LABEL[provider] ?? provider}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Main panel ──────────────────────────────────────────────────────────────

const AgentThinkingPanel: React.FC = () => {
  const [events, setEvents] = useState<AgentOutputEvent[]>([]);
  const [tokenEvents, setTokenEvents] = useState<TokenUsageEvent[]>([]);
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Map agentEvent.id → token event by matching sequential occurrence per label
  const tokenMap = React.useMemo(() => {
    const byLabel = new Map<string, TokenUsageEvent[]>();
    for (const t of tokenEvents) {
      const list = byLabel.get(t.label);
      if (list) list.push(t); else byLabel.set(t.label, [t]);
    }
    const labelCount = new Map<string, number>();
    const result = new Map<string, TokenUsageEvent>();
    for (const ev of events) {
      const n = labelCount.get(ev.label) ?? 0;
      labelCount.set(ev.label, n + 1);
      const list = byLabel.get(ev.label);
      if (list?.[n]) result.set(ev.id, list[n]);
    }
    return result;
  }, [tokenEvents, events]);

  useEffect(() => {
    const unsubAgent = subscribeToAgentOutput((ev) => {
      setEvents(prev => {
        const idx = prev.findIndex(e => e.agent === ev.agent && e.label === ev.label && e.status === 'thinking');
        if (idx >= 0 && ev.status !== 'thinking') {
          const copy = [...prev];
          copy[idx] = ev;
          return copy;
        }
        return [...prev, ev];
      });
      setVisible(true);
      setMinimized(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    });

    const unsubToken = subscribeToTokenUsage((ev) => {
      setTokenEvents(prev => [...prev, ev]);
    });

    return () => { unsubAgent(); unsubToken(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  useEffect(() => {
    const allDone = events.length > 0 && events.every(e => e.status === 'done' || e.status === 'error');
    if (allDone) {
      hideTimer.current = setTimeout(() => setMinimized(true), 8000);
      return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    }
  }, [events]);

  const handleClose = () => {
    setVisible(false);
    setEvents([]);
    setTokenEvents([]);
  };

  const handleCopy = useCallback(() => {
    const text = buildExportText(events, tokenMap);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [events, tokenMap]);

  const activeCount = events.filter(e => e.status === 'thinking').length;
  const doneCount = events.filter(e => e.status === 'done').length;
  const canExport = doneCount > 0;

  if (!visible || events.length === 0) return null;

  return (
    <AnimatePresence>
      <M.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="fixed bottom-4 right-4 z-50 w-[400px] max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="bg-stone-900 rounded-t-xl px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Compass className="w-4 h-4 text-amber-400" />
              {activeCount > 0 && (
                <M.div
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
              )}
            </div>
            <span className="text-xs font-mono uppercase tracking-widest text-stone-300">
              Agent Pipeline
            </span>
            <span className="text-[10px] text-stone-500 ml-1">
              {doneCount}/{events.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {canExport && (
              <button
                onClick={handleCopy}
                title="Copiar pipeline completo"
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all duration-200 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-stone-700 hover:bg-stone-600 text-stone-300 hover:text-white'
                }`}
              >
                {copied
                  ? <><CheckIcon className="w-3 h-3" /> Copiado!</>
                  : <><Copy className="w-3 h-3" /> Exportar</>
                }
              </button>
            )}
            <button
              onClick={() => setMinimized(prev => !prev)}
              className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors"
            >
              {minimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleClose}
              className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <AnimatePresence>
          {!minimized && (
            <M.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden bg-white/95 backdrop-blur-md border border-t-0 border-stone-200 shadow-2xl"
            >
              <div ref={scrollRef} className="p-3 space-y-0 max-h-[62vh] overflow-y-auto">
                {events.map((ev, idx) => (
                  <React.Fragment key={ev.id}>
                    <AgentCard event={ev} tokenEvent={tokenMap.get(ev.id)} />
                    {idx < events.length - 1 && <Connector />}
                  </React.Fragment>
                ))}
              </div>
            </M.div>
          )}
        </AnimatePresence>

        {/* Token footer */}
        {!minimized && (
          <TokenFooter tokenEvents={tokenEvents} />
        )}

        {/* Rounded bottom only when footer present */}
        {!minimized && (
          <div className="bg-stone-950 rounded-b-xl h-1" />
        )}

        {/* Rounded bottom when minimized */}
        {minimized && (
          <div className="bg-stone-900 rounded-b-xl px-4 py-1.5 border border-t-0 border-stone-800">
            <TokenFooter tokenEvents={tokenEvents} />
          </div>
        )}
      </M.div>
    </AnimatePresence>
  );
};

export default AgentThinkingPanel;
