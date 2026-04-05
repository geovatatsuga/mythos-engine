import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Character, CodexEntry, RuleEntryKind, TimelineImpact, TimelineScope, Universe } from '../types';
import Button from './ui/Button';
import Modal from './ui/Modal';
import CharacterPortrait from './ui/CharacterPortrait';
import InlineHelp from './ui/InlineHelp';
import { RelationshipConstellation } from './CharactersView';
import { collectCharacterMentions, collectCodexEntryMentions, markUniverseDirty } from '../services/geminiService';
import { BookOpen, ChevronDown, Clock, Edit3, EyeOff, Globe2, LayoutGrid, MapPin, Plus, Radar, Scale, Search, Share2, Shield, Sparkles, Users } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

type CodexBucket = 'timeline' | 'factions' | 'rules';
type CharacterDraft = Character | null;
type CodexEntryDraft = {
  title: string;
  aliases: string;
  content: string;
  notesPrivate: string;
  ruleKind: RuleEntryKind;
  aiVisibility: 'global' | 'tracked' | 'hidden';
  trackByAlias: boolean;
  caseSensitive: boolean;
  exclusions: string;
  truthCanon: string;
  truthBelief: string;
  truthMyth: string;
  truthNeedsReview: boolean;
  eventState: 'historical' | 'active_pressure' | 'latent' | 'resolved' | 'forecast';
  discoveryKind: 'past_occurrence' | 'present_discovery' | 'forecast';
  timelineImpact: TimelineImpact;
  timelineScope: TimelineScope;
  relatedEntities: string;
  anchorCharacters: string;
};

const LOCATION_HINTS = ['bairro', 'torre', 'templo', 'cidade', 'reino', 'fortaleza', 'palacio', 'palácio', 'porto', 'floresta', 'ruina', 'ruína', 'distrito', 'megacidade', 'district', 'tower', 'temple', 'city', 'kingdom', 'forest'];
const LAW_HINTS = ['lei', 'regra', 'ritual', 'dogma', 'doutrina', 'mandamento', 'pacto', 'codigo', 'código', 'magic', 'magia', 'law', 'rule', 'curse', 'oath'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const FACTION_PALETTES = [
  { from: '#1a0f00', to: '#2a1900', line: '#C5A059', text: '#e8d4a8' },
  { from: '#0d1520', to: '#172030', line: '#7c8fa8', text: '#b8cadb' },
  { from: '#1a0608', to: '#280a10', line: '#ef4444', text: '#f8b4b4' },
  { from: '#081a10', to: '#102818', line: '#22c55e', text: '#a7f3c0' },
];

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const splitAliases = (value: string) => value.split(',').map(alias => alias.trim()).filter(Boolean);
const aliasString = (aliases?: string[]) => (aliases ?? []).join(', ');
const includesSearch = (haystack: string, needle: string) => !needle || normalize(haystack).includes(normalize(needle));
const toRoman = (n: number) => ROMAN[n] ?? String(n + 1);
const normalizeLabel = (value: string) => normalize(value.trim());

const sectionDefs = (lang: 'pt' | 'en', t: (key: string) => string) => [
  { id: 'overview', label: t('codex.section.overview'), icon: <Globe2 className="h-4 w-4" /> },
  { id: 'characters', label: t('codex.section.characters'), icon: <Users className="h-4 w-4" /> },
  { id: 'factions', label: t('codex.section.factionsRealm'), icon: <Shield className="h-4 w-4" /> },
  { id: 'systemsMagic', label: lang === 'en' ? 'Lore & Systems' : 'Lore & Sistemas', icon: <Scale className="h-4 w-4" /> },
  { id: 'locations', label: t('codex.section.locations'), icon: <MapPin className="h-4 w-4" /> },
  { id: 'timeline', label: t('codex.section.timeline'), icon: <Clock className="h-4 w-4" /> },
];

const filterEntry = (entry: CodexEntry, search: string) => includesSearch([entry.title, entry.content, aliasString(entry.aliases), entry.notesPrivate ?? ''].join(' '), search);
const filterCharacter = (character: Character, search: string) => includesSearch([character.name, character.role, character.faction, character.status, character.bio, character.alignment, aliasString(character.aliases), character.notesPrivate ?? ''].join(' '), search);
const classifyRule = (entry: CodexEntry): RuleEntryKind => {
  if (entry.ruleKind) return entry.ruleKind;
  const blob = normalize(`${entry.title} ${entry.content}`);
  if (LOCATION_HINTS.some(hint => blob.includes(hint))) return 'location';
  if (LAW_HINTS.some(hint => blob.includes(hint))) return normalize(entry.title).includes('mag') || normalize(entry.content).includes('mag') ? 'magic' : 'system';
  return 'lore';
};

const ruleKindLabel = (kind: RuleEntryKind, lang: 'pt' | 'en') => {
  const labels = {
    pt: { system: 'Sistema', magic: 'Magia & Poder', location: 'Local', lore: 'Lore' },
    en: { system: 'System', magic: 'Magic & Power', location: 'Location', lore: 'Lore' },
  } as const;
  return labels[lang][kind];
};

const timelineImpactLabel = (value: TimelineImpact, lang: 'pt' | 'en') => {
  const labels = {
    pt: { low: 'baixo', medium: 'médio', high: 'alto', cataclysmic: 'cataclísmico' },
    en: { low: 'low', medium: 'medium', high: 'high', cataclysmic: 'cataclysmic' },
  } as const;
  return labels[lang][value];
};

const timelineScopeLabel = (value: TimelineScope, lang: 'pt' | 'en') => {
  const labels = {
    pt: { personal: 'pessoal', local: 'local', faction: 'facção', world: 'mundo' },
    en: { personal: 'personal', local: 'local', faction: 'faction', world: 'world' },
  } as const;
  return labels[lang][value];
};

const SectionBlock = ({ id, title, icon, subtitle, count, action, active = true, children }: { id: string; title: string; icon: React.ReactNode; subtitle: string; count?: number; action?: React.ReactNode; active?: boolean; children: React.ReactNode }) => (
  <section id={id} className={`scroll-mt-28 ${active ? '' : 'hidden'}`}>
    <div className="mb-5 flex items-center justify-between gap-3 border-b border-stone-200 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-nobel">{icon}</div>
          <h2 className="font-serif text-2xl font-bold text-stone-900">{title}</h2>
          {count !== undefined && <span className="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-[10px] font-mono text-stone-500">{count}</span>}
        </div>
        <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const FieldBlock = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-stone-500">{label}</p>
      {hint && <p className="mt-1 text-xs leading-5 text-stone-500">{hint}</p>}
    </div>
    {children}
  </div>
);

const SegmentedToggle = ({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string; meta?: string }>; onChange: (value: string) => void }) => (
  <div className="inline-flex rounded-2xl border border-stone-200 bg-white p-1 shadow-sm">
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${value === option.value ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'}`}
      >
        <span className="block">{option.label}</span>
        {option.meta && <span className={`mt-0.5 block text-[10px] font-medium ${value === option.value ? 'text-stone-300' : 'text-stone-400'}`}>{option.meta}</span>}
      </button>
    ))}
  </div>
);

