import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Character, CodexEntry, Universe } from '../types';
import Button from './ui/Button';
import Modal from './ui/Modal';
import CharacterPortrait from './ui/CharacterPortrait';
import InlineHelp from './ui/InlineHelp';
import { RelationshipConstellation } from './CharactersView';
import { collectCharacterMentions, collectCodexEntryMentions, markUniverseDirty } from '../services/geminiService';
import { BookOpen, ChevronDown, Clock, Edit3, Globe2, LayoutGrid, MapPin, Plus, Scale, Search, Share2, Shield, Sparkles, Users } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

type CodexBucket = 'timeline' | 'factions' | 'rules';
type CharacterDraft = Character | null;
type CodexEntryDraft = {
  title: string;
  aliases: string;
  content: string;
  notesPrivate: string;
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
  relatedEntities: string;
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

const sectionDefs = (t: (key: string) => string) => [
  { id: 'overview', label: t('codex.section.overview'), icon: <Globe2 className="h-4 w-4" /> },
  { id: 'characters', label: t('codex.section.characters'), icon: <Users className="h-4 w-4" /> },
  { id: 'factions', label: t('codex.section.factionsRealm'), icon: <Shield className="h-4 w-4" /> },
  { id: 'laws', label: t('codex.section.lawsMagic'), icon: <Scale className="h-4 w-4" /> },
  { id: 'locations', label: t('codex.section.locations'), icon: <MapPin className="h-4 w-4" /> },
  { id: 'timeline', label: t('codex.section.timeline'), icon: <Clock className="h-4 w-4" /> },
  { id: 'lore', label: t('codex.section.loreConcepts'), icon: <Sparkles className="h-4 w-4" /> },
];

const filterEntry = (entry: CodexEntry, search: string) => includesSearch([entry.title, entry.content, aliasString(entry.aliases), entry.notesPrivate ?? ''].join(' '), search);
const filterCharacter = (character: Character, search: string) => includesSearch([character.name, character.role, character.faction, character.status, character.bio, character.alignment, aliasString(character.aliases), character.notesPrivate ?? ''].join(' '), search);
const classifyRule = (entry: CodexEntry): 'location' | 'law' | 'lore' => {
  const blob = normalize(`${entry.title} ${entry.content}`);
  if (LOCATION_HINTS.some(hint => blob.includes(hint))) return 'location';
  if (LAW_HINTS.some(hint => blob.includes(hint))) return 'law';
  return 'lore';
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
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
              <span>{lang === 'en' ? 'AI Visibility' : 'Visibilidade IA'}</span>
              <InlineHelp content={t('help.codex.aiVisibility')} />
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
                <select className="rounded-xl border border-stone-300 px-3 py-2" value={draft.aiVisibility} onChange={e => setDraft(prev => prev ? { ...prev, aiVisibility: e.target.value as Character['aiVisibility'] } : prev)}>
                  <option value="global">{lang === 'en' ? 'Always include' : 'Sempre incluir'}</option>
                  <option value="tracked">{lang === 'en' ? 'Include when detected' : 'Incluir quando detectado'}</option>
                  <option value="hidden">{lang === 'en' ? 'Never include' : 'Nunca incluir'}</option>
                </select>
              </div>
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
  const sections = useMemo(() => sectionDefs(t), [t]);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [search, setSearch] = useState('');
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({ name: universe.name, subtitle: universe.subtitle ?? '', description: universe.description, overview: universe.codex.overview, notesPrivate: universe.notesPrivate ?? '' });
  const [entryEditor, setEntryEditor] = useState<{ bucket: CodexBucket; title: string; entry: CodexEntry | null } | null>(null);
  const [characterEditor, setCharacterEditor] = useState<CharacterDraft>(null);
  const [characterLens, setCharacterLens] = useState<'cards' | 'relations'>('cards');

  useEffect(() => {
    setProjectDraft({ name: universe.name, subtitle: universe.subtitle ?? '', description: universe.description, overview: universe.codex.overview, notesPrivate: universe.notesPrivate ?? '' });
  }, [universe.name, universe.subtitle, universe.description, universe.codex.overview, universe.notesPrivate]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const characters = useMemo(() => universe.characters.filter(character => filterCharacter(character, search)), [universe.characters, search]);
  const factions = useMemo(() => universe.codex.factions.filter(entry => filterEntry(entry, search)), [universe.codex.factions, search]);
  const timeline = useMemo(() => universe.codex.timeline.filter(entry => filterEntry(entry, search)), [universe.codex.timeline, search]);
  const rules = useMemo(() => universe.codex.rules.filter(entry => filterEntry(entry, search)), [universe.codex.rules, search]);
  const locations = useMemo(() => rules.filter(entry => classifyRule(entry) === 'location'), [rules]);
  const laws = useMemo(() => rules.filter(entry => classifyRule(entry) === 'law'), [rules]);
  const lore = useMemo(() => rules.filter(entry => classifyRule(entry) === 'lore'), [rules]);

  const counts = { overview: 1, characters: characters.length, factions: factions.length, laws: laws.length, locations: locations.length, timeline: timeline.length, lore: lore.length };

  const navTo = (id: string) => {
    setActiveSection(id);
  };

  const entityCatalog = useMemo(() => [
    ...universe.characters.map(item => ({ id: item.id, label: item.name })),
    ...universe.codex.factions.map(item => ({ id: item.id, label: item.title })),
    ...universe.codex.rules.map(item => ({ id: item.id, label: item.title })),
    ...universe.codex.timeline.map(item => ({ id: item.id, label: item.title })),
  ], [universe]);

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

  const openEntryEditor = (bucket: CodexBucket, title: string, entry?: CodexEntry) => {
    setEntryEditor({
      bucket,
      title,
      entry: entry ?? { id: Math.random().toString(36).slice(2, 11), title: '', aliases: [], content: '', notesPrivate: '', aiVisibility: bucket === 'rules' ? 'global' : 'tracked', tracking: { trackByAlias: true, caseSensitive: false, exclusions: [] }, truth: { eventKey: `entry:${Math.random().toString(36).slice(2, 11)}`, layers: [], needsReview: false }, eventState: bucket === 'timeline' ? 'historical' : undefined, discoveryKind: bucket === 'timeline' ? 'past_occurrence' : undefined, relatedEntityIds: [] },
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
      aiVisibility: draft.aiVisibility,
      eventState: entryEditor.bucket === 'timeline' ? draft.eventState : entryEditor.entry.eventState,
      discoveryKind: entryEditor.bucket === 'timeline' ? draft.discoveryKind : entryEditor.entry.discoveryKind,
      relatedEntityIds: entryEditor.bucket === 'timeline'
        ? resolveRelatedEntityIds(draft.relatedEntities)
        : (entryEditor.entry.relatedEntityIds ?? []),
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
              </div>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-6">
                <p className="mb-3 text-[10px] uppercase tracking-[0.28em] text-stone-500">{t('codex.hero.aiOverview')}</p>
                <p className="font-serif text-[1.02rem] leading-8 text-stone-700">{universe.codex.overview || t('codex.empty.overview')}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-6">
                <p className="mb-4 text-[10px] uppercase tracking-[0.28em] text-stone-500">{t('codex.hero.state')}</p>
                <div className="space-y-3">
                  {[{ label: lang === 'en' ? 'Characters' : 'Personagens', value: universe.characters.length }, { label: lang === 'en' ? 'Factions' : 'Facções', value: universe.codex.factions.length }, { label: lang === 'en' ? 'Locations / Laws / Lore' : 'Locais / Leis / Lore', value: universe.codex.rules.length }, { label: lang === 'en' ? 'Events' : 'Eventos', value: universe.codex.timeline.length }].map(item => (
                    <div key={item.label} className="flex items-center justify-between border-b border-stone-100 pb-3 last:border-b-0 last:pb-0">
                      <span className="text-sm text-stone-500">{item.label}</span>
                      <span className="font-mono text-sm font-bold text-stone-900">{item.value}</span>
                    </div>
                  ))}
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

          <SimpleEntryGrid active={activeSection === 'laws'} id="laws" title={t('codex.section.lawsMagic')} icon={<Scale className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.laws')} entries={laws} addLabel={lang === 'en' ? 'New law' : 'Nova lei'} onAdd={() => openEntryEditor('rules', lang === 'en' ? 'New law or rule' : 'Nova lei ou regra')} onEdit={entry => openEntryEditor('rules', lang === 'en' ? 'Edit law or rule' : 'Editar lei ou regra', entry)} />
          <SimpleEntryGrid active={activeSection === 'locations'} id="locations" title={t('codex.section.locations')} icon={<MapPin className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.locations')} entries={locations} addLabel={lang === 'en' ? 'New location' : 'Novo local'} onAdd={() => openEntryEditor('rules', lang === 'en' ? 'New location' : 'Novo local')} onEdit={entry => openEntryEditor('rules', lang === 'en' ? 'Edit location' : 'Editar local', entry)} />

          <SectionBlock active={activeSection === 'timeline'} id="timeline" title={t('codex.section.timeline')} icon={<Clock className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.timeline')} count={timeline.length} action={<Button variant="ghost" size="sm" onClick={() => openEntryEditor('timeline', lang === 'en' ? 'New event' : 'Novo evento')}><Plus className="mr-2 h-3.5 w-3.5" />{lang === 'en' ? 'New event' : 'Novo evento'}</Button>}>
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
                              {(entry.relatedEntityIds?.length ?? 0) > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">{entry.relatedEntityIds?.length} {t('codex.label.links')}</span>}
                            </div>
                          </div>
                          <button className="text-stone-400 hover:text-stone-700" onClick={() => openEntryEditor('timeline', 'Editar evento', entry)}><Edit3 className="h-4 w-4" /></button>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-stone-600">{entry.content}</p>
                        {(entry.relatedEntityIds?.length ?? 0) > 0 && (
                          <p className="mt-3 text-xs text-stone-400">{t('codex.label.relatedTo')}: {relatedEntityLabels(entry.relatedEntityIds)}</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </SectionBlock>

          <SimpleEntryGrid active={activeSection === 'lore'} id="lore" title={t('codex.section.loreConcepts')} icon={<Sparkles className="h-4 w-4" />} subtitle={t('codex.sectionSubtitle.lore')} entries={lore} addLabel={lang === 'en' ? 'New concept' : 'Novo conceito'} onAdd={() => openEntryEditor('rules', lang === 'en' ? 'New concept' : 'Novo conceito')} onEdit={entry => openEntryEditor('rules', lang === 'en' ? 'Edit concept' : 'Editar conceito', entry)} />
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
          relatedEntities: relatedEntityLabels(entryEditor?.entry?.relatedEntityIds),
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
  const { t } = useLanguage();
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
