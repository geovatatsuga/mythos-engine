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

const AgentCard: React.FC<{ event: AgentOutputEvent; tokenEvents?: TokenUsageEvent[] }> = ({ event, tokenEvents = [] }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = getMeta(event.agent);
  const Icon = meta.icon;

  const isThinking = event.status === 'thinking';
  const isError    = event.status === 'error';
  const totalTokens = tokenEvents.reduce((sum, item) => sum + item.totalTokens, 0);
  const providers = Array.from(new Set(tokenEvents.map(item => item.provider)));
  const primaryTokenEvent = tokenEvents[tokenEvents.length - 1];

  return (
    <M.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`relative rounded-xl border overflow-hidden transition-colors duration-300 ${
        isThinking
          ? 'border-[#dbc89f] bg-[linear-gradient(180deg,rgba(255,252,246,0.96),rgba(250,244,232,0.96))] shadow-[0_18px_45px_rgba(128,96,51,0.10)]'
          : isError
            ? 'border-red-300 bg-red-50/95'
            : 'border-[#e8dcc8] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,243,236,0.9))]'
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
        <div className={`relative flex-shrink-0 w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center`}>
          {isThinking && (
            <M.div
              className="absolute inset-0 rounded-lg border border-current opacity-30"
              animate={{ scale: [1, 1.18, 1], opacity: [0.18, 0.36, 0.18] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            />
          )}
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
          {tokenEvents.length > 0 && primaryTokenEvent && (
            <div className="flex items-center gap-1.5 mt-1">
              {providers.map((provider) => (
                <span
                  key={provider}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: `${PROVIDER_COLOR[provider]}18`,
                    color: PROVIDER_COLOR[provider],
                    border: `1px solid ${PROVIDER_COLOR[provider]}33`,
                  }}
                >
                  {PROVIDER_LABEL[provider]}
                </span>
              ))}
              <span className="max-w-[220px] truncate rounded-full border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-[9px] font-mono text-stone-500">
                {primaryTokenEvent.model}
              </span>
              <span className="text-[10px] text-stone-400 font-mono">
                {fmt(totalTokens)} tok
                {tokenEvents.length > 1 && <span className="text-stone-300 mx-1">· {tokenEvents.length} chamadas</span>}
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
              {tokenEvents.length > 1 && (
                <div className="mt-2 rounded-lg border border-stone-200 bg-white p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">
                    Providers usados nesta etapa
                  </p>
                  <div className="space-y-1.5">
                    {tokenEvents.map((token, index) => (
                      <div key={`${token.id}-${index}`} className="flex items-center justify-between gap-3 text-[10px] font-mono text-stone-500">
                        <span className="truncate">
                          {PROVIDER_LABEL[token.provider]} / {token.model}
                        </span>
                        <span className="shrink-0 text-stone-400">{fmt(token.totalTokens)} tok</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

const buildExportText = (evs: AgentOutputEvent[], tokenMap: Map<string, TokenUsageEvent[]>): string => {
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
    const toks = tokenMap.get(ev.id) ?? [];
    const tok = toks[toks.length - 1];
    lines.push(`[${idx + 1}] ${meta.label.toUpperCase()} · ${ev.label}`);
    lines.push('─'.repeat(44));
    if (ev.summary) lines.push(`OUTPUT: ${ev.summary}`);
    if (tok) {
      const total = toks.reduce((sum, item) => sum + item.totalTokens, 0);
      lines.push(`TOKENS: ${fmt(total)} total${toks.length > 1 ? ` em ${toks.length} chamadas` : ''} · último: ${PROVIDER_LABEL[tok.provider]} / ${tok.model}`);
      if (toks.length > 1) {
        toks.forEach((entry) => {
          lines.push(`  - ${PROVIDER_LABEL[entry.provider]} / ${entry.model} · ↑${fmt(entry.inputTokens)} entrada · ↓${fmt(entry.outputTokens)} saída · ${fmt(entry.totalTokens)} total`);
        });
      } else {
        lines.push(`  - ↑${fmt(tok.inputTokens)} entrada · ↓${fmt(tok.outputTokens)} saída`);
      }
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
  const [minimized, setMinimized] = useState(true);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Map agentEvent.id → token event by matching sequential occurrence per label
  const tokenMap = React.useMemo(() => {
    const result = new Map<string, TokenUsageEvent[]>();
    const completedByLabel = new Map<string, AgentOutputEvent[]>();

    for (const ev of events) {
      const list = completedByLabel.get(ev.label);
      if (list) list.push(ev);
      else completedByLabel.set(ev.label, [ev]);
    }

    for (const [label, labelEvents] of completedByLabel.entries()) {
      const matchingTokens = tokenEvents
        .filter(token => token.label === label)
        .sort((a, b) => a.timestamp - b.timestamp);
      const orderedEvents = [...labelEvents].sort((a, b) => a.timestamp - b.timestamp);

      orderedEvents.forEach((ev, index) => {
        const previousEventTime = index > 0 ? orderedEvents[index - 1].timestamp : -Infinity;
        const tokensForEvent = matchingTokens.filter(token => token.timestamp > previousEventTime && token.timestamp <= ev.timestamp);
        if (tokensForEvent.length > 0) result.set(ev.id, tokensForEvent);
      });
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
      if (ev.status === 'error') {
        setMinimized(false);
      }
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
        className="fixed bottom-4 right-4 z-50 flex w-[340px] max-h-[85vh] flex-col xl:w-[360px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl border border-b-0 border-[#2b241d] bg-[linear-gradient(180deg,#221d19,#171310)] px-4 py-3">
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
              className="overflow-hidden border border-t-0 border-[#dcc9a8] bg-[linear-gradient(180deg,rgba(255,251,243,0.9),rgba(248,239,223,0.84))] shadow-[0_24px_80px_rgba(14,10,4,0.28)] backdrop-blur-xl"
            >
              <div ref={scrollRef} className="p-3 space-y-0 max-h-[62vh] overflow-y-auto">
                {events.map((ev, idx) => (
                  <React.Fragment key={ev.id}>
                    <AgentCard event={ev} tokenEvents={tokenMap.get(ev.id)} />
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
          <div className="h-1 rounded-b-2xl bg-stone-950" />
        )}

        {/* Rounded bottom when minimized */}
        {minimized && (
          <div className="rounded-b-2xl border border-t-0 border-stone-800 bg-stone-900 px-4 py-1.5">
            <TokenFooter tokenEvents={tokenEvents} />
          </div>
        )}
      </M.div>
    </AnimatePresence>
  );
};

export default AgentThinkingPanel;