const EntryCollectionPanel = ({ title, subtitle, entries, addLabel, onAdd, onEdit, emptyTitle, emptyBody, accent = 'stone' }: { title: string; subtitle: string; entries: CodexEntry[]; addLabel: string; onAdd: () => void; onEdit: (entry: CodexEntry) => void; emptyTitle: string; emptyBody: string; accent?: 'stone' | 'amber' | 'sky' | 'violet' }) => {
  const { lang } = useLanguage();
  const accentStyles = {
    stone: { border: 'border-stone-200', soft: 'bg-stone-50', badge: 'bg-stone-100 text-stone-700' },
    amber: { border: 'border-amber-200', soft: 'bg-amber-50/70', badge: 'bg-amber-100 text-amber-800' },
    sky: { border: 'border-sky-200', soft: 'bg-sky-50/70', badge: 'bg-sky-100 text-sky-800' },
    violet: { border: 'border-violet-200', soft: 'bg-violet-50/70', badge: 'bg-violet-100 text-violet-800' },
  } as const;
  const tone = accentStyles[accent];

  return (
    <div className={`rounded-[26px] border ${tone.border} bg-white p-5 shadow-sm`}>
      <div className="flex flex-col gap-4 border-b border-stone-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-xl font-bold text-stone-900">{title}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${tone.badge}`}>{entries.length}</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{subtitle}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className={`mt-4 rounded-2xl border border-dashed ${tone.border} ${tone.soft} p-6 text-center`}>
          <p className="font-serif text-lg font-bold text-stone-900">{emptyTitle}</p>
          <p className="mt-2 text-sm leading-6 text-stone-500">{emptyBody}</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {entries.map((entry, index) => (
            <motion.button
              key={entry.id}
              type="button"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
              onClick={() => onEdit(entry)}
              className={`group rounded-2xl border ${tone.border} bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-serif text-lg font-bold text-stone-900">{entry.title}</p>
                  {entry.aliases.length > 0 && <p className="mt-1 text-xs text-stone-400">Aliases: {aliasString(entry.aliases)}</p>}
                </div>
                <Edit3 className="h-4 w-4 flex-shrink-0 text-stone-300 transition-colors group-hover:text-stone-700" />
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {entry.ruleKind && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone.badge}`}>{ruleKindLabel(entry.ruleKind, lang)}</span>}
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">{entry.aiVisibility}</span>
              </div>
              <p className="line-clamp-4 text-sm leading-7 text-stone-600">{entry.content}</p>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
};

const VisibilityPresetCard = ({ active, title, body, tone, onClick }: { active: boolean; title: string; body: string; tone: 'global' | 'tracked' | 'hidden'; onClick: () => void }) => {
  const toneStyles = {
    global: active ? 'border-amber-400 bg-amber-50 shadow-amber-100' : 'border-amber-200/70 bg-white hover:border-amber-300',
    tracked: active ? 'border-sky-400 bg-sky-50 shadow-sky-100' : 'border-sky-200/70 bg-white hover:border-sky-300',
    hidden: active ? 'border-stone-500 bg-stone-100 shadow-stone-200' : 'border-stone-200 bg-white hover:border-stone-400',
  } as const;

  const toneBadge = {
    global: 'bg-amber-100 text-amber-800',
    tracked: 'bg-sky-100 text-sky-800',
    hidden: 'bg-stone-200 text-stone-700',
  } as const;

  return (
    <button type="button" onClick={onClick} className={`w-full rounded-2xl border p-4 text-left transition-all shadow-sm ${toneStyles[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-serif text-base font-bold text-stone-900">{title}</p>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${toneBadge[tone]}`}>{tone}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-stone-600">{body}</p>
    </button>
  );
};

const EntryModal = ({ open, title, bucket, value, mentions, onClose, onSave }: { open: boolean; title: string; bucket: CodexBucket; value: CodexEntryDraft; mentions: Array<{ label: string; excerpt: string; sourceType: string }>; onClose: () => void; onSave: (value: CodexEntryDraft) => void }) => {
  const { t, lang } = useLanguage();
  const [draft, setDraft] = useState(value);
  const [tab, setTab] = useState<'details' | 'truth' | 'mentions' | 'tracking'>('details');
  useEffect(() => setDraft(value), [value]);
  useEffect(() => setTab('details'), [open, value.title]);
  return (
    <Modal isOpen={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-stone-200 pb-3">
          {[
            { id: 'details', label: lang === 'en' ? 'Details' : 'Detalhes' },
            { id: 'truth', label: lang === 'en' ? 'Truth' : 'Verdade' },
            { id: 'mentions', label: lang === 'en' ? 'Mentions' : 'Menções' },
            { id: 'tracking', label: 'Tracking' },
          ].map(item => (
            <button key={item.id} onClick={() => setTab(item.id as typeof tab)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === item.id ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <div className="space-y-4">
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.title} onChange={e => setDraft(prev => ({ ...prev, title: e.target.value }))} placeholder={lang === 'en' ? 'Title' : 'Título'} />
            <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.aliases} onChange={e => setDraft(prev => ({ ...prev, aliases: e.target.value }))} placeholder="Aliases" />
            {bucket === 'rules' && (
              <>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                  {lang === 'en'
                    ? 'Systems explain how the world operates, magic explains how power works, locations anchor space, and lore holds myths, beliefs, and cultural memory.'
                    : 'Sistemas explicam como o mundo opera, magia explica como o poder funciona, locais ancoram o espaço e lore guarda mitos, crenças e memória cultural.'}
                </div>
                <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.ruleKind} onChange={e => setDraft(prev => ({ ...prev, ruleKind: e.target.value as RuleEntryKind }))}>
                  <option value="system">{ruleKindLabel('system', lang)}</option>
                  <option value="magic">{ruleKindLabel('magic', lang)}</option>
                  <option value="location">{ruleKindLabel('location', lang)}</option>
                  <option value="lore">{ruleKindLabel('lore', lang)}</option>
                </select>
              </>
            )}
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
              <span>{lang === 'en' ? 'AI Visibility' : 'Visibilidade IA'}</span>
              <InlineHelp content={t('help.codex.aiVisibility')} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <VisibilityPresetCard active={draft.aiVisibility === 'global'} tone="global" title={lang === 'en' ? 'Global anchor' : 'Âncora global'} body={lang === 'en' ? 'Always enters context. Use for hard canon, core rules, or central factions.' : 'Sempre entra no contexto. Use para cÃ¢none duro, regras centrais ou facÃ§Ãµes-chave.'} onClick={() => setDraft(prev => ({ ...prev, aiVisibility: 'global' }))} />
              <VisibilityPresetCard active={draft.aiVisibility === 'tracked'} tone="tracked" title={lang === 'en' ? 'Tracked recall' : 'MemÃ³ria rastreada'} body={lang === 'en' ? 'Enters when the tracker detects names, aliases, or related pressure in the scene.' : 'Entra quando o tracker detecta nomes, aliases ou pressÃ£o relacionada na cena.'} onClick={() => setDraft(prev => ({ ...prev, aiVisibility: 'tracked' }))} />
              <VisibilityPresetCard active={draft.aiVisibility === 'hidden'} tone="hidden" title={lang === 'en' ? 'Author-only' : 'SÃ³ autor'} body={lang === 'en' ? 'Stays in your archive, but is withheld from generation context.' : 'Fica no seu arquivo, mas nÃ£o entra no contexto de geraÃ§Ã£o.'} onClick={() => setDraft(prev => ({ ...prev, aiVisibility: 'hidden' }))} />
            </div>
            <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.aiVisibility} onChange={e => setDraft(prev => ({ ...prev, aiVisibility: e.target.value as CodexEntryDraft['aiVisibility'] }))}>
              <option value="global">{lang === 'en' ? 'Always include' : 'Sempre incluir'}</option>
              <option value="tracked">{lang === 'en' ? 'Include when detected' : 'Incluir quando detectado'}</option>
              <option value="hidden">{lang === 'en' ? 'Never include' : 'Nunca incluir'}</option>
            </select>
            {bucket === 'timeline' && (
              <>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
                  <span>{lang === 'en' ? 'Event State' : 'Estado do Evento'}</span>
                  <InlineHelp content={t('help.codex.timelineState')} />
                </div>
                <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.eventState} onChange={e => setDraft(prev => ({ ...prev, eventState: e.target.value as CodexEntryDraft['eventState'] }))}>
                  <option value="historical">{lang === 'en' ? 'Historical' : 'Histórico'}</option>
                  <option value="active_pressure">{lang === 'en' ? 'Active Pressure' : 'Pressão Ativa'}</option>
                  <option value="latent">{lang === 'en' ? 'Latent' : 'Latente'}</option>
                  <option value="resolved">{lang === 'en' ? 'Resolved' : 'Resolvido'}</option>
                  <option value="forecast">{lang === 'en' ? 'Forecast' : 'Previsão'}</option>
                </select>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
                  <span>{lang === 'en' ? 'Discovery Kind' : 'Tipo de Descoberta'}</span>
                  <InlineHelp content={t('help.codex.discoveryKind')} />
                </div>
                <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.discoveryKind} onChange={e => setDraft(prev => ({ ...prev, discoveryKind: e.target.value as CodexEntryDraft['discoveryKind'] }))}>
                  <option value="past_occurrence">{lang === 'en' ? 'Past Occurrence' : 'Ocorrência Passada'}</option>
                  <option value="present_discovery">{lang === 'en' ? 'Present Discovery' : 'Descoberta no Presente'}</option>
                  <option value="forecast">{lang === 'en' ? 'Forecast' : 'Previsão'}</option>
                </select>
                <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.relatedEntities} onChange={e => setDraft(prev => ({ ...prev, relatedEntities: e.target.value }))} placeholder={lang === 'en' ? 'Related entities (names/titles, comma separated)' : 'Entidades relacionadas (nomes/títulos, separados por vírgula)'} />
                <div className="grid gap-3 md:grid-cols-2">
                  <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.timelineImpact} onChange={e => setDraft(prev => ({ ...prev, timelineImpact: e.target.value as TimelineImpact }))}>
                    <option value="low">{lang === 'en' ? 'Impact: low' : 'Impacto: baixo'}</option>
                    <option value="medium">{lang === 'en' ? 'Impact: medium' : 'Impacto: médio'}</option>
                    <option value="high">{lang === 'en' ? 'Impact: high' : 'Impacto: alto'}</option>
                    <option value="cataclysmic">{lang === 'en' ? 'Impact: cataclysmic' : 'Impacto: cataclísmico'}</option>
                  </select>
                  <select className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.timelineScope} onChange={e => setDraft(prev => ({ ...prev, timelineScope: e.target.value as TimelineScope }))}>
                    <option value="personal">{lang === 'en' ? 'Scope: personal' : 'Escopo: pessoal'}</option>
                    <option value="local">{lang === 'en' ? 'Scope: local' : 'Escopo: local'}</option>
                    <option value="faction">{lang === 'en' ? 'Scope: faction' : 'Escopo: facção'}</option>
                    <option value="world">{lang === 'en' ? 'Scope: world' : 'Escopo: mundo'}</option>
                  </select>
                </div>
                <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={draft.anchorCharacters} onChange={e => setDraft(prev => ({ ...prev, anchorCharacters: e.target.value }))} placeholder={lang === 'en' ? 'Anchor characters (names, comma separated)' : 'Personagens âncora (nomes, separados por vírgula)'} />
              </>
            )}
            <textarea className="h-32 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.content} onChange={e => setDraft(prev => ({ ...prev, content: e.target.value }))} placeholder={lang === 'en' ? 'AI-facing content' : 'Conteúdo para IA'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.notesPrivate} onChange={e => setDraft(prev => ({ ...prev, notesPrivate: e.target.value }))} placeholder={lang === 'en' ? 'Author notes' : 'Notas do autor'} />
          </div>
        )}

        {tab === 'truth' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
              <span>{lang === 'en' ? 'Truth Layers' : 'Camadas de Verdade'}</span>
              <InlineHelp content={t('help.codex.truth')} />
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
              {lang === 'en'
                ? 'Canon is the operative truth. Belief and Myth are optional layers for subjective memory and cultural narrative.'
                : 'Canon é a verdade operativa. Belief e Myth são camadas opcionais para memória subjetiva e narrativa cultural.'}
            </div>
            <textarea className="h-28 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.truthCanon} onChange={e => setDraft(prev => ({ ...prev, truthCanon: e.target.value }))} placeholder={lang === 'en' ? 'CANON: what is objectively true' : 'CANON: o que é objetivamente verdadeiro'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.truthBelief} onChange={e => setDraft(prev => ({ ...prev, truthBelief: e.target.value, truthNeedsReview: e.target.value.trim().length > 0 || prev.truthMyth.trim().length > 0 }))} placeholder={lang === 'en' ? 'BELIEF: what a character believes happened' : 'BELIEF: o que um personagem acredita que aconteceu'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.truthMyth} onChange={e => setDraft(prev => ({ ...prev, truthMyth: e.target.value, truthNeedsReview: prev.truthBelief.trim().length > 0 || e.target.value.trim().length > 0 }))} placeholder={lang === 'en' ? 'MYTH: what the world, culture, or faction says happened' : 'MYTH: o que o mundo, a cultura ou a facção dizem que aconteceu'} />
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <input type="checkbox" checked={draft.truthNeedsReview} onChange={e => setDraft(prev => ({ ...prev, truthNeedsReview: e.target.checked }))} />
              {lang === 'en' ? 'Mark this entry for truth-layer review' : 'Marcar esta entrada para revisão de camadas de verdade'}
            </label>
          </div>
        )}

        {tab === 'mentions' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
              {mentions.length} {lang === 'en' ? 'mentions detected across chapters, codex, and memory.' : 'menções detectadas entre capítulos, codex e memória.'}
            </div>
            {mentions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-400">
                {lang === 'en' ? 'No mentions yet for this entry.' : 'Nenhuma menção encontrada ainda para esta entrada.'}
              </div>
            ) : (
              mentions.map((mention, index) => (
                <div key={`${mention.label}-${index}`} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium text-stone-900">{mention.label}</p>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-500">{mention.sourceType}</span>
                  </div>
                  <p className="text-sm leading-6 text-stone-600">{mention.excerpt}</p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'tracking' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
              {lang === 'en' ? 'Tracked entries are found by name and aliases. Exclusions reduce false positives; case-sensitive mode is useful only for very specific spellings.' : 'Entradas rastreadas sÃ£o encontradas por nome e aliases. ExclusÃµes reduzem falsos positivos; modo sensÃ­vel a maiÃºsculas sÃ³ ajuda em grafias muito especÃ­ficas.'}
            </div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
              <span>Tracking</span>
              <InlineHelp content={t('help.codex.tracking')} />
            </div>
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <input type="checkbox" checked={draft.trackByAlias} onChange={e => setDraft(prev => ({ ...prev, trackByAlias: e.target.checked }))} />
              {lang === 'en' ? 'Track this entry by name and aliases.' : 'Rastrear esta entrada por nome e aliases.'}
            </label>
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <input type="checkbox" checked={draft.caseSensitive} onChange={e => setDraft(prev => ({ ...prev, caseSensitive: e.target.checked }))} />
              {lang === 'en' ? 'Use case-sensitive matching.' : 'Usar correspondência sensível a maiúsculas/minúsculas.'}
            </label>
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.exclusions} onChange={e => setDraft(prev => ({ ...prev, exclusions: e.target.value }))} placeholder={lang === 'en' ? 'Phrases to exclude, separated by commas' : 'Frases para excluir, separadas por vírgula'} />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={!draft.title.trim()}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
};

const CharacterModal = ({ character, mentions, onClose, onSave }: { character: CharacterDraft; mentions: Array<{ label: string; excerpt: string; sourceType: string }>; onClose: () => void; onSave: (character: Character) => void }) => {
  const { t, lang } = useLanguage();
  const [draft, setDraft] = useState<CharacterDraft>(character);
  const [tab, setTab] = useState<'details' | 'mentions' | 'tracking'>('details');
  useEffect(() => setDraft(character), [character]);
  useEffect(() => setTab('details'), [character?.id]);
  if (!draft) return null;
  return (
    <Modal isOpen={!!draft} onClose={onClose} title={draft.name}>
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-stone-200 pb-3">
          {[
            { id: 'details', label: lang === 'en' ? 'Details' : 'Detalhes' },
            { id: 'mentions', label: lang === 'en' ? 'Mentions' : 'Menções' },
            { id: 'tracking', label: 'Tracking' },
          ].map(item => (
            <button key={item.id} onClick={() => setTab(item.id as typeof tab)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === item.id ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <>
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <CharacterPortrait name={draft.name} imageUrl={draft.imageUrl} role={draft.role} faction={draft.faction} size={512} className="aspect-[4/5] w-full rounded-2xl border border-stone-200 object-cover" />
              <div className="grid gap-3 md:grid-cols-2">
                <input className="rounded-xl border border-stone-300 px-3 py-2 md:col-span-2" value={draft.name} onChange={e => setDraft(prev => prev ? { ...prev, name: e.target.value } : prev)} placeholder={lang === 'en' ? 'Name' : 'Nome'} />
                <input className="rounded-xl border border-stone-300 px-3 py-2 md:col-span-2" value={aliasString(draft.aliases)} onChange={e => setDraft(prev => prev ? { ...prev, aliases: splitAliases(e.target.value) } : prev)} placeholder="Aliases" />
                <select className="rounded-xl border border-stone-300 px-3 py-2" value={draft.role} onChange={e => setDraft(prev => prev ? { ...prev, role: e.target.value as Character['role'] } : prev)}>
                  <option value="Protagonista">{lang === 'en' ? 'Protagonist' : 'Protagonista'}</option>
                  <option value="Antagonista">{lang === 'en' ? 'Antagonist' : 'Antagonista'}</option>
                  <option value="Mentor">Mentor</option>
                  <option value="Coadjuvante">{lang === 'en' ? 'Support' : 'Coadjuvante'}</option>
                  <option value="Figurante">{lang === 'en' ? 'Extra' : 'Figurante'}</option>
                </select>
                <select className="rounded-xl border border-stone-300 px-3 py-2" value={draft.status} onChange={e => setDraft(prev => prev ? { ...prev, status: e.target.value as Character['status'] } : prev)}>
                  <option value="Vivo">{lang === 'en' ? 'Alive' : 'Vivo'}</option>
                  <option value="Morto">{lang === 'en' ? 'Dead' : 'Morto'}</option>
                  <option value="Desconhecido">{lang === 'en' ? 'Unknown' : 'Desconhecido'}</option>
                </select>
                <input className="rounded-xl border border-stone-300 px-3 py-2" value={draft.faction} onChange={e => setDraft(prev => prev ? { ...prev, faction: e.target.value } : prev)} placeholder={lang === 'en' ? 'Faction' : 'Facção'} />
                <input className="rounded-xl border border-stone-300 px-3 py-2" type="number" value={draft.age} onChange={e => setDraft(prev => prev ? { ...prev, age: Number(e.target.value) } : prev)} placeholder={lang === 'en' ? 'Age' : 'Idade'} />
                <input className="rounded-xl border border-stone-300 px-3 py-2" value={draft.alignment} onChange={e => setDraft(prev => prev ? { ...prev, alignment: e.target.value } : prev)} placeholder={lang === 'en' ? 'Alignment' : 'Alinhamento'} />
                <select className="rounded-xl border border-stone-300 px-3 py-2 md:col-span-2" value={draft.aiVisibility} onChange={e => setDraft(prev => prev ? { ...prev, aiVisibility: e.target.value as Character['aiVisibility'] } : prev)}>
                  <option value="global">{lang === 'en' ? 'Always include' : 'Sempre incluir'}</option>
                  <option value="tracked">{lang === 'en' ? 'Include when detected' : 'Incluir quando detectado'}</option>
                  <option value="hidden">{lang === 'en' ? 'Never include' : 'Nunca incluir'}</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <VisibilityPresetCard active={draft.aiVisibility === 'global'} tone="global" title={lang === 'en' ? 'Always remember' : 'Sempre lembrar'} body={lang === 'en' ? 'Use for protagonist, key antagonists, or anyone whose state must stay active.' : 'Use para protagonista, antagonistas-chave ou quem precisa permanecer vivo na memÃ³ria do motor.'} onClick={() => setDraft(prev => prev ? { ...prev, aiVisibility: 'global' } : prev)} />
              <VisibilityPresetCard active={draft.aiVisibility === 'tracked'} tone="tracked" title={lang === 'en' ? 'Recall on mention' : 'Lembrar ao citar'} body={lang === 'en' ? 'Good for supporting cast. The engine pulls them in when names or aliases appear.' : 'Bom para elenco de apoio. O motor puxa esse personagem quando nomes ou aliases aparecem.'} onClick={() => setDraft(prev => prev ? { ...prev, aiVisibility: 'tracked' } : prev)} />
              <VisibilityPresetCard active={draft.aiVisibility === 'hidden'} tone="hidden" title={lang === 'en' ? 'Private sheet' : 'Ficha privada'} body={lang === 'en' ? 'Keeps notes and draft intent without steering generation yet.' : 'MantÃ©m notas e intenÃ§Ãµes de rascunho sem empurrar a geraÃ§Ã£o agora.'} onClick={() => setDraft(prev => prev ? { ...prev, aiVisibility: 'hidden' } : prev)} />
            </div>
            <textarea className="h-32 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.bio} onChange={e => setDraft(prev => prev ? { ...prev, bio: e.target.value } : prev)} placeholder={lang === 'en' ? 'AI-facing bio' : 'Bio para IA'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.ghost ?? ''} onChange={e => setDraft(prev => prev ? { ...prev, ghost: e.target.value } : prev)} placeholder={lang === 'en' ? 'Ghost: the past decision that still haunts this character' : 'Ghost: a decisão do passado que ainda assombra este personagem'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.coreLie ?? ''} onChange={e => setDraft(prev => prev ? { ...prev, coreLie: e.target.value } : prev)} placeholder={lang === 'en' ? 'Core Lie: the false belief driving this character' : 'Core Lie: a crença falsa que dirige este personagem'} />
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={draft.notesPrivate ?? ''} onChange={e => setDraft(prev => prev ? { ...prev, notesPrivate: e.target.value } : prev)} placeholder={lang === 'en' ? 'Author notes' : 'Notas do autor'} />
          </>
        )}

        {tab === 'mentions' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
              {mentions.length} {lang === 'en' ? 'mentions detected across chapters, codex, and memory.' : 'menções detectadas entre capítulos, codex e memória.'}
            </div>
            {mentions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-400">
                {lang === 'en' ? 'No mentions yet for this character.' : 'Nenhuma menção encontrada ainda para este personagem.'}
              </div>
            ) : (
              mentions.map((mention, index) => (
                <div key={`${mention.label}-${index}`} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium text-stone-900">{mention.label}</p>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-500">{mention.sourceType}</span>
                  </div>
                  <p className="text-sm leading-6 text-stone-600">{mention.excerpt}</p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'tracking' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
              {lang === 'en' ? 'Characters marked as tracked are found by name and aliases. Add exclusions for ambiguous surnames or titles that appear too often.' : 'Personagens marcados como rastreados sÃ£o encontrados por nome e aliases. Adicione exclusÃµes para sobrenomes ou tÃ­tulos ambÃ­guos que aparecem demais.'}
            </div>
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <input type="checkbox" checked={draft.tracking?.trackByAlias ?? true} onChange={e => setDraft(prev => prev ? { ...prev, tracking: { trackByAlias: e.target.checked, caseSensitive: prev.tracking?.caseSensitive ?? false, exclusions: prev.tracking?.exclusions ?? [] } } : prev)} />
              {lang === 'en' ? 'Track this character by name and aliases.' : 'Rastrear este personagem por nome e aliases.'}
            </label>
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <input type="checkbox" checked={draft.tracking?.caseSensitive ?? false} onChange={e => setDraft(prev => prev ? { ...prev, tracking: { trackByAlias: prev.tracking?.trackByAlias ?? true, caseSensitive: e.target.checked, exclusions: prev.tracking?.exclusions ?? [] } } : prev)} />
              {lang === 'en' ? 'Use case-sensitive matching.' : 'Usar correspondência sensível a maiúsculas/minúsculas.'}
            </label>
            <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={aliasString(draft.tracking?.exclusions ?? [])} onChange={e => setDraft(prev => prev ? { ...prev, tracking: { trackByAlias: prev.tracking?.trackByAlias ?? true, caseSensitive: prev.tracking?.caseSensitive ?? false, exclusions: splitAliases(e.target.value) } } : prev)} placeholder={lang === 'en' ? 'Phrases to exclude, separated by commas' : 'Frases para excluir, separadas por vírgula'} />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => onSave(draft)}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
};

export default function CodexView({ universe, onUpdateUniverse, initialSection = 'overview' }: { universe: Universe; onUpdateUniverse?: (universe: Universe) => void; isLoading: boolean; initialSection?: string }) {
  const { t, lang } = useLanguage();
  const sections = useMemo(() => sectionDefs(lang, t), [lang, t]);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [search, setSearch] = useState('');
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: universe.name, subtitle: universe.subtitle ?? '', description: universe.description, overview: universe.codex.overview, notesPrivate: universe.notesPrivate ?? '' });
  const [entryEditor, setEntryEditor] = useState<{ bucket: CodexBucket; title: string; entry: CodexEntry | null } | null>(null);
  const [characterEditor, setCharacterEditor] = useState<CharacterDraft>(null);
  const [characterLens, setCharacterLens] = useState<'cards' | 'relations'>('cards');
  const [lawLens, setLawLens] = useState<'systems' | 'magic'>('systems');

  useEffect(() => {
    setProjectDraft({ name: universe.name, subtitle: universe.subtitle ?? '', description: universe.description, overview: universe.codex.overview, notesPrivate: universe.notesPrivate ?? '' });
  }, [universe.name, universe.subtitle, universe.description, universe.codex.overview, universe.notesPrivate]);

  useEffect(() => {
    setActiveSection(initialSection === 'laws' ? 'systemsMagic' : initialSection);
  }, [initialSection]);

  const characters = useMemo(() => universe.characters.filter(character => filterCharacter(character, search)), [universe.characters, search]);
  const factions = useMemo(() => universe.codex.factions.filter(entry => filterEntry(entry, search)), [universe.codex.factions, search]);
  const timeline = useMemo(() => universe.codex.timeline.filter(entry => filterEntry(entry, search)), [universe.codex.timeline, search]);
  const rules = useMemo(() => universe.codex.rules.filter(entry => filterEntry(entry, search)), [universe.codex.rules, search]);
  const locations = useMemo(() => rules.filter(entry => classifyRule(entry) === 'location'), [rules]);
  const systems = useMemo(() => rules.filter(entry => classifyRule(entry) === 'system'), [rules]);
  const magic = useMemo(() => rules.filter(entry => classifyRule(entry) === 'magic'), [rules]);
  const lore = useMemo(() => rules.filter(entry => classifyRule(entry) === 'lore'), [rules]);
  const activeLawEntries = lawLens === 'systems' ? systems : magic;
  const latestTimelineEntry = useMemo(() => universe.codex.timeline[0] ?? null, [universe.codex.timeline]);
  const activePressureEntries = useMemo(() => universe.codex.timeline.filter(entry => entry.eventState === 'active_pressure').slice(0, 2), [universe.codex.timeline]);

  const counts = { overview: 1, characters: characters.length, factions: factions.length, systemsMagic: systems.length + magic.length, locations: locations.length, timeline: timeline.length };
  const memoryProfile = useMemo(() => {
    const codexEntries = [...universe.codex.factions, ...universe.codex.rules, ...universe.codex.timeline];
    const entities = [...universe.characters, ...codexEntries];
    const visibility = entities.reduce((acc, entity) => {
      const mode = entity.aiVisibility ?? 'tracked';
      acc[mode] += 1;
      return acc;
    }, { global: 0, tracked: 0, hidden: 0 });
    const trackedByAlias = entities.filter(entity => (entity.tracking?.trackByAlias ?? true)).length;
    const withExclusions = entities.filter(entity => (entity.tracking?.exclusions?.length ?? 0) > 0).length;
    const openLoops = universe.narrativeMemory?.openLoops?.filter(loop => loop.resolved === undefined).length ?? 0;
    const activePressure = universe.codex.timeline.filter(entry => entry.eventState === 'active_pressure').length;
    return { visibility, trackedByAlias, withExclusions, openLoops, activePressure };
  }, [universe]);
  const overviewHighlights = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (universe.subtitle?.trim()) {
      items.push({ label: lang === 'en' ? 'Logline' : 'Logline', value: universe.subtitle.trim() });
    }
    if (latestTimelineEntry?.title?.trim()) {
      items.push({ label: lang === 'en' ? 'Current narrative state' : 'Estado atual da narrativa', value: latestTimelineEntry.title.trim() });
    }
    if (memoryProfile.openLoops > 0) {
      items.push({
        label: lang === 'en' ? 'Open tension' : 'Tensão em aberto',
        value: `${memoryProfile.openLoops} ${lang === 'en' ? 'live loop(s) still pulling future chapters.' : 'loop(s) ainda puxando os próximos capítulos.'}`,
      });
    }
    return items.slice(0, 3);
  }, [lang, latestTimelineEntry, memoryProfile.openLoops, universe.subtitle]);

  const navTo = (id: string) => {
    setActiveSection(id);
  };

  useEffect(() => {
    if (lawLens === 'systems' && systems.length === 0 && magic.length > 0) {
      setLawLens('magic');
    }
    if (lawLens === 'magic' && magic.length === 0 && systems.length > 0) {
      setLawLens('systems');
    }
  }, [lawLens, systems.length, magic.length]);

  const entityCatalog = useMemo(() => [
    ...universe.characters.map(item => ({ id: item.id, label: item.name })),
    ...universe.codex.factions.map(item => ({ id: item.id, label: item.title })),
    ...universe.codex.rules.map(item => ({ id: item.id, label: item.title })),
    ...universe.codex.timeline.map(item => ({ id: item.id, label: item.title })),
  ], [universe]);
  const characterCatalog = useMemo(() => universe.characters.map(item => ({ id: item.id, label: item.name })), [universe.characters]);

  const resolveRelatedEntityIds = (labels: string) => {
    const wanted = splitAliases(labels).map(normalizeLabel);
    if (wanted.length === 0) return [];
    return entityCatalog
      .filter(item => wanted.includes(normalizeLabel(item.label)))
      .map(item => item.id);
  };

  const relatedEntityLabels = (ids?: string[]) => {
    if (!ids?.length) return '';
    return ids
      .map(id => entityCatalog.find(item => item.id === id)?.label)
      .filter(Boolean)
      .join(', ');
  };

  const saveProject = () => {
    onUpdateUniverse?.(markUniverseDirty({
      ...universe,
      name: projectDraft.name.trim() || universe.name,
      subtitle: projectDraft.subtitle,
      description: projectDraft.description,
      notesPrivate: projectDraft.notesPrivate,
      codex: { ...universe.codex, overview: projectDraft.overview },
    }, ['project', 'codex']));
    setProjectEditorOpen(false);
  };

  const openEntryEditor = (bucket: CodexBucket, title: string, entry?: CodexEntry, preset?: Partial<CodexEntry>) => {
    setEntryEditor({
      bucket,
      title,
      entry: entry ?? { id: Math.random().toString(36).slice(2, 11), title: '', aliases: [], content: '', notesPrivate: '', aiVisibility: bucket === 'rules' ? 'global' : 'tracked', tracking: { trackByAlias: true, caseSensitive: false, exclusions: [] }, truth: { eventKey: `entry:${Math.random().toString(36).slice(2, 11)}`, layers: [], needsReview: false }, ruleKind: bucket === 'rules' ? 'system' : undefined, eventState: bucket === 'timeline' ? 'historical' : undefined, discoveryKind: bucket === 'timeline' ? 'past_occurrence' : undefined, timelineImpact: bucket === 'timeline' ? 'medium' : undefined, timelineScope: bucket === 'timeline' ? 'personal' : undefined, relatedEntityIds: [], anchorCharacterIds: [], ...preset },
    });
  };

  const saveEntry = (draft: CodexEntryDraft) => {
    if (!entryEditor?.entry) return;
    const truthLayers = [
      draft.truthCanon.trim() ? { kind: 'CANON' as const, statement: draft.truthCanon.trim() } : null,
      draft.truthBelief.trim() ? { kind: 'BELIEF' as const, statement: draft.truthBelief.trim() } : null,
      draft.truthMyth.trim() ? { kind: 'MYTH' as const, statement: draft.truthMyth.trim() } : null,
    ].filter(Boolean);
    const nextEntry: CodexEntry = {
      ...entryEditor.entry,
      title: draft.title.trim(),
      aliases: splitAliases(draft.aliases),
      content: draft.content,
      notesPrivate: draft.notesPrivate,
      ruleKind: entryEditor.bucket === 'rules' ? draft.ruleKind : entryEditor.entry.ruleKind,
      aiVisibility: draft.aiVisibility,
      eventState: entryEditor.bucket === 'timeline' ? draft.eventState : entryEditor.entry.eventState,
      discoveryKind: entryEditor.bucket === 'timeline' ? draft.discoveryKind : entryEditor.entry.discoveryKind,
      timelineImpact: entryEditor.bucket === 'timeline' ? draft.timelineImpact : entryEditor.entry.timelineImpact,
      timelineScope: entryEditor.bucket === 'timeline' ? draft.timelineScope : entryEditor.entry.timelineScope,
      relatedEntityIds: entryEditor.bucket === 'timeline'
        ? resolveRelatedEntityIds(draft.relatedEntities)
        : (entryEditor.entry.relatedEntityIds ?? []),
      anchorCharacterIds: entryEditor.bucket === 'timeline'
        ? characterCatalog.filter(item => splitAliases(draft.anchorCharacters).map(normalizeLabel).includes(normalizeLabel(item.label))).map(item => item.id)
        : (entryEditor.entry.anchorCharacterIds ?? []),
      tracking: {
        trackByAlias: draft.trackByAlias,
        caseSensitive: draft.caseSensitive,
        exclusions: splitAliases(draft.exclusions),
      },
      truth: {
        eventKey: entryEditor.entry.truth?.eventKey ?? `${entryEditor.bucket}:${entryEditor.entry.id}`,
        needsReview: draft.truthNeedsReview,
        layers: truthLayers.length > 0 ? truthLayers : [{ kind: 'CANON', statement: draft.content.trim() || draft.title.trim() }],
      },
    };
    const existing = universe.codex[entryEditor.bucket];
    const updated = existing.some(entry => entry.id === nextEntry.id) ? existing.map(entry => entry.id === nextEntry.id ? nextEntry : entry) : [...existing, nextEntry];
    const scopeMap: Record<CodexBucket, 'timeline' | 'factions' | 'rules'> = { timeline: 'timeline', factions: 'factions', rules: 'rules' };
    onUpdateUniverse?.(markUniverseDirty({ ...universe, codex: { ...universe.codex, [entryEditor.bucket]: updated } }, ['codex', scopeMap[entryEditor.bucket]]));
    setEntryEditor(null);
  };

  const saveCharacter = (character: Character) => {
    onUpdateUniverse?.(markUniverseDirty({ ...universe, characters: universe.characters.map(existing => existing.id === character.id ? character : existing) }, ['characters']));
    setCharacterEditor(character);
  };

  const entryMentions = useMemo(() => entryEditor?.entry ? collectCodexEntryMentions(universe, entryEditor.entry) : [], [entryEditor, universe]);
  const characterMentions = useMemo(() => characterEditor ? collectCharacterMentions(universe, characterEditor) : [], [characterEditor, universe]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-8 flex flex-col gap-4 border-b border-stone-200 pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-nobel" />
          <div>
            <h1 className="font-serif text-3xl font-bold text-stone-900">{t('codex.unifiedTitle')}</h1>
            <p className="mt-0.5 text-sm text-stone-400">{t('codex.unifiedSubtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-500">{t('codex.syncLabel')} v{universe.syncMeta?.canonVersion ?? 1} · {t('codex.memoryLabel')} v{universe.syncMeta?.memoryVersion ?? 1}</div>
          <Button variant="ghost" size="sm" onClick={() => setProjectEditorOpen(true)}><Edit3 className="mr-2 h-3.5 w-3.5" />{t('codex.editProject')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[250px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            <div className="rounded-2xl border border-stone-800 bg-stone-950 p-4 text-center">
              <p className="mb-1 text-[9px] uppercase tracking-[0.35em] text-nobel/45">{t('codex.liveLabel')}</p>
              <p className="font-serif text-sm font-bold text-white">{universe.name}</p>
              {universe.subtitle && <p className="mt-1 text-xs italic text-stone-400">{universe.subtitle}</p>}
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white/80 p-2 backdrop-blur">
              {sections.map(section => (
                <button key={section.id} onClick={() => navTo(section.id)} className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm transition-all last:mb-0 ${activeSection === section.id ? 'border border-stone-800 bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'}`}>
                  <span className={activeSection === section.id ? 'text-nobel' : 'text-stone-400'}>{section.icon}</span>
                  <span className="font-medium">{section.label}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-mono ${activeSection === section.id ? 'bg-white/10 text-stone-200' : 'bg-stone-100 text-stone-500'}`}>{counts[section.id as keyof typeof counts] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-12">
          <div className="sticky top-0 z-10 mb-8 rounded-2xl border border-stone-200 bg-paper/90 p-3 shadow-[0_8px_25px_rgba(15,15,15,0.06)] backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input className="w-full rounded-xl border border-stone-300 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-nobel" placeholder={t('codex.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {sections.map(section => (
                  <button key={section.id} onClick={() => navTo(section.id)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${activeSection === section.id ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{section.label}</button>
                ))}
              </div>
            </div>
          </div>

          <SectionBlock active={activeSection === 'overview'} id="overview" title={t('codex.section.overview')} icon={<Globe2 className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.overview')} action={<Button variant="ghost" size="sm" onClick={() => setProjectEditorOpen(true)}><Edit3 className="mr-2 h-3.5 w-3.5" />{t('codex.editProject')}</Button>}>
            <div className="relative overflow-hidden rounded-[28px] border border-stone-800 bg-stone-950 shadow-[0_24px_70px_rgba(15,15,15,0.18)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(197,160,89,0.24),transparent_42%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(197,160,89,0.12),transparent_32%)]" />
              <div className="relative p-7 md:p-10">
                <p className="mb-2 text-[10px] uppercase tracking-[0.35em] text-nobel/50">{t('codex.hero.centralArchive')}</p>
                <h1 className="font-serif text-3xl font-bold text-white md:text-4xl">{universe.name}</h1>
                {universe.subtitle && <p className="mt-2 text-sm italic text-stone-300">{universe.subtitle}</p>}
                {universe.description && <p className="mt-5 max-w-3xl font-serif text-base leading-8 text-stone-200/92">{universe.description}</p>}
                {overviewHighlights.length > 0 && (
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {overviewHighlights.map(item => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-nobel/60">{item.label}</p>
                        <p className="mt-2 text-sm leading-6 text-stone-100">{item.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="hidden">
                <p className="mb-3 text-[10px] uppercase tracking-[0.28em] text-stone-500">{t('codex.hero.aiOverview')}</p>
                <p className="font-serif text-[1.02rem] leading-8 text-stone-700">{universe.codex.overview || t('codex.empty.overview')}</p>
              </div>
              <div className="hidden">
                <p className="mb-4 text-[10px] uppercase tracking-[0.28em] text-stone-500">{t('codex.hero.state')}</p>
                <div className="space-y-3">
                  {[{ label: lang === 'en' ? 'Characters' : 'Personagens', value: universe.characters.length }, { label: lang === 'en' ? 'Factions' : 'Facções', value: universe.codex.factions.length }, { label: lang === 'en' ? 'Systems / Magic / Lore' : 'Sistemas / Magia / Lore', value: universe.codex.rules.length }, { label: lang === 'en' ? 'Events' : 'Eventos', value: universe.codex.timeline.length }].map(item => (
                    <div key={item.label} className="flex items-center justify-between border-b border-stone-100 pb-3 last:border-b-0 last:pb-0">
                      <span className="text-sm text-stone-500">{item.label}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {[{ label: lang === 'en' ? 'Characters' : 'Personagens', value: universe.characters.length }, { label: lang === 'en' ? 'Factions' : 'Facções', value: universe.codex.factions.length }, { label: lang === 'en' ? 'Rules & Lore' : 'Regras & Lore', value: universe.codex.rules.length }, { label: lang === 'en' ? 'Events' : 'Eventos', value: universe.codex.timeline.length }].map(item => (
                <div key={item.label} className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-stone-400">{item.label}</p>
                  <p className="mt-2 font-mono text-2xl font-bold text-stone-900">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="space-y-4">
                <div className="rounded-[26px] border border-amber-100 bg-amber-50/55 p-7 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.28em] text-stone-500">{t('codex.hero.aiOverview')}</p>
                      <h3 className="mt-2 font-serif text-2xl font-bold text-stone-900">{lang === 'en' ? 'Story memory in plain language' : 'Memória da história em linguagem clara'}</h3>
                    </div>
                    <div className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                      {memoryProfile.openLoops} {lang === 'en' ? 'open loops' : 'loops abertos'}
                    </div>
                  </div>
                  <p className="mt-4 font-serif text-[1.06rem] leading-8 text-stone-700">{universe.codex.overview || t('codex.empty.overview')}</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                  <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                    <p className="text-[10px] uppercase tracking-[0.26em] text-stone-500">{lang === 'en' ? 'Current story state' : 'Estado atual da história'}</p>
                    <div className="mt-4 space-y-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-stone-400">{lang === 'en' ? 'Latest chapter pressure' : 'Pressão mais recente'}</p>
                        <p className="mt-2 font-serif text-xl font-bold text-stone-900">{latestTimelineEntry?.title || (lang === 'en' ? 'No timeline event yet' : 'Nenhum evento de timeline ainda')}</p>
                        <p className="mt-2 text-sm leading-6 text-stone-600">{latestTimelineEntry?.content || (lang === 'en' ? 'As chapters are generated, the latest event will appear here as the current narrative state.' : 'Conforme os capítulos forem gerados, o último evento aparece aqui como o estado narrativo atual.')}</p>
                      </div>
                      {activePressureEntries.length > 0 && (
                        <div className="border-t border-stone-100 pt-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-stone-400">{lang === 'en' ? 'Pressure now' : 'Tensão agora'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {activePressureEntries.map(entry => (
                              <span key={entry.id} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">{entry.title}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.26em] text-stone-500">{lang === 'en' ? 'AI memory panel' : 'Painel de memória da IA'}</p>
                        <h4 className="mt-2 font-serif text-xl font-bold text-stone-900">{lang === 'en' ? 'What the engine keeps active' : 'O que o motor mantém ativo'}</h4>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-2">
                        <Radar className="h-4 w-4 text-nobel" />
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-600">
                      {lang === 'en' ? 'This is the technical layer behind continuity. Keep it close, but secondary to the story itself.' : 'Esta é a camada técnica por trás da continuidade. Ela ajuda bastante, mas deve ficar atrás da própria história.'}
                    </p>
                    <div className="mt-4 grid gap-3">
                      <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-3">
                        <span className="text-sm text-stone-600">{lang === 'en' ? 'Global anchors' : 'Âncoras globais'}</span>
                        <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.visibility.global}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-sky-50 px-3 py-3">
                        <span className="text-sm text-stone-600">{lang === 'en' ? 'Tracked entries' : 'Entradas rastreadas'}</span>
                        <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.visibility.tracked}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-3">
                        <span className="text-sm text-stone-600">{lang === 'en' ? 'Hidden notes' : 'Notas ocultas'}</span>
                        <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.visibility.hidden}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-nobel/55">{lang === 'en' ? 'AI memory map' : 'Mapa da memÃ³ria da IA'}</p>
                    <h3 className="mt-2 font-serif text-2xl font-bold">{lang === 'en' ? 'What the engine actually carries forward' : 'O que o motor realmente carrega adiante'}</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-300">
                      {lang === 'en' ? 'Global entries stay pinned in context. Tracked entries are recalled when names, aliases, or scene pressure match. Hidden entries remain in your archive only.' : 'Entradas globais ficam presas no contexto. Entradas rastreadas sÃ£o lembradas quando nomes, aliases ou a pressÃ£o da cena combinam. Entradas ocultas ficam sÃ³ no seu arquivo.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <Radar className="h-6 w-6 text-nobel" />
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-amber-200">Global</p>
                    <p className="mt-2 font-serif text-3xl font-bold">{memoryProfile.visibility.global}</p>
                    <p className="mt-2 text-sm leading-6 text-amber-100/80">{lang === 'en' ? 'Core anchors that always steer generation.' : 'Ã‚ncoras centrais que sempre orientam a geraÃ§Ã£o.'}</p>
                  </div>
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-sky-200">{lang === 'en' ? 'Tracked' : 'Rastreado'}</p>
                    <p className="mt-2 font-serif text-3xl font-bold">{memoryProfile.visibility.tracked}</p>
                    <p className="mt-2 text-sm leading-6 text-sky-100/80">{lang === 'en' ? 'Detected by mention, alias, or narrative pressure.' : 'Detectado por menÃ§Ã£o, alias ou pressÃ£o narrativa.'}</p>
                  </div>
                  <div className="rounded-2xl border border-stone-400/20 bg-white/5 p-4">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-stone-300">{lang === 'en' ? 'Hidden' : 'Oculto'}</p>
                    <p className="mt-2 font-serif text-3xl font-bold">{memoryProfile.visibility.hidden}</p>
                    <p className="mt-2 text-sm leading-6 text-stone-300/80">{lang === 'en' ? 'Private notes that never enter AI context.' : 'Notas privadas que nunca entram no contexto da IA.'}</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-4">
                <div className="rounded-2xl border border-stone-200 bg-white p-5">
                  <p className="text-[10px] uppercase tracking-[0.26em] text-stone-500">{lang === 'en' ? 'Codex map' : 'Mapa do codex'}</p>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                    <p><strong>{lang === 'en' ? 'Timeline' : 'Timeline'}:</strong> {lang === 'en' ? 'what happened, what is in motion, and what future pressure exists.' : 'o que aconteceu, o que está em movimento e que pressão futura existe.'}</p>
                    <p><strong>{lang === 'en' ? 'Lore & Systems' : 'Lore & Sistemas'}:</strong> {lang === 'en' ? 'how the world works, what power costs, and what it cannot do.' : 'como o mundo funciona, quanto o poder custa e o que ele não pode fazer.'}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white p-5">
                  <p className="text-[10px] uppercase tracking-[0.26em] text-stone-500">{lang === 'en' ? 'Tracker pulse' : 'Pulso do tracker'}</p>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2.5">
                      <span className="text-sm text-stone-500">{lang === 'en' ? 'Aliases enabled' : 'Aliases ativados'}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.trackedByAlias}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2.5">
                      <span className="text-sm text-stone-500">{lang === 'en' ? 'Custom exclusions' : 'ExclusÃµes customizadas'}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.withExclusions}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2.5">
                      <span className="text-sm text-stone-500">{lang === 'en' ? 'Open loops alive' : 'Loops em aberto'}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.openLoops}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2.5">
                      <span className="text-sm text-stone-500">{lang === 'en' ? 'Active pressure events' : 'Eventos em pressÃ£o ativa'}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{memoryProfile.activePressure}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
                  <p className="text-[10px] uppercase tracking-[0.26em] text-stone-500">{lang === 'en' ? 'Recommended use' : 'Uso recomendado'}</p>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                    <div className="flex items-start gap-3">
                      <Globe2 className="mt-0.5 h-4 w-4 text-amber-600" />
                      <p>{lang === 'en' ? 'Mark protagonist, central law, and non-negotiable faction truths as global.' : 'Marque protagonista, lei central e verdades de facÃ§Ã£o nÃ£o negociÃ¡veis como globais.'}</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Search className="mt-0.5 h-4 w-4 text-sky-600" />
                      <p>{lang === 'en' ? 'Leave side cast, recurring places, and episodic lore as tracked to keep prompts lean.' : 'Deixe elenco de apoio, locais recorrentes e lore episÃ³dico como rastreados para manter o prompt enxuto.'}</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <EyeOff className="mt-0.5 h-4 w-4 text-stone-500" />
                      <p>{lang === 'en' ? 'Hide spoiler notes, draft theories, and material you do not want the engine acting on yet.' : 'Oculte notas com spoiler, teorias de rascunho e material que vocÃª ainda nÃ£o quer que o motor use.'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionBlock>

          <SectionBlock active={activeSection === 'characters'} id="characters" title={t('codex.section.characters')} icon={<Users className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.characters')} count={characters.length} action={
            <div className="mx-auto flex items-center justify-center gap-2">
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white p-1 shadow-sm">
                <button
                  onClick={() => setCharacterLens('cards')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${characterLens === 'cards' ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'}`}
                >
                  <LayoutGrid className="mr-2 inline h-3.5 w-3.5" />
                  {t('chars.constellation.cards')}
                </button>
                <button
                  onClick={() => setCharacterLens('relations')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${characterLens === 'relations' ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900'}`}
                >
                  <Share2 className="mr-2 inline h-3.5 w-3.5" />
                  {t('chars.constellation.map')}
                </button>
              </div>
              <InlineHelp content={t('help.codex.relationMap')} />
            </div>
          }>
            {characters.length === 0 ? (
              <p className="text-sm italic text-stone-400">{t('codex.empty.characters')}</p>
            ) : characterLens === 'relations' ? (
              <RelationshipConstellation characters={characters} universe={universe} onSelect={character => setCharacterEditor(character)} t={t} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {characters.map(character => (
                  <button key={character.id} onClick={() => setCharacterEditor(character)} className="group overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-stone-300 hover:shadow-lg">
                    <div className="relative h-56 overflow-hidden">
                      <CharacterPortrait name={character.name} imageUrl={character.imageUrl} role={character.role} faction={character.faction} size={512} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/20 to-transparent" />
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="font-serif text-xl font-bold text-white">{character.name}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-stone-300">{character.role}</p>
                      </div>
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">{character.status}</span>
                        {character.faction && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">{character.faction}</span>}
                        <span className="rounded-full bg-stone-900 px-2.5 py-1 text-[11px] font-semibold text-white">{character.aiVisibility}</span>
                      </div>
                      <p className="line-clamp-3 text-sm leading-6 text-stone-600">{character.bio}</p>
                      {character.aliases.length > 0 && <p className="text-xs text-stone-400">{t('codex.label.aliases')}: {aliasString(character.aliases)}</p>}
                      {character.chapters.length > 0 && (
                        <p className="text-xs text-stone-500">
                          {t('codex.label.latestAppearance')}:{' '}
                          {universe.chapters.find(chapter => chapter.id === character.chapters[character.chapters.length - 1])?.title ?? `${lang === 'en' ? 'Chapter' : 'Capítulo'} ${character.chapters.length}`}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionBlock>

          <SectionBlock active={activeSection === 'factions'} id="factions" title={t('codex.section.factionsRealm')} icon={<Shield className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.factions')} count={factions.length} action={<Button variant="ghost" size="sm" onClick={() => openEntryEditor('factions', lang === 'en' ? 'New faction' : 'Nova facção')}><Plus className="mr-2 h-3.5 w-3.5" />{lang === 'en' ? 'New faction' : 'Nova facção'}</Button>}>
            {factions.length === 0 ? (
              <p className="text-sm italic text-stone-400">{t('codex.empty.factionsFilter')}</p>
            ) : (
              <div className="space-y-3">
                {factions.map((entry, index) => {
                  const palette = FACTION_PALETTES[index % FACTION_PALETTES.length];
                  return (
                    <motion.div key={entry.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="overflow-hidden rounded-2xl border" style={{ borderColor: `${palette.line}30` }}>
                      <FactionAccordion entry={entry} index={index} palette={palette} onEdit={() => openEntryEditor('factions', 'Editar faccao', entry)} />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </SectionBlock>

          <SectionBlock active={activeSection === 'systemsMagic'} id="systemsMagic" title={lang === 'en' ? 'Lore & Systems' : 'Lore & Sistemas'} icon={<Scale className="h-4 w-4" />} subtitle={lang === 'en' ? 'World rules and power logic.' : 'Regras do mundo e lógica do poder.'} count={systems.length + magic.length} action={<div className="flex flex-col items-stretch gap-2 md:items-end"><SegmentedToggle value={lawLens} onChange={value => setLawLens(value as 'systems' | 'magic')} options={[{ value: 'systems', label: lang === 'en' ? 'Systems' : 'Sistemas', meta: `${systems.length}` }, { value: 'magic', label: lang === 'en' ? 'Magic' : 'Magia', meta: `${magic.length}` }]} /><Button variant="ghost" size="sm" onClick={() => openEntryEditor('rules', lawLens === 'systems' ? (lang === 'en' ? 'New system' : 'Novo sistema') : (lang === 'en' ? 'New magic rule' : 'Nova regra de magia'), undefined, { ruleKind: lawLens === 'systems' ? 'system' : 'magic', aiVisibility: 'global' })}><Plus className="mr-2 h-3.5 w-3.5" />{lawLens === 'systems' ? (lang === 'en' ? 'Add system' : 'Adicionar sistema') : (lang === 'en' ? 'Add magic rule' : 'Adicionar magia')}</Button></div>}>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${lawLens === 'systems' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
                {lawLens === 'systems' ? (lang === 'en' ? 'Systems' : 'Sistemas') : (lang === 'en' ? 'Magic' : 'Magia')}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] font-semibold text-stone-600">
                {lawLens === 'systems'
                  ? (lang === 'en' ? `${systems.length} entries` : `${systems.length} entradas`)
                  : (lang === 'en' ? `${magic.length} entries` : `${magic.length} entradas`)}
              </span>
            </div>
            <EntryCollectionPanel title={lawLens === 'systems' ? (lang === 'en' ? 'Systems' : 'Sistemas') : (lang === 'en' ? 'Magic & Powers' : 'Magia & Poderes')} subtitle={lawLens === 'systems' ? (lang === 'en' ? 'Operational rules, institutions, and constraints that keep the setting coherent.' : 'Regras operacionais, instituições e restrições que mantêm o cenário coerente.') : (lang === 'en' ? 'Source, cost, limit, access, and danger of supernatural or exceptional force.' : 'Fonte, custo, limite, acesso e perigo da força sobrenatural ou excepcional.')} entries={activeLawEntries} addLabel={lawLens === 'systems' ? (lang === 'en' ? 'New system' : 'Novo sistema') : (lang === 'en' ? 'New magic rule' : 'Nova regra de magia')} onAdd={() => openEntryEditor('rules', lawLens === 'systems' ? (lang === 'en' ? 'New system' : 'Novo sistema') : (lang === 'en' ? 'New magic rule' : 'Nova regra de magia'), undefined, { ruleKind: lawLens === 'systems' ? 'system' : 'magic', aiVisibility: 'global' })} onEdit={entry => openEntryEditor('rules', lawLens === 'systems' ? (lang === 'en' ? 'Edit system' : 'Editar sistema') : (lang === 'en' ? 'Edit magic rule' : 'Editar regra de magia'), entry)} emptyTitle={lawLens === 'systems' ? (lang === 'en' ? 'No systems yet' : 'Nenhum sistema ainda') : (lang === 'en' ? 'No magic rules yet' : 'Nenhuma regra de magia ainda')} emptyBody={lawLens === 'systems' ? (lang === 'en' ? 'Start with one hard rule the world cannot ignore.' : 'Comece com uma regra dura que o mundo não pode ignorar.') : (lang === 'en' ? 'Start with the source of power and its cost.' : 'Comece pela fonte do poder e seu custo.')} accent={lawLens === 'systems' ? 'amber' : 'sky'} />
          </SectionBlock>
          <SimpleEntryGrid active={activeSection === 'locations'} id="locations" title={t('codex.section.locations')} icon={<MapPin className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.locations')} entries={locations} addLabel={lang === 'en' ? 'New location' : 'Novo local'} onAdd={() => openEntryEditor('rules', lang === 'en' ? 'New location' : 'Novo local', undefined, { ruleKind: 'location', aiVisibility: 'tracked' })} onEdit={entry => openEntryEditor('rules', lang === 'en' ? 'Edit location' : 'Editar local', entry)} />

          <SectionBlock active={activeSection === 'timeline'} id="timeline" title={t('codex.section.timeline')} icon={<Clock className="h-4 w-4" />} subtitle={lang === 'en' ? 'Events now carry state, impact, scope, and anchor characters for better memory.' : 'Eventos agora carregam estado, impacto, escopo e personagens âncora para melhorar a memória.'} count={timeline.length} action={<Button variant="ghost" size="sm" onClick={() => openEntryEditor('timeline', lang === 'en' ? 'New event' : 'Novo evento')}><Plus className="mr-2 h-3.5 w-3.5" />{lang === 'en' ? 'New event' : 'Novo evento'}</Button>}>
            <div className="mb-5 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-stone-500">{lang === 'en' ? 'Impact' : 'Impacto'}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{lang === 'en' ? 'How violently this event bends the story.' : 'Quão violentamente esse evento entorta a história.'}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-stone-500">{lang === 'en' ? 'Scope' : 'Escopo'}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{lang === 'en' ? 'Whether it hits one life, one place, one faction, or the whole world.' : 'Se atinge uma vida, um lugar, uma facção ou o mundo inteiro.'}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-stone-500">{lang === 'en' ? 'Anchors' : 'Âncoras'}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{lang === 'en' ? 'Tie events to characters so the engine knows whose arc they pressure.' : 'Prenda eventos a personagens para o motor saber em que arco essa pressão cai.'}</p>
              </div>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm italic text-stone-400">{t('codex.empty.events')}</p>
            ) : (
              <div className="relative">
                <div className="absolute bottom-2 left-[24px] top-2 w-px bg-gradient-to-b from-nobel/60 via-stone-300 to-transparent" />
                <div className="space-y-0">
                  {timeline.map((entry, index) => (
                    <motion.div key={entry.id} className="relative flex gap-5 pb-8 last:pb-0" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }}>
                      <div className="relative mt-1 flex-shrink-0">
                        <div className={`relative z-10 flex h-[48px] w-[48px] items-center justify-center rounded-full border-2 text-xs font-serif font-bold ${index === 0 ? 'border-nobel bg-stone-900 text-nobel shadow-[0_0_12px_rgba(197,160,89,0.3)]' : 'border-stone-300 bg-white text-stone-600'}`}>{toRoman(index)}</div>
                      </div>
                      <div className="mt-0.5 flex-1 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="font-serif text-base font-bold text-stone-900">{entry.title}</h4>
                            {entry.aliases.length > 0 && <p className="mt-1 text-xs text-stone-400">{t('codex.label.aliases')}: {aliasString(entry.aliases)}</p>}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {entry.eventState && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">{entry.eventState}</span>}
                              {entry.discoveryKind && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">{entry.discoveryKind}</span>}
                              {entry.timelineImpact && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">{timelineImpactLabel(entry.timelineImpact, lang)}</span>}
                              {entry.timelineScope && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">{timelineScopeLabel(entry.timelineScope, lang)}</span>}
                              {(entry.relatedEntityIds?.length ?? 0) > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">{entry.relatedEntityIds?.length} {t('codex.label.links')}</span>}
                            </div>
                          </div>
                          <button className="text-stone-400 hover:text-stone-700" onClick={() => openEntryEditor('timeline', 'Editar evento', entry)}><Edit3 className="h-4 w-4" /></button>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-stone-600">{entry.content}</p>
                        {(entry.relatedEntityIds?.length ?? 0) > 0 && (
                          <p className="mt-3 text-xs text-stone-400">{t('codex.label.relatedTo')}: {relatedEntityLabels(entry.relatedEntityIds)}</p>
                        )}
                        {(entry.anchorCharacterIds?.length ?? 0) > 0 && (
                          <p className="mt-2 text-xs text-stone-400">{lang === 'en' ? 'Anchor characters' : 'Personagens âncora'}: {entry.anchorCharacterIds?.map(id => characterCatalog.find(item => item.id === id)?.label).filter(Boolean).join(', ')}</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </SectionBlock>

          

        </main>
      </div>

      <Modal isOpen={projectEditorOpen} onClose={() => setProjectEditorOpen(false)} title={t('codex.projectModal.title')}>
        <div className="space-y-4">
          <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={projectDraft.name} onChange={e => setProjectDraft(prev => ({ ...prev, name: e.target.value }))} placeholder={t('codex.projectModal.name')} />
          <input className="w-full rounded-xl border border-stone-300 px-3 py-2" value={projectDraft.subtitle} onChange={e => setProjectDraft(prev => ({ ...prev, subtitle: e.target.value }))} placeholder={t('codex.projectModal.subtitle')} />
          <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={projectDraft.description} onChange={e => setProjectDraft(prev => ({ ...prev, description: e.target.value }))} placeholder={t('codex.projectModal.description')} />
          <textarea className="h-32 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={projectDraft.overview} onChange={e => setProjectDraft(prev => ({ ...prev, overview: e.target.value }))} placeholder={t('codex.projectModal.overview')} />
          <textarea className="h-24 w-full rounded-xl border border-stone-300 px-3 py-2 resize-none" value={projectDraft.notesPrivate} onChange={e => setProjectDraft(prev => ({ ...prev, notesPrivate: e.target.value }))} placeholder={t('codex.projectModal.notes')} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setProjectEditorOpen(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={saveProject}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      <EntryModal
        open={!!entryEditor}
        title={entryEditor?.title ?? (lang === 'en' ? 'Edit entry' : 'Editar entrada')}
        bucket={entryEditor?.bucket ?? 'rules'}
        value={{
          title: entryEditor?.entry?.title ?? '',
          aliases: aliasString(entryEditor?.entry?.aliases ?? []),
          content: entryEditor?.entry?.content ?? '',
          notesPrivate: entryEditor?.entry?.notesPrivate ?? '',
          ruleKind: entryEditor?.entry?.ruleKind ?? 'system',
          aiVisibility: entryEditor?.entry?.aiVisibility ?? 'tracked',
          trackByAlias: entryEditor?.entry?.tracking?.trackByAlias ?? true,
          caseSensitive: entryEditor?.entry?.tracking?.caseSensitive ?? false,
          exclusions: aliasString(entryEditor?.entry?.tracking?.exclusions ?? []),
          truthCanon: entryEditor?.entry?.truth?.layers.find(layer => layer.kind === 'CANON')?.statement ?? entryEditor?.entry?.content ?? '',
          truthBelief: entryEditor?.entry?.truth?.layers.find(layer => layer.kind === 'BELIEF')?.statement ?? '',
          truthMyth: entryEditor?.entry?.truth?.layers.find(layer => layer.kind === 'MYTH')?.statement ?? '',
          truthNeedsReview: entryEditor?.entry?.truth?.needsReview ?? false,
          eventState: entryEditor?.entry?.eventState ?? 'historical',
          discoveryKind: entryEditor?.entry?.discoveryKind ?? 'past_occurrence',
          timelineImpact: entryEditor?.entry?.timelineImpact ?? 'medium',
          timelineScope: entryEditor?.entry?.timelineScope ?? 'personal',
          relatedEntities: relatedEntityLabels(entryEditor?.entry?.relatedEntityIds),
          anchorCharacters: entryEditor?.entry?.anchorCharacterIds?.map(id => characterCatalog.find(item => item.id === id)?.label).filter(Boolean).join(', ') ?? '',
        }}
        mentions={entryMentions}
        onClose={() => setEntryEditor(null)}
        onSave={saveEntry}
      />
      <CharacterModal character={characterEditor} mentions={characterMentions} onClose={() => setCharacterEditor(null)} onSave={saveCharacter} />
    </div>
  );
}

const FactionAccordion = ({ entry, index, palette, onEdit }: { entry: CodexEntry; index: number; palette: { from: string; to: string; line: string; text: string }; onEdit: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(value => !value)} className="flex w-full items-start gap-4 p-5 text-left" style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}>
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border text-lg font-serif font-bold" style={{ background: `${palette.line}22`, color: palette.line, borderColor: `${palette.line}44` }}>{entry.title[0]?.toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-serif text-lg font-bold leading-tight" style={{ color: palette.text }}>{entry.title}</p>
          <p className="line-clamp-2 text-xs leading-6 opacity-75" style={{ color: palette.text }}>{entry.content}</p>
        </div>
        <button type="button" onClick={event => { event.stopPropagation(); onEdit(); }} className="mt-1 flex-shrink-0 text-stone-200 hover:text-white"><Edit3 className="h-4 w-4" /></button>
        <ChevronDown className="mt-1 h-4 w-4 flex-shrink-0 transition-transform duration-200" style={{ color: palette.line, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t bg-white px-5 py-4" style={{ borderColor: `${palette.line}20` }}>
              {entry.aliases.length > 0 && <p className="mb-2 text-xs text-stone-400">Aliases: {aliasString(entry.aliases)}</p>}
              <p className="font-serif text-sm leading-7 text-stone-600">{entry.content}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

const SimpleEntryGrid = ({ id, title, icon, subtitle, entries, addLabel, onAdd, onEdit, active = true }: { id: string; title: string; icon: React.ReactNode; subtitle: string; entries: CodexEntry[]; addLabel: string; onAdd: () => void; onEdit: (entry: CodexEntry) => void; active?: boolean }) => {
  const { t, lang } = useLanguage();
  return (
  <SectionBlock active={active} id={id} title={title} icon={icon} subtitle={subtitle} count={entries.length} action={<Button variant="ghost" size="sm" onClick={onAdd}><Plus className="mr-2 h-3.5 w-3.5" />{addLabel}</Button>}>
    {entries.length === 0 ? (
      <p className="text-sm italic text-stone-400">{t('codex.empty.entries')}</p>
    ) : (
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map((entry, index) => (
          <motion.div key={entry.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-lg font-bold text-stone-900">{entry.title}</p>
                {entry.aliases.length > 0 && <p className="mt-1 text-xs text-stone-400">{t('codex.label.aliases')}: {aliasString(entry.aliases)}</p>}
                {entry.ruleKind && <span className="mt-2 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">{ruleKindLabel(entry.ruleKind, lang)}</span>}
              </div>
              <button className="text-stone-400 hover:text-stone-700" onClick={() => onEdit(entry)}><Edit3 className="h-4 w-4" /></button>
            </div>
            <p className="text-sm leading-7 text-stone-600">{entry.content}</p>
          </motion.div>
        ))}
      </div>
    )}
  </SectionBlock>
  );
};
