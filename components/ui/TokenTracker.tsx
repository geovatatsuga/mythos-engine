import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, X, Zap } from 'lucide-react';
import type { TokenUsageEvent } from '../../types';

interface TokenTrackerProps {
  events: TokenUsageEvent[];
  onClear: () => void;
}

const PROVIDER_STYLE = {
  groq: {
    badge: 'bg-orange-100 text-orange-700 border border-orange-200',
    dot: 'bg-orange-400',
    label: 'Groq',
  },
  gemini: {
    badge: 'bg-blue-100 text-blue-700 border border-blue-200',
    dot: 'bg-blue-400',
    label: 'Gemini',
  },
  cerebras: {
    badge: 'bg-purple-100 text-purple-700 border border-purple-200',
    dot: 'bg-purple-400',
    label: 'Cerebras',
  },
  openrouter: {
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    dot: 'bg-emerald-400',
    label: 'OpenRouter',
  },
} as const;

const fmt = (n: number) => n.toLocaleString('pt-BR');

const TokenTracker: React.FC<TokenTrackerProps> = ({ events, onClear }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Session totals
  const totalIn = events.reduce((s, e) => s + e.inputTokens, 0);
  const totalOut = events.reduce((s, e) => s + e.outputTokens, 0);
  const totalAll = totalIn + totalOut;
  const groqTotal = events.filter(e => e.provider === 'groq').reduce((s, e) => s + e.totalTokens, 0);
  const geminiTotal = events.filter(e => e.provider === 'gemini').reduce((s, e) => s + e.totalTokens, 0);
  const cerebrasTotal = events.filter(e => e.provider === 'cerebras').reduce((s, e) => s + e.totalTokens, 0);
  const openrouterTotal = events.filter(e => e.provider === 'openrouter').reduce((s, e) => s + e.totalTokens, 0);

  const recent = expanded ? [...events].reverse() : [...events].reverse().slice(0, 5);

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-1 font-sans select-none">
      {/* Expanded panel */}
      {open && (
        <div
          className="w-80 bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden"
          style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-stone-50 border-b border-stone-200">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-stone-500" />
              <span className="text-xs font-semibold text-stone-700 uppercase tracking-wider">Uso de Tokens</span>
            </div>
            <div className="flex items-center gap-2">
              {events.length > 0 && (
                <button
                  onClick={onClear}
                  className="text-[10px] text-stone-400 hover:text-red-500 transition-colors"
                >
                  limpar
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-stone-400 italic">
              Nenhuma requisição ainda.<br />Gere um capítulo para começar.
            </div>
          ) : (
            <>
              {/* Session summary */}
              <div className="px-4 py-3 border-b border-stone-100 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-orange-50 rounded-lg p-2 border border-orange-100">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
                    <span className="text-[10px] font-semibold text-orange-700">Groq</span>
                  </div>
                  <p className="text-sm font-bold text-orange-900">{fmt(groqTotal)}</p>
                  <p className="text-[10px] text-orange-500">tokens totais</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-2 border border-blue-100">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                    <span className="text-[10px] font-semibold text-blue-700">Gemini</span>
                  </div>
                  <p className="text-sm font-bold text-blue-900">{fmt(geminiTotal)}</p>
                  <p className="text-[10px] text-blue-500">tokens totais</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-2 border border-purple-100">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                    <span className="text-[10px] font-semibold text-purple-700">Cerebras</span>
                  </div>
                  <p className="text-sm font-bold text-purple-900">{fmt(cerebrasTotal)}</p>
                  <p className="text-[10px] text-purple-500">tokens totais</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    <span className="text-[10px] font-semibold text-emerald-700">OpenRouter</span>
                  </div>
                  <p className="text-sm font-bold text-emerald-900">{fmt(openrouterTotal)}</p>
                  <p className="text-[10px] text-emerald-500">tokens totais</p>
                </div>
                <div className="col-span-2 md:col-span-4 bg-stone-50 rounded-lg p-2 border border-stone-200 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-stone-500">Sessão total</p>
                    <p className="text-sm font-bold text-stone-800">{fmt(totalAll)} tokens</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-stone-400">↑ {fmt(totalIn)} entrada</p>
                    <p className="text-[10px] text-stone-400">↓ {fmt(totalOut)} saída</p>
                  </div>
                </div>
              </div>

              {/* Call log */}
              <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1.5">
                {recent.map(ev => {
                  const style = PROVIDER_STYLE[ev.provider];
                  const time = new Date(ev.timestamp).toLocaleTimeString('pt-BR', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  });
                  return (
                    <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-stone-50 last:border-0">
                      <span className={`mt-0.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${style.badge}`}>
                        {style.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-stone-700 truncate">{ev.label}</p>
                        <p className="text-[10px] text-stone-400">
                          {fmt(ev.totalTokens)} tok &nbsp;·&nbsp; ↑{fmt(ev.inputTokens)} ↓{fmt(ev.outputTokens)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[9px] text-stone-300 mt-0.5">{time}</span>
                    </div>
                  );
                })}
              </div>

              {/* Show more / less */}
              {events.length > 5 && (
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="w-full text-[10px] text-stone-400 hover:text-stone-600 py-2 border-t border-stone-100 flex items-center justify-center gap-1 transition-colors"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'Mostrar menos' : `Ver todos os ${events.length} registros`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Floating pill button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-full shadow-lg border border-stone-200 hover:border-stone-300 hover:shadow-xl transition-all group"
      >
        <Zap className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-600" />
        <span className="text-[11px] font-semibold text-stone-600">
          {fmt(totalAll)} tok
        </span>
        {groqTotal > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
          </span>
        )}
        {geminiTotal > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          </span>
        )}
        {cerebrasTotal > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
          </span>
        )}
        {openrouterTotal > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </span>
        )}
        {events.length > 0 && (
          <span className="bg-stone-100 text-stone-500 text-[9px] px-1 py-0.5 rounded-full font-mono">
            {events.length}
          </span>
        )}
      </button>
    </div>
  );
};

export default TokenTracker;
