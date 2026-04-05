import OpenAI from "openai";
import { loadApiKeys } from '../utils/apiKeys';
import { z } from "zod";
import type {
    Universe, Character, Chapter, VisualAsset, UniverseIdea,
    ChapterGenerationParams, CodexEntry, StoryProfile, StoryFormat,
    NarrativeMemory, CharacterState, OpenLoop, OpeningStyle, ArbiterIssue,
    TokenUsageEvent, AgentOutputEvent, AgentOutputStatus, WeaverPlan, GenerationQualityMode,
    DirectorGuidance, AIVisibility, DirtyScope, SyncMeta, TrackingConfig, TruthBundle, CharacterLieState, TimelineEventState, TimelineDiscoveryKind, RuleEntryKind, TimelineImpact, TimelineScope,
    LongformBlueprint, LongformProgressState, LongformChapterFunction,
} from '../types';
import { DEFAULT_AGENTS } from '../constants';
import { createPortraitUrl } from '../utils/portraits';

// ─── Token Usage Pub/Sub ──────────────────────────────────────────────────────
type UsageListener = (event: TokenUsageEvent) => void;
const _usageListeners: UsageListener[] = [];

export const subscribeToTokenUsage = (cb: UsageListener): (() => void) => {
    _usageListeners.push(cb);
    return () => {
        const i = _usageListeners.indexOf(cb);
        if (i >= 0) _usageListeners.splice(i, 1);
    };
};

const emitUsage = (event: Omit<TokenUsageEvent, 'id' | 'timestamp'>) => {
    if (_usageListeners.length === 0) return;
    const full: TokenUsageEvent = {
        ...event,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
    };
    _usageListeners.forEach(cb => cb(full));
};

// ─── Agent Output Pub/Sub ─────────────────────────────────────────────────────
type AgentOutputListener = (event: AgentOutputEvent) => void;
const _agentListeners: AgentOutputListener[] = [];

export const subscribeToAgentOutput = (cb: AgentOutputListener): (() => void) => {
    _agentListeners.push(cb);
    return () => {
        const i = _agentListeners.indexOf(cb);
        if (i >= 0) _agentListeners.splice(i, 1);
    };
};

const emitAgentOutput = (event: Omit<AgentOutputEvent, 'id' | 'timestamp'>) => {
    if (_agentListeners.length === 0) return;
    const full: AgentOutputEvent = {
        ...event,
        label: typeof event.label === 'string' ? repairTextArtifacts(event.label) : event.label,
        summary: typeof event.summary === 'string' ? repairTextArtifacts(event.summary) : event.summary,
        detail: typeof event.detail === 'string' ? repairTextArtifacts(event.detail) : event.detail,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
    };
    _agentListeners.forEach(cb => cb(full));
};

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

// ─── Gemini (Google AI Studio) — OpenAI-compatible endpoint ────────────────
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const GEMINI_DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash-lite';

// ─── Cerebras — OpenAI-compatible endpoint (free tier) ─────────────────────
const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
const CEREBRAS_DEFAULT_MODEL = process.env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507';
const CEREBRAS_WEAVER_MODEL = process.env.CEREBRAS_WEAVER_MODEL || 'zai-glm-4.7';
const CEREBRAS_LAST_RESORT = 'llama3.1-8b'; // absolute last fallback (free tier 8B)
const CEREBRAS_GPT_OSS_MODELS = new Set(['gpt-oss-120b', 'gpt-oss-20b']);
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'qwen/qwen3.6-plus:free';
const OPENROUTER_STRUCTURE_MODEL = process.env.OPENROUTER_STRUCTURE_MODEL || 'openai/gpt-oss-120b:free';
const AUTOGEN_INTER_CHAPTER_DELAY_MS = Number(process.env.AUTOGEN_INTER_CHAPTER_DELAY_MS || 0);
const WEAVER_PLAN_STAGGER_MS = Number(process.env.WEAVER_PLAN_STAGGER_MS || 0);
const LLM_REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 45000);
const OPENROUTER_ATTEMPT_TIMEOUT_MS = Number(process.env.OPENROUTER_ATTEMPT_TIMEOUT_MS || 14000);

type OpenRouterRouteConfig = {
    primary: string;
    fallbacks: string[];
};

const getOpenRouterRouteConfig = (label: string, withJsonMode: boolean): OpenRouterRouteConfig => {
    const normalized = label.toLowerCase();

    if (normalized.includes('bard')) {
        return {
            primary: OPENROUTER_DEFAULT_MODEL,
            fallbacks: [OPENROUTER_STRUCTURE_MODEL],
        };
    }

    if (normalized.includes('director') || normalized.includes('weaver') || normalized.includes('lector') || normalized.includes('chronicler')) {
        return {
            primary: OPENROUTER_STRUCTURE_MODEL,
            fallbacks: [OPENROUTER_DEFAULT_MODEL],
        };
    }

    if (normalized.includes('blueprint')) {
        return {
            primary: OPENROUTER_STRUCTURE_MODEL,
            fallbacks: [OPENROUTER_DEFAULT_MODEL],
        };
    }

    if (normalized.includes('architect') || normalized.includes('soulforger')) {
        return {
            primary: OPENROUTER_DEFAULT_MODEL,
            fallbacks: [OPENROUTER_STRUCTURE_MODEL],
        };
    }

    return {
        primary: withJsonMode ? OPENROUTER_STRUCTURE_MODEL : OPENROUTER_DEFAULT_MODEL,
        fallbacks: withJsonMode ? [OPENROUTER_DEFAULT_MODEL] : [OPENROUTER_STRUCTURE_MODEL],
    };
};

const getPreferredHighCapabilityProvider = (): 'openrouter' | 'cerebras' | 'auto' => {
    const keys = loadApiKeys();
    const preferred = keys?.preferredProvider ?? 'auto';

    if (preferred === 'openrouter' && keys?.openrouter?.trim()) return 'openrouter';
    if (preferred === 'cerebras' && keys?.cerebras?.trim()) return 'cerebras';
    return 'auto';
};

const generateId = () => Math.random().toString(36).substr(2, 9);
const isEconomyMode = (mode?: GenerationQualityMode): boolean => mode === 'economy';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const withLlmTimeout = async <T>(label: string, work: Promise<T>, timeoutMs = LLM_REQUEST_TIMEOUT_MS): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            work,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`[MythosEngine] ${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
};

const DEFAULT_AI_VISIBILITY: AIVisibility = 'tracked';
const DEFAULT_TRACKING: TrackingConfig = {
    trackByAlias: true,
    caseSensitive: false,
    exclusions: [],
};

const createTruthBundle = (
    eventKey: string,
    statement: string,
    sourceChapterId?: string,
    sourceExcerpt?: string,
): TruthBundle => ({
    eventKey,
    needsReview: false,
    layers: statement.trim()
        ? [{
            kind: 'CANON',
            statement: statement.trim(),
            sourceChapterId,
            sourceExcerpt: truncateText(sourceExcerpt, 180),
            confidence: sourceChapterId ? 0.82 : 1,
        }]
        : [],
});

const createLayeredTruthBundle = (
    eventKey: string,
    canon: string,
    options?: {
        belief?: string;
        myth?: string;
        sourceChapterId?: string;
        sourceExcerpt?: string;
    },
): TruthBundle => {
    const layers = [
        canon.trim() ? {
            kind: 'CANON' as const,
            statement: canon.trim(),
            sourceChapterId: options?.sourceChapterId,
            sourceExcerpt: truncateText(options?.sourceExcerpt, 180),
            confidence: options?.sourceChapterId ? 0.82 : 1,
        } : null,
        options?.belief?.trim() ? {
            kind: 'BELIEF' as const,
            statement: options.belief.trim(),
            sourceChapterId: options?.sourceChapterId,
            sourceExcerpt: truncateText(options?.sourceExcerpt, 180),
            confidence: options?.sourceChapterId ? 0.68 : 0.74,
        } : null,
        options?.myth?.trim() ? {
            kind: 'MYTH' as const,
            statement: options.myth.trim(),
            sourceChapterId: options?.sourceChapterId,
            sourceExcerpt: truncateText(options?.sourceExcerpt, 180),
            confidence: options?.sourceChapterId ? 0.64 : 0.7,
        } : null,
    ].filter(Boolean) as TruthBundle['layers'];

    return {
        eventKey,
        needsReview: layers.some(layer => layer.kind !== 'CANON'),
        layers,
    };
};

const markTruthForReview = (truth?: TruthBundle): TruthBundle | undefined =>
    truth
        ? { ...truth, needsReview: truth.layers.some(layer => layer.kind !== 'CANON') }
        : truth;

const normalizeAliasList = (aliases?: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const alias of aliases ?? []) {
        const trimmed = alias.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
    }
    return result;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeMatchValue = (value: string, caseSensitive: boolean): string => caseSensitive ? value : value.toLowerCase();
const buildTrackedTerms = (name: string, aliases: string[], tracking?: TrackingConfig): string[] => {
    const base = tracking?.trackByAlias === false ? [name] : [name, ...aliases];
    return normalizeAliasList(base).sort((a, b) => b.length - a.length);
};

const containsTrackedTerm = (text: string, terms: string[], tracking?: TrackingConfig): boolean => {
    if (!text.trim() || terms.length === 0) return false;
    const caseSensitive = tracking?.caseSensitive ?? DEFAULT_TRACKING.caseSensitive;
    const exclusions = normalizeAliasList(tracking?.exclusions).map(item => normalizeMatchValue(item, caseSensitive));
    const candidate = normalizeMatchValue(text, caseSensitive);
    if (exclusions.some(exclusion => exclusion && candidate.includes(exclusion))) return false;
    return terms.some(term => {
        const needle = normalizeMatchValue(term, caseSensitive);
        if (!needle) return false;
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, caseSensitive ? 'u' : 'iu');
        return pattern.test(candidate);
    });
};

const inferTimelineEventState = (title: string, content: string): TimelineEventState => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(profecia|prophecy|premon|forecast|previsto|pressagio|presságio)/.test(blob)) return 'forecast';
    if (/(veneno|maldicao|maldição|timer|contagem|prazo|ritual em curso|ca[cç]a|pursuit|persegui)/.test(blob)) return 'active_pressure';
    if (/(latente|selado|adormecido|hibernando|dormente|esperando)/.test(blob)) return 'latent';
    if (/(resolvido|encerrado|curado|closed|resolved|apurado|concluido|concluído)/.test(blob)) return 'resolved';
    return 'historical';
};

const inferTimelineDiscoveryKind = (title: string, content: string): TimelineDiscoveryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(flashback|visao|visão|recordacao|recordação|descoberta|revela|memory recovered|vision)/.test(blob)) return 'present_discovery';
    if (/(profecia|prophecy|premon|forecast)/.test(blob)) return 'forecast';
    return 'past_occurrence';
};

const inferRuleEntryKind = (title: string, content: string): RuleEntryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(bairro|torre|templo|cidade|reino|fortaleza|palacio|palácio|porto|floresta|ruina|ruína|distrito|megacidade|district|tower|temple|city|kingdom|forest|hall|passagem|passage)/.test(blob)) return 'location';
    if (/(magia|magic|spell|mana|arcano|arcane|ritual de poder|grimorio|grimoire|feiti|poder|ability|gift|curse system|source of power)/.test(blob)) return 'magic';
    if (/(mito|myth|lenda|legend|cosmologia|cosmology|religiao|religião|folk|folclore|propaganda|rumor|origem do mundo|deuses|gods)/.test(blob)) return 'lore';
    return 'system';
};

const inferTimelineImpact = (title: string, content: string): TimelineImpact => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(apocalipse|world-ending|cataclism|cataclismo|extin|ruina total|queda do imperio|fall of the empire)/.test(blob)) return 'cataclysmic';
    if (/(guerra|war|massacre|rebeli|rebellion|assassinat|coup|ritual major|ritual maior)/.test(blob)) return 'high';
    if (/(revela|discovery|descoberta|juramento|oath|pacto|fuga|escape|capture|captura)/.test(blob)) return 'medium';
    return 'low';
};

const inferTimelineScope = (title: string, content: string): TimelineScope => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(mundo|world|imperio|empire|all realms|todos os reinos|cosmos|reino inteiro)/.test(blob)) return 'world';
    if (/(fac[cç][aã]o|faction|house|guild|cult|ordem|clan|clã)/.test(blob)) return 'faction';
    if (/(cidade|city|hall|bairro|district|temple|palace|palacio|palácio|fortress|fortaleza)/.test(blob)) return 'local';
    return 'personal';
};

const inferRelatedEntityIds = (universe: Universe, text: string, excludeId?: string): string[] => {
    const prepared = ensureUniverseDefaults(universe);
    const pools: Array<{ id: string; name: string; aliases: string[]; tracking?: TrackingConfig }> = [
        ...prepared.characters.map(character => ({ id: character.id, name: character.name, aliases: character.aliases, tracking: character.tracking })),
        ...prepared.codex.factions.map(entry => ({ id: entry.id, name: entry.title, aliases: entry.aliases, tracking: entry.tracking })),
        ...prepared.codex.rules.map(entry => ({ id: entry.id, name: entry.title, aliases: entry.aliases, tracking: entry.tracking })),
        ...prepared.codex.timeline.map(entry => ({ id: entry.id, name: entry.title, aliases: entry.aliases, tracking: entry.tracking })),
    ];

    return pools
        .filter(item => item.id !== excludeId)
        .filter(item => containsTrackedTerm(text, buildTrackedTerms(item.name, item.aliases, item.tracking), item.tracking))
        .map(item => item.id);
};

const ensureCodexEntryDefaults = (entry: CodexEntry): CodexEntry => ({
    ...entry,
    aliases: normalizeAliasList(entry.aliases),
    aiVisibility: entry.aiVisibility ?? DEFAULT_AI_VISIBILITY,
    notesPrivate: entry.notesPrivate ?? '',
    tracking: {
        ...DEFAULT_TRACKING,
        ...(entry.tracking ?? {}),
        exclusions: normalizeAliasList(entry.tracking?.exclusions),
    },
    truth: entry.truth ?? createTruthBundle(entry.id || generateId(), entry.content),
    ruleKind: entry.ruleKind ?? inferRuleEntryKind(entry.title, entry.content),
    relatedEntityIds: entry.relatedEntityIds ?? [],
    anchorCharacterIds: entry.anchorCharacterIds ?? [],
    dependsOnIds: entry.dependsOnIds ?? [],
    eventState: entry.eventState,
    discoveryKind: entry.discoveryKind,
    timelineImpact: entry.timelineImpact ?? (entry.eventState ? inferTimelineImpact(entry.title, entry.content) : undefined),
    timelineScope: entry.timelineScope ?? (entry.eventState ? inferTimelineScope(entry.title, entry.content) : undefined),
});

const ensureCharacterDefaults = (character: Character): Character => ({
    ...character,
    aliases: normalizeAliasList(character.aliases),
    aiVisibility: character.aiVisibility ?? DEFAULT_AI_VISIBILITY,
    notesPrivate: character.notesPrivate ?? '',
    tracking: {
        ...DEFAULT_TRACKING,
        ...(character.tracking ?? {}),
        exclusions: normalizeAliasList(character.tracking?.exclusions),
    },
});

const ensureSyncMeta = (syncMeta?: SyncMeta): SyncMeta => ({
    canonVersion: syncMeta?.canonVersion ?? 1,
    memoryVersion: syncMeta?.memoryVersion ?? 1,
    dirtyScopes: syncMeta?.dirtyScopes ?? [],
    lastSyncAt: syncMeta?.lastSyncAt,
    lastSyncMode: syncMeta?.lastSyncMode,
});

const ensureUniverseDefaults = (universe: Universe): Universe => ({
    ...universe,
    subtitle: universe.subtitle ?? '',
    notesPrivate: universe.notesPrivate ?? '',
    creationMode: universe.creationMode ?? 'manual',
    codex: {
        ...universe.codex,
        overview: universe.codex.overview ?? '',
        timeline: universe.codex.timeline.map(ensureCodexEntryDefaults),
        factions: universe.codex.factions.map(ensureCodexEntryDefaults),
        rules: universe.codex.rules.map(ensureCodexEntryDefaults),
    },
    characters: universe.characters.map(ensureCharacterDefaults),
    chapters: universe.chapters.map(chapter => ({
        ...chapter,
        aiVisibility: chapter.aiVisibility ?? DEFAULT_AI_VISIBILITY,
        notesPrivate: chapter.notesPrivate ?? '',
    })),
    narrativeMemory: universe.narrativeMemory ? {
        ...universe.narrativeMemory,
        lexicalCooldownGuidance: universe.narrativeMemory.lexicalCooldownGuidance ?? {},
        stylePatternCooldown: universe.narrativeMemory.stylePatternCooldown ?? {},
        lieStates: universe.narrativeMemory.lieStates ?? [],
    } : universe.narrativeMemory,
    longformProgress: universe.longformProgress ? {
        ...universe.longformProgress,
        completedMilestones: universe.longformProgress.completedMilestones ?? [],
    } : universe.longformProgress,
    syncMeta: ensureSyncMeta(universe.syncMeta),
});

const limitItems = <T,>(items: T[], maxItems: number): T[] => items.slice(0, Math.max(0, maxItems));
const truncateText = (value: string | undefined, maxChars: number): string => {
    if (!value) return '';
    return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
};

const COMPACT_AGENT_PROMPTS: Partial<Record<string, string>> = {
    architect: 'Create a coherent fictional universe with strong atmosphere, opposing factions, and clear limits. Return only what was requested.',
    soulforger: 'Create psychologically coherent characters with a Ghost and a Lie. Keep the protagonist active and concrete.',
    director: 'Analyse narrative health and prose drift: open loops, faction balance, protagonist agency, repeated openings/endings, and repeated rhetorical patterns. Issue per-chapter guidance JSON only.',
    weaver: 'Plan 5-7 causal beats. Each beat must include actor, action, obstacle, and consequence. Avoid textbook plot labels and generic screenplay scaffolding. Output structured JSON only.',
    bard: 'Write continuous narrative prose only. No headers or meta text. Start concrete, maintain POV, dramatize actions, avoid repetition or cliches, vary sentence temperature, forbid filtering ("he felt/he knew/he saw"), avoid "parecia/como se" except when indispensable, default to affirmative syntax instead of contrastive negation, and vary openings/endings from recent chapters.',
    chronicler: 'Extract explicit facts into the requested JSON only. Reuse known character IDs, avoid invention, and only record stable codex facts.',
    lector: 'Polish the chapter with minimal edits. Prefer concrete nouns, physical verbs, direct syntax, and lower-temperature phrasing. Remove repetition, filtering, hedged similes, banned rhetoric, repeated openings/endings, and saturated image families without making the prose more dramatic.',
};

const BARD_STYLE_OVERRIDE = `

FILTERING / HESITATION BAN:
- Do NOT habitually frame prose through "ele sabia", "ele sentiu", "ele percebeu", "ele notou", "ele viu", "ele ouviu", "ela sabia", "ela sentiu", or equivalent English forms.
- Only use a perception verb if the act of perception itself changes the scene.
- Do NOT lean on "parecia", "como se", "as if", or "seemed" as default atmosphere generators. One rare use in a long chapter is acceptable; repeated use is failure.
- Prefer concrete assertion over hedged image.

WEAK GLUE WORDS:
- Do NOT use "mas", "não", "apenas", "só", "quase" as rhythmic crutches in consecutive sentences.
- If you need force, cut the sentence or sharpen the verb. Do not simulate intensity with connective negation.
- Prefer affirmative syntax and concrete sequence over explanatory contrast.

RHETORICAL REPETITION BAN:
- FORBIDDEN default molds: "não X, mas Y", "não era X. Era Y.", "não vinha de X, vinha de Y", "não por X, por Y", "não com X, mas com Y".
- If contrast is necessary, express it through scene consequence, juxtaposition, or paragraph order — not sentence self-correction.
- Do NOT build intensity by repeatedly denying one image and replacing it with another.

OPENING / ENDING VARIETY:
- Do NOT open consecutive chapters with the same atmospheric recipe.
- Avoid always opening with smell + texture + bodily discomfort + pulsing architecture.
- Avoid ending every chapter with an identity riddle or rhetorical question.
- Vary chapter temperature: some chapters should cut cleaner, move faster, or speak more plainly.
`;

const STYLE_PATTERN_LABELS: Record<string, string> = {
    nao_x_mas_y: 'Avoid contrastive-negation formulas like "não X, mas Y".',
    nao_era_x_era_y: 'Avoid sentence-pair correction formulas like "não era X. Era Y."',
    opening_sensorial_densa: 'Do not open with dense atmospheric sensation. Start with action, dialogue, intrusion, or concrete event.',
    ending_pergunta_identitaria: 'Do not close with a rhetorical identity question. End on action, image, choice, or factual revelation.',
    opening_nome_movimento: 'Do not start the first sentence with protagonist name + movement verb.',
};

const inferOpeningPattern = (text: string, protagonistName = ''): string | null => {
    const first = text.split(/\n+/).map(line => line.trim()).find(Boolean)?.toLowerCase() || '';
    if (!first) return null;
    const normalizedName = protagonistName.toLowerCase();
    if (normalizedName && new RegExp(`^${normalizedName}\\s+(caminhou|correu|desceu|subiu|entrou|atravessou|seguiu|avançou|walked|ran|moved|descended|climbed|entered)\\b`).test(first)) {
        return 'opening_nome_movimento';
    }
    const sensoryHits = ['cheiro', 'gosto', 'ar ', 'umidade', 'cobre', 'ferro', 'terra', 'raiz', 'odor', 'puls', 'latej', 'respir']
        .filter(token => first.includes(token)).length;
    if (sensoryHits >= 3) return 'opening_sensorial_densa';
    return null;
};

const inferEndingPattern = (text: string): string | null => {
    const lines = text.trim().split(/\n+/).map(line => line.trim()).filter(Boolean);
    const tail = lines.slice(-2).join(' ').toLowerCase();
    if (!tail) return null;
    if (tail.includes('?') && /(quem|o que|será|seria|por que|porque|why|who|what)/.test(tail)) {
        return 'ending_pergunta_identitaria';
    }
    return null;
};

const getRecentChapterStarts = (universe: Universe, count = 2): string[] =>
    universe.chapters.slice(-count).map(ch => ch.content.split(/\n+/).map(line => line.trim()).find(Boolean) || '').filter(Boolean);

const getRecentChapterEndings = (universe: Universe, count = 2): string[] =>
    universe.chapters.slice(-count).map(ch => ch.content.trim().split(/\n+/).map(line => line.trim()).filter(Boolean).slice(-1)[0] || '').filter(Boolean);

const detectImageryOveruse = (text: string): string[] => {
    const families = [
        ['osso', 'ossos', 'fêmur', 'femur', 'vértebra', 'vertebra', 'dente', 'dentes', 'crânio', 'cranio'],
        ['pedra', 'rocha', 'pedra-viva', 'rocha-viva'],
        ['cobre', 'ferro', 'metal', 'metálico', 'metalico'],
        ['umidade', 'úmido', 'umido', 'terra molhada', 'raiz', 'raízes', 'raizes'],
        ['abismo', 'poço', 'poco', 'vazio'],
        ['pulsava', 'pulse', 'latejava', 'latejar', 'respirava', 'respira'],
    ];
    const lower = text.toLowerCase();
    return families
        .map(group => ({
            label: group[0],
            hits: group.reduce((sum, token) => sum + ((lower.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length), 0),
        }))
        .filter(item => item.hits >= 4)
        .map(item => item.label);
};

// ─── Story Profile Helpers ──────────────────────────────────────────────────

const FORMAT_SPEC: Record<StoryFormat, { label: string; wordsPerChapter: string; chapterCount: string; style: string }> = {
    light_novel: {
        label: 'Light Novel',
        wordsPerChapter: '1500–2500',
        chapterCount: 'many short chapters',
        style: 'dialogue-heavy, fast-paced, anime-esque, expressive inner monologue',
    },
    web_novel: {
        label: 'Web Novel',
        wordsPerChapter: '2000–3500',
        chapterCount: 'serialized chapters with strong hooks',
        style: 'strong chapter hooks, cliffhangers, informal prose, reader-engagement focus',
    },
    novel: {
        label: 'Novel',
        wordsPerChapter: '4000–7000',
        chapterCount: 'longer immersive chapters',
        style: 'literary prose, richly described scenes, slow deliberate pacing, complex subtext',
    },
};

const ARCHETYPE_STYLE: Record<string, string> = {
    tolkien: 'dense mythological worldbuilding, archaic prose, rare magic, grand scale, languages and histories',
    dostoevski: 'psychological depth, moral philosophy, suffering and redemption, intense interior monologue',
    shakespeare: 'poetic language, tragic irony, complex villains, fate vs free will',
    isekai: 'protagonist transported to fantasy world, system mechanics, leveling, overpowered growth, friendship and rivalry arcs',
    realismo_magico: 'magical elements woven seamlessly into mundane reality, matter-of-fact treatment of the supernatural, lyrical prose, García Márquez / Mia Couto style',
    opera_espacial: 'galactic empires and political factions, space diplomacy, interstellar conflict, grand scale, sophisticated power struggles between civilizations',
    romance_gothico: 'atmospheric dread, forbidden love, decaying grandeur, secrets and curses',
    noir: 'cynical narrator, moral ambiguity, crime, rain-soaked cities, femme fatale archetypes',
};

const buildProfileContext = (profile?: StoryProfile, compact = false): string => {
    if (!profile) return '';

    const fmt = profile.format ? FORMAT_SPEC[profile.format] : null;
    const archetypeStyles = profile.archetypes.map(a => ARCHETYPE_STYLE[a]).filter(Boolean).join('; ');
    const themes = profile.themes.join(', ');

    const fmtLine = fmt
        ? `FORMAT: ${fmt.label}\n  - Words per chapter: ~${fmt.wordsPerChapter}\n  - Chapter structure: ${fmt.chapterCount}\n  - Prose style: ${fmt.style}`
        : 'FORMAT: AI decides freely — choose the most fitting format';

    const hasPremise = !!profile.premise?.trim();
    const premiseBlock = hasPremise
        ? `⚑ USER PREMISE — NON-NEGOTIABLE CONTENT ANCHOR:\n"${profile.premise!.trim()}"\n→ ALL generated content (title, world, factions, conflict, setting, characters) MUST emerge from and serve this premise.\n→ The style directives below (literary influences, tone, format) shape HOW this premise is told — they do NOT replace or dilute it.`
        : 'USER PREMISE: none provided — invent freely following the style directives below.';

    if (compact) {
        return `
=== STORY PROFILE ===
${hasPremise ? `PREMISE (NON-NEGOTIABLE): ${profile.premise!.trim()}` : 'PREMISE: original premise'}
FORMAT: ${fmt?.label || 'flexible'}
TONE: ${profile.tone || 'flexible'}
POV: ${profile.pov ? profile.pov.replace(/_/g, ' ') : 'flexible'}
THEMES: ${themes || 'flexible'}
INFLUENCES: ${archetypeStyles || 'neutral'}
=====================
`;
    }

    return `
=== STORY PROFILE (MANDATORY — FOLLOW STRICTLY) ===
${premiseBlock}

STYLE DIRECTIVES — apply these to shape the premise:
${fmtLine}

NARRATIVE TONE: ${profile.tone || 'AI decides freely'}
POINT OF VIEW: ${profile.pov ? profile.pov.replace(/_/g, ' ') : 'AI decides freely'}
CORE THEMES: ${themes || 'AI decides freely'}
LITERARY INFLUENCES (style/world-feel/prose register — shape HOW, not WHAT): ${archetypeStyles || 'neutral'}
===================================================
`;
};

const LONGFORM_FUNCTION_LABELS: Record<LongformChapterFunction, string> = {
    setup: 'Setup',
    inciting_break: 'Inciting Break',
    lock_in: 'Lock-In',
    complication: 'Complication',
    reversal: 'Reversal',
    midpoint: 'Midpoint',
    descent: 'Descent',
    collapse: 'Collapse',
    pre_climax: 'Pre-Climax',
    climax: 'Climax',
    aftermath: 'Aftermath',
};

const pickBlueprintAnchors = (universe: Universe) => {
    const factionTitles = universe.codex.factions.map(entry => entry.title).filter(Boolean);
    const initialSettingRule = universe.codex.rules.find(entry => entry.title === 'Initial Setting');
    const centralConflictRule = universe.codex.rules.find(entry => entry.title === 'Central Conflict');
    const namedRuleEntries = universe.codex.rules.filter(entry => entry.title && entry.title !== 'Initial Setting' && entry.title !== 'Central Conflict');
    const ruleTitles = namedRuleEntries.map(entry => entry.title).filter(Boolean);
    const timelineTitles = universe.codex.timeline.map(entry => entry.title || entry.content).filter(Boolean);
    return {
        factionA: factionTitles[0] || (universe.lang === 'en' ? 'the ruling faction' : 'a facção dominante'),
        factionB: factionTitles[1] || factionTitles[0] || (universe.lang === 'en' ? 'the opposing faction' : 'a facção rival'),
        ruleA: ruleTitles[0] || initialSettingRule?.content || (universe.lang === 'en' ? 'the central rule of the world' : 'a regra central do mundo'),
        ruleB: ruleTitles[1] || centralConflictRule?.content || ruleTitles[0] || (universe.lang === 'en' ? 'the forbidden law' : 'a lei proibida'),
        timelineA: timelineTitles[0] || centralConflictRule?.content || (universe.lang === 'en' ? 'the buried event that shaped the present' : 'o evento enterrado que moldou o presente'),
    };
};

const normalizeBlueprintText = (text: string, universe: Universe): string => {
    const initialSetting = universe.codex.rules.find(rule => rule.title === 'Initial Setting')?.content?.trim() || universe.codex.overview?.trim() || universe.name;
    const centralConflict = universe.codex.rules.find(rule => rule.title === 'Central Conflict')?.content?.trim() || universe.description?.trim() || universe.codex.overview?.trim() || universe.name;
    const timelineAnchor = universe.codex.timeline[0]?.title?.trim() || universe.codex.timeline[0]?.content?.trim() || centralConflict;

    return repairTextArtifacts(text)
        .replace(/\bInitial Setting\b/g, initialSetting)
        .replace(/\bCentral Conflict\b/g, centralConflict)
        .replace(/\bthe buried event that shaped the present\b/gi, timelineAnchor)
        .replace(/\bo evento enterrado que moldou o presente\b/gi, timelineAnchor);
};

const normalizeLongformBlueprint = (blueprint: LongformBlueprint, universe: Universe): LongformBlueprint => ({
    ...deepRepairTextArtifacts(blueprint),
    title: normalizeBlueprintText(blueprint.title, universe),
    logline: normalizeBlueprintText(blueprint.logline, universe),
    promise: normalizeBlueprintText(blueprint.promise, universe),
    conflictCore: normalizeBlueprintText(blueprint.conflictCore, universe),
    protagonistFocus: normalizeBlueprintText(blueprint.protagonistFocus, universe),
    acts: blueprint.acts.map(act => ({
        ...act,
        label: normalizeBlueprintText(act.label, universe),
        purpose: normalizeBlueprintText(act.purpose, universe),
        milestone: normalizeBlueprintText(act.milestone, universe),
    })),
    milestones: blueprint.milestones.map(item => ({
        ...item,
        label: normalizeBlueprintText(item.label, universe),
        objective: normalizeBlueprintText(item.objective, universe),
    })),
    chapterMap: blueprint.chapterMap.map(entry => ({
        ...entry,
        goal: normalizeBlueprintText(entry.goal, universe),
        milestone: entry.milestone ? normalizeBlueprintText(entry.milestone, universe) : entry.milestone,
    })),
});

const BLUEPRINT_GENERIC_PATTERNS = [
    /training, initiation, infiltration,? or adaptation/i,
    /treinamento, inicia[cç][aã]o, infiltra[cç][aã]o ou adapta[cç][aã]o/i,
    /price of victory/i,
    /preço da vitória/i,
    /hidden truth/i,
    /verdade oculta/i,
    /apparent victory/i,
    /vit[óo]ria aparente/i,
    /false shelter/i,
    /abrigo falso/i,
    /narrower path/i,
    /caminho estreito/i,
    /surviving forces/i,
    /forças sobreviventes/i,
    /central promise/i,
    /promessa central/i,
    /central engine of the conflict/i,
    /motor central do conflito/i,
    /what must be won, lost, or exposed/i,
    /o que precisa ser ganho, perdido ou exposto/i,
    [/revelaçãoo/gi, 'revelação'], [/exposiçãoo/gi, 'exposição'], [/deterioraçãoo/gi, 'deterioração'],
    [/puniçãoo/gi, 'punição'], [/facçõeses/gi, 'facções'], [/prote\?\?o/gi, 'proteção'],
    [/institui\?\?/gi, 'instituições'], [/rel\?quia/gi, 'relíquia'], [/espec\?fica/gi, 'específica'],
    [/viol\?ncia/gi, 'violência'], [/imposs\?vel/gi, 'impossível'], [/sacrif\?cio/gi, 'sacrifício'],
    [/cl\?max/gi, 'clímax'],
    [/Ã¢Å¡Â /g, 'WARN '], [/invÃ¡lido/gi, 'invalido'],
];

const blueprintTextHasNamedAnchor = (text: string, anchors: string[]): boolean =>
    anchors.some(anchor => anchor.length > 2 && text.toLowerCase().includes(anchor.toLowerCase()));

const estimateLongformTargetChapters = (universe: Universe): number => {
    const profile = universe.storyProfile;
    const premiseLength = (profile?.premise || universe.description || '').trim().length;
    const themes = profile?.themes?.length ?? 0;
    const archetypes = profile?.archetypes?.length ?? 0;
    const factionCount = universe.codex.factions.length;
    const ruleCount = universe.codex.rules.length;
    const timelineCount = universe.codex.timeline.length;
    const tone = normalizeThemeKey(profile?.tone ?? '');
    const proseStyle = profile?.proseStyle ?? '';

    let score = 16;
    if (premiseLength > 150) score += 1;
    if (premiseLength > 260) score += 1;
    if (themes >= 3) score += 1;
    if (archetypes >= 2) score += 1;
    if (factionCount >= 3) score += 1;
    if (ruleCount >= 5) score += 1;
    if (timelineCount >= 4) score += 1;
    if (tone.includes('epic') || tone.includes('epico') || tone.includes('mysterious') || tone.includes('misterioso') || tone.includes('lyrical') || tone.includes('lirico')) score += 1;
    if (proseStyle === 'novel') score += 1;
    if (proseStyle === 'light_novel') score -= 1;

    return Math.max(15, Math.min(20, score));
};

const buildDynamicChapterFunctions = (targetChapters: number): LongformChapterFunction[] => {
    const total = Math.max(15, Math.min(20, targetChapters));
    const sequence: LongformChapterFunction[] = Array.from({ length: total }, () => 'complication');
    sequence[0] = 'setup';
    sequence[1] = 'inciting_break';
    sequence[2] = 'lock_in';

    const midpointIndex = Math.max(7, Math.min(total - 6, Math.round(total / 2))) - 1;
    const aftermathIndex = total - 1;

    if (total >= 18) {
        sequence[total - 5] = 'collapse';
        sequence[total - 4] = 'pre_climax';
        sequence[total - 3] = 'pre_climax';
        sequence[total - 2] = 'climax';
        sequence[total - 1] = 'aftermath';
    } else {
        sequence[total - 4] = 'collapse';
        sequence[total - 3] = 'pre_climax';
        sequence[total - 2] = 'climax';
        sequence[total - 1] = 'aftermath';
    }

    sequence[midpointIndex] = 'midpoint';

    for (let i = 3; i < midpointIndex; i++) {
        sequence[i] = i % 2 === 0 ? 'reversal' : 'complication';
    }
    for (let i = midpointIndex + 1; i < total - (total >= 18 ? 5 : 4); i++) {
        sequence[i] = (i - midpointIndex) % 3 === 0 ? 'reversal' : ((i - midpointIndex) % 2 === 0 ? 'descent' : 'complication');
    }

    sequence[aftermathIndex] = 'aftermath';
    return sequence;
};

const buildFallbackLongformBlueprint = (universe: Universe): LongformBlueprint => {
    const protagonist = universe.characters[0];
    const protagonistName = protagonist?.name || 'The protagonist';
    const title = universe.name || 'Untitled Work';
    const logline = universe.description?.trim() || universe.codex.overview?.trim() || `A longform story centered on ${protagonistName}.`;
    const lang = universe.lang ?? universe.storyProfile?.lang ?? 'pt';
    const themes = universe.storyProfile?.themes ?? [];
    const conflict = universe.codex.rules.find(rule => rule.title === 'Central Conflict')?.content?.trim() || universe.codex.overview?.trim() || logline;
    const initialSetting = universe.codex.rules.find(rule => rule.title === 'Initial Setting')?.content?.trim() || universe.codex.overview?.trim() || title;
    const anchors = pickBlueprintAnchors(universe);
    const targetChapters = estimateLongformTargetChapters(universe);
    const chapterFunctions = buildDynamicChapterFunctions(targetChapters);
    const actOneEnd = targetChapters <= 16 ? 4 : 5;
    const actTwoEnd = Math.max(actOneEnd + 4, Math.round(targetChapters * 0.5));
    const actThreeEnd = Math.max(actTwoEnd + 4, targetChapters - (targetChapters >= 18 ? 4 : 3));
    const milestoneChapters = [actOneEnd, actTwoEnd, actThreeEnd, targetChapters];
    const themeLine = themes.length > 0
        ? (lang === 'en' ? `The work explores ${themes.join(', ')} under escalating pressure.` : `A obra explora ${themes.join(', ')} sob press?o crescente.`)
        : (lang === 'en' ? 'The work promises escalating moral and emotional consequence.' : 'A obra promete consequ?ncia moral e emocional crescente.');
    const promise = lang === 'en'
        ? `${universe.codex.overview?.trim() || logline} The pressure concentrates around ${initialSetting}, the fracture between ${anchors.factionA} and ${anchors.factionB}, and the dangerous truth hidden inside ${anchors.ruleA}. ${themeLine}`.trim()
        : `${universe.codex.overview?.trim() || logline} A press?o se concentra em ${initialSetting}, na fratura entre ${anchors.factionA} e ${anchors.factionB}, e na verdade perigosa escondida em ${anchors.ruleA}. ${themeLine}`.trim();
    const actMilestones = lang === 'en'
        ? [
            `${protagonistName} is forced to choose between the safety of ${initialSetting} and the pull of ${anchors.ruleA}, making open conflict with ${anchors.factionA} unavoidable.`,
            `A revelation tied to ${anchors.timelineA} exposes what ${anchors.factionB} really wants and changes the scale of the conflict.`,
            `${protagonistName} loses protection, is exposed through ${anchors.ruleB}, and is cornered into acting without cover.`,
            `The final collision resolves the fracture between ${anchors.factionA} and ${anchors.factionB} through sacrifice, consequence, and a changed order.`,
        ]
        : [
            `${protagonistName} ? for?ado a escolher entre a seguran?a de ${initialSetting} e o chamado de ${anchors.ruleA}, tornando inevit?vel o conflito aberto com ${anchors.factionA}.`,
            `Uma revela??o ligada a ${anchors.timelineA} exp?e o que ${anchors.factionB} realmente quer e muda a escala do conflito.`,
            `${protagonistName} perde prote??o, ? exposto por ${anchors.ruleB} e fica encurralado a agir sem cobertura.`,
            `A colis?o final resolve a fratura entre ${anchors.factionA} e ${anchors.factionB} por meio de sacrif?cio, consequ?ncia e nova ordem.`,
        ];
    const acts = [
        { actIndex: 1, label: lang === 'en' ? 'Act I' : 'Ato I', purpose: lang === 'en' ? 'Establish the ordinary order, the pressure lines, and the first irreversible breach.' : 'Estabele?a a ordem comum, as linhas de press?o e a primeira ruptura irrevers?vel.', chapterStart: 1, chapterEnd: actOneEnd, milestone: actMilestones[0] },
        { actIndex: 2, label: lang === 'en' ? 'Act II-A' : 'Ato II-A', purpose: lang === 'en' ? 'Expand the arena, sharpen factional pressure, and deepen attachment under danger.' : 'Expanda a arena, afie a press?o entre fac??es e aprofunde v?nculos sob perigo.', chapterStart: actOneEnd + 1, chapterEnd: actTwoEnd, milestone: actMilestones[1] },
        { actIndex: 3, label: lang === 'en' ? 'Act II-B' : 'Ato II-B', purpose: lang === 'en' ? 'Turn revelation into cost, exposure, deterioration, and narrowing options.' : 'Transforme revela??o em custo, exposi??o, deteriora??o e estreitamento de op??es.', chapterStart: actTwoEnd + 1, chapterEnd: actThreeEnd, milestone: actMilestones[2] },
        { actIndex: 4, label: lang === 'en' ? 'Act III' : 'Ato III', purpose: lang === 'en' ? 'Converge surviving forces into collision, consequence, and aftermath.' : 'Converja as for?as sobreviventes em colis?o, consequ?ncia e desfecho.', chapterStart: actThreeEnd + 1, chapterEnd: targetChapters, milestone: actMilestones[3] },
    ];
    const chapterGoalSeeds = lang === 'en'
        ? [
            `Show ${protagonistName} inside the fragile routine of ${initialSetting} while the first sign of ${anchors.ruleA} threatens to expose the conflict hidden inside ${conflict}.`,
            `Force ${protagonistName} to cross into the zone controlled by ${anchors.factionB}, breaking a taboo that cannot be undone quietly.`,
            `Make retreat impossible by tying ${protagonistName}'s safety to a witness, relic, or secret linked to ${anchors.timelineA}.`,
            `Expose a concrete move by ${anchors.factionA} that turns the conflict from rumor into organized violence.`,
            `Push ${protagonistName} to learn, steal, or survive one specific rule of ${anchors.ruleA} under immediate risk.`,
            `Turn an apparent ally into a liability by revealing their hidden tie to ${anchors.factionB} or ${anchors.ruleB}.`,
            `Make loyalty, desire, and survival collide through a relationship strained by demands from ${anchors.factionA} and ${anchors.factionB}.`,
            `Reveal a fact about ${anchors.timelineA} that directly reframes the protagonist's Lie and contaminates the next choice.`,
            `Deliver a midpoint truth that identifies what ${anchors.ruleA} really does and why both factions are willing to spill blood for it.`,
            `Transform that truth into visible social, spiritual, or physical punishment centered on ${initialSetting}.`,
            `Escalate pressure as factions, rituals, or institutions move openly around ${anchors.ruleB}.`,
            `Destroy the refuge, cover story, or alliance protecting ${protagonistName}, and tie the collapse to ${anchors.factionA}.`,
            `Narrow the road until sacrifice means losing a person, place, or oath anchored in ${anchors.timelineA}.`,
            `Prepare the final collision by exposing the exact price of defeating ${anchors.factionB} and the truth ${protagonistName} still refuses to name.`,
            `Drive the surviving forces into the same arena, forcing ${protagonistName} to choose who will be betrayed, saved, or abandoned.`,
            `Stage the climax through direct confrontation with whoever wields ${anchors.ruleA}.`,
            `Show what remains of the world, the bonds, and the self after the order around ${initialSetting} has been rewritten.`,
        ]
        : [
            `Mostre ${protagonistName} dentro da rotina fr?gil de ${initialSetting}, enquanto o primeiro sinal de ${anchors.ruleA} amea?a expor o conflito escondido em ${conflict}.`,
            `Force ${protagonistName} a cruzar para a zona controlada por ${anchors.factionB}, quebrando um tabu que n?o pode ser desfeito em sil?ncio.`,
            `Torne a retirada imposs?vel ao ligar a seguran?a de ${protagonistName} a uma testemunha, rel?quia ou segredo conectado a ${anchors.timelineA}.`,
            `Exponha um movimento concreto de ${anchors.factionA} que transforma o conflito de rumor em viol?ncia organizada.`,
            `Empurre ${protagonistName} a aprender, roubar ou sobreviver a uma regra espec?fica de ${anchors.ruleA} sob risco imediato.`,
            `Transforme um aliado aparente em problema ao revelar seu v?nculo oculto com ${anchors.factionB} ou ${anchors.ruleB}.`,
            `Fa?a lealdade, desejo e sobreviv?ncia colidirem por meio de uma rela??o pressionada ao mesmo tempo por ${anchors.factionA} e ${anchors.factionB}.`,
            `Revele um fato sobre ${anchors.timelineA} que reinterpreta diretamente a Lie do protagonista e contamina a pr?xima escolha.`,
            `Entregue no midpoint a verdade sobre o que ${anchors.ruleA} realmente faz e por que as duas fac??es aceitariam sangrar por isso.`,
            `Transforme essa verdade em puni??o social, espiritual ou f?sica vis?vel, centrada em ${initialSetting}.`,
            `Aumente a press?o quando fac??es, rituais ou institui??es passam a agir abertamente ao redor de ${anchors.ruleB}.`,
            `Destrua o ref?gio, a cobertura ou a alian?a que protegia ${protagonistName}, ligando o colapso a ${anchors.factionA}.`,
            `Aperte o caminho at? o sacrif?cio significar perder uma pessoa, lugar ou juramento ancorado em ${anchors.timelineA}.`,
            `Prepare a colis?o final expondo o pre?o exato de derrotar ${anchors.factionB} e a verdade que ${protagonistName} ainda se recusa a nomear.`,
            `Leve as for?as sobreviventes para a mesma arena e obrigue ${protagonistName} a escolher quem ser? tra?do, salvo ou abandonado.`,
            `Encene o cl?max por confronto direto com quem controla ${anchors.ruleA}.`,
            `Mostre o que resta do mundo, dos v?nculos e do eu depois que a ordem em ${initialSetting} foi reescrita.`,
        ];

    const chapterMap = chapterFunctions.map((fn, index) => {
        const chapterNumber = index + 1;
        const actIndex = chapterNumber <= actOneEnd ? 1 : chapterNumber <= actTwoEnd ? 2 : chapterNumber <= actThreeEnd ? 3 : 4;
        const fallbackGoal = lang === 'en'
            ? `${LONGFORM_FUNCTION_LABELS[fn]}: force ${protagonistName} into a named cost, revelation, or irreversible move tied to ${anchors.ruleA}.`
            : `${LONGFORM_FUNCTION_LABELS[fn]}: force ${protagonistName} a pagar um custo nomeado, receber uma revela??o concreta ou agir sem volta em torno de ${anchors.ruleA}.`;
        return {
            chapterNumber,
            actIndex,
            function: fn,
            goal: chapterGoalSeeds[index] || fallbackGoal,
            milestone: chapterNumber === milestoneChapters[0] ? actMilestones[0]
                : chapterNumber === milestoneChapters[1] ? actMilestones[1]
                : chapterNumber === milestoneChapters[2] ? actMilestones[2]
                : chapterNumber === milestoneChapters[3] ? actMilestones[3]
                : undefined,
        };
    });

    return {
        title,
        logline,
        promise,
        conflictCore: conflict,
        protagonistFocus: protagonist?.coreLie
            ? (lang === 'en' ? `${protagonistName} must confront the Lie that ${protagonist.coreLie}` : `${protagonistName} precisa confrontar a Lie de que ${protagonist.coreLie}`)
            : (protagonist?.bio?.trim() || protagonistName),
        targetChapters,
        minChapters: 15,
        maxChapters: 20,
        acts,
        milestones: [
            { chapter: milestoneChapters[0], label: lang === 'en' ? 'Act I Lock' : 'Fecho do Ato I', objective: actMilestones[0] },
            { chapter: milestoneChapters[1], label: lang === 'en' ? 'Midpoint Turn' : 'Virada do Midpoint', objective: actMilestones[1] },
            { chapter: milestoneChapters[2], label: lang === 'en' ? 'Final Descent' : 'Descida Final', objective: actMilestones[2] },
            { chapter: milestoneChapters[3], label: lang === 'en' ? 'Resolution' : 'Resolu??o', objective: actMilestones[3] },
        ],
        chapterMap,
    };
};
const normalizeThemeKey = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

const buildLongformBlueprintDirectives = (profile: StoryProfile | undefined, lang: 'pt' | 'en') => {
    const themes = (profile?.themes ?? []).map(normalizeThemeKey);
    const archetypes = profile?.archetypes ?? [];
    const tone = normalizeThemeKey(profile?.tone ?? '');
    const pov = profile?.pov;

    const model = archetypes.includes('isekai')
        ? 'isekai progression using Save the Cat opening displacement, Hero’s Journey threshold crossing, midpoint rule revelation, and late belonging choice'
        : archetypes.includes('noir')
            ? 'investigation-noir using Fichtean pressure, clue laddering, corruption spiral, and late moral reversal'
            : archetypes.includes('romance_gothico')
                ? 'gothic arc using haunted-house escalation, secrecy lattice, forbidden intimacy beats, and inheritance revelation'
                : archetypes.includes('opera_espacial')
                    ? 'space-opera escalation using converging faction fronts, diplomatic reversals, midpoint scale expansion, and war-cost climax'
                    : archetypes.includes('shakespeare')
                        ? 'tragic reversal arc using fatal contradiction, dramatic irony, cascading misunderstanding, and cathartic downfall'
                        : 'hybrid longform structure using Save the Cat beats, Seven-Point Story Structure, scene-sequel rhythm, and a strong midpoint turn';

    const directivesPt: string[] = [];
    const directivesEn: string[] = [];

    directivesPt.push('TÉCNICA ESTRUTURAL: escolha conscientemente 1-2 frameworks entre Save the Cat, Seven-Point Story Structure, Hero’s Journey, Fichtean curve, Kishotenketsu ou scene-sequel rhythm. Use-os de verdade na distribuição dos atos e marcos, sem citar teoria no texto final.');
    directivesEn.push('STRUCTURAL CRAFT: deliberately choose 1-2 frameworks from Save the Cat, Seven-Point Story Structure, Hero’s Journey, Fichtean curve, Kishotenketsu, or scene-sequel rhythm. Actually use them in act and milestone distribution without naming theory in the final text.');

    if (tone.includes('sombrio') || tone.includes('dark')) {
        directivesPt.push('TOM SOMBRIO: midpoint e ato final devem cobrar perda, custo, degradação e ausência de redenção fácil.');
        directivesEn.push('DARK TONE: midpoint and final act must demand loss, cost, deterioration, and no easy redemption.');
    }
    if (tone.includes('epico') || tone.includes('epic')) {
        directivesPt.push('TOM ÉPICO: escale de conflito pessoal para implicação coletiva, política ou civilizacional até o clímax.');
        directivesEn.push('EPIC TONE: escalate from personal conflict toward collective, political, or civilizational stakes by the climax.');
    }
    if (tone.includes('misterioso') || tone.includes('mysterious')) {
        directivesPt.push('TOM MISTERIOSO: distribua perguntas e revelações em camadas; cada ato deve responder algo e abrir outra pergunta maior.');
        directivesEn.push('MYSTERIOUS TONE: distribute questions and revelations in layers; each act must answer something and open a larger question.');
    }
    if (tone.includes('dramatico') || tone.includes('dramatic')) {
        directivesPt.push('TOM DRAMÁTICO: pelo menos uma relação central deve mudar de estado em cada ato.');
        directivesEn.push('DRAMATIC TONE: at least one core relationship must change state in each act.');
    }
    if (tone.includes('humoristico') || tone.includes('humorous')) {
        directivesPt.push('TOM HUMORÍSTICO: inclua reversões irônicas, contraste e alívio sem desmontar a pressão central.');
        directivesEn.push('HUMOROUS TONE: include ironic reversals, contrast, and relief without dissolving core pressure.');
    }
    if (tone.includes('lirico') || tone.includes('lyrical')) {
        directivesPt.push('TOM LÍRICO: preserve a clareza estrutural, mas permita marcos com forte peso imagético e simbólico.');
        directivesEn.push('LYRICAL TONE: preserve structural clarity while allowing milestones with strong imagistic and symbolic weight.');
    }

    if (themes.includes('redencao')) {
        directivesPt.push('TEMA REDENÇÃO: o protagonista deve enfrentar culpa, falhar moralmente e só poder reparar algo depois de pagar custo real.');
        directivesEn.push('REDEMPTION THEME: the protagonist must face guilt, fail morally, and only earn repair after paying real cost.');
    }
    if (themes.includes('poder_e_corrupcao')) {
        directivesPt.push('TEMA PODER E CORRUPÇÃO: cada ganho de poder precisa vir com deformação ética, dependência ou risco de desumanização.');
        directivesEn.push('POWER & CORRUPTION THEME: every power gain must carry ethical distortion, dependency, or dehumanizing risk.');
    }
    if (themes.includes('amor_proibido')) {
        directivesPt.push('TEMA AMOR PROIBIDO: introduza vínculo afetivo sob barreira real e faça o custo dessa ligação aumentar por ato.');
        directivesEn.push('FORBIDDEN LOVE THEME: introduce an emotional bond under a real barrier and increase its cost each act.');
    }
    if (themes.includes('identidade')) {
        directivesPt.push('TEMA IDENTIDADE: midpoint ou virada do ato 2 deve quebrar a autoimagem do protagonista.');
        directivesEn.push('IDENTITY THEME: the midpoint or late act-two turn must break the protagonist’s self-image.');
    }
    if (themes.includes('vinganca')) {
        directivesPt.push('TEMA VINGANÇA: a busca retaliatória deve ganhar um preço moral claro e disputar espaço com outras lealdades.');
        directivesEn.push('VENGEANCE THEME: the retaliatory drive must incur a clear moral price and compete with other loyalties.');
    }
    if (themes.includes('revolucao')) {
        directivesPt.push('TEMA REVOLUÇÃO: mostre custo sistêmico, facções em conflito e ausência de solução moral simples.');
        directivesEn.push('REVOLUTION THEME: show systemic cost, factions in conflict, and no morally simple solution.');
    }
    if (themes.includes('sobrevivencia')) {
        directivesPt.push('TEMA SOBREVIVÊNCIA: todo bloco precisa pressionar recursos, tempo, risco físico ou abrigo.');
        directivesEn.push('SURVIVAL THEME: every block must pressure resources, time, physical risk, or shelter.');
    }
    if (themes.includes('traicao')) {
        directivesPt.push('TEMA TRAIÇÃO: plante sementes cedo e exija ao menos uma ruptura importante de confiança.');
        directivesEn.push('BETRAYAL THEME: plant seeds early and require at least one major rupture of trust.');
    }

    if (archetypes.includes('isekai')) {
        directivesPt.push('ISEKAI: o blueprint deve conter ruptura explícita entre mundo comum e mundo outro. Capítulos 1-2 precisam cobrir morte/reencarnação, convocação/transporte ou aprisionamento em outro mundo; o ato 1 precisa ensinar as regras do novo mundo; o midpoint precisa revelar por que o protagonista foi parar ali; o ato final precisa forçar escolha entre pertencer, voltar ou reescrever os dois mundos.');
        directivesEn.push('ISEKAI: the blueprint must contain an explicit rupture between ordinary world and other world. Chapters 1-2 must cover death/reincarnation, summoning/transport, or entrapment in another world; act one must teach the new world’s rules; the midpoint must reveal why the protagonist arrived there; the final act must force a choice between belonging, returning, or rewriting both worlds.');
    }
    if (archetypes.includes('noir')) {
        directivesPt.push('NOIR: inclua investigação, corrupção em camadas, ambiguidade moral e uma verdade tardia que custe algo ao protagonista.');
        directivesEn.push('NOIR: include investigation, layered corruption, moral ambiguity, and a late truth that costs the protagonist something.');
    }
    if (archetypes.includes('romance_gothico')) {
        directivesPt.push('GÓTICO: use segredo de linhagem, casa/instituição decadente, intimidade proibida e sensação de herança maldita.');
        directivesEn.push('GOTHIC: use lineage secrets, a decaying house/institution, forbidden intimacy, and the sense of cursed inheritance.');
    }
    if (archetypes.includes('opera_espacial')) {
        directivesPt.push('SPACE OPERA: distribua conflito entre facções, escala interestelar, diplomacia tensa e promessa de expansão de arena.');
        directivesEn.push('SPACE OPERA: distribute conflict across factions, interstellar scale, tense diplomacy, and the promise of expanding arena.');
    }
    if (archetypes.includes('realismo_magico')) {
        directivesPt.push('REALISMO MÁGICO: o sobrenatural deve coexistir com o cotidiano sem virar tutorial de sistema rígido.');
        directivesEn.push('MAGICAL REALISM: the supernatural must coexist with the ordinary without turning into a rigid system tutorial.');
    }
    if (archetypes.includes('dostoevski')) {
        directivesPt.push('DRAMA PSICOLÓGICO: aumente contradições internas, culpa, autoengano e dilemas sem saída limpa.');
        directivesEn.push('PSYCHOLOGICAL DRAMA: intensify inner contradiction, guilt, self-deception, and dilemmas without clean exits.');
    }
    if (archetypes.includes('tolkien')) {
        directivesPt.push('HIGH FANTASY: deixe claro o pano de fundo mítico, a história profunda do mundo e a relação entre facções, legado e cosmologia.');
        directivesEn.push('HIGH FANTASY: make the mythic backdrop, deep history, and relation between factions, legacy, and cosmology explicit.');
    }
    if (archetypes.includes('shakespeare')) {
        directivesPt.push('TRAGÉDIA CLÁSSICA: faça o blueprint caminhar para ironia, erro fatal e catarse, não apenas para vitória limpa.');
        directivesEn.push('CLASSICAL TRAGEDY: drive the blueprint toward irony, fatal error, and catharsis, not merely clean victory.');
    }

    if (pov === 'primeira_pessoa') {
        directivesPt.push('POV PRIMEIRA PESSOA: organize revelações para o leitor descobrir o mundo pelos limites subjetivos do protagonista.');
        directivesEn.push('FIRST-PERSON POV: structure revelations so the reader discovers the world through the protagonist’s subjective limits.');
    } else if (pov === 'terceiro_limitado') {
        directivesPt.push('POV TERCEIRO LIMITADO: mantenha foco concentrado e segure informações fora do alcance imediato do protagonista.');
        directivesEn.push('THIRD-LIMITED POV: keep focus concentrated and withhold information beyond the protagonist’s immediate reach.');
    } else if (pov === 'terceiro_onisciente') {
        directivesPt.push('POV TERCEIRO ONISCIENTE: permita ironia dramática e contraponto entre facções, mas sem dissolver a linha principal do protagonista.');
        directivesEn.push('THIRD-OMNISCIENT POV: allow dramatic irony and factional counterpoint without dissolving the protagonist’s main line.');
    }

    return {
        model,
        directivesText: lang === 'en'
            ? directivesEn.join('\n- ')
            : directivesPt.join('\n- '),
    };
};

const buildCompactLongformBlueprintDirectives = (profile: StoryProfile | undefined, lang: 'pt' | 'en') => {
    const themes = (profile?.themes ?? []).map(normalizeThemeKey);
    const archetypes = profile?.archetypes ?? [];
    const tone = normalizeThemeKey(profile?.tone ?? '');
    const pov = profile?.pov;

    const model = archetypes.includes('isekai')
        ? 'isekai rupture -> threshold -> world-secret -> belonging choice'
        : archetypes.includes('noir')
            ? 'investigation spiral -> corruption ladder -> moral reversal'
            : archetypes.includes('romance_gothico')
                ? 'gothic secrecy -> forbidden intimacy -> inheritance reveal'
                : archetypes.includes('opera_espacial')
                    ? 'faction escalation -> diplomatic reversals -> war-cost climax'
                    : archetypes.includes('shakespeare')
                        ? 'tragic contradiction -> irony -> downfall -> catharsis'
                        : '4-act escalation with a strong midpoint and earned aftermath';

    const directivesPt: string[] = ['Escolha 1-2 frameworks e aplique-os de verdade na distribuição dos atos.'];
    const directivesEn: string[] = ['Choose 1-2 frameworks and actually apply them to act distribution.'];

    if (tone.includes('sombrio') || tone.includes('dark')) {
        directivesPt.push('Cobre perda real no midpoint e no ato final.');
        directivesEn.push('Charge real loss at the midpoint and in the final act.');
    }
    if (tone.includes('epico') || tone.includes('epic')) {
        directivesPt.push('Escale para impacto coletivo ou civilizacional.');
        directivesEn.push('Escalate toward collective or civilizational stakes.');
    }
    if (tone.includes('misterioso') || tone.includes('mysterious')) {
        directivesPt.push('Cada ato responde uma pergunta e abre outra maior.');
        directivesEn.push('Each act answers one question and opens a larger one.');
    }
    if (tone.includes('dramatico') || tone.includes('dramatic')) {
        directivesPt.push('Faça ao menos uma relação central mudar por ato.');
        directivesEn.push('Make at least one core relationship change each act.');
    }

    if (themes.includes('identidade')) {
        directivesPt.push('Frature a autoimagem do protagonista no midpoint ou fim do ato 2.');
        directivesEn.push('Fracture the protagonist self-image at the midpoint or late act two.');
    }
    if (themes.includes('redencao')) {
        directivesPt.push('A reparação só vem depois de culpa, falha e custo.');
        directivesEn.push('Repair only comes after guilt, failure, and cost.');
    }
    if (themes.includes('poder_e_corrupcao')) {
        directivesPt.push('Todo ganho de poder precisa deformar algo humano.');
        directivesEn.push('Every power gain must deform something human.');
    }
    if (themes.includes('amor_proibido')) {
        directivesPt.push('Faça o vínculo proibido ficar mais caro a cada ato.');
        directivesEn.push('Make the forbidden bond costlier each act.');
    }
    if (themes.includes('vinganca')) {
        directivesPt.push('A vingança deve competir com outras lealdades.');
        directivesEn.push('Vengeance must compete with other loyalties.');
    }
    if (themes.includes('revolucao')) {
        directivesPt.push('Mostre custo sistêmico e facções em choque.');
        directivesEn.push('Show systemic cost and clashing factions.');
    }
    if (themes.includes('sobrevivencia')) {
        directivesPt.push('Pressione tempo, recurso, abrigo ou risco físico em cada bloco.');
        directivesEn.push('Pressure time, resources, shelter, or physical risk in every block.');
    }
    if (themes.includes('traicao')) {
        directivesPt.push('Plante cedo a ruptura de confiança e cobre-a depois.');
        directivesEn.push('Plant the trust rupture early and collect on it later.');
    }

    if (archetypes.includes('isekai')) {
        directivesPt.push('Capítulos 1-2 devem cobrir a ruptura entre mundos.');
        directivesEn.push('Chapters 1-2 must cover the rupture between worlds.');
    }
    if (archetypes.includes('noir')) {
        directivesPt.push('Inclua investigação, corrupção em camadas e verdade tardia com custo.');
        directivesEn.push('Include investigation, layered corruption, and a costly late truth.');
    }
    if (archetypes.includes('romance_gothico')) {
        directivesPt.push('Use decadência, segredo e intimidade proibida.');
        directivesEn.push('Use decay, secrecy, and forbidden intimacy.');
    }
    if (archetypes.includes('opera_espacial')) {
        directivesPt.push('Distribua pressão entre facções, arena ampla e diplomacia tensa.');
        directivesEn.push('Distribute pressure across factions, broad arena, and tense diplomacy.');
    }
    if (archetypes.includes('realismo_magico')) {
        directivesPt.push('O sobrenatural deve coexistir com o cotidiano sem tutorial de sistema.');
        directivesEn.push('The supernatural must coexist with the ordinary without a system tutorial.');
    }
    if (archetypes.includes('dostoevski')) {
        directivesPt.push('Aumente culpa, autoengano e contradição interna.');
        directivesEn.push('Intensify guilt, self-deception, and inner contradiction.');
    }
    if (archetypes.includes('tolkien')) {
        directivesPt.push('Deixe explícitos legado, profundidade histórica e pano de fundo mítico.');
        directivesEn.push('Make legacy, deep history, and mythic backdrop explicit.');
    }
    if (archetypes.includes('shakespeare')) {
        directivesPt.push('Conduza para ironia, erro fatal e catarse.');
        directivesEn.push('Drive toward irony, fatal error, and catharsis.');
    }

    if (pov === 'primeira_pessoa') {
        directivesPt.push('Passe as revelações pelos limites subjetivos do protagonista.');
        directivesEn.push('Route revelations through the protagonist subjective limits.');
    } else if (pov === 'terceiro_limitado') {
        directivesPt.push('Segure informação fora do alcance imediato do protagonista.');
        directivesEn.push('Withhold information beyond the protagonist immediate reach.');
    } else if (pov === 'terceiro_onisciente') {
        directivesPt.push('Permita contraponto entre facções sem dissolver a linha principal.');
        directivesEn.push('Allow factional counterpoint without dissolving the main line.');
    }

    return {
        model,
        directivesText: lang === 'en'
            ? directivesEn.slice(0, 8).join('\n- ')
            : directivesPt.slice(0, 8).join('\n- '),
    };
};

const getBlueprintChapterMeta = (blueprint: LongformBlueprint | undefined, chapterNumber: number) =>
    blueprint?.chapterMap.find(entry => entry.chapterNumber === chapterNumber) ?? null;

const langMandate = (lang?: 'pt' | 'en'): string => {
    if (lang === 'en') {
        return 'Write everything in English only.';
    }
    return 'Escreva tudo em português brasileiro. Não misture inglês no texto. Use acentuação correta quando necessário. Referência rápida: ação, coração, órbita, capítulo, memória, estação, ficção, bênção, impossível.';
};

const langMandateVerbose = (lang?: 'pt' | 'en'): string => {
    if (!lang || lang === 'pt') {
        return `
=== LANGUAGE MANDATE — OBRIGATÓRIO ===
Escreva TODO o texto gerado em PORTUGUÊS BRASILEIRO. Sem exceções.
PROIBIDO misturar inglês no meio do texto português.
Exemplos de erros PROIBIDOS (use a tradução ao lado):
  ❌ "o ar estava thick"      → ✅ "o ar estava espesso / denso"
  ❌ "fluir through ele"      → ✅ "fluir através dele"
  ❌ "tão vivid"              → ✅ "tão vívido / nítido"
  ❌ "uma sensação de flow"   → ✅ "uma sensação de fluidez"
  ❌ "her eyes"               → ✅ "seus olhos"
Nomes próprios de personagens, lugares e fações criados anteriormente devem ser mantidos como estão.
==============================================
`;
    }
    return `
=== LANGUAGE MANDATE ===
You MUST write ALL generated text in ENGLISH. No exceptions.
Do NOT insert words from any other language.
========================
`;
};

// ─── Clean English leakage from PT prose ────────────────────────────────────
const cleanLanguageLeakage = (text: string, lang?: 'pt' | 'en'): string => {
    if (lang === 'en') return text; // nothing to clean
    return text
        .replace(/\bthrough\b/gi, 'através de')
        .replace(/\b(thick|dense)\b(?=\s+(?:com|de|o|a|os|as)\b)/gi, 'denso')
        .replace(/\bthick\b/gi, 'espesso')
        .replace(/\bvivid\b/gi, 'vívido')
        .replace(/\bflow\b/gi, 'fluir')
        .replace(/\bshadow\b/gi, 'sombra')
        .replace(/\bshimmering\b/gi, 'cintilante')
        .replace(/\bglowing\b/gi, 'brilhante')
        .replace(/\bgrim\b/gi, 'sombrio')
        .replace(/\bominous\b/gi, 'ominoso');
};

// ─── Clients ─────────────────────────────────────────────────────────────────


const getGroqClient = (): OpenAI | null => {
    const keys = loadApiKeys();
    const apiKey = keys?.groq;
    if (!apiKey) return null;
    return new OpenAI({
        apiKey,
        baseURL: GROQ_BASE_URL,
        dangerouslyAllowBrowser: true,
    });
};


const getGeminiClient = (): OpenAI | null => {
    const keys = loadApiKeys();
    const apiKey = keys?.gemini;
    if (!apiKey) return null;
    return new OpenAI({
        apiKey,
        baseURL: GEMINI_BASE_URL,
        dangerouslyAllowBrowser: true,
    });
};


const getCerebrasClient = (): OpenAI | null => {
    const keys = loadApiKeys();
    const apiKey = keys?.cerebras;
    if (!apiKey) return null;
    return new OpenAI({
        apiKey,
        baseURL: CEREBRAS_BASE_URL,
        dangerouslyAllowBrowser: true,
    });
};

const getOpenRouterClient = (): OpenAI | null => {
    const keys = loadApiKeys();
    const apiKey = keys?.openrouter;
    if (!apiKey) return null;
    return new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
            'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
            'X-Title': 'Mythos Engine',
        },
        dangerouslyAllowBrowser: true,
    });
};

const is429Error = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const e = error as { status?: number; message?: string };
    if (e.status === 429) return true;
    const msg = e.message ?? '';
    return /rate.?limit|429|too many requests|tokens per day|tpd|tpm/i.test(msg);
};

const extractText = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'type' in part && (part as { type?: string }).type === 'text') {
                    return (part as { text?: string }).text || '';
                }
                return '';
            })
            .join('');
    }
    return '';
};

const stripCodeFences = (value: string): string =>
    value
        .replace(/<think>[\s\S]*?<\/think>/gi, '')   // strip qwen-3 / reasoning model <think> blocks
        .replace(/<think>[\s\S]*$/gi, '')             // strip unclosed <think> (truncated output)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

const TEXT_REPAIR_RULES: Array<[RegExp, string]> = [
    [/Ã¡/g, 'á'], [/Ã /g, 'à'], [/Ã¢/g, 'â'], [/Ã£/g, 'ã'], [/Ã¤/g, 'ä'],
    [/Ã©/g, 'é'], [/Ãª/g, 'ê'], [/Ã¨/g, 'è'],
    [/Ã­/g, 'í'], [/Ã¬/g, 'ì'], [/Ã®/g, 'î'],
    [/Ã³/g, 'ó'], [/Ã´/g, 'ô'], [/Ãµ/g, 'õ'], [/Ã¶/g, 'ö'],
    [/Ãº/g, 'ú'], [/Ã¹/g, 'ù'], [/Ã»/g, 'û'], [/Ã¼/g, 'ü'],
    [/Ã§/g, 'ç'], [/Ã‘/g, 'Ñ'], [/Ã±/g, 'ñ'],
    [/â€™/g, "'"], [/â€œ/g, '"'], [/â€/g, '"'], [/â€“/g, '-'], [/â€”/g, '—'], [/â€¦/g, '...'],
    [/Â·/g, '·'], [/Â/g, ''],
    [/press\?o/gi, 'pressão'], [/consequ\?ncia/gi, 'consequência'], [/seguran\?a/gi, 'segurança'],
    [/inevit\?vel/gi, 'inevitável'], [/revela\?\?/gi, 'revelação'], [/exp\?e/gi, 'expõe'],
    [/fac\?\?/gi, 'facções'], [/v\?nculos/gi, 'vínculos'], [/v\?nculo/gi, 'vínculo'],
    [/exposi\?\?/gi, 'exposição'], [/deteriora\?\?/gi, 'deterioração'], [/op\?\?es/gi, 'opções'],
    [/for\?as/gi, 'forças'], [/colis\?o/gi, 'colisão'], [/fr\?gil/gi, 'frágil'], [/amea\?a/gi, 'ameaça'],
    [/\bn\?o\b/gi, 'não'], [/sil\?ncio/gi, 'silêncio'], [/pr\?xima/gi, 'próxima'], [/puni\?\?/gi, 'punição'],
    [/ref\?gio/gi, 'refúgio'], [/alian\?a/gi, 'aliança'], [/at\?/gi, 'até'], [/pre\?o/gi, 'preço'],
    [/ser\?/gi, 'será'], [/tra\?do/gi, 'traído'], [/cap\?tulo/gi, 'capítulo'], [/estabele\?a/gi, 'estabeleça'],
];

const repairTextArtifacts = (value: string): string => {
    let next = value;
    for (const [pattern, replacement] of TEXT_REPAIR_RULES) {
        next = next.replace(pattern, replacement);
    }
    return next;
};

const hasMeaningfulFallback = (fallback: unknown): boolean => {
    if (fallback == null) return false;
    if (typeof fallback === 'string') return fallback.trim().length > 0;
    if (Array.isArray(fallback)) return fallback.length > 0;
    if (typeof fallback === 'object') return Object.keys(fallback as Record<string, unknown>).length > 0;
    return true;
};

const deepRepairTextArtifacts = <T,>(value: T): T => {
    if (typeof value === 'string') {
        return repairTextArtifacts(value) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => deepRepairTextArtifacts(item)) as T;
    }
    if (value && typeof value === 'object') {
        const repairedEntries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, deepRepairTextArtifacts(entry)]);
        return Object.fromEntries(repairedEntries) as T;
    }
    return value;
};

const shouldAttemptBlueprintTranslationPass = (label?: string): boolean => {
    if (!label) return false;
    const normalized = label.toLowerCase();
    return normalized.includes('blueprint') && !normalized.includes('json repair');
};

const translateRawBlueprintJson = async <T>({
    raw,
    fallback,
    schema,
    label,
}: {
    raw: string;
    fallback: T;
    schema?: z.ZodType<T>;
    label?: string;
}): Promise<T | null> => {
    const keys = loadApiKeys();
    const preferred = keys?.preferredProvider ?? 'auto';
    const preferredCandidate =
        preferred === 'cerebras' && keys?.cerebras?.trim() ? 'cerebras'
        : preferred === 'openrouter' && keys?.openrouter?.trim() ? 'openrouter'
        : preferred === 'groq' && keys?.groq?.trim() ? 'groq'
        : preferred === 'gemini' && keys?.gemini?.trim() ? 'gemini'
        : null;
    const candidateProviders = Array.from(new Set<Array<'cerebras' | 'groq' | 'openrouter' | 'gemini'>[number]>([
        ...(preferredCandidate ? [preferredCandidate] : []),
        ...(keys?.openrouter?.trim() ? ['openrouter' as const] : []),
        ...(keys?.cerebras?.trim() ? ['cerebras' as const] : []),
        ...(keys?.groq?.trim() ? ['groq' as const] : []),
        ...(keys?.gemini?.trim() ? ['gemini' as const] : []),
    ]));

    if (candidateProviders.length === 0) return null;

    const repairedFallback = deepRepairTextArtifacts(fallback);
    try {
        const locallyParsed = deepRepairTextArtifacts(safeJsonParse<T>(raw));
        if (!schema) return locallyParsed;

        const mergedLocalCandidate =
            locallyParsed && typeof locallyParsed === 'object' && !Array.isArray(locallyParsed) &&
            repairedFallback && typeof repairedFallback === 'object' && !Array.isArray(repairedFallback)
                ? deepRepairTextArtifacts({ ...(repairedFallback as object), ...(locallyParsed as object) })
                : locallyParsed;

        const localValidation = schema.safeParse(mergedLocalCandidate);
        if (localValidation.success) return deepRepairTextArtifacts(localValidation.data);
    } catch {
        // Only spend another model call if local JSON recovery truly fails.
    }

    const repairPrompt = [
        'You will receive raw JSON text produced by another model.',
        'Your job is only to normalize the language and encoding of that exact output.',
        'Return ONLY valid JSON.',
        'Do not add, remove, or invent story content.',
        'Preserve the same keys, hierarchy, and intended meaning.',
        'Fix Portuguese accents, mojibake, duplicated suffixes, punctuation damage, and malformed string text.',
        'If needed, minimally repair JSON syntax so the object becomes valid.',
        'Use this object only as a schema reference:',
        JSON.stringify(repairedFallback, null, 2),
        'Raw JSON text to normalize:',
        repairTextArtifacts(stripCodeFences(raw)),
    ].join('\n\n');

    for (const candidateProvider of candidateProviders) {
            try {
            const repairedRaw = await chat({
                user: repairPrompt,
                json: false,
                temperature: 0,
                maxTokens: 2200,
                label: `${label ?? 'Structured Output'} · JSON Repair`,
                provider: candidateProvider,
            });
            if (!repairedRaw) continue;

            const parsed = deepRepairTextArtifacts(safeJsonParse<T>(repairedRaw));
            if (!schema) return parsed;

            const mergedCandidate =
                parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
                repairedFallback && typeof repairedFallback === 'object' && !Array.isArray(repairedFallback)
                    ? deepRepairTextArtifacts({ ...(repairedFallback as object), ...(parsed as object) })
                    : parsed;

            const validation = schema.safeParse(mergedCandidate);
            if (validation.success) return deepRepairTextArtifacts(validation.data);
        } catch (repairError) {
            console.warn(`[MythosEngine] ${label ?? 'Structured Output'} JSON repair via ${candidateProvider} failed.`, repairError instanceof Error ? repairError.message : repairError);
        }
    }

    return null;
};

const repairJson = (raw: string): string => {
    // Strategy 1: remove trailing commas before } or ]
    let s = raw.replace(/,\s*([\}\]])/g, '$1');
    // Strategy 2: close unclosed braces/brackets (handles truncated model output)
    const stack: string[] = [];
    let inString = false;
    let escape = false;
    for (const ch of s) {
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
    }
    if (escape && s.endsWith('\\')) {
        s = s.slice(0, -1);
    }
    if (inString) {
        s += '"';
    }
    s += stack.reverse().join('');
    return s;
};

const extractBalancedJsonCandidates = (raw: string): string[] => {
    const candidates: string[] = [];
    let inString = false;
    let escape = false;
    const stack: string[] = [];
    let start = -1;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if ((ch === '{' || ch === '[') && stack.length === 0) {
            start = i;
        }

        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if ((ch === '}' || ch === ']') && stack.length) {
            const expected = stack.pop();
            if (expected !== ch) {
                stack.length = 0;
                start = -1;
                continue;
            }
            if (stack.length === 0 && start !== -1) {
                candidates.push(raw.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return candidates;
};

const summarizeRawModelOutput = (raw: string): string => {
    const cleaned = repairTextArtifacts(stripCodeFences(raw));
    const head = cleaned.slice(0, 500);
    const tail = cleaned.length > 500 ? cleaned.slice(-500) : '';
    return [
        `RAW_LENGTH=${cleaned.length}`,
        'RAW_HEAD:',
        head,
        ...(tail ? ['RAW_TAIL:', tail] : []),
    ].join('\n');
};

const safeJsonParse = <T>(value: string): T => {
    const cleaned = repairTextArtifacts(stripCodeFences(value));
    // Attempt 1: direct parse
    try { return deepRepairTextArtifacts(JSON.parse(cleaned) as T); } catch {}
    // Attempt 2: repair common malformations
    try { return deepRepairTextArtifacts(JSON.parse(repairJson(cleaned)) as T); } catch {}
    // Attempt 3: parse any balanced top-level JSON object/array embedded in the text.
    for (const candidate of extractBalancedJsonCandidates(cleaned).reverse()) {
        try { return deepRepairTextArtifacts(JSON.parse(candidate) as T); } catch {}
        try { return deepRepairTextArtifacts(JSON.parse(repairJson(candidate)) as T); } catch {}
    }
    // Attempt 4: extract first JSON object/array with brute-force slice
    try {
        const start = cleaned.search(/[\[{]/);
        if (start !== -1) {
            const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
            if (lastBrace > start) return deepRepairTextArtifacts(JSON.parse(cleaned.slice(start, lastBrace + 1)) as T);
        }
    } catch {}
    throw new SyntaxError('JSON parse failed after repair attempts');
};

const isRetryableModelError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return /model|unsupported|response_format|invalid/i.test(message);
};

// ─── Core LLM call — now accepts explicit temperature ───────────────────────

const chat = async ({
    system,
    user,
    json = false,
    model = DEFAULT_MODEL,
    temperature,
    maxTokens,
    label = 'call',
    provider = 'auto',
}: {
    system?: string;
    user: string;
    json?: boolean;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    label?: string;
    provider?: 'groq' | 'gemini' | 'cerebras' | 'openrouter' | 'auto';
}): Promise<string> => {
    const keys = loadApiKeys();
    const client = getGroqClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (system?.trim()) {
        messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: user });

    const defaultTemp = temperature ?? (json ? 0.4 : 0.8);
    const preferredProvider = provider === 'auto'
        ? ((keys?.preferredProvider ?? 'auto') === 'auto'
            ? (keys?.cerebras?.trim() ? 'cerebras' : 'auto')
            : (keys?.preferredProvider ?? 'auto'))
        : provider;
    let cerebrasAlreadyTried = false;
    const executeOpenRouter = async (withJsonMode: boolean, modelOverride?: string): Promise<string> => {
        const openRouterClient = getOpenRouterClient();
        if (!openRouterClient) throw new Error('OPENROUTER_API_KEY not configured.');
        const routeConfig = getOpenRouterRouteConfig(label, withJsonMode);
        const openRouterModels = modelOverride
            ? [modelOverride, ...routeConfig.fallbacks.filter(candidate => candidate !== modelOverride)]
            : [routeConfig.primary, ...routeConfig.fallbacks];
        let lastError: unknown = null;
        for (const openRouterCandidate of openRouterModels) {
            try {
                cerebrasAlreadyTried = true;
                const completion = await withLlmTimeout(
                    `OpenRouter ${label} ${openRouterCandidate}`,
                    openRouterClient.chat.completions.create({
                        model: openRouterCandidate,
                        messages,
                        temperature: defaultTemp,
                        ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
                        ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    }),
                    OPENROUTER_ATTEMPT_TIMEOUT_MS,
                );
                const u = completion.usage;
                const actualModel = completion.model || openRouterCandidate;
                if (u) emitUsage({ provider: 'openrouter', model: actualModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
                return extractText(completion.choices[0]?.message?.content).trim();
            } catch (error) {
                lastError = error;
                console.warn(`[MythosEngine] OpenRouter ${openRouterCandidate} failed — trying next fast fallback.`, error instanceof Error ? error.message : error);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(`[MythosEngine] OpenRouter failed for ${label}.`);
    };


    // ── Direct Cerebras routing (bypass Groq/Gemini entirely) ─────────────────
    if (provider === 'cerebras') {
        const cerebrasClient = getCerebrasClient();
        if (cerebrasClient) {
            const cerebrasModel = model !== DEFAULT_MODEL ? model : CEREBRAS_DEFAULT_MODEL;
            const isGptOss = CEREBRAS_GPT_OSS_MODELS.has(cerebrasModel);
            try {
                const completion = await withLlmTimeout(`Cerebras direct · ${label}`, cerebrasClient.chat.completions.create({
                    model: cerebrasModel,
                    messages,
                    temperature: defaultTemp,
                    ...(json ? { response_format: { type: 'json_object' } } : {}),
                    ...(maxTokens ? (isGptOss ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) : {}),
                }));
                const u = completion.usage;
                if (u) emitUsage({ provider: 'cerebras', model: cerebrasModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
                return extractText(completion.choices[0]?.message?.content).trim();
            } catch (cerebrasErr) {
                console.warn(`[MythosEngine] Cerebras direct ${cerebrasModel} failed — falling through to auto.`, cerebrasErr);
            }
        }
    }

    // ── Direct Gemini routing (bypass Groq entirely) ──────────────────────────
    if (provider === 'gemini') {
        const geminiClient = getGeminiClient();
        if (geminiClient) {
            for (const geminiModel of [GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL]) {
                try {
                    const completion = await withLlmTimeout(`Gemini direct · ${label}`, geminiClient.chat.completions.create({
                        model: geminiModel,
                        messages,
                        temperature: defaultTemp,
                        ...(json ? { response_format: { type: 'json_object' } } : {}),
                        ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    }));
                    const u = completion.usage;
                    if (u) emitUsage({ provider: 'gemini', model: geminiModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
                    return extractText(completion.choices[0]?.message?.content).trim();
                } catch (geminiErr) {
                    console.warn(`[MythosEngine] Gemini ${geminiModel} failed — trying next.`, geminiErr);
                }
            }
            console.warn('[MythosEngine] All Gemini models failed — falling back to Groq.');
        }
    }

    if (preferredProvider === 'openrouter' && keys?.openrouter.trim()) {
        try {
            return await executeOpenRouter(json);
        } catch (error) {
            console.warn('[MythosEngine] OpenRouter preferred provider failed ? falling back.', error);
            if (keys?.cerebras.trim()) {
                try {
                    return await executeCerebras(json);
                } catch (cerebrasError) {
                    console.warn('[MythosEngine] Cerebras fallback after OpenRouter failed ? continuing.', cerebrasError);
                }
            }
            if (keys?.gemini.trim()) {
                try {
                    return await executeGemini(json);
                } catch (geminiError) {
                    console.warn('[MythosEngine] Gemini fallback after OpenRouter failed ? continuing.', geminiError);
                }
            }
        }
    }

    if (preferredProvider === 'gemini' && keys?.gemini.trim()) {
        try {
            return await executeGemini(json);
        } catch (error) {
            console.warn('[MythosEngine] Gemini preferred provider failed â€” falling back.', error);
        }
    }

    if (preferredProvider === 'cerebras' && keys?.cerebras.trim()) {
        try {
            return await executeCerebras(json);
        } catch (error) {
            console.warn('[MythosEngine] Cerebras preferred provider failed â€” falling back.', error);
        }
    }

    const execute = async (activeModel: string, withJsonMode: boolean) => {
        if (!client) throw new Error('GROQ_API_KEY not configured.');
        const completion = await withLlmTimeout(`Groq · ${label}`, client.chat.completions.create({
            model: activeModel,
            messages,
            temperature: defaultTemp,
            ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
        }));
        const u = completion.usage;
        if (u) emitUsage({
            provider: 'groq',
            model: activeModel,
            label,
            inputTokens: u.prompt_tokens,
            outputTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
        });
        return extractText(completion.choices[0]?.message?.content).trim();
    };

    // ─── Gemini fallback executor ─────────────────────────────────────────────
    const executeGemini = async (withJsonMode: boolean, modelOverride?: string): Promise<string> => {
        const geminiClient = getGeminiClient();
        if (!geminiClient) throw new Error('GEMINI_API_KEY not configured — cannot use Gemini fallback.');
        const geminiModel = modelOverride ?? GEMINI_DEFAULT_MODEL;
        try {
            const completion = await withLlmTimeout(`Gemini · ${label}`, geminiClient.chat.completions.create({
                model: geminiModel,
                messages,
                temperature: defaultTemp,
                ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
                ...(maxTokens ? { max_tokens: maxTokens } : {}),
            }));
            const u = completion.usage;
            if (u) emitUsage({ provider: 'gemini', model: geminiModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
            return extractText(completion.choices[0]?.message?.content).trim();
            } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // If JSON mode caused the error, retry without it (Gemini may not support it on all endpoints)
            if (withJsonMode && (isRetryableModelError(err) || /response_format|json/i.test(errMsg))) {
                console.warn(`[MythosEngine] Gemini ${geminiModel} JSON mode failed — retrying without.`, errMsg);
                try {
                    const noJsonCompletion = await withLlmTimeout(`Gemini no-json · ${label}`, geminiClient.chat.completions.create({
                        model: geminiModel,
                        messages,
                        temperature: defaultTemp,
                        ...(maxTokens ? { max_tokens: maxTokens } : {}),
                    }));
                    const u = noJsonCompletion.usage;
                    if (u) emitUsage({ provider: 'gemini', model: geminiModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
                    return extractText(noJsonCompletion.choices[0]?.message?.content).trim();
                } catch { /* fall through to model fallback */ }
            }
            if (geminiModel !== GEMINI_FALLBACK_MODEL) {
                console.warn(`[MythosEngine] Gemini ${geminiModel} failed — retrying with ${GEMINI_FALLBACK_MODEL}.`, errMsg);
                return executeGemini(withJsonMode, GEMINI_FALLBACK_MODEL);
            }
            console.error(`[MythosEngine] All Gemini models failed.`, errMsg);

        }
    };

    // ─── Cerebras fallback executor ───────────────────────────────────────────
    const executeCerebras = async (withJsonMode: boolean, modelOverride?: string): Promise<string> => {
        const cerebrasClient = getCerebrasClient();
        if (!cerebrasClient) throw new Error('CEREBRAS_API_KEY not configured — cannot use Cerebras fallback.');
        const cerebrasModels = Array.from(new Set([
            modelOverride,
            CEREBRAS_DEFAULT_MODEL,
            CEREBRAS_WEAVER_MODEL,
            CEREBRAS_LAST_RESORT,
        ].filter(Boolean) as string[]));
        let lastError: unknown = null;
        /*
        for (const cerebrasModel of cerebrasModels) {
            const isGptOss = CEREBRAS_GPT_OSS_MODELS.has(cerebrasModel);
            const cerebrasCall = async (useJsonMode: boolean) => {
            const completion = await withLlmTimeout(`Cerebras · ${label}`, cerebrasClient.chat.completions.create({
                model: cerebrasModel,
                messages,
                temperature: defaultTemp,
                ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
                // gpt-oss uses max_completion_tokens; llama models use max_tokens
                ...(maxTokens ? (isGptOss ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) : {}),
            }));
            const u = completion.usage;
            if (u) emitUsage({ provider: 'cerebras', model: cerebrasModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
            return extractText(completion.choices[0]?.message?.content).trim();
        };
        try {
            return await cerebrasCall(withJsonMode);
        } catch (err) {
                lastError = err;
                // If json_mode caused the failure, retry without it (Cerebras has limited json_mode support)
            if (withJsonMode) {
                try {
                    console.warn(`[MythosEngine] Cerebras ${cerebrasModel} json_mode failed — retrying without.`, err instanceof Error ? err.message : err);
                    return await cerebrasCall(false);
                    } catch (noJsonErr) {
                        lastError = noJsonErr;
                    }
            }
            console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed â€” trying next model.`, err instanceof Error ? err.message : err);
                console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed — retrying with ${CEREBRAS_LAST_RESORT}.`, err instanceof Error ? err.message : err);

            }
            throw err;
        }
    };
        */

        for (const cerebrasModel of cerebrasModels) {
            const isGptOss = CEREBRAS_GPT_OSS_MODELS.has(cerebrasModel);
            const cerebrasCall = async (useJsonMode: boolean) => {
                const completion = await withLlmTimeout(`Cerebras Â· ${label}`, cerebrasClient.chat.completions.create({
                    model: cerebrasModel,
                    messages,
                    temperature: defaultTemp,
                    ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
                    ...(maxTokens ? (isGptOss ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) : {}),
                }));
                const u = completion.usage;
                if (u) emitUsage({ provider: 'cerebras', model: cerebrasModel, label, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens });
                return extractText(completion.choices[0]?.message?.content).trim();
            };

            try {
                return await cerebrasCall(withJsonMode);
            } catch (err) {
                lastError = err;
                if (withJsonMode) {
                    try {
                        console.warn(`[MythosEngine] Cerebras ${cerebrasModel} json_mode failed â€” retrying without.`, err instanceof Error ? err.message : err);
                        return await cerebrasCall(false);
                    } catch (noJsonErr) {
                        lastError = noJsonErr;
                    }
                }

                console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed â€” trying next model.`, err instanceof Error ? err.message : err);
            }
        }

        throw lastError instanceof Error ? lastError : new Error(`[MythosEngine] All Cerebras models failed for ${label}.`);
    };

    // ── Full fallback chain: Gemini 2.5 → Gemini 2.0 → Cerebras qwen-3-235b → llama3.1-8b ──
    const tryFallbackProviders = async (reason: string): Promise<string> => {
        console.warn(`[MythosEngine] ${reason} ? chain: Cerebras -> Groq -> OpenRouter -> Gemini`);
        try {
            return await executeCerebras(json);
        } catch (cerebrasError) {
            console.warn('[MythosEngine] All Cerebras models failed ? trying OpenRouter, then Gemini.', cerebrasError);
        }
        if (keys?.openrouter.trim()) {
            try {
                return await executeOpenRouter(json);
            } catch (openRouterError) {
                console.warn('[MythosEngine] OpenRouter fallback failed ? trying Gemini.', openRouterError);
            }
        }
        return executeGemini(json);
    };

    if (!client) {
        return tryFallbackProviders('No primary provider configured');
    }

    try {
        return await execute(model, json);
    } catch (error) {
        // ── 429 Rate Limit: immediately go to fallback chain (no Groq retry delays) ──
        if (is429Error(error)) {
            console.warn('[MythosEngine] Groq rate limit hit — going to fallback chain immediately.');
            return tryFallbackProviders('Groq 429');
        }
        // ── Model/format errors ───────────────────────────────────────────────
        if (isRetryableModelError(error)) {
            return tryFallbackProviders('Groq model error');
        }
        // ── Any other error (connection, timeout, 500, etc.) ─────────────────
        console.error('[MythosEngine] Groq error:', error instanceof Error ? error.message : error);
        return tryFallbackProviders('Groq request failed');
    }
};

// ─── LLM Output Schemas (Zod) ────────────────────────────────────────────────
// Validates runtime JSON from LLM agents — catches wrong types, missing fields,
// and silent coercion bugs before they propagate through the pipeline.

const ZDirectorGuidance = z.object({
    openLoopCount:          z.number().int().min(0),
    loopPriority:           z.string().min(1),
    factionPressure:        z.string().min(1),
    characterFocus:         z.string().min(1),
    thematicConstraint:     z.string().min(1),
    narrativePressure:      z.string().min(1),
    wordsToSetOnCooldown:   z.array(z.string()).default([]),
    cooldownSubstitutions:  z.array(z.object({ term: z.string(), note: z.string() })).default([]),
    rhetoricalBans:         z.array(z.string()).default([]),
    imageryCooldown:        z.array(z.string()).default([]),
    openingConstraint:      z.string().default(''),
    closingConstraint:      z.string().default(''),
    densityTarget:          z.enum(['lean', 'balanced', 'lush']).default('balanced'),
    contradictionSummary:   z.string().default(''),
    liePressureSource:      z.string().default(''),
    protagonistLieStability:z.number().min(1).max(10).default(10),
    ruptureRequired:        z.boolean().default(false),
});

const ZLongformBlueprint = z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
    promise: z.string().min(1),
    conflictCore: z.string().min(1),
    protagonistFocus: z.string().min(1),
    targetChapters: z.number().int().min(15).max(20),
    minChapters: z.number().int().min(15).max(20),
    maxChapters: z.number().int().min(15).max(20),
    acts: z.array(z.object({
        actIndex: z.number().int().min(1).max(4),
        label: z.string().min(1),
        purpose: z.string().min(1),
        chapterStart: z.number().int().min(1),
        chapterEnd: z.number().int().min(1),
        milestone: z.string().min(1),
    })).length(4),
    milestones: z.array(z.object({
        chapter: z.number().int().min(1),
        label: z.string().min(1),
        objective: z.string().min(1),
    })).min(4),
    chapterMap: z.array(z.object({
        chapterNumber: z.number().int().min(1),
        actIndex: z.number().int().min(1).max(4),
        function: z.enum(['setup', 'inciting_break', 'lock_in', 'complication', 'reversal', 'midpoint', 'descent', 'collapse', 'pre_climax', 'climax', 'aftermath']),
        goal: z.string().min(1),
        milestone: z.string().optional(),
    })).min(15).max(20),
});

const ZLongformBlueprintCore = z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
    promise: z.string().min(1),
    conflictCore: z.string().min(1),
    protagonistFocus: z.string().min(1),
});

const ZLongformBlueprintActsPass = z.object({
    acts: z.array(z.object({
        actIndex: z.number().int().min(1).max(4),
        label: z.string().min(1),
        purpose: z.string().min(1),
        milestone: z.string().min(1),
    })).length(4),
    milestones: z.array(z.object({
        chapter: z.number().int().min(1),
        label: z.string().min(1),
        objective: z.string().min(1),
    })).length(4),
});

const ZLongformBlueprintChapterPass = z.object({
    chapters: z.array(z.object({
        chapterNumber: z.number().int().min(1),
        actIndex: z.number().int().min(1).max(4),
        function: z.enum(['setup', 'inciting_break', 'lock_in', 'complication', 'reversal', 'midpoint', 'descent', 'collapse', 'pre_climax', 'climax', 'aftermath']),
        goal: z.string().min(1),
        milestone: z.string().optional(),
    })),
});

const ZWeaverPlan = z.object({
    chapterTitle:   z.string().optional(),
    chapterSummary: z.string().optional(),
    endHook:        z.string().optional(),
    scenes: z.array(z.object({
        beat:       z.string(),
        characters: z.array(z.string()),
        tension:    z.string(),
    })).optional(),
});

const ZSurgicalLectorOutput = z.object({
    replacements: z.array(z.object({
        find:        z.string(),
        replaceWith: z.string(),
    })).default([]),
    wordOveruse:          z.array(z.string()).default([]),
    passiveProtagonist:   z.enum(['sim', 'não']).default('não'),
    sceneObjectiveCheck:  z.enum(['ok', 'complicado', 'falhou']).default('ok'),
    rhetoricalPatternOveruse: z.string().default(''),
    rhetoricalPatternCount: z.number().int().min(0).default(0),
    imageryOveruse: z.array(z.string()).default([]),
    openingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).default('low'),
    endingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).default('low'),
    mustRewrite: z.boolean().default(false),
});

const ZChroniclerOutput = z.object({
    summary:         z.string().min(1),
    characterUpdates: z.array(z.object({
        characterId:    z.string(),
        name:           z.string(),
        status:         z.enum(['Vivo', 'Morto', 'Desconhecido']),
        location:       z.string().optional(),
        emotionalState: z.string().optional(),
        lastAction:     z.string().optional(),
    })).default([]),
    newOpenLoops:     z.array(z.object({ description: z.string() })).default([]),
    resolvedLoopIds:  z.array(z.string()).default([]),
    recentEvents:     z.array(z.string()).default([]),
    newCodex: z.object({
        factions: z.array(z.object({ title: z.string(), content: z.string() })).default([]),
        rules:    z.array(z.object({ title: z.string(), content: z.string() })).default([]),
        timeline: z.array(z.object({ title: z.string(), content: z.string() })).default([]),
    }).default({ factions: [], rules: [], timeline: [] }),
    auditFlags: z.object({
        wordOveruse:          z.array(z.string()).optional(),
        sceneObjectiveCheck:  z.string().optional(),
        passiveProtagonist:   z.string().optional(),
        rhetoricalPatternOveruse: z.string().optional(),
        rhetoricalPatternCount: z.number().optional(),
        imageryOveruse: z.array(z.string()).optional(),
        openingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).optional(),
        endingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).optional(),
        mustRewrite: z.boolean().optional(),
    }).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────

const chatJson = async <T>({
    system,
    user,
    fallback,
    model,
    temperature,
    maxTokens,
    label,
    provider,
    schema,
}: {
    system?: string;
    user: string;
    fallback: T;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    label?: string;
    provider?: 'groq' | 'gemini' | 'cerebras' | 'openrouter' | 'auto';
    schema?: z.ZodType<T>;
}): Promise<T> => {
    let raw = '';
    try {
        raw = await chat({ system, user, json: true, model, temperature, maxTokens, label, provider });
        if (!raw) return fallback;
        let parsed: T;
        try {
            parsed = deepRepairTextArtifacts(safeJsonParse<T>(raw));
        } catch (parseError) {
            if (shouldAttemptBlueprintTranslationPass(label)) {
                const translated = await translateRawBlueprintJson({ raw, fallback, schema, label });
                if (translated) return deepRepairTextArtifacts(translated);
            }
            throw parseError;
        }
        if (schema) {
            const result = schema.safeParse(parsed);
            if (!result.success) {
                console.warn(`[Zod] ${label ?? 'chatJson'} schema mismatch:`, result.error.format());
                // Attempt coercion with safe defaults rather than discarding entirely
                const coerced = schema.safeParse(deepRepairTextArtifacts({ ...fallback as object, ...parsed as object }));
                return coerced.success ? deepRepairTextArtifacts(coerced.data) : deepRepairTextArtifacts(fallback);
            }
            return deepRepairTextArtifacts(result.data);
        }
        return deepRepairTextArtifacts(parsed);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn('LLM JSON call failed', error);
        if (label) {
            const usedMeaningfulFallback = hasMeaningfulFallback(fallback);
            const isParseIssue = /JSON parse failed/i.test(errMsg);
            const debugDetail = isParseIssue && raw
                ? `${errMsg}\n\n${summarizeRawModelOutput(raw)}`
                : errMsg;
            const fallbackSummary = usedMeaningfulFallback
                ? (isParseIssue ? 'Modelo respondeu, mas o JSON veio inválido — usando fallback local' : 'Modelo falhou — usando fallback local')
                : 'Todos os provedores falharam â€” usando fallback vazio';
            emitAgentOutput({
                agent: 'system',
                label: `âš  ${label}`,
                status: 'done',
                summary: fallbackSummary,
                detail: debugDetail,
            });
            return deepRepairTextArtifacts(fallback);
            emitAgentOutput({
                agent: 'system',
                label: `⚠ ${label}`,
                status: 'done',
                summary: 'Todos os provedores falharam — usando fallback vazio',
                detail: errMsg,
            });
        }
        return deepRepairTextArtifacts(fallback);
    }
};

// ─── Image placeholder ──────────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const buildImagePlaceholder = (prompt: string, label: string): string => {
    const wrappedPrompt = escapeHtml(prompt).slice(0, 180);
    const wrappedLabel = escapeHtml(label);
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#f9f8f4" />
                    <stop offset="100%" stop-color="#e7dcc0" />
                </linearGradient>
            </defs>
            <rect width="800" height="600" fill="url(#bg)" />
            <rect x="36" y="36" width="728" height="528" rx="24" fill="none" stroke="#c5a059" stroke-width="3" />
            <text x="70" y="110" font-family="Georgia, serif" font-size="34" fill="#1a1a1a">${wrappedLabel}</text>
            <text x="70" y="170" font-family="Arial, sans-serif" font-size="20" fill="#57534e">Image generation is temporarily in placeholder mode.</text>
            <foreignObject x="70" y="220" width="660" height="260">
                <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 22px; color: #1a1a1a; line-height: 1.45;">
                    ${wrappedPrompt}
                </div>
            </foreignObject>
        </svg>
    `;
    const encodedSvg = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// ─── Agent prompt & context builders ────────────────────────────────────────

const getAgentPrompt = (universe: Universe | null, agentId: string, compact = false): string => {
    const basePrompt = compact && COMPACT_AGENT_PROMPTS[agentId]
        ? COMPACT_AGENT_PROMPTS[agentId] as string
        : universe && universe.agentConfigs && universe.agentConfigs[agentId]
        ? universe.agentConfigs[agentId].systemPrompt
        : DEFAULT_AGENTS[agentId]?.systemPrompt || 'You are a helpful AI assistant.';

    if (agentId === 'bard') {
        return `${basePrompt}${BARD_STYLE_OVERRIDE}`;
    }

    return basePrompt;
};

const isVisibleToAI = (visibility?: AIVisibility): boolean => (visibility ?? DEFAULT_AI_VISIBILITY) !== 'hidden';
const isGlobalToAI = (visibility?: AIVisibility): boolean => (visibility ?? DEFAULT_AI_VISIBILITY) === 'global';

const formatAliasesInline = (aliases?: string[]): string =>
    normalizeAliasList(aliases).length > 0 ? ` (aliases: ${normalizeAliasList(aliases).join(', ')})` : '';

const sortByVisibility = <T extends { aiVisibility?: AIVisibility }>(items: T[]): T[] => {
    const visible = items.filter(item => isVisibleToAI(item.aiVisibility));
    return [
        ...visible.filter(item => isGlobalToAI(item.aiVisibility)),
        ...visible.filter(item => !isGlobalToAI(item.aiVisibility)),
    ];
};

const collectEffectiveCodexEntries = (
    entries: CodexEntry[],
    compact: boolean,
    maxItems: number,
): CodexEntry[] => {
    const sorted = sortByVisibility(entries);
    if (!compact) return sorted;
    const globals = sorted.filter(entry => isGlobalToAI(entry.aiVisibility));
    const tracked = sorted.filter(entry => !isGlobalToAI(entry.aiVisibility));
    return [...globals, ...limitItems(tracked, Math.max(0, maxItems - globals.length))].slice(0, maxItems);
};

const collectEffectiveTimelineEntries = (
    entries: CodexEntry[],
    compact: boolean,
    maxItems: number,
    relatedEntityIds: string[] = [],
): CodexEntry[] => {
    const sorted = sortByVisibility(entries);
    const activePressure = sorted.filter(entry => entry.eventState === 'active_pressure');
    const related = sorted.filter(entry =>
        (entry.relatedEntityIds ?? []).some(id => relatedEntityIds.includes(id)) && !activePressure.some(active => active.id === entry.id)
    );
    const globals = sorted.filter(entry =>
        isGlobalToAI(entry.aiVisibility) &&
        !activePressure.some(active => active.id === entry.id) &&
        !related.some(item => item.id === entry.id)
    );
    const remaining = sorted.filter(entry =>
        !activePressure.some(active => active.id === entry.id) &&
        !related.some(item => item.id === entry.id) &&
        !globals.some(item => item.id === entry.id)
    );
    const prioritized = [...activePressure, ...related, ...globals, ...remaining];
    return compact ? prioritized.slice(0, maxItems) : prioritized;
};

const buildUniverseContext = (
    universe: Universe,
    options?: { compact?: boolean; maxFactions?: number; maxRules?: number; maxTimeline?: number; relatedEntityIds?: string[] }
): string => {
    const compact = options?.compact ?? false;
    const factions = collectEffectiveCodexEntries(universe.codex.factions, compact, options?.maxFactions ?? 2);
    const rules = collectEffectiveCodexEntries(universe.codex.rules, compact, options?.maxRules ?? 4);
    const timeline = collectEffectiveTimelineEntries(universe.codex.timeline, compact, options?.maxTimeline ?? 2, options?.relatedEntityIds ?? []);
    return `
    === WORLD CODEX: ${universe.name} ===
    DESCRIPTION: ${truncateText(universe.description, compact ? 140 : 400)}
    OVERVIEW: ${truncateText(universe.codex.overview, compact ? 220 : 700)}

    --- KEY FACTIONS ---
    ${factions.map(f => `- ${f.title}${formatAliasesInline(f.aliases)}: ${truncateText(f.content, compact ? 120 : 240)}`).join('\n') || '- None recorded.'}

    --- WORLD SYSTEMS / MAGIC / LORE ---
    ${rules.map(r => `- ${r.title}${formatAliasesInline(r.aliases)} [${r.ruleKind ?? inferRuleEntryKind(r.title, r.content)}]: ${truncateText(r.content, compact ? 120 : 240)}`).join('\n') || '- None recorded.'}

    --- TIMELINE ---
    ${timeline.map(t => `- ${t.title}${formatAliasesInline(t.aliases)} [${t.eventState ?? 'historical'}${t.discoveryKind ? ` / ${t.discoveryKind}` : ''}${t.timelineImpact ? ` / impact:${t.timelineImpact}` : ''}${t.timelineScope ? ` / scope:${t.timelineScope}` : ''}]: ${truncateText(t.content, compact ? 120 : 240)}`).join('\n') || '- None recorded.'}
    `;
};

const buildLongformBlueprintContext = (
    universe: Universe,
    protagonist: Character | undefined,
    compact = false,
): string => {
    const factions = collectEffectiveCodexEntries(universe.codex.factions, true, compact ? 2 : 3);
    const rules = collectEffectiveCodexEntries(universe.codex.rules, true, compact ? 3 : 4);
    const timeline = collectEffectiveTimelineEntries(universe.codex.timeline, true, compact ? 2 : 3, protagonist ? [protagonist.id] : []);

    return [
        `UNIVERSE: ${universe.name}`,
        `PREMISE: ${truncateText(universe.description || universe.codex.overview, compact ? 180 : 260)}`,
        `WORLD: ${truncateText(universe.codex.overview || universe.description, compact ? 220 : 320)}`,
        `PROTAGONIST: ${protagonist?.name || 'Unknown'} - ${truncateText(protagonist?.bio || '', compact ? 140 : 220) || 'No bio'}`,
        `GHOST: ${truncateText(protagonist?.ghost || 'none', compact ? 100 : 160)}`,
        `LIE: ${truncateText(protagonist?.coreLie || 'none', compact ? 100 : 160)}`,
        'FACTIONS:',
        ...(factions.length > 0
            ? factions.map(entry => `- ${entry.title}: ${truncateText(entry.content, compact ? 70 : 100)}`)
            : ['- none']),
        'RULES:',
        ...(rules.length > 0
            ? rules.map(entry => `- ${entry.title}: ${truncateText(entry.content, compact ? 70 : 100)}`)
            : ['- none']),
        'TIMELINE:',
        ...(timeline.length > 0
            ? timeline.map(entry => `- ${entry.title}: ${truncateText(entry.content, compact ? 70 : 100)}`)
            : ['- none']),
    ].join('\n');
};

// Compact list for Weaver: name + role + current state/location (no bio)
const buildCompactCharacterList = (universe: Universe): string => {
    const stateMap = new Map(
        (universe.narrativeMemory?.characterStates ?? []).map(cs => [cs.name, cs])
    );
    return sortByVisibility(universe.characters).map(c => {
        const st = stateMap.get(c.name);
        const state = st ? ` | ${st.status}${st.location ? ` @ ${st.location}` : ''}` : '';
        return `${c.name}${formatAliasesInline(c.aliases)} (${c.role})${state}`;
    }).join('\n');
};

const deriveContextEntityIds = (universe: Universe, activeCharacterIds: string[]): string[] => {
    const ids = new Set<string>(activeCharacterIds);
    for (const character of universe.characters.filter(item => activeCharacterIds.includes(item.id))) {
        if (character.faction) {
            const matchingFaction = universe.codex.factions.find(entry => normalizeTitle(entry.title) === normalizeTitle(character.faction));
            if (matchingFaction) ids.add(matchingFaction.id);
        }
    }
    return Array.from(ids);
};

const buildCharacterContext = (universe: Universe, activeIds: string[], compact = false): string => {
    const activeChars = universe.characters.filter(c => activeIds.includes(c.id) && isVisibleToAI(c.aiVisibility));
    if (activeChars.length === 0) return 'NO SPECIFIC CHARACTERS SELECTED. FOCUS ON WORLD ATMOSPHERE.';

    // Delta mode for chapter 2+: use live state from narrative memory to save tokens
    const stateMap = new Map(
        (universe.narrativeMemory?.characterStates ?? []).map(cs => [cs.name, cs])
    );
    const hasMem = universe.narrativeMemory && universe.narrativeMemory.characterStates.length > 0;

    if (hasMem) {
        return `
    === ACTIVE CHARACTERS — CURRENT STATE (delta, chapter continuation) ===
    ${activeChars.map(c => {
            const st = stateMap.get(c.name);
            if (st) {
                return `- ${c.name}${formatAliasesInline(c.aliases)} (${c.role}${c.faction ? ` / ${c.faction}` : ''}) [${st.status}]${st.location ? ` @ ${truncateText(st.location, compact ? 50 : 120)}` : ''}${st.emotionalState ? ` | mood: ${truncateText(st.emotionalState, compact ? 40 : 90)}` : ''}${st.lastAction ? ` | last: ${truncateText(st.lastAction, compact ? 70 : 160)}` : ''}`;
            }
            // Fallback: character not yet in memory → include bio (new character intro)
            return `- ${c.name}${formatAliasesInline(c.aliases)} (${c.role}${c.faction ? ` / ${c.faction}` : ''}) — ${truncateText(c.bio, compact ? 110 : 260)}`;
        }).join('\n')}
    `;
    }

    // Chapter 1 or no memory: send full bio so Bard can introduce characters properly
    return `
    === ACTIVE CHARACTERS IN SCENE ===
    ${activeChars.map(c => `
    NAME: ${c.name}
    ALIASES: ${normalizeAliasList(c.aliases).join(', ') || 'None'}
    ROLE: ${c.role}
    FACTION: ${c.faction}
    BIO: ${truncateText(c.bio, compact ? 120 : 320)}
    `).join('\n')}
    `;
};

// ─── buildStoryContext — FIXED: uses absolute index, not indexOf on pool ────

const buildStoryContext = (universe: Universe, chapterIndex?: number): string => {
    const pool = chapterIndex !== undefined
        ? universe.chapters.slice(0, chapterIndex)
        : universe.chapters.slice(-3);
    if (pool.length === 0) return 'CONTEXT: This is the first chapter of the story.';

    const startIdx = chapterIndex !== undefined
        ? 0
        : Math.max(0, universe.chapters.length - 3);

    return `
    === PREVIOUS STORY SO FAR (Read carefully to ensure continuity) ===
    ${pool.map((c, i) => `CHAPTER ${startIdx + i + 1} [${c.title}]: ${c.summary}`).join('\n')}
    `;
};

// ─── Layered Memory — buildMemoryContext ────────────────────────────────────

const buildMemoryContext = (universe: Universe, chapterIndex?: number, compact = false): string => {
    const mem = universe.narrativeMemory;

    // Backward compat: no narrative memory yet → fall back
    if (!mem) return buildStoryContext(universe, chapterIndex);

    const characterStates = compact ? limitItems(mem.characterStates, 4) : mem.characterStates;
    const charStates = characterStates.length > 0
        ? characterStates.map(cs =>
            `- ${cs.name} [${cs.status}]${cs.location ? ` @ ${truncateText(cs.location, compact ? 45 : 120)}` : ''}${cs.emotionalState ? ` — mood: ${truncateText(cs.emotionalState, compact ? 35 : 90)}` : ''}${cs.lastAction ? ` — last: ${truncateText(cs.lastAction, compact ? 60 : 160)}` : ''}`
        ).join('\n')
        : 'No character state recorded yet.';

    const openLoops = limitItems(mem.openLoops.filter(l => l.resolved === undefined), compact ? 3 : 8);
    const loopsText = openLoops.length > 0
        ? openLoops.map(l => `- [Ch.${l.introduced + 1}] ${truncateText(l.description, compact ? 110 : 220)}`).join('\n')
        : 'No open plot threads.';

    const recentEvents = compact ? limitItems(mem.recentEvents, 3) : mem.recentEvents;
    const recentText = recentEvents.length > 0
        ? recentEvents.map(e => `- ${truncateText(e, compact ? 100 : 220)}`).join('\n')
        : 'No recent events.';
    const lieStates = compact ? limitItems(mem.lieStates ?? [], 2) : (mem.lieStates ?? []);
    const lieText = lieStates.length > 0
        ? lieStates.map(state => `- ${state.name}: stability ${state.lieStability}/10 | pressure: ${state.pressureSources.join(', ') || 'none'} | contradictions: ${truncateText(state.contradictions.slice(-2).join(' / '), compact ? 120 : 240) || 'none'}${state.ruptureRequired ? ' | rupture required soon' : ''}`).join('\n')
        : 'No lie-state tracking recorded yet.';

    // Quality flags from the previous Chronicler audit
    const auditSection = mem.lastAuditFlags
        ? (() => {
            const lines: string[] = [];
            const currentChIdx = chapterIndex ?? universe.chapters.length;
            const cooldownWords = Object.entries(mem.lexicalCooldown ?? {})
                .filter(([, expiry]) => expiry > currentChIdx)
                .map(([word]) => word);
            const chapterBanned = mem.lastAuditFlags.wordOveruse ?? [];
            const allBanned = Array.from(new Set([...cooldownWords, ...chapterBanned]));
            if (allBanned.length) {
                lines.push(`OVERUSED WORDS (ban these in every beat): ${allBanned.join(', ')}`);
            }
            if (mem.lastAuditFlags.passiveProtagonist === 'sim') {
                lines.push('PASSIVE PROTAGONIST — The protagonist DID NOTHING last chapter. Every beat MUST force physical action: move, fight, decide, escape, steal, confront.');
            }
            if (mem.lastAuditFlags.sceneObjectiveCheck && mem.lastAuditFlags.sceneObjectiveCheck !== 'ok') {
                lines.push('SCENE STAGNATION detected — Do NOT plan any beat where characters only talk or wait. Each scene: new location OR new item OR new threat OR new alliance.');
            }
            if (mem.lastAuditFlags.rhetoricalPatternOveruse) {
                lines.push('RHETORICAL PATTERN OVERUSE detected — ban contrastive-negation crutches like "não X, mas Y", "não era..., mas..." and "em vez disso". Build contrast through action, image, or consequence instead of self-correcting sentence shapes, and default to affirmative syntax.');
            }
            return lines.length > 0
                ? `\nQUALITY MANDATE (fix from previous chapter):\n${lines.join('\n')}`
                : '';
        })()
        : '';

    // Find the previous chapter's end state to give Weaver an exact pick-up point
    const prevChapterIdx = chapterIndex !== undefined ? chapterIndex - 1 : universe.chapters.length - 1;
    const prevChapter = prevChapterIdx >= 0 ? universe.chapters[prevChapterIdx] : null;
    const pickUpPoint = prevChapter
        ? `CHAPTER PICK-UP POINT — The new chapter MUST begin AFTER this moment:
  Previous chapter title: "${prevChapter.title}"
  How Ch.${prevChapterIdx + 1} ended: ${prevChapter.endHook || prevChapter.summary}
  → Do NOT rewind, repeat, or contradict any event that already occurred.`
        : 'This is the first chapter — no pick-up point needed.';

    return `
=== NARRATIVE MEMORY (Layered — trust this over raw chapter text) ===

${pickUpPoint}

GLOBAL SUMMARY:
${truncateText(mem.globalSummary, compact ? 220 : 900)}

RECENT KEY EVENTS:
${recentText}

CHARACTER STATES (exact position at end of last chapter):
${charStates}

OPEN PLOT THREADS (must be addressed or complicated):
${loopsText}

LIE STATE TRACKING:
${lieText}
${auditSection}
===================================================================
`;
};

// ─── Slim Bard Memory Hints — pick-up point + audit flags only ──────────────
const buildBardMemoryHints = (universe: Universe, chapterIndex?: number, compact = false): string => {
    const mem = universe.narrativeMemory;
    if (!mem) return ''; // Chapter 1 — Bard starts fresh, no prior context needed

    const hints: string[] = [];

    // Where the story ended — the Bard MUST begin here, not before
    const prevChapterIdx = chapterIndex !== undefined ? chapterIndex - 1 : universe.chapters.length - 1;
    const prevChapter = prevChapterIdx >= 0 ? universe.chapters[prevChapterIdx] : null;
    if (prevChapter) {
        hints.push(`STORY RESUMES — begin after: "${prevChapter.title}" ended with ${truncateText(prevChapter.endHook || prevChapter.summary, compact ? 120 : 260)}.`);
    }

    // Banned words: active lexical cooldown + last chapter overuse
    const currentChIdx = chapterIndex ?? universe.chapters.length;
    const cooldownActive = Object.entries(mem.lexicalCooldown ?? {})
        .filter(([, expiry]) => expiry > currentChIdx)
        .map(([word]) => word);
    const chapterBanned = mem.lastAuditFlags?.wordOveruse ?? [];
    const allBanned = Array.from(new Set([...cooldownActive, ...chapterBanned]));
    if (allBanned.length) {
        hints.push(`BANNED WORDS (do NOT use these — they were overused in previous chapters): ${limitItems(allBanned, compact ? 10 : 20).join(', ')}`);
    }

    const substitutionRules = allBanned.map(word => {
        const rule = mem.lexicalCooldownGuidance?.[word.toLowerCase()];
        return `- ${word}: ${rule || 'Do not name it directly; use sensory description, metaphor, action, or consequence instead.'}`;
    });
    if (substitutionRules.length) {
        hints.push(`LEXICAL SUBSTITUTION RULES:\n${substitutionRules.join('\n')}`);
    }

    const activePatternBans = Object.entries(mem.stylePatternCooldown ?? {})
        .filter(([, expiry]) => expiry > currentChIdx)
        .map(([pattern]) => pattern);
    if (activePatternBans.length) {
        hints.push(`STYLE PATTERN COOLDOWN:\n${activePatternBans.map(pattern => `- ${STYLE_PATTERN_LABELS[pattern] || pattern}`).join('\n')}`);
    }

    // Passive protagonist escalation
    if (mem.lastAuditFlags?.passiveProtagonist === 'sim') {
        hints.push('⚠️ PASSIVE PROTAGONIST flagged — protagonist was passive last chapter. Every beat in this chapter: protagonist must initiate an action (move, grab, decide, fight, escape, confront). Zero passive observation allowed.');
    }
    if (mem.lastAuditFlags?.rhetoricalPatternOveruse) {
        hints.push(`RHETORICAL CRUTCH BAN: ${mem.lastAuditFlags.rhetoricalPatternOveruse} Build contrast through image, sequence, consequence, and syntax variety — not through formulas like "não X, mas Y", "não era..., mas..." or "em vez disso". Use affirmative syntax by default.`);
    }

    if (mem.lastAuditFlags?.rhetoricalPatternCount && mem.lastAuditFlags.rhetoricalPatternCount >= 3) {
        hints.push('FORM RESTRICTION: maximum one contrastive-negation construction in the whole chapter, preferably zero. Rewrite sentences into direct image, direct action, or direct consequence instead of sentence-internal correction.');
    }
    if (mem.lastAuditFlags?.imageryOveruse?.length) {
        hints.push(`IMAGERY COOLDOWN: avoid centering the chapter around these image families again: ${mem.lastAuditFlags.imageryOveruse.join(', ')}.`);
    }
    if (mem.lastAuditFlags?.openingSimilarityToRecentChapters === 'high') {
        hints.push('OPENING REPEAT WARNING: recent chapter openings sound too similar. Open this chapter with a different mechanism: action, dialogue, interruption, objective task, or blunt consequence.');
    }
    if (mem.lastAuditFlags?.endingSimilarityToRecentChapters === 'high') {
        hints.push('ENDING REPEAT WARNING: recent chapter endings are too similar. Do NOT close on a rhetorical identity question again.');
    }

    const dir = mem.directorGuidance;
    if (dir?.openingConstraint) hints.push(`DIRECTOR OPENING CONSTRAINT: ${dir.openingConstraint}`);
    if (dir?.closingConstraint) hints.push(`DIRECTOR CLOSING CONSTRAINT: ${dir.closingConstraint}`);
    if (dir?.rhetoricalBans?.length) hints.push(`DIRECTOR RHETORICAL BANS: ${dir.rhetoricalBans.join(', ')}`);
    if (dir?.imageryCooldown?.length) hints.push(`DIRECTOR IMAGERY COOLDOWN: ${dir.imageryCooldown.join(', ')}`);
    if (dir?.densityTarget) hints.push(`DIRECTOR DENSITY TARGET: ${dir.densityTarget}`);

    const protagonist = universe.characters[0];
    const lieState = protagonist
        ? mem.lieStates?.find(state => state.characterId === protagonist.id)
        : undefined;
    if (lieState) {
        hints.push(`CORE LIE TRACKING: ${lieState.name} believes "${lieState.coreLie}". Stability ${lieState.lieStability}/10. Pressure: ${lieState.pressureSources.join(', ') || 'none'}.`);
        if (lieState.contradictions.length) {
            hints.push(`LATEST CONTRADICTIONS:\n${lieState.contradictions.slice(-3).map(item => `- ${item}`).join('\n')}`);
        }
        if (lieState.ruptureRequired) {
            hints.push('RUPTURE REQUIRED: the next chapter must force ideological fracture, confession, or a choice that the lie cannot survive.');
        }
    }

    if (hints.length === 0) return '';
    return `\n=== NARRATIVE CONTINUITY HINTS ===\n${hints.join('\n\n')}\n===================================\n`;
};

// ─── Opening Style Randomizer ───────────────────────────────────────────────

const OPENING_STYLES: { style: OpeningStyle; instruction: string }[] = [
    { style: 'action', instruction: 'Open with an action scene already in motion — physical movement, urgency, sensory overload.' },
    { style: 'dialogue', instruction: 'Open with a conversation mid-flow — no tags until the third line, let voice carry character.' },
    { style: 'description', instruction: 'Open with a vivid sensory description of the setting — sight, sound, smell. Ground the reader.' },
    { style: 'introspection', instruction: 'Open inside the POV character\'s mind — a thought, a memory, a feeling that hooks.' },
    { style: 'in_medias_res', instruction: 'Open at the climactic moment of the scene, then rewind to show how we got here.' },
    { style: 'flashback', instruction: 'Open with a brief flashback or memory that contrasts with the chapter\'s present.' },
    { style: 'epistolary', instruction: 'Open with a letter, diary entry, news broadcast, or in-world document fragment.' },
];

const pickOpeningStyle = (universe?: Universe): { style: OpeningStyle; instruction: string } => {
    const recent = universe?.chapters.slice(-2).map(ch => ch.openingStyle).filter(Boolean) as OpeningStyle[] | undefined;
    const blocked = new Set(recent ?? []);
    const preferred = OPENING_STYLES.filter(item => !blocked.has(item.style) && item.style !== 'description');
    const pool = preferred.length > 0 ? preferred : OPENING_STYLES.filter(item => !blocked.has(item.style));
    const finalPool = pool.length > 0 ? pool : OPENING_STYLES;
    return finalPool[Math.floor(Math.random() * finalPool.length)];
};

// ─── Prose cleanup helpers ──────────────────────────────────────────────────

const stripLLMPrefixes = (text: string): string => {
    return text
        .replace(/^(?:Certainly!|Sure!|Here (?:is|are) the chapter[:\s]*|Of course[!,.\s]*)/i, '')
        .replace(/^##?\s*Chapter\s+\d+[:\s]*/i, '')
        // Strip scene/part labels that the LLM may insert despite instructions
        .replace(/\*{0,2}(?:Cena|Scene|Part|Parte|Capítulo|Chapter)\s+\d+[:\s—–-]*\*{0,2}\n?/gi, '')
        .trim();
};

/**
 * Detect and truncate LLM degeneration loops (repeated paragraphs/sentences).
 * Splits into paragraphs, keeps only the first occurrence of each.
 * If any paragraph appears 3+ times, truncates at the second occurrence.
 */
const truncateRepetitionLoops = (text: string): string => {
    const paragraphs = text.split(/\n\s*\n/);
    if (paragraphs.length < 4) return text;

    const seen = new Map<string, number>();
    const kept: string[] = [];
    const MAX_REPEATS = 2;

    for (const para of paragraphs) {
        const normalized = para.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
        if (!normalized) continue;
        const count = (seen.get(normalized) ?? 0) + 1;
        seen.set(normalized, count);
        if (count <= MAX_REPEATS) {
            kept.push(para);
        } else {
            // Degeneration detected — stop here
            break;
        }
    }

    return kept.join('\n\n').trim();
};

const countContrastiveNegationPatterns = (text: string): { count: number; message?: string } => {
    if (!text.trim()) return { count: 0 };
    const patterns = [
        /\bn[aã]o\b[^.!?\n]{0,120}\bmas\b/giu,
        /\bnot\b[^.!?\n]{0,120}\bbut\b/giu,
        /\bem vez disso\b/giu,
        /\binstead\b[^.!?\n]{0,80}/giu,
        /\bn[aã]o era\b[^.!?\n]{0,120}\bmas\b/giu,
        /\bwasn't\b[^.!?\n]{0,120}\bbut\b/giu,
    ];
    const count = patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
    if (count < 3) return { count };
    return {
        count,
        message: `Excessive contrastive-negation rhetoric detected (${count} hits). Avoid relying on structures like "não X, mas Y", "não era..., mas...", or "em vez disso" as a default literary crutch.`,
    };
};

// ─── Creativity Seeds: Faction Archetypes + Protagonist Backgrounds ──────────

const FACTION_ARCHETYPES: { type: string; hint: string }[] = [
    { type: 'teocracia_mercantil', hint: 'A faction where faith and commerce are the same institution — commercial licenses are religious sacraments and spiritual rank determines economic access.' },
    { type: 'academia_corrompida', hint: 'A faction that uses knowledge as political leverage — what is taught, withheld, or classified defines who holds power, not what is true.' },
    { type: 'guilda_de_memoria', hint: 'A faction that controls, trades, or erases memories — their power is knowing what others have forgotten or desperately want forgotten.' },
    { type: 'colonia_dissidente', hint: 'A breakaway community whose way of life is structurally incompatible with the dominant system — their existence is an ongoing political fact.' },
    { type: 'classe_endividada', hint: 'A class trapped in structural debt — the faction is either their collective resistance or the institution that profits from their permanent captivity.' },
    { type: 'cartografo_imperial', hint: 'A faction that controls maps, borders, and the legal right to move — geographic knowledge is their weapon and their primary currency.' },
    { type: 'casta_de_descartaveis', hint: 'A group instrumentalized by the elite that has slowly organized itself around its own exploitation — they understand their role and have built real power from within it.' },
    { type: 'herdeiros_em_queda', hint: 'A decaying elite clinging to symbolic power as its material resources collapse — enormous prestige, diminishing leverage, and the willingness to do anything to reverse that.' },
    { type: 'rede_de_contrabando', hint: 'An underground network built around something the state has banned — people, knowledge, memories, or substances that threaten the dominant order by their very existence.' },
    { type: 'ordem_de_exilados', hint: 'Expelled from the system, they built a parallel society with incompatible rules — the state cannot absorb them and cannot afford to ignore them.' },
    { type: 'burocracia_tecnica', hint: 'Specialists who hold structural power because they are the only ones who understand the systems everyone else depends on to survive.' },
    { type: 'culto_de_consequencias', hint: 'Organized around the side effects of the world\'s magic or technology that everyone else dismisses — they have built theology, politics, and survival from the fallout nobody else acknowledges.' },
];

const pickFactionArchetypes = (count: number): string[] => {
    const indices = Array.from({ length: FACTION_ARCHETYPES.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count).map(i => FACTION_ARCHETYPES[i].hint);
};

const PROTAGONIST_BACKGROUNDS: string[] = [
    'A state bureaucrat removed from their post due to an administrative inconsistency they did not cause — now a liability to the institution they served.',
    'A healer or medic structurally indebted to the system they are supposed to resist — their professional independence is constrained by what they owe and to whom.',
    'A technical specialist (cartographer, engineer, archivist) exiled specifically for documenting something the state wanted to keep buried.',
    'A member of a declining elite who still carries the name and the manners but has lost the resources — prestige without leverage, obligation without power.',
    'A courier or messenger who discovered mid-route that they are being used as an unwitting carrier for something dangerous or politically explosive.',
    'A creator (writer, composer, artisan) whose work was officially banned — now living in the shadow of what they made and cannot take back.',
    'A memory-keeper or institutional archivist who has processed too many suppressed histories and now carries dangerous knowledge no one authorized them to have.',
    'Someone who believed they were making a morally neutral professional choice — and is only now discovering the full scope of what that choice enabled.',
    'A specialist in a prohibited field (banned history, suppressed science, outlawed craft) operating under bureaucratic surveillance they cannot shake.',
    'An instructor or teacher whose actual curriculum diverges from the official version — under watch, with students who may or may not be informants.',
];

const pickBackground = (): string => {
    return PROTAGONIST_BACKGROUNDS[Math.floor(Math.random() * PROTAGONIST_BACKGROUNDS.length)];
};

const deriveRecentEventsFromChapters = (chapters: Chapter[]): string[] =>
    chapters
        .filter(ch => (ch.aiVisibility ?? DEFAULT_AI_VISIBILITY) !== 'hidden')
        .slice(-5)
        .map(ch => ch.summary || ch.endHook || ch.title)
        .filter(Boolean);

export const markUniverseDirty = (universe: Universe, scopes: DirtyScope[]): Universe => {
    const prepared = ensureUniverseDefaults(universe);
    const nextScopes = Array.from(new Set([...(prepared.syncMeta?.dirtyScopes ?? []), ...scopes]));
    return {
        ...prepared,
        syncMeta: {
            ...ensureSyncMeta(prepared.syncMeta),
            canonVersion: (prepared.syncMeta?.canonVersion ?? 1) + 1,
            dirtyScopes: nextScopes,
        },
    };
};

export const syncUniverseCanon = (
    universe: Universe,
    mode: 'light' | 'deep' = 'light',
): Universe => {
    const prepared = ensureUniverseDefaults(universe);
    const dirtyScopes = prepared.syncMeta?.dirtyScopes ?? [];
    const narrativeMemory = prepared.narrativeMemory
        ? {
            ...prepared.narrativeMemory,
            characterStates: prepared.narrativeMemory.characterStates.map(state => {
                const matchingCharacter = prepared.characters.find(character => character.id === state.characterId);
                return matchingCharacter
                    ? { ...state, name: matchingCharacter.name, status: matchingCharacter.status }
                    : state;
            }),
          }
        : undefined;

    const chapterVisibility = prepared.chapters.filter(chapter => (chapter.aiVisibility ?? DEFAULT_AI_VISIBILITY) !== 'hidden');
    const latestChapter = chapterVisibility[chapterVisibility.length - 1];

    const syncedMemory: NarrativeMemory | undefined = narrativeMemory || dirtyScopes.length > 0
        ? {
            lastChapterIndex: latestChapter ? prepared.chapters.findIndex(ch => ch.id === latestChapter.id) : prepared.narrativeMemory?.lastChapterIndex ?? 0,
            globalSummary: dirtyScopes.some(scope => scope === 'chapters' || scope === 'project')
                ? latestChapter?.summary || prepared.narrativeMemory?.globalSummary || ''
                : prepared.narrativeMemory?.globalSummary || latestChapter?.summary || '',
            characterStates: narrativeMemory?.characterStates ?? prepared.characters.map(character => ({
                characterId: character.id,
                name: character.name,
                status: character.status,
            })),
            openLoops: prepared.narrativeMemory?.openLoops ?? [],
            recentEvents: dirtyScopes.some(scope => scope === 'chapters')
                ? deriveRecentEventsFromChapters(prepared.chapters)
                : prepared.narrativeMemory?.recentEvents ?? deriveRecentEventsFromChapters(prepared.chapters),
            newCodexEntries: prepared.narrativeMemory?.newCodexEntries ?? { factions: [], rules: [], timeline: [] },
            lastAuditFlags: prepared.narrativeMemory?.lastAuditFlags,
            lexicalCooldown: prepared.narrativeMemory?.lexicalCooldown,
            lexicalCooldownGuidance: prepared.narrativeMemory?.lexicalCooldownGuidance ?? {},
            lieStates: prepared.narrativeMemory?.lieStates ?? [],
            directorGuidance: dirtyScopes.length > 0 ? undefined : prepared.narrativeMemory?.directorGuidance,
        }
        : undefined;

    return {
        ...prepared,
        narrativeMemory: syncedMemory,
        syncMeta: {
            ...ensureSyncMeta(prepared.syncMeta),
            memoryVersion: (prepared.syncMeta?.memoryVersion ?? 1) + (dirtyScopes.length > 0 ? 1 : 0),
            dirtyScopes: [],
            lastSyncAt: new Date().toISOString(),
            lastSyncMode: mode,
        },
    };
};

export interface MentionHit {
    sourceType: 'chapter' | 'summary' | 'codex' | 'memory';
    sourceId: string;
    label: string;
    excerpt: string;
}

export const collectCharacterMentions = (universe: Universe, character: Character): MentionHit[] => {
    const prepared = ensureUniverseDefaults(universe);
    const terms = buildTrackedTerms(character.name, character.aliases, character.tracking);
    const hits: MentionHit[] = [];

    for (const chapter of prepared.chapters) {
        const sources = [
            { bucket: 'chapter' as const, label: chapter.title, text: chapter.content },
            { bucket: 'summary' as const, label: `${chapter.title} · resumo`, text: `${chapter.summary} ${chapter.endHook ?? ''}`.trim() },
        ];
        for (const source of sources) {
            if (containsTrackedTerm(source.text, terms, character.tracking)) {
                hits.push({ sourceType: source.bucket, sourceId: chapter.id, label: source.label, excerpt: truncateText(source.text, 180) });
            }
        }
    }

    if (containsTrackedTerm(prepared.codex.overview, terms, character.tracking)) {
        hits.push({ sourceType: 'codex', sourceId: 'overview', label: 'Codex · overview', excerpt: truncateText(prepared.codex.overview, 180) });
    }

    for (const entry of [...prepared.codex.factions, ...prepared.codex.rules, ...prepared.codex.timeline]) {
        if (containsTrackedTerm(`${entry.title} ${entry.content}`, terms, character.tracking)) {
            hits.push({ sourceType: 'codex', sourceId: entry.id, label: entry.title, excerpt: truncateText(entry.content, 180) });
        }
    }

    const mem = prepared.narrativeMemory;
    if (mem) {
        const memoryBlocks = [
            { id: 'globalSummary', label: 'Memoria · resumo global', text: mem.globalSummary },
            { id: 'recentEvents', label: 'Memoria · eventos recentes', text: mem.recentEvents.join(' ') },
            { id: 'openLoops', label: 'Memoria · pontas abertas', text: mem.openLoops.map(loop => loop.description).join(' ') },
            { id: 'characterStates', label: 'Memoria · estados', text: mem.characterStates.map(state => `${state.name} ${state.status} ${state.location ?? ''} ${state.emotionalState ?? ''} ${state.lastAction ?? ''}`).join(' ') },
        ];
        for (const block of memoryBlocks) {
            if (containsTrackedTerm(block.text, terms, character.tracking)) {
                hits.push({ sourceType: 'memory', sourceId: block.id, label: block.label, excerpt: truncateText(block.text, 180) });
            }
        }
    }

    return hits;
};

export const collectCodexEntryMentions = (universe: Universe, entry: CodexEntry): MentionHit[] => {
    const prepared = ensureUniverseDefaults(universe);
    const terms = buildTrackedTerms(entry.title, entry.aliases, entry.tracking);
    const hits: MentionHit[] = [];

    for (const chapter of prepared.chapters) {
        const sources = [
            { bucket: 'chapter' as const, label: chapter.title, text: chapter.content },
            { bucket: 'summary' as const, label: `${chapter.title} · resumo`, text: `${chapter.summary} ${chapter.endHook ?? ''}`.trim() },
        ];
        for (const source of sources) {
            if (containsTrackedTerm(source.text, terms, entry.tracking)) {
                hits.push({ sourceType: source.bucket, sourceId: chapter.id, label: source.label, excerpt: truncateText(source.text, 180) });
            }
        }
    }

    const codexPools = [
        ...prepared.characters.map(character => ({ id: character.id, title: character.name, text: character.bio })),
        ...prepared.codex.factions.map(item => ({ id: item.id, title: item.title, text: item.content })),
        ...prepared.codex.rules.map(item => ({ id: item.id, title: item.title, text: item.content })),
        ...prepared.codex.timeline.map(item => ({ id: item.id, title: item.title, text: item.content })),
    ];
    for (const item of codexPools) {
        if (item.id === entry.id) continue;
        if (containsTrackedTerm(`${item.title} ${item.text}`, terms, entry.tracking)) {
            hits.push({ sourceType: 'codex', sourceId: item.id, label: item.title, excerpt: truncateText(item.text, 180) });
        }
    }

    const mem = prepared.narrativeMemory;
    if (mem) {
        const memoryBlocks = [
            { id: 'globalSummary', label: 'Memoria · resumo global', text: mem.globalSummary },
            { id: 'recentEvents', label: 'Memoria · eventos recentes', text: mem.recentEvents.join(' ') },
            { id: 'openLoops', label: 'Memoria · pontas abertas', text: mem.openLoops.map(loop => loop.description).join(' ') },
        ];
        for (const block of memoryBlocks) {
            if (containsTrackedTerm(block.text, terms, entry.tracking)) {
                hits.push({ sourceType: 'memory', sourceId: block.id, label: block.label, excerpt: truncateText(block.text, 180) });
            }
        }
    }

    return hits;
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export const generateUniverseIdea = async (profile?: StoryProfile, lang?: 'pt' | 'en'): Promise<UniverseIdea> => {
    const fallback = { name: 'The Default Realm', description: 'A fallback world generated offline.' };
    const profileCtx = buildProfileContext(profile);
    const effectiveLang = lang ?? profile?.lang ?? 'pt';
    const langMandateText = langMandate(effectiveLang);

    emitAgentOutput({ agent: 'architect', label: 'Gênesis · Ideia do Universo', status: 'thinking' });
    const data = await chatJson<UniverseIdea>({
        user: `
        ${langMandateText}
        ${profileCtx}
        Generate a unique, high-concept fictional universe idea that perfectly suits the Story Profile above.
        The name and description must feel native to the chosen format and literary influences.
        TITLE RULES — "name" is the TITLE OF THE LITERARY WORK (book/light novel/serial), not a planet or place name.
        Choose whatever title structure best fits the work — single evocative words, phrases, questions, poetic fragments, verb-led titles are all valid.
        Examples of fitting structures (not obligatory): "Shadows of the Dead", "Ashes", "The Architect of Chaos", "Cold Blood", "Who Keeps the Fire"
        FORBIDDEN: a single invented proper noun used as a world/planet name ("Valdur", "Aetheria", "Eldoria"), "The Kingdom of X", "The World of Y".
        Return only valid JSON with this exact shape:
        {"name":"Literary work title","description":"Evocative description in about 30 words that captures the tone and themes"}
        `,
        fallback,
        label: 'Gênesis · Ideia do Universo',
        maxTokens: 120,
    });
    emitAgentOutput({ agent: 'architect', label: 'Gênesis · Ideia do Universo', status: 'done', summary: data.name || fallback.name, detail: data.description || fallback.description });

    return {
        name: data.name || fallback.name,
        description: data.description || fallback.description,
        profile: profile ? { ...profile, lang: effectiveLang } : { themes: [], archetypes: [], lang: effectiveLang },
    };
};

export const createNewUniverse = async (idea: UniverseIdea): Promise<Universe> => {
    const newUniverse: Universe = {
        id: generateId(),
        name: idea.name,
        subtitle: '',
        description: idea.description,
        lastGenerated: new Date().toISOString(),
        codex: {
            overview: `Bem-vindo a ${idea.name}. ${idea.description}`,
            timeline: [],
            factions: [],
            rules: [],
        },
        characters: [],
        chapters: [],
        assets: { visual: [], sound: [] },
        storyProfile: idea.profile,
        notesPrivate: '',
        syncMeta: ensureSyncMeta(),
    };

    const profileCtx = buildProfileContext(idea.profile);
    const hasPremiseCNU = !!(idea.profile?.premise?.trim());
    const factionSeedCNU = !hasPremiseCNU ? pickFactionArchetypes(2).map(h => `- ${h}`).join('\n') : '';
    const data = await chatJson<{
        factions?: Array<{ title: string; content: string; belief?: string; myth?: string }>;
        rules?: Array<{ title: string; content: string; belief?: string; myth?: string }>;
    }>({
        user: `
        ${profileCtx}
        Based on this world idea: "${idea.name}: ${idea.description}", generate 2 factions and 2 world rules that fit the Story Profile.
        ${factionSeedCNU ? `FACTION STRUCTURE SEED (use these power structures — invent your own proper names, do NOT use these descriptions verbatim):\n${factionSeedCNU}` : 'PREMISE LOCK: Factions and rules MUST derive from the user premise above. Literary influences shape style, not content.'}
        Return only valid JSON with this exact shape:
        {
          "factions": [{ "title": "Faction name (invented proper noun, not genre label)", "content": "What the faction controls + what it structurally needs + who it structurally conflicts with (competing needs for the same resource — not moral opposition)", "belief": "Optional: what insiders or victims believe about this faction", "myth": "Optional: what the city, culture, or rivals say about this faction" }],
          "rules": [{ "title": "Rule name", "content": "The rule + its primary social cost: who suffers from it, who exploits it, what injustice it creates or normalizes", "belief": "Optional: what people incorrectly or emotionally believe about this rule", "myth": "Optional: the folklore, propaganda, or public version of this rule" }]
        }
        `,
        fallback: {},
        label: 'Architect · Facções & Regras',
        maxTokens: 400,
    });

    if (data.factions) newUniverse.codex.factions = data.factions.map((f) => ensureCodexEntryDefaults({
        id: generateId(),
        title: f.title,
        content: f.content,
        truth: createLayeredTruthBundle(`faction:${normalizeTitle(f.title)}`, f.content, { belief: f.belief, myth: f.myth }),
    }));
    if (data.rules) newUniverse.codex.rules = data.rules.map((r) => ensureCodexEntryDefaults({
        id: generateId(),
        title: r.title,
        content: r.content,
        truth: createLayeredTruthBundle(`rule:${normalizeTitle(r.title)}`, r.content, { belief: r.belief, myth: r.myth }),
    }));

    return ensureUniverseDefaults(newUniverse);
};

// ═══════════════════════════════════════════════════════════════════════════
// GENESIS — Minimal Canon: anchors → protagonist → chapter 1 → Chronicler
// ═══════════════════════════════════════════════════════════════════════════

export const generateFullUniverseGenesis = async (
    idea: UniverseIdea,
    onProgress: (step: string) => void,
    qualityMode: GenerationQualityMode = 'balanced'
): Promise<Universe> => {
    const compactMode = isEconomyMode(qualityMode);
    const profileCtx = buildProfileContext(idea.profile, compactMode);
    const effectiveLang = idea.profile?.lang ?? 'pt';
    const langMandateText = langMandate(effectiveLang);
    const hasPremise = !!(idea.profile?.premise?.trim());
    // Creative seeds guide free invention. When user provides a premise, the premise takes full priority.
    const factionSeed = !hasPremise ? pickFactionArchetypes(compactMode ? 2 : 3).map(h => `- ${h}`).join('\n') : '';
    const bgSeed = !hasPremise ? pickBackground() : '';
    const premiseLock = hasPremise
        ? '\nPREMISE LOCK — NON-NEGOTIABLE: ALL world structure, factions, title, setting, conflict, and protagonist MUST derive directly from the user premise. Literary influences and tone are STYLE parameters — they shape HOW the premise is told, not WHAT is invented.\n'
        : '';
    let uni: Universe = {
        id: generateId(),
        name: idea.name,
        description: idea.description,
        lastGenerated: new Date().toISOString(),
        lang: effectiveLang,
        codex: { overview: idea.description, timeline: [], factions: [], rules: [] },
        characters: [],
        chapters: [],
        assets: { visual: [], sound: [] },
        agentConfigs: {},
        storyProfile: idea.profile,
    };

    // ── Step 1: Universe Idea + Minimal Anchors — single merged Architect call ──
    onProgress('anchors');
    const isGenesisFromProfile = !idea.name;
    const stepLabel = isGenesisFromProfile ? 'Architect · Universo & Âncoras' : 'Architect · Âncoras';
    emitAgentOutput({ agent: 'architect', label: stepLabel, status: 'thinking' });
    const architectPrompt = getAgentPrompt(uni, 'architect', compactMode);
    const anchorData = await chatJson<{
        name?: string;
        description?: string;
        overview?: string;
        setting?: string;
        settingBelief?: string;
        settingMyth?: string;
        conflict?: string;
        conflictBelief?: string;
        conflictMyth?: string;
        factions?: Array<{ title: string; content: string; belief?: string; myth?: string }>;
    }>({        system: architectPrompt,
        user: isGenesisFromProfile
          ? effectiveLang === 'en' ? `
        ${langMandateText}
        ${profileCtx}
        ${premiseLock}
        You are creating a new fictional universe from scratch.
        Invent a unique, high-concept universe idea that perfectly suits the Story Profile, then immediately define its minimal anchors.
        Do NOT over-specify — the world will emerge from the prose.
        TITLE RULES — "name" is the TITLE OF THE LITERARY WORK (book/light novel/serial), not a planet or place name.
        Choose whatever title structure best fits the work — single evocative words, phrases, questions, poetic fragments, verb-led titles are all valid.
        Examples of fitting structures (not obligatory): "Shadows of the Dead", "Ashes", "The Architect of Chaos", "Cold Blood", "Who Keeps the Fire"
        FORBIDDEN: a single invented proper noun used as a world/planet name ("Valdur", "Aetheria", "Eldoria"), "The Kingdom of X", "The World of Y".
        Return only valid JSON:
        {
          "name": "Literary work title",
          "description": "Evocative 25-30 word description capturing tone and themes",
          "overview": "One paragraph setting atmosphere and central tension",
          "setting": "Specific location where Chapter 1 takes place",
          "conflict": "The inciting tension or threat driving the opening",
          "factions": [{ "title": "Faction name (invented proper noun, not a genre label)", "content": "What the faction controls + what it structurally needs + who it structurally conflicts with (competing needs, not moral opposition)", "belief": "Optional: what insiders or nearby characters believe about this faction", "myth": "Optional: the city's rumor, propaganda, or sacred story about this faction" }],
          "settingBelief": "Optional: what locals believe or fear about the opening location",
          "settingMyth": "Optional: the folklore or public narrative surrounding the opening location",
          "conflictBelief": "Optional: how characters misread or emotionally frame the opening conflict",
          "conflictMyth": "Optional: the official, ritual, or cultural version of the opening conflict"
        }
        ${factionSeed ? `FACTION STRUCTURE SEED (use these power structures — invent proper names, do NOT copy verbatim):\n${factionSeed}\n        Generate 2-3 factions in structural tension. Avoid protagonist’s side vs antagonist’s side framing.` : 'Generate 2-3 factions that emerge from the user premise. Factions must compete for the specific resources or power the premise makes relevant.'}
        ` : `
        ${langMandateText}
        ${profileCtx}
        ${premiseLock}
        Você está criando um universo ficcional do zero.
        Invente uma ideia de universo única e de alto conceito que se encaixe perfeitamente no Perfil da História, e então defina suas âncoras mínimas.
        NÃO especifique demais — o mundo emergirá da prosa.
        REGRAS DO TÍTULO — "name" é o TÍTULO DA OBRA LITERÁRIA (livro/light novel/serial), não o nome de um planeta ou lugar.
        Escolha a estrutura de título que melhor encaixar na obra — palavras únicas evocativas, frases, perguntas, fragmentos poéticos, títulos com verbo, tudo é válido.
        Exemplos de boas estruturas (não obrigatórias): "As Sombras da Morte", "Cinzas", "O Arquiteto do Caos", "Sangue Frio", "Quem Guarda o Fogo"
        PROIBIDO: um único substantivo próprio inventado como nome de mundo/planeta ("Valdur", "Aetheria", "Eldoria"), "O Reino de X", "O Mundo de Y".
        Retorne apenas JSON válido:
        {
          "name": "Título da obra literária",
          "description": "Descrição evocativa de 25-30 palavras capturando tom e temas",
          "overview": "Um parágrafo definindo atmosfera e tensão central",
          "setting": "Local específico onde o Capítulo 1 acontece",
          "conflict": "A tensão incitante ou ameaça que impulsiona a abertura",
          "factions": [{ "title": "Nome da facção (substantivo próprio inventado, não rótulo de gênero)", "content": "O que a facção controla + o que ela estruturalmente precisa + com quem conflita (necessidades concorrentes, não oposição moral)", "belief": "Opcional: o que membros ou vítimas acreditam sobre esta facção", "myth": "Opcional: o rumor, propaganda ou narrativa sagrada sobre esta facção" }],
          "settingBelief": "Opcional: o que os locais acreditam ou temem sobre o cenário inicial",
          "settingMyth": "Opcional: o folclore ou narrativa pública sobre o cenário inicial",
          "conflictBelief": "Opcional: como os personagens interpretam errado ou emocionalmente o conflito inicial",
          "conflictMyth": "Opcional: a versão oficial, ritual ou cultural do conflito inicial"
        }
        ${factionSeed ? `FACTION STRUCTURE SEED (use estas estruturas de poder — invente nomes próprios, NÃO copie verbatim):\n${factionSeed}\n        Gere 2-3 facções em tensão estrutural.` : 'Gere 2-3 facções que emergem da premissa do usuário. As facções devem competir pelos recursos específicos relevantes à premissa.'}
        `
          : effectiveLang === 'en' ? `
        ${langMandateText}
        ${profileCtx}
        ${premiseLock}
        For the universe idea: "${idea.name} - ${idea.description}", generate MINIMAL ANCHORS only.
        These are the bare essentials the Bard needs to write Chapter 1.
        Do NOT over-specify — the world will emerge from the prose.
        Return only valid JSON:
        {
          "overview": "One paragraph that sets the atmosphere and central tension",
          "setting": "The specific location where Chapter 1 will take place",
          "conflict": "The inciting tension or threat that drives the opening",
          "factions": [{ "title": "Faction name (invented proper noun, not a genre label)", "content": "What the faction controls + what it structurally needs + who it structurally conflicts with (competing needs, not moral opposition)", "belief": "Optional: what insiders or nearby characters believe about this faction", "myth": "Optional: the city's rumor, propaganda, or sacred story about this faction" }],
          "settingBelief": "Optional: what locals believe or fear about the opening location",
          "settingMyth": "Optional: the folklore or public narrative surrounding the opening location",
          "conflictBelief": "Optional: how characters misread or emotionally frame the opening conflict",
          "conflictMyth": "Optional: the official, ritual, or cultural version of the opening conflict"
        }
        ${factionSeed ? `FACTION STRUCTURE SEED (use these power structures — invent proper names, do NOT copy verbatim):\n${factionSeed}\n        Generate 2-3 factions in structural tension. Avoid protagonist’s side vs antagonist’s side framing.` : 'Generate 2-3 factions that emerge from the user premise. Factions must compete for the specific resources or power the premise makes relevant.'}
        ` : `
        ${langMandateText}
        ${profileCtx}
        ${premiseLock}
        Para a ideia de universo: "${idea.name} - ${idea.description}", gere apenas ÂNCORAS MÍNIMAS.
        São o essencial que o Bardo precisa para escrever o Capítulo 1.
        NÃO especifique demais — o mundo emergirá da prosa.
        Retorne apenas JSON válido:
        {
          "overview": "Um parágrafo que define a atmosfera e a tensão central",
          "setting": "O local específico onde o Capítulo 1 acontecerá",
          "conflict": "A tensão incitante ou ameaça que impulsiona a abertura",
          "factions": [{ "title": "Nome da facção (substantivo próprio inventado, não rótulo de gênero)", "content": "O que a facção controla + o que ela estruturalmente precisa + com quem conflita (necessidades concorrentes, não oposição moral)", "belief": "Opcional: o que membros ou vítimas acreditam sobre esta facção", "myth": "Opcional: o rumor, propaganda ou narrativa sagrada sobre esta facção" }],
          "settingBelief": "Opcional: o que os locais acreditam ou temem sobre o cenário inicial",
          "settingMyth": "Opcional: o folclore ou narrativa pública sobre o cenário inicial",
          "conflictBelief": "Opcional: como os personagens interpretam errado ou emocionalmente o conflito inicial",
          "conflictMyth": "Opcional: a versão oficial, ritual ou cultural do conflito inicial"
        }
        ${factionSeed ? `FACTION STRUCTURE SEED (use estas estruturas de poder — invente nomes próprios, NÃO copie verbatim):\n${factionSeed}\n        Gere 2-3 facções em tensão estrutural.` : 'Gere 2-3 facções que emergem da premissa do usuário. As facções devem competir pelos recursos específicos relevantes à premissa.'}
        `,
        fallback: {},
        temperature: 0.5,
        label: stepLabel,
        maxTokens: compactMode ? (isGenesisFromProfile ? 1600 : 1400) : (isGenesisFromProfile ? 2000 : 1800),
    });

    if (isGenesisFromProfile && anchorData.name) {
        uni.name = anchorData.name;
        uni.description = anchorData.description || uni.name;
    }

    emitAgentOutput({ agent: 'architect', label: stepLabel, status: 'done', summary: anchorData.overview?.slice(0, 120) || (anchorData.name ?? 'Âncoras criadas'), detail: JSON.stringify(anchorData, null, 2) });

    uni.codex.overview = anchorData.overview || uni.codex.overview;
    uni.codex.factions = (anchorData.factions || []).map(x => ensureCodexEntryDefaults({
        id: generateId(),
        title: x.title,
        content: x.content,
        truth: createLayeredTruthBundle(`faction:${normalizeTitle(x.title)}`, x.content, { belief: x.belief, myth: x.myth }),
    }));

    if (anchorData.setting) {
        uni.codex.rules.push(ensureCodexEntryDefaults({
            id: generateId(),
            title: 'Initial Setting',
            content: anchorData.setting,
            aliases: ['Abertura', 'Cenario inicial'],
            aiVisibility: 'global',
            truth: createLayeredTruthBundle('rule:initial-setting', anchorData.setting, { belief: anchorData.settingBelief, myth: anchorData.settingMyth }),
        }));
    }
    if (anchorData.conflict) {
        uni.codex.rules.push(ensureCodexEntryDefaults({
            id: generateId(),
            title: 'Central Conflict',
            content: anchorData.conflict,
            aliases: ['Conflito central'],
            aiVisibility: 'global',
            truth: createLayeredTruthBundle('rule:central-conflict', anchorData.conflict, { belief: anchorData.conflictBelief, myth: anchorData.conflictMyth }),
        }));
    }

    // ── Step 2: Protagonist seed (one Soulforger call) ──
    onProgress('characters');
    emitAgentOutput({ agent: 'soulforger', label: 'Soulforger · Protagonista', status: 'thinking' });
    const soulforgerPrompt = getAgentPrompt(uni, 'soulforger', compactMode);
    const factionsList = uni.codex.factions.map(f => f.title).join(', ');
    const protData = await chatJson<{
        name?: string;
        aliases?: string[];
        role?: Character['role'];
        faction?: string;
        bio?: string;
        age?: number;
        alignment?: string;
        ghost?: string;
        lie?: string;
    }>({
        system: soulforgerPrompt,
        user: effectiveLang === 'en' ? `
        ${langMandateText}
        ${profileCtx}
        Universe: "${uni.name}" — ${uni.codex.overview}
        Factions: ${factionsList}

        Create ONE protagonist. Include their Ghost (past trauma) and Lie (misconception about the world).
        ${bgSeed ? `BACKGROUND SEED (use this social position as starting point — invent all names and details):\n        ${bgSeed}` : 'Derive the protagonist\'s background and social position directly from the user premise and the world factions above.'}
        Return only valid JSON:
        {
          "name": "Name",
          "aliases": ["Nickname or in-world title"],
          "role": "Protagonista",
          "faction": "Faction name",
          "bio": "2-sentence biography including Ghost and Lie",
          "age": 30,
          "alignment": "Alignment",
          "ghost": "A specific past DECISION the character made that caused harm — not something that happened to them passively",
          "lie": "A specific falsifiable belief that creates friction with trustworthy characters in this story"
        }
        ` : `
        ${langMandateText}
        ${profileCtx}
        Universo: "${uni.name}" — ${uni.codex.overview}
        Facções: ${factionsList}

        Crie UM protagonista. Inclua o Ghost (trauma do passado) e a Lie (visão equivocada do mundo).
        ${bgSeed ? `BACKGROUND SEED (use esta posição social como ponto de partida — invente todos os nomes e detalhes):\n        ${bgSeed}` : 'Derive o background e posição social do protagonista diretamente da premissa do usuário e das facções do mundo acima.'}
        Retorne apenas JSON válido:
        {
          "name": "Nome",
          "aliases": ["Apelido ou titulo usado no mundo"],
          "role": "Protagonista",
          "faction": "Nome da facção",
          "bio": "Biografia de 2 frases incluindo Ghost e Lie",
          "age": 30,
          "alignment": "Alinhamento",
          "ghost": "Uma DECISÃO específica do passado que o personagem tomou e causou dano — não algo que aconteceu com ele passivamente",
          "lie": "Uma crença específica e falsificável que cria conflito com personagens dignos de confiança nesta história"
        }
        `,
        fallback: {},
        temperature: 0.5,
        label: 'Soulforger · Protagonista',
        maxTokens: compactMode ? 1400 : 1800,
    });

    emitAgentOutput({ agent: 'soulforger', label: 'Soulforger · Protagonista', status: 'done', summary: protData.name || '⚠️ Protagonista criado sem nome — veja detail', detail: JSON.stringify(protData, null, 2) });

    const protName = protData.name || (effectiveLang === 'en' ? 'Unknown Hero' : 'Herói Desconhecido');
    const protagonist: Character = {
        id: generateId(),
        name: protName,
        aliases: normalizeAliasList(protData.aliases),
        role: protData.role || 'Protagonista',
        faction: (protData.faction || '').trim(),
        age: protData.age || 25,
        alignment: protData.alignment || 'N/A',
        bio: protData.bio || (effectiveLang === 'en' ? 'A mysterious figure.' : 'Uma figura misteriosa.'),
        ghost: protData.ghost,
        coreLie: protData.lie,
        status: 'Vivo',
        notesPrivate: '',
        aiVisibility: 'global',
        tracking: { ...DEFAULT_TRACKING },
        relationships: [],
        chapters: [],
        imageUrl: createPortraitUrl({
            name: protName,
            role: protData.role || 'Protagonista',
            faction: (protData.faction || '').trim(),
            seed: `${protName}|${protData.bio || ''}`,
            size: 768,
        }),
    };
    uni.characters.push(protagonist);

    // ── Step 3: Chapter 1 via three-pass pipeline (Weaver bypassed — fixed genesis plot) ──
    onProgress('writing_intro');
    const rawSetting = anchorData.setting || uni.name;
    // Extract just the place name (before the first comma or dash) to avoid verbose beats
    const setting = rawSetting.split(/[,\-—]/)[0].trim();
    const genesisScenes = effectiveLang === 'en' ? [
        { beat: `${protagonist.name} works through a concrete task at ${setting} when a detail in the environment proves one of their protections has been disturbed.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `${protagonist.name} tests the disturbance with their own body or tools, and the contact forces a live physical echo of the Ghost without slipping into flashback summary.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `A messenger, witness, customer, or intruder arrives carrying evidence that turns the world conflict into a personal threat for ${protagonist.name}.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `${protagonist.name} extracts or recognizes one hard fact that reveals the threat was aimed at them specifically, not at random.`, characters: [protagonist.name], tension: 'peak' },
        { beat: `${protagonist.name} chooses an immediate course of action that burns a bridge, marks an enemy, or exposes them to retaliation.`, characters: [protagonist.name], tension: 'peak' },
    ] : [
        { beat: `${protagonist.name} trabalha em uma tarefa concreta em ${setting} quando um detalhe do ambiente prova que uma de suas proteções foi violada.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `${protagonist.name} testa a violação com o próprio corpo ou com suas ferramentas, e o contato força um eco físico do Ghost sem cair em flashback resumido.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `Um mensageiro, testemunha, cliente ou intruso chega carregando uma evidência que transforma o conflito do mundo em ameaça pessoal para ${protagonist.name}.`, characters: [protagonist.name], tension: 'rising' },
        { beat: `${protagonist.name} extrai ou reconhece um fato duro que revela que a ameaça foi armada especificamente para atingi-lo, e não ao acaso.`, characters: [protagonist.name], tension: 'peak' },
        { beat: `${protagonist.name} escolhe uma ação imediata que queima uma ponte, marca um inimigo ou o expõe a represália direta.`, characters: [protagonist.name], tension: 'peak' },
    ];

    const chapterTitle = effectiveLang === 'en' ? 'The Beginning' : 'O Começo';
    const chapterParams: ChapterGenerationParams = {
        title: chapterTitle,
        plotDirection: effectiveLang === 'en'
            ? `Open with a concrete task at ${setting}, let the Ghost (${protData.ghost || 'hidden pain'}) break through physical contact, then turn the world conflict into a targeted personal threat. End with a retaliatory choice.`
            : `Abra com uma tarefa concreta em ${setting}, deixe o Ghost (${protData.ghost || 'dor oculta'}) romper por contato físico, depois transforme o conflito do mundo em uma ameaça pessoal direcionada. Termine com uma escolha de retaliação.`,
        activeCharacterIds: [protagonist.id],
        tone: idea.profile?.tone ?? 'Dramático',
        focus: 'Introspecção',
        lang: effectiveLang,
        qualityMode,
        skipWeaver: true,
        prebuiltPlan: {
            chapterTitle,
            scenes: genesisScenes,
            chapterSummary: effectiveLang === 'en'
                ? `${protagonist.name} is introduced in their daily world at ${setting}. Their Ghost surfaces through action. The inciting incident strikes. They make a first irreversible choice.`
                : `${protagonist.name} é apresentado em seu mundo cotidiano em ${setting}. O Ghost emerge por meio de ação. O incidente incitante irrompe. A primeira escolha irreversível é tomada.`,
            endHook: effectiveLang === 'en'
                ? `${protagonist.name} has crossed a threshold from which there is no return — the real story begins.`
                : `${protagonist.name} cruzou um limiar sem retorno — a história real começa.`,
        },
    };
    const { chapter, chroniclerOutput } = await generateChapterThreePass(uni, chapterParams);
    chapter.title = (effectiveLang === 'en' ? 'Chapter 1: ' : 'Capítulo 1: ') + chapter.title;
    uni.chapters.push(chapter);

    // ── Step 4: Chronicler applies extracted facts to the universe codex ──
    onProgress('chronicler');
    if (chroniclerOutput) {
        uni = applyChroniclerSideEffects(uni, chroniclerOutput, 0, chapter.id);
    }

    onProgress('done');
    return ensureUniverseDefaults(uni);
};

// ═══════════════════════════════════════════════════════════════════════════
// THREE-PASS Chapter Generation
// ═══════════════════════════════════════════════════════════════════════════

interface ChroniclerOutput {
    summary: string;
    characterUpdates: CharacterState[];
    newOpenLoops: Array<{ description: string }>;
    resolvedLoopIds: string[];
    recentEvents: string[];
    newCodex: {
        factions: Array<{ title: string; content: string }>;
        rules: Array<{ title: string; content: string }>;
        timeline: Array<{ title: string; content: string }>;
    };
    auditFlags?: {
        wordOveruse?: string[];
        sceneObjectiveCheck?: string;
        passiveProtagonist?: string;
        rhetoricalPatternOveruse?: string;
        rhetoricalPatternCount?: number;
        imageryOveruse?: string[];
        openingSimilarityToRecentChapters?: 'low' | 'medium' | 'high';
        endingSimilarityToRecentChapters?: 'low' | 'medium' | 'high';
        mustRewrite?: boolean;
    };
}

/**
 * Sanitize raw Chronicler JSON:
 * 1. Strip empty objects from all arrays.
 * 2. Remap rogue codex keys (locations, threats, places) → rules.
 * 3. Ensure required arrays exist.
 */
const sanitizeChroniclerOutput = (raw: any): ChroniclerOutput => {
    const isValidEntry = (e: any) => e && typeof e === 'object' && e.title && e.content;
    const isValidChar = (e: any) => e && typeof e === 'object' && (e.characterId || e.name);
    const isValidLoop = (e: any) => e && typeof e === 'object' && e.description;

    const parseEntry = (e: any) => {
        if (!e) return null;
        if (typeof e === 'string') return { title: e, content: `Nova entrada identificada: ${e}` };
        if (typeof e === 'object' && e.title && e.content) return e;
        if (typeof e === 'object' && e.nome) return { title: e.nome, content: e.descricao || e.description || e.name || '' };
        if (typeof e === 'object' && e.name) return { title: e.name, content: e.description || e.descricao || '' };
        return null;
    };

    // Rogue codex keys that should map to rules
    const rogueRuleKeys = ['locations', 'threats', 'places', 'locais', 'ameacas', 'locações', 'settings', 'setting', 'codexEntries', 'entries', 'institutions', 'instituicoes', 'instituições', 'organizations', 'organizacoes', 'organizações'];

    const rawCodex: Record<string, any> = raw?.newCodex || {};
    const extraRules: Array<{ title: string; content: string }> = [];
    for (const key of rogueRuleKeys) {
        const arr = rawCodex[key];
        if (Array.isArray(arr)) {
            const parsed = arr.map(parseEntry).filter(isValidEntry);
            extraRules.push(...parsed);
        }
    }

    // Normalize factions: strings like "Liga dos Revolucionários" → {title, content}
    const normalizeFaction = (f: any) => {
        if (!f) return null;
        if (typeof f === 'string' && f.trim()) return { title: f.trim(), content: `Facção mencionada na narrativa.` };
        return parseEntry(f);
    };

    return {
        summary: raw?.summary || '',
        characterUpdates: (raw?.characterUpdates || []).filter(isValidChar),
        newOpenLoops: (raw?.newOpenLoops || []).filter(isValidLoop),
        resolvedLoopIds: Array.isArray(raw?.resolvedLoopIds) ? raw.resolvedLoopIds.filter((id: any) => typeof id === 'string' && id.length > 0) : [],
        recentEvents: Array.isArray(raw?.recentEvents) ? raw.recentEvents.filter((e: any) => typeof e === 'string') : [],
        newCodex: {
            factions: [...(rawCodex.factions || []).map(normalizeFaction).filter(isValidEntry)],
            rules: [...(rawCodex.rules || []).map(parseEntry).filter(isValidEntry), ...extraRules],
            timeline: [...(rawCodex.timeline || []).map(parseEntry).filter(isValidEntry)],
        },
        auditFlags: (raw?.auditFlags && typeof raw.auditFlags === 'object' && !Array.isArray(raw.auditFlags))
            ? raw.auditFlags
            : undefined,
    };
};

interface ThreePassResult {
    chapter: Chapter;
    chroniclerOutput: ChroniclerOutput | null;
}

interface SurgicalLectorOutput {
    replacements: Array<{ find: string; replaceWith: string }>;
    wordOveruse: string[];
    passiveProtagonist: 'sim' | 'não';
    sceneObjectiveCheck: 'ok' | 'complicado' | 'falhou';
    rhetoricalPatternOveruse?: string;
    rhetoricalPatternCount?: number;
    imageryOveruse?: string[];
    openingSimilarityToRecentChapters?: 'low' | 'medium' | 'high';
    endingSimilarityToRecentChapters?: 'low' | 'medium' | 'high';
    mustRewrite?: boolean;
}

const generateChapterThreePass = async (
    universe: Universe,
    params: ChapterGenerationParams,
): Promise<ThreePassResult> => {
    const compactMode = isEconomyMode(params.qualityMode);
    const memoryCtx = buildMemoryContext(universe, params.chapterIndex, compactMode);
    const relatedEntityIds = deriveContextEntityIds(universe, params.activeCharacterIds);
    const worldContext = buildUniverseContext(universe, compactMode ? { compact: true, maxFactions: 2, maxRules: 4, maxTimeline: 3, relatedEntityIds } : { relatedEntityIds });
    const characterContext = buildCharacterContext(universe, params.activeCharacterIds, compactMode);
    const profileCtx = buildProfileContext(universe.storyProfile, compactMode);
    const langMandateText = langMandate(params.lang ?? universe.lang ?? 'pt');

    // ── Pass 1: Weaver (planner) — skipped for genesis (fixed plot), runs for normal chapters ──
    let plan: {
        chapterTitle?: string;
        scenes?: Array<{ beat: string; characters: string[]; tension: string }>;
        chapterSummary?: string;
        endHook?: string;
    };

    if (params.skipWeaver && params.prebuiltPlan) {
        plan = params.prebuiltPlan;
        emitAgentOutput({ agent: 'weaver', label: 'Weaver · Planner', status: 'done', summary: `${plan.chapterTitle} (${plan.scenes?.length ?? 0} cenas fixas)`, detail: JSON.stringify(plan, null, 2) });
    } else {
        emitAgentOutput({ agent: 'weaver', label: 'Weaver · Planner', status: 'thinking' });
        const weaverPrompt = getAgentPrompt(universe, 'weaver', compactMode);
        const weaverLangLine = params.lang === 'en' ? 'Write ALL text in English only.' : 'Escreva TODO o texto em PORTUGUÊS BRASILEIRO. Beats, títulos, tudo em português. Proibido usar inglês.';

        // Derive plotDirection from open loops when AutoGen passes empty strings
        const derivedPlotDirection = params.plotDirection?.trim()
            ? params.plotDirection
            : (() => {
                const openLoops = universe.narrativeMemory?.openLoops?.filter(l => l.resolved === undefined) ?? [];
                if (openLoops.length > 0) {
                    return `[AUTO] Escalate these unresolved threads: ${openLoops.slice(0, 3).map(l => l.description).join(' / ')}. Pick the most urgent, push it forward, and introduce a new complication.`;
                }
                return `[AUTO] Continue from where the story left off. Escalate the central conflict. The chapter must meaningfully advance the plot — no repetition of previous arcs.`;
            })();
        const derivedTitle = params.title?.trim() || '';
        const densityInstruction = params.density === 'arc'
            ? `DENSITY MODE: ARC (time-skip).
- Plan 1 scene only. It is a summary of a passage of time (days, weeks, or travel).
- The single beat must describe: what changed, where the protagonist ended up, and one emotional consequence.
- The Bard will write this as a compact arc prose, NOT a full dramatized scene.`
            : params.density === 'scene'
            ? `DENSITY MODE: SCENE (micro-focus).
- Plan 1 to 3 scenes only. High detail, single location or single confrontation.
- Each beat is an intimate, high-stakes moment. No overarching plot moves.`
            : `DENSITY MODE: CHAPTER (default).
- You MUST plan EXACTLY 5 to 7 scenes. Never fewer than 5. This is non-negotiable.
- If you return fewer than 5 scenes, your output is invalid and will be rejected.`;
        const longformWeaverMeta = params.longformMode
            ? `
LONGFORM STRUCTURE:
- This chapter belongs to ACT ${params.actIndex ?? '?'} of a longform work.
- Structural function: ${params.chapterFunction ?? 'complication'}
- Milestone pressure: ${params.milestoneFocus || 'advance the work toward its next irreversible turn'}
- By the end of the chapter, something must clearly change in the protagonist, conflict, or world state.`
            : '';

    plan = await chatJson<{
        chapterTitle?: string;
        scenes?: Array<{ beat: string; characters: string[]; tension: string }>;
        chapterSummary?: string;
        endHook?: string;
    }>({
        system: `${weaverPrompt}

${weaverLangLine}

You are planning the structure of a single chapter.
${longformWeaverMeta}
CRITICAL CONTINUITY RULES:
- The chapter MUST directly continue from where the previous chapter ended.
- If there is a cliffhanger or open plot thread, it MUST be addressed or actively developed.
- The POV character must remain consistent with the established protagonist unless the plot explicitly requires a change.
- Do NOT reset to a new status quo — the previous chapter's consequences carry forward.
- Do NOT plan a beat that repeats an action from the previous chapter (e.g., "character runs", "character escapes" again).

SCENE COUNT — MANDATORY:
${densityInstruction}

STATE-CHANGE RULE (Every scene must advance the plot):
- Each scene MUST end with a PHYSICAL STATE CHANGE: new location, item gained/lost, injury, new ally/enemy, information discovered.
- If the characters are in the same place, same condition, with the same knowledge at the end of a scene as at the beginning, the scene is INVALID — rewrite it.
- FORBIDDEN: scenes where characters only "discuss what to do" or "reflect on events". Characters must ACT while they talk.
- Use THEREFORE/BUT causality: each beat connects to the next via consequence or complication. Never coincidence.
- FORBIDDEN BEAT SHAPES: "show routine", "memory of the ghost", "obstacle exposes the lie", "inciting incident erupts", "irreversible decision" as abstract labels.
- Instead, beats must name the concrete event itself: object, attack, revelation, pursuit, exchange, wound, intrusion, theft, argument, omen, discovery.
- Every beat must feel unique to THIS world and THIS chapter. If the beat could fit any fantasy story, it is too generic.
- Across the full plan, vary beat temperature: not every scene should peak. Mix pressure, investigation, movement, reversal, and fallout.

Output a structured plan — do NOT write prose.
CONCISION MANDATE: Each "beat" must be ONE specific sentence (10-25 words) naming WHO does WHAT WHERE. Not vague labels.`,
        user: `
        ${langMandateText}
        ${profileCtx}
        ${worldContext}
        ${memoryCtx}
        ${(() => {
            const dir = universe.narrativeMemory?.directorGuidance;
            if (!dir) return '';
            return `
=== DIRECTOR GUIDANCE (GM mandates — honour the pressure, not the prescription) ===
Narrative Pressure: ${dir.narrativePressure}
Thematic Constraint: ${dir.thematicConstraint}
Character Focus: ${dir.characterFocus}
Faction Pressure: ${dir.factionPressure}
Loop Priority: ${dir.loopPriority}
===`;
        })()}

        === ASSIGNMENT ===
        Title/Idea: "${derivedTitle}"
        Plot Direction: "${derivedPlotDirection}"
        Tone: ${params.tone}
        Focus: ${params.focus}

        ACTIVE CHARACTERS:
        ${buildCompactCharacterList(universe)}

        Return only valid JSON:
        {
          "chapterTitle": "Title for this chapter",
          "scenes": [
            { "beat": "What happens", "characters": ["Character Name"], "tension": "rising/peak/falling" }
          ],
          "chapterSummary": "One paragraph summary of the whole chapter",
          "endHook": "The cliffhanger or question that pulls the reader to the next chapter"
        }
        `,
        fallback: {},
        temperature: 0.5,
        label: 'Weaver · Planner',
        maxTokens: compactMode ? 1800 : 2000,
        provider: getPreferredHighCapabilityProvider(),
    });

        // Sanitize chapter title — strip garbled Unicode control chars
        if (plan.chapterTitle) {
            plan.chapterTitle = plan.chapterTitle.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
        }
        // Sanitize all beat strings — strip control chars that corrupt text (e.g. \u0018 → "Cap82culo")
        if (plan.scenes) {
            plan.scenes = plan.scenes
                .filter(s => s && typeof s.beat === 'string' && s.beat.trim().length > 0) // remove empty {} objects
                .map(s => ({
                    ...s,
                    beat: s.beat.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim(),
                }));
        }

        // Enforce maximum 7 scenes — trim overflow that tends to compress Bard pacing.
        if (plan.scenes && plan.scenes.length > 7 && params.density !== 'scene' && params.density !== 'arc') {
            plan.scenes = plan.scenes.slice(0, 7);
        }

        // Enforce minimum 5 scenes — only in full chapter mode
        if ((!plan.scenes || plan.scenes.length < 5) && params.density !== 'scene' && params.density !== 'arc') {
            const existing = plan.scenes || [];
            const protagonist = universe.characters[0]?.name || 'Protagonista';
            const fillers = params.lang === 'en' ? [
                { beat: `${protagonist} faces an unexpected obstacle that forces a change of plan.`, characters: [protagonist], tension: 'rising' },
                { beat: `A new character or threat appears, complicating the situation.`, characters: [protagonist], tension: 'peak' },
                { beat: `${protagonist} makes a desperate move that changes their physical position or resources.`, characters: [protagonist], tension: 'rising' },
                { beat: `The consequences of the previous action create an immediate new problem.`, characters: [protagonist], tension: 'peak' },
                { beat: `${protagonist} is forced into a decision that commits them to a new path.`, characters: [protagonist], tension: 'peak' },
            ] : [
                { beat: `${protagonist} enfrenta um obstáculo inesperado que force uma mudança de plano.`, characters: [protagonist], tension: 'rising' },
                { beat: `Um novo personagem ou ameaça surge, complicando a situação.`, characters: [protagonist], tension: 'peak' },
                { beat: `${protagonist} faz um movimento desesperado que altera sua posição ou recursos.`, characters: [protagonist], tension: 'rising' },
                { beat: `As consequências da ação anterior criam um novo problema imediato.`, characters: [protagonist], tension: 'peak' },
                { beat: `${protagonist} é forçado a uma decisão que o compromete com um novo caminho.`, characters: [protagonist], tension: 'peak' },
            ];
            while (existing.length < 5) {
                existing.push(fillers[existing.length % fillers.length]);
            }
            plan.scenes = existing;
        }

        if (!plan.chapterTitle) {
            const chapterNum = (params.chapterIndex ?? 0) + 1;
            plan.chapterTitle = params.lang === 'en' ? `Chapter ${chapterNum}` : `Capítulo ${chapterNum}`;
        }
        emitAgentOutput({ agent: 'weaver', label: 'Weaver · Planner', status: 'done', summary: `${plan.chapterTitle} (${plan.scenes?.length ?? 0} cenas)`, detail: JSON.stringify(plan, null, 2) });
    } // end else (weaver LLM call)

    // ── Pass 2: Bard (writer) — temp 0.88, FREE prose (no JSON) ──
    emitAgentOutput({ agent: 'bard', label: 'Bard · Escrita', status: 'thinking' });
    const bardPrompt = getAgentPrompt(universe, 'bard', compactMode);
    const opening = pickOpeningStyle(universe);

    const scenesPlan = plan.scenes && plan.scenes.length > 0
        ? plan.scenes.map((s, i) => `B${i + 1}[${s.tension[0]}]: ${s.beat} · ${s.characters.join('/')}`).join('\n')
        : `- ${params.plotDirection}`;

    // ── Arc mode: time-skip prose, compact, no full dramatization ──
    // Arc prose bypasses the full Bard pipeline and Lector — runs Chronicler directly.
    let arcModeProse: string | null = null;
    if (params.density === 'arc') {
        const arcLang = params.lang === 'en'
            ? 'Write in English only.'
            : 'Escreva em PORTUGUÊS BRASILEIRO apenas.';
        const arcUser = `${arcLang}
${buildBardMemoryHints(universe, params.chapterIndex, true)}

ARC PASSAGE — TIME SKIP
Beats to compress: ${scenesPlan}
Chapter summary: ${plan.chapterSummary || params.plotDirection}

Write a single flowing arc passage (180–350 words). Rules:
- Show the passage of time and distance through physical details and brief images, not scene dramatization.
- Include one moment of emotional consequence for the protagonist.
- End with the protagonist arriving at or facing the next situation — a clear landing point.
- No dialogue unless absolutely essential. No scene headers. Pure prose.
- FORBIDDEN: starting with the protagonist's name as subject of the first sentence.`;

        arcModeProse = await chat({
            system: bardPrompt,
            user: arcUser,
            json: false,
            temperature: 0.8,
            maxTokens: compactMode ? 900 : 1400,
            label: 'Bard · Arc',
            provider: getPreferredHighCapabilityProvider(),
        });
        arcModeProse = stripLLMPrefixes(arcModeProse);
        arcModeProse = cleanLanguageLeakage(arcModeProse, params.lang ?? universe.lang ?? 'pt');
        emitAgentOutput({ agent: 'bard', label: 'Bard · Escrita', status: 'done', summary: `Arc: ${arcModeProse.length} chars`, detail: arcModeProse.slice(0, 200) + '…' });
    }

    const pov = universe.storyProfile?.pov;
    const povInstruction = pov === 'primeira_pessoa'
        ? `\n=== POINT OF VIEW — MANDATORY ===\nWrite in FIRST PERSON (eu/I) throughout. Every sentence is filtered through the protagonist's "I". Use "eu vi", "eu senti" — but then immediately replace perception filters: instead of "Eu ouvi os gritos" → "Os gritos chegaram antes de eu entender de onde vinham." Never use "ele/ela" for the protagonist.\n`
        : pov === 'terceiro_onisciente'
        ? `\n=== POINT OF VIEW — MANDATORY ===\nWrite in THIRD PERSON OMNISCIENT. The narrator can access any character's thoughts, including side characters. Use this to build dramatic irony — let the reader know things the protagonist doesn't.\n`
        : `\n=== POINT OF VIEW — MANDATORY ===\nWrite in THIRD PERSON LIMITED. Follow one character's perspective at a time. Access their thoughts but not others'. Use "ele/ela pensou", deep interior reaction, physical sensation — all filtered through one POV character per scene.\n`;

    // ── Bard: chapter-sensitive opening rules ──
    const chapterNum = (params.chapterIndex ?? universe.chapters.length) + 1;
    const protagonist = universe.characters[0];
    const protagonistFullName = protagonist?.name || 'the protagonist';
    const protagonistFirstName = protagonistFullName.split(' ')[0];
    const protagonistFaction = protagonist?.faction ? `the ${protagonist.faction}` : '';
    const protagonistRole = protagonist?.bio?.match(/(\w+ spy|\w+ warrior|\w+ rebel|\w+ mage|\w+ knight|\w+ hunter|\w+ ranger|\w+ thief|\w+ assassin)/i)?.[0] || protagonist?.role || 'the protagonist';
    const knownLocations = universe.codex.rules.map(r => r.title).slice(0, 6).join(', ');

    const groundingMandate = chapterNum === 1
        ? `=== OPENING MANDATE ===
- Anchor the reader immediately: protagonist + specific named location + physical action in the first sentence.
- The protagonist must be the grammatical subject of the first sentence.
- FORBIDDEN openings: abstract reflections, philosophical statements, time metaphors, city-first descriptions.
- Every scene must name at least one location. Vague spaces ("the darkness", "somewhere") are forbidden.
- Named characters, places, and factions MUST appear by name in the prose.`
        : `=== OPENING MANDATE (CONTINUATION — Chapter ${chapterNum}) ===
- CRITICAL: Story is already in progress. Do NOT re-introduce protagonist or world.
- FORBIDDEN first sentence patterns (any = automatic failure):
  • "${protagonistFullName} [movement verb] through [place]" — this exact pattern opened EVERY previous chapter. BREAK IT.
  • Any sentence starting with "${protagonistFullName}" followed by a movement verb (ran, sprinted, walked, swam, pushed, moved).
  • Describing the city, ocean, or setting as if the reader sees it for the first time.
  • Any sentence that could logically open Chapter 1.
- REQUIRED: Begin with PRONOUN ("He"/"She"), short name "${protagonistFirstName}", a raw PHYSICAL SENSATION, a piece of dialogue, or an object/sound.
- Continue from the EXACT MOMENT in the narrative memory. No time jumps, no resets.
${knownLocations ? `- ESTABLISHED LOCATIONS (familiar — describe from fresh angles, don't re-introduce): ${knownLocations}` : ''}`;

    const nameVariationMandate = chapterNum === 1
        ? `
=== NAME VARIATION — NON-NEGOTIABLE ===
- Full name "${protagonistFullName}" may appear AT MOST TWICE in this entire chapter.
- After the first mention, rotate: "${protagonistFirstName}" (short form), a role descriptor (their function in the scene — "o engenheiro", "o fugitivo", "o arquiteto"), pronouns, or implied subject (omit it: "Caminhou" instead of "Ele caminhou").
- NEVER start two consecutive paragraphs with the same name or reference form.`
        : `
=== NAME VARIATION — NON-NEGOTIABLE ===
- Full name "${protagonistFullName}" may appear AT MOST TWICE in this entire chapter.
- Rotate naturally: "${protagonistFirstName}" (short), role descriptor (what they ARE in this moment — "o engenheiro", "o exilado", "o arquiteto"), "${protagonistFaction}" (faction), pronouns, implied subject.
- NEVER start two consecutive paragraphs with the same name or reference form.
- Apply the same rule to all recurring characters — no back-to-back identical references.`;

    // Build sceneObjectiveCheck + passiveProtagonist escalation injection
    const lastAuditCheck = universe.narrativeMemory?.lastAuditFlags?.sceneObjectiveCheck;
    const lastAuditPassive = universe.narrativeMemory?.lastAuditFlags?.passiveProtagonist;
    const stagnationWarning = (lastAuditCheck === 'complicado' || lastAuditCheck === 'falhou')
        ? `\n⚠️ PREVIOUS CHAPTER STAGNATED (sceneObjectiveCheck: ${lastAuditCheck}). CORRECTIVE MANDATE: Every single paragraph must show the protagonist moving, grabbing, deciding, fighting, escaping, or confronting something. Passive observation, standing still, or "waiting to see what happens" is FORBIDDEN. If a paragraph does not advance the protagonist's physical or emotional position, DELETE IT and write one that does.\n`
        : (lastAuditPassive === 'sim')
        ? `\n⚠️ PASSIVE PROTAGONIST DETECTED IN PREVIOUS CHAPTER. CORRECTIVE MANDATE: The protagonist MUST be the grammatical subject of every action sentence. Other characters may act, but the protagonist must ACT in response — not observe, not follow, not wait. Every paragraph must end with the protagonist having done something physical or made a decision. Observational sentences like "eu vi", "eu senti que ele foi" are FORBIDDEN unless immediately followed by a protagonist action.\n`
        : '';
    const sceneCount = Math.max(plan.scenes?.length || 5, 1);
    const targetMinChars = compactMode
        ? Math.min(5600, Math.max(3200, sceneCount * 560))
        : Math.min(7600, Math.max(4200, sceneCount * 700));

    const protagonistName = universe.characters[0]?.name || 'the protagonist';
    const bardPassiveNote = lastAuditPassive === 'sim'
        ? `\n=== ACTIVE PROTAGONIST MANDATE ===\n- POV ANCHOR: "${protagonistName}" is the grammatical subject of every action. Other characters act — but ${protagonistName} RESPONDS with a physical action.\n- FORBIDDEN: paragraphs where ${protagonistName} only watches, follows, or waits without acting.\n- Every paragraph must end with ${protagonistName} having done something or decided something.\n`
        : '';
    const recentStarts = getRecentChapterStarts(universe);
    const recentEndings = getRecentChapterEndings(universe);
    const directorStyle = universe.narrativeMemory?.directorGuidance;
    const densityInstruction = directorStyle?.densityTarget === 'lean'
        ? 'PROSE DENSITY TARGET: LEAN. Cut ornament aggressively. Favor direct physical progression, cleaner syntax, and fewer metaphoric layers.'
        : directorStyle?.densityTarget === 'lush'
        ? 'PROSE DENSITY TARGET: LUSH. Rich texture is allowed, but vary sentence shape and avoid repeating the same rhetoric or image family.'
        : 'PROSE DENSITY TARGET: BALANCED. Alternate clean forward motion with selected moments of richer language.';
    const directorStyleMandate = `
=== STYLE VARIATION MANDATE ===
- This chapter must sound different from the previous two in opening shape, dominant image family, and ending mechanism.
- Recent opening lines to avoid echoing:
${recentStarts.length ? recentStarts.map(line => `  • ${truncateText(line, 140)}`).join('\n') : '  • none'}
- Recent ending lines to avoid echoing:
${recentEndings.length ? recentEndings.map(line => `  • ${truncateText(line, 140)}`).join('\n') : '  • none'}
- ${directorStyle?.openingConstraint || 'Do not default to a dense sensory opening.'}
- ${directorStyle?.closingConstraint || 'Do not default to a rhetorical identity question at the end.'}
- Rhetorical bans: ${(directorStyle?.rhetoricalBans?.join(', ')) || 'avoid corrective negation and abstract sentence self-correction'}
- Imagery on cooldown: ${(directorStyle?.imageryCooldown?.join(', ')) || 'none'}
- ${densityInstruction}
`;

    const bardInput = `
${langMandateText}
${profileCtx}
${worldContext}
${characterContext}
${buildBardMemoryHints(universe, params.chapterIndex, compactMode)}
${stagnationWarning}${bardPassiveNote}
${params.longformMode ? `=== LONGFORM STRUCTURE ===
This is chapter ${(params.chapterIndex ?? universe.chapters.length) + 1} of ${params.targetChapterCount ?? universe.longformBlueprint?.targetChapters ?? 18}.
Act: ${params.actIndex ?? universe.longformProgress?.currentAct ?? '?'}
Chapter function: ${params.chapterFunction ?? universe.longformProgress?.currentFunction ?? 'complication'}
Required change by the end: ${params.milestoneFocus || 'advance the work toward its next irreversible turn'}
The chapter must feel like a structural step inside a larger novel, not an isolated episode.
` : ''}
=== CHAPTER PLAN (from the Weaver - follow this structure) ===
Title: ${plan.chapterTitle || params.title}
Narrative beats to cover (in order):
${scenesPlan}
End Hook: ${plan.endHook || 'Leave the reader wanting more.'}
Summary: ${plan.chapterSummary || params.plotDirection}

=== OPENING STYLE (mandatory for the first paragraph) ===
${opening.instruction}
${povInstruction}

${groundingMandate}
${nameVariationMandate}
${directorStyleMandate}

=== CONTINUITY — FORBIDDEN REPEATS ===
- Do NOT reuse any sensory prop or imagery from the PREVIOUS chapter. If luminescent fish, a wall, a smell, or a texture appeared last time — find something else.
- Locations already introduced are familiar to the characters — no one "discovers" a place they've already been.
- If a relationship is established, interactions must reflect that history — never reset to strangers.

=== OVERUSED EXPRESSIONS — ROTATE, NEVER REPEAT ===
- These are worn-out phrases. You may use one if truly unavoidable — but NEVER repeat the same expression (or anything semantically identical) twice in this chapter. When tempted, find a CONCRETE INVOLUNTARY PHYSICAL REACTION instead.
- WORN (EN): "shattering glass", "feral smile", "this would change everything", "little did I/he know", "a testament to", "a symphony of", "the weight of destiny", "time seemed to stop", "the air was thick with", "a shiver ran down my/his spine", "the words hung in the air", "a spark of recognition", "for now", "and with that"
- WORN (PT): "sentiu um arrepio na espinha", "o coração disparou", "olhos penetrantes", "sentiu um calafrio", "o silêncio era ensurdecedor", "o ar estava pesado", "o tempo pareceu parar", "as palavras pairaram no ar", "um nó na garganta", "estava com o coração na boca", "a respiração presa na garganta", "mãos sudorentas", "olhos marejaram"
- REPETITION RULE: any non-trivial word (not articles, prepositions) that appears 5+ times in the chapter is a failure. Vary deliberately.
- ALTERNATIVE: "o coração disparou" → what does the body actually do? Jaw locks. Weight shifts forward. Breath stalls high in the chest. Be specific.

=== SHOW, DON'T TELL — MANDATORY ===
- FORBIDDEN: naming emotions directly. "Estava nervoso", "sentiu medo", "ficou aliviado", "ela estava furiosa" — these are TELLING. Show the physical manifestation.
- TECHNIQUE: find the body part or involuntary reaction that betrays the emotion.
  • Nervous → "As mãos foram para a bancada antes de ele perceber que precisava de apoio."
  • Fear → "O estômago subiu — ele já conhecia aquele cheiro."
  • Relief → "O ombro cedeu. O sorriso veio depois, torto."
  • Rage → "Ela não respondeu. Dobrou o papel uma vez, duas vezes, até ele não ter mais forma."
- ADVERBS: cut -mente adverbs wherever a stronger verb exists. "Correu rapidamente" → "disparou". "Disse calmamente" → show the calm in the body.
- Rule: if you write an abstract emotion word, follow it with its physical anchor in the same sentence or cut it.

=== SENTENCE RHYTHM — MANDATORY ===
- Alternate short and long sentences. NEVER three sentences of similar length in a row.
- SHORT (3–8 words): impact, revelation, the beat right after action. Punch.
- LONG (15–35 words, subordinate clauses): environment, interiority, consequence. Immersion.
- Example: "A porta cedeu. O cheiro de enxofre que veio com ela era antigo demais para ser descuido — alguém havia preparado aquela sala antes de ${protagonistFirstName} sequer saber que viria."
- Action sequences: bias short. Reflective or environmental passages: bias long. Never monotone.
- TEMPERATURE RULE: not every sentence should sound monumental. Most sentences should carry story clearly; only a few should try to be unforgettable.
- After any high-intensity image or gothic line, ground the next beat in plain physical reality: movement, object, breath, wound, sound, distance, weight.
- If three consecutive sentences all sound aphoristic, solemn, or "trailer-like", rewrite them into cleaner narrative prose.

=== SENSORY PALETTE — BEYOND VISION ===
- Each scene MUST use at least 2 senses that are NOT vision. Vision is the default — it is not enough alone.
- SMELL: machine oil, old paper, rain on stone, burnt metal, cold air, dust, sweat, ink.
- SOUND: the specific click of a mechanism, footsteps on different surfaces, the rhythm of breathing, paper tearing, pipes contracting.
- TOUCH: texture of materials, temperature changes, gravity of held objects, fabric or metal against skin, pulse in a fingertip.
- TASTE: metallic dry-mouth before a decision, dust in the throat, cold air on the tongue.
- RULE: do NOT open a scene by describing what the character sees. Lead with one non-visual sensation first.

=== LITERARY CRAFT — USE WHEN IT EMERGES NATURALLY ===
- These are tools, not obligations. Force none of them.
- METAPHOR (direct, no 'como'): "A mente de ${protagonistFirstName} era uma engrenagem que recusava parar."
- PERSONIFICATION (give agency to objects): "A luz da vela lutava contra a escuridão."
- ANAPHORA (repeated opening for rhythm — MAX ONCE per chapter): "Era preciso coragem. Era preciso lógica. Era preciso silêncio."
- RULE: if a device calls attention to itself, it has already failed. Good craft is invisible.

=== RHETORICAL CRUTCH BAN — MANDATORY ===
- Do NOT lean on contrastive-negation sentence molds as a default literary tic.
- FORBIDDEN high-frequency patterns: "não X, mas Y", "não era..., mas...", "não por..., mas por...", "em vez disso", "not X, but Y", "it wasn't..., it was...".
- You may use one isolated contrastive sentence if absolutely necessary, but repeated use in the same chapter is a failure.
- When you want contrast, do it through sequence and consequence:
  • action followed by reaction
  • image followed by image
  • expectation broken by a concrete event
- Bad: "Ele sorriu, não por alegria, mas por hábito."
- Better: "O canto da boca subiu por reflexo. Os olhos ficaram imóveis."
- ALSO FORBIDDEN: chains of negation used to simulate profundity, such as "não humana. não animal.", "não era linguagem. era ritual.", "não por medo. por certeza."
- Default to affirmative syntax. Name what is there before naming what it is not.

=== FILTERING & HESITATION BAN — MANDATORY ===
- Remove narrative filters unless the act of perception itself is the event.
- FORBIDDEN as habitual framing: "ele sentiu", "ele sabia", "ele percebeu", "ele notou", "ele viu", "ele ouviu", "ele pensou", "ele observou", "ela sentiu", "ela sabia", and equivalent English forms.
- Bad: "Ele sentiu o peso da decisão." Better: "A decisão pesou nos ombros."
- Bad: "Ele sabia que o inimigo estava lá." Better: "O inimigo o esperava na penumbra."
- The reader should touch the scene directly, not through explanatory wrappers.

=== SIMILE / 'PARECIA' CONTROL — MANDATORY ===
- Do NOT use "parecia", "como se", "as if", or "seemed" as default atmosphere generators.
- One isolated use in a long chapter is acceptable; repeated use is a failure.
- Prefer concrete assertion over hedged image.
- Bad: "o metal se contorceu como se respirasse." Better: "o metal se contorceu, respirando sob a pressão."
- Bad: "a estrutura parecia viva." Better: "a estrutura pulsava sob as placas."

=== WEAK EMPHASIS WORDS — COOLDOWN ===
- Avoid leaning on "mas", "não", "apenas", "só", "ainda", "quase" as sentence crutches for false intensity.
- If contrast is needed, create it through action and consequence, not connective glue.
- If minimalism is needed, cut the sentence rather than inserting "apenas".

=== LENGTH MANDATE & MICRO-PACING ===
- Write ALL ${plan.scenes?.length || 5} beats fully — do not summarize or skip any.
- TARGET LENGTH: at least ${targetMinChars} characters unless every beat has already been fully dramatized.
- MINIMUM LENGTH: 4 paragraphs per beat. 
- For each beat: first establish the environment (1 paragraph), then show physical/emotional reactions (1 paragraph), then proceed with action or dialogue.
- Every beat must include at least one concrete physical action initiated by the protagonist or current POV character.
- If there are 6 or 7 beats, the chapter MUST feel long on the page. A short scene sketch is invalid.
- MAXIMUM: 8000 characters. Limit is just a safety, write extensively.
- Once you deliver the end hook, STOP. Do not add trailing reflections or echoes.
- FORBIDDEN: rushing through scenes. If a beat says "they fight and escape", describe the sensory details of the fight and the exhaustion of the escape. Never summarize physical action.

=== INSTRUCTIONS ===
Write the FULL chapter as polished, flowing prose.
CRITICAL FORMATTING RULES — NEVER BREAK THESE:
- Do NOT write section headers like "Cena 1", "Scene 1", "Part 1", or any numbered/labeled section.
- Do NOT add any meta-commentary, labels, or structural markers of any kind.
- The narrative beats above are internal guideposts only — weave them invisibly into continuous prose.
- Use blank lines or "---" only for time/location transitions; never to label scenes.
- Do NOT wrap in JSON. Write pure prose from start to finish.
Use Deep POV: show thoughts, sensations, reactions — never list actions.
STYLE: ${params.tone}. FOCUS: ${params.focus}.
    `;

    let prose = arcModeProse ?? '';
    if (!arcModeProse) {
    prose = await chat({
        system: bardPrompt,
        user: bardInput,
        json: false,
        temperature: 0.88,
        maxTokens: compactMode ? 4400 : 5200,
        label: 'Bard · Escrita',
        provider: getPreferredHighCapabilityProvider(),
    });

    prose = stripLLMPrefixes(prose);
    prose = cleanLanguageLeakage(prose, params.lang ?? universe.lang ?? 'pt');
    prose = truncateRepetitionLoops(prose);

    // Guard: retry if too short for the current scene count.
    if (prose.length < targetMinChars) {
        let expansionProse = await chat({
            system: bardPrompt,
            user: `${bardInput}

CRITICAL REVISION TASK: Expand the chapter below so it fully dramatizes every planned beat. Keep the same events, but add missing environment, physical action, transitions, and consequences until the text reaches at least ${targetMinChars} characters. Return the FULL rewritten chapter, not just the added part.\n\nCURRENT CHAPTER:\n${prose}`,
            json: false,
            temperature: 0.82,
            maxTokens: compactMode ? 4400 : 5200,
            label: compactMode ? 'Bard · Retry' : 'Bard · Expand',
            provider: getPreferredHighCapabilityProvider(),
        });
        expansionProse = stripLLMPrefixes(expansionProse);
        expansionProse = cleanLanguageLeakage(expansionProse, params.lang ?? universe.lang ?? 'pt');
        expansionProse = truncateRepetitionLoops(expansionProse);
        if (expansionProse.length > prose.length) {
            prose = expansionProse;
        }
    }
    } // end if (!arcModeProse)

    if (!arcModeProse) {
    emitAgentOutput({ agent: 'bard', label: 'Bard · Escrita', status: 'done', summary: `${prose.length} caracteres escritos`, detail: prose.slice(0, 200) + '…' });
    }

    // ── Pass 3: Lector Cirúrgico — JSON diffs + audit flags, sem rewrite completo ──
    // Runs always (cheap: ~400 output tokens vs 4000 for full rewrite).

    const applyLectorReplacements = (text: string, reps: SurgicalLectorOutput['replacements']): string => {
        let result = text;
        for (const { find, replaceWith } of reps) {
            if (!find || !replaceWith || find === replaceWith) continue;
            // Attempt 1: exact match (first occurrence only)
            const idx = result.indexOf(find);
            if (idx !== -1) {
                result = result.slice(0, idx) + replaceWith + result.slice(idx + find.length);
                continue;
            }
            // Attempt 2: flexible whitespace — build regex allowing \s+ between words
            try {
                const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flexible = escaped.replace(/\\? +/g, '\\s+');
                const regex = new RegExp(flexible);
                if (regex.test(result)) {
                    result = result.replace(regex, replaceWith);
                }
            } catch {
                // regex compile failed — skip this replacement safely
            }
        }
        return result;
    };

    const prevWordOveruse = universe.narrativeMemory?.lastAuditFlags?.wordOveruse ?? [];

    // Arc mode: skip Lector — prose is already compact, no surgical pass needed
    let lectorAudit: SurgicalLectorOutput | null = null;
    let finalProse = prose;

    if (!arcModeProse) {
    emitAgentOutput({ agent: 'lector', label: 'Lector · Cirúrgico', status: 'thinking' });

    // Feed up to 6000 chars — covers most chapters without ballooning Lector cost
    const proseSample = prose.length > 6000 ? prose.slice(0, 6000) + '\n[…truncated for audit…]' : prose;
    const previousOpenings = getRecentChapterStarts(universe, 2);
    const previousEndings = getRecentChapterEndings(universe, 2);

    // Apply surgical replacements to the full prose
    const lectorResult = await chatJson<SurgicalLectorOutput>({
        system: `You are a precision literary auditor. Your ONLY job is to return targeted corrections and audit flags.
RULES:
- Return MAX 8 replacements. Each "find" must be an EXACT verbatim phrase from the text (10-60 chars).
- Only flag issues that are CLEARLY present: word overuse (same non-article word 4+ times), POV drift, passive protagonist.
- Detect rhetorical crutches: repeated contrastive-negation molds such as "não X, mas Y", "não era..., mas...", "em vez disso", "not X, but Y".
- Detect repeated opening behavior: dense atmospheric first paragraphs, protagonist-name-plus-motion openings, and openings too similar to recent chapters.
- Detect repeated ending behavior: rhetorical identity questions and endings too similar to recent chapters.
- Detect imagery-family saturation: overuse of the same semantic family (bone/stone/metal/humidity/abyss/pulsing).
- Detect tonal monotony: if too many consecutive sentences sound maximally solemn, aphoristic, or trailer-like, prefer cleaner and more direct replacements.
- Detect narrative filtering and hedged atmosphere: "ele sentiu", "ele sabia", "ele percebeu", "ele viu", "parecia", "como se", "as if", "seemed".
- Your replacements must REDUCE inflation, not increase it.
- Prefer concrete nouns, physical verbs, direct syntax, and lower-temperature phrasing.
- Never replace a simple phrase with a more ornate one. If in doubt, simplify.
- Bad correction: "sentiu um leve arrepio" -> "uma onda de alerta percorreu sua espinha".
- Good correction: "sentiu um leve arrepio" -> "um arrepio correu pela nuca".
- Good correction: "ele sabia que precisava agir" -> "precisava agir".
- Good correction: "o metal parecia vivo" -> "o metal pulsava".
- Do NOT alter plot, names, or story facts.
- Do NOT return a replacement if you are not 100% sure the "find" string appears verbatim.
- "sceneObjectiveCheck": "ok" if the protagonist actively drives each scene, "complicado" if they are passive in 1-2 scenes, "falhou" if passive throughout.`,
        user: `${langMandateText}
PROTAGONIST: ${protagonistName}
POV: ${pov === 'primeira_pessoa' ? 'first-person (eu/I)' : pov === 'terceiro_onisciente' ? 'third-person omniscient' : 'third-person limited'}
PREVIOUSLY OVERUSED WORDS (flag if repeated again): ${prevWordOveruse.join(', ') || 'none'}
RECENT OPENINGS TO COMPARE AGAINST:
${previousOpenings.map(line => `- ${truncateText(line, 140)}`).join('\n') || '- none'}
RECENT ENDINGS TO COMPARE AGAINST:
${previousEndings.map(line => `- ${truncateText(line, 140)}`).join('\n') || '- none'}

CHAPTER TEXT:
${proseSample}

Return ONLY valid JSON matching this exact schema:
{
  "replacements": [
    { "find": "exact verbatim phrase from text", "replaceWith": "corrected phrase" }
  ],
  "wordOveruse": ["word1", "word2"],
  "passiveProtagonist": "sim" | "não",
  "sceneObjectiveCheck": "ok" | "complicado" | "falhou",
  "rhetoricalPatternOveruse": "short warning message if contrastive-negation rhetoric is overused",
  "rhetoricalPatternCount": 0,
  "imageryOveruse": ["family1"],
  "openingSimilarityToRecentChapters": "low" | "medium" | "high",
  "endingSimilarityToRecentChapters": "low" | "medium" | "high",
  "mustRewrite": false
}`,
        fallback: { replacements: [], wordOveruse: [], passiveProtagonist: 'não', sceneObjectiveCheck: 'ok', imageryOveruse: [], openingSimilarityToRecentChapters: 'low', endingSimilarityToRecentChapters: 'low', mustRewrite: false },
        temperature: 0.2,
        maxTokens: compactMode ? 1400 : 1600,
        label: 'Lector · Cirúrgico',
        provider: getPreferredHighCapabilityProvider(),
        schema: ZSurgicalLectorOutput as z.ZodType<SurgicalLectorOutput>,
    });
    lectorAudit = lectorResult;
    const rhetoricalAudit = countContrastiveNegationPatterns(proseSample);
    lectorAudit = {
        ...lectorAudit,
        rhetoricalPatternCount: Math.max(lectorAudit.rhetoricalPatternCount ?? 0, rhetoricalAudit.count),
        rhetoricalPatternOveruse: lectorAudit.rhetoricalPatternOveruse || rhetoricalAudit.message || '',
        imageryOveruse: Array.from(new Set([...(lectorAudit.imageryOveruse ?? []), ...detectImageryOveruse(proseSample)])),
    };
    const inferredOpeningPattern = inferOpeningPattern(proseSample, protagonistName);
    const inferredEndingPattern = inferEndingPattern(proseSample);
    const openingSimilarity = inferredOpeningPattern && previousOpenings.length > 0
        ? 'high'
        : (lectorAudit.openingSimilarityToRecentChapters ?? 'low');
    const endingSimilarity = inferredEndingPattern && previousEndings.length > 0
        ? 'high'
        : (lectorAudit.endingSimilarityToRecentChapters ?? 'low');
    lectorAudit.openingSimilarityToRecentChapters = openingSimilarity;
    lectorAudit.endingSimilarityToRecentChapters = endingSimilarity;
    lectorAudit.mustRewrite = Boolean(
        lectorAudit.mustRewrite
        || (lectorAudit.rhetoricalPatternCount ?? 0) >= 3
        || (lectorAudit.imageryOveruse?.length ?? 0) >= 2
        || openingSimilarity === 'high'
        || endingSimilarity === 'high'
    );

    // Apply surgical replacements to the full prose
    finalProse = applyLectorReplacements(prose, lectorAudit.replacements ?? []);
    // Safety: if result shrank dramatically, fall back to original
    if (finalProse.length < prose.length * 0.92) finalProse = prose;
    if (lectorAudit.mustRewrite && !compactMode) {
        emitAgentOutput({ agent: 'bard', label: 'Bard rhetorical rewrite', status: 'thinking' });
        let rewrittenProse = await chat({
            system: bardPrompt,
            user: `${langMandateText}

The Lector flagged stylistic repetition in the chapter below.

=== RHETORICAL / STYLE REWRITE MANDATE ===
- Remove habitual formulas such as "não X, mas Y", "não era..., mas...", "em vez disso", "não com..., mas com...".
- If the opening repeats recent chapter openings, rewrite the FIRST paragraph with a different mechanism.
- If the ending closes on a rhetorical identity question, replace it with image, action, revelation, or irreversible choice.
- Reduce imagery saturation from these families: ${(lectorAudit.imageryOveruse ?? []).join(', ') || 'none'}.
- Rewrite toward direct statement, direct image, direct action, sensory detail, or consequence.
- Preserve plot, scene order, character decisions, and ending.
- Keep the prose literary, but stop self-correcting sentences and avoid repeating the same atmospheric machinery.
- Return the FULL rewritten chapter.

CHAPTER TO FIX:
${finalProse}`,
            json: false,
            temperature: 0.7,
            maxTokens: 5200,
            label: 'Bard rhetorical rewrite',
            provider: getPreferredHighCapabilityProvider(),
        });
        rewrittenProse = stripLLMPrefixes(rewrittenProse);
        rewrittenProse = cleanLanguageLeakage(rewrittenProse, params.lang ?? universe.lang ?? 'pt');
        if (rewrittenProse.length > finalProse.length * 0.72) {
            finalProse = rewrittenProse;
        }
    }

    const lectorSummary = [
        `${lectorAudit.replacements?.length ?? 0} correções`,
        lectorAudit.passiveProtagonist === 'sim' ? '⚠ protagonista passivo' : null,
        lectorAudit.sceneObjectiveCheck !== 'ok' ? `cenas: ${lectorAudit.sceneObjectiveCheck}` : null,
        lectorAudit.wordOveruse?.length ? `overuse: ${lectorAudit.wordOveruse.join(', ')}` : null,
        lectorAudit.imageryOveruse?.length ? `imagética: ${lectorAudit.imageryOveruse.join(', ')}` : null,
        lectorAudit.openingSimilarityToRecentChapters === 'high' ? 'abertura repetida' : null,
        lectorAudit.endingSimilarityToRecentChapters === 'high' ? 'fecho repetido' : null,
        lectorAudit.rhetoricalPatternCount && lectorAudit.rhetoricalPatternCount >= 3 ? `retÃ³rica IA: ${lectorAudit.rhetoricalPatternCount}` : null,
    ].filter(Boolean).join(' · ');

    emitAgentOutput({
        agent: 'lector',
        label: 'Lector · Cirúrgico',
        status: 'done',
        summary: lectorSummary || 'sem problemas detectados',
        detail: JSON.stringify(lectorAudit, null, 2),
    });

    // ── Pass 3b: Active Rewrite — triggered when Lector flags a passive protagonist ──
    // Only runs in non-economy mode (skip for draft/fast generations).
    if (lectorAudit.passiveProtagonist === 'sim' && lectorAudit.sceneObjectiveCheck === 'falhou' && !compactMode) {
        emitAgentOutput({ agent: 'bard', label: 'Bard · Reescrita Ativa', status: 'thinking' });
        let rewrittenProse = await chat({
            system: bardPrompt,
            user: `${langMandateText}

The Lector flagged a PASSIVE PROTAGONIST problem in the chapter below.
${protagonistName} is observing, following or waiting in scenes instead of driving them.

=== ACTIVE REWRITE MANDATE ===
- ${protagonistName} must be the grammatical AGENT of every scene — the one who starts actions, not reacts to them.
- For every paragraph where ${protagonistName} only watches/follows/waits: make them ACT. Grab something. Speak first. Decide. Push back. Move before others do.
- Keep ALL plot events, characters, and dialogue. Only convert passivity into agency.
- Do NOT add new scenes or change the ending.
- Return the FULL rewritten chapter.  

CHAPTER TO FIX:
${finalProse}`,
            json: false,
            temperature: 0.75,
            maxTokens: 5200,
            label: 'Bard · Reescrita Ativa',
            provider: getPreferredHighCapabilityProvider(),
        });
        rewrittenProse = stripLLMPrefixes(rewrittenProse);
        rewrittenProse = cleanLanguageLeakage(rewrittenProse, params.lang ?? universe.lang ?? 'pt');
        // Only accept if plausibly the same chapter (size within 30% of original)
        if (rewrittenProse.length > finalProse.length * 0.7) {
            finalProse = rewrittenProse;
        }
        emitAgentOutput({
            agent: 'bard',
            label: 'Bard · Reescrita Ativa',
            status: 'done',
            summary: `protagonista reativado · ${finalProse.length} chars`,
            detail: finalProse.slice(0, 200) + '…',
        });
        blueprint = normalizeLongformBlueprint(blueprint, preparedUniverse);
    }

    } // end if (!arcModeProse) — Lector + 3b rewrite

    // ── Pass 4: Chronicler (extractor) — reads the FINAL polished prose ──
    emitAgentOutput({ agent: 'chronicler', label: 'Chronicler · Extrator', status: 'thinking' });
    const chroniclerPrompt = getAgentPrompt(universe, 'chronicler', compactMode);
    
    // POV instruction
    const povRule = pov === 'primeira_pessoa' 
        ? `\nPOV RULE: The text is in first-person ('eu'/'I'). Map ALL first-person actions and sensations to the protagonist: [${universe.characters[0]?.name || 'the protagonist'}]. Do NOT create a character named 'Eu' or 'I'.\n`
        : '';
        
    const existingCharacterRoster = universe.characters.length > 0
        ? universe.characters.map(c => `- ${c.name} => ${c.id}`).join('\n')
        : 'none';
    const existingFactionTitles = universe.codex.factions.map(f => f.title).join(' | ');
    const existingRuleTitles = universe.codex.rules.map(r => r.title).join(' | ');
    const existingTimelineTitles = universe.codex.timeline.map(t => t.title).join(' | ');
    const existingOpenLoopsText = universe.narrativeMemory?.openLoops
        ?.filter(l => l.resolved === undefined)
        .map(l => `[ID:${l.id}] ${l.description}`)
        .join('\n  ') || 'none yet';

    let chroniclerOutput = await chatJson<ChroniclerOutput>({
        system: `${chroniclerPrompt}
${povRule}
You are extracting facts from the chapter prose that was just written.
Extract facts that EXPLICITLY appear in the text. Do NOT infer or fabricate.
EXISTING CHARACTER ROSTER (reuse these exact IDs when the name matches):
${existingCharacterRoster}
If a character name matches the roster above, you MUST return that exact ID and MUST NOT create NEW_[name].
IMPORTANT: For characters that appear in the prose but are NOT in the ID list above, set characterId to "NEW_[name]" (e.g. "NEW_Gideon"). NEVER use the literal string "id" or "unknown" as a characterId.
DO NOT rename a known character into a generic label like "Stranger", "Guard", "Woman", or "Man" if the prose already provides a more specific identity.

This may be Chapter 1. Even initial states are valuable facts — extract them.
The user message contains the EXACT JSON schema you must return. Use those exact key names. Do NOT invent your own keys.

ALREADY IN CODEX — do NOT re-extract these (they are known):
  Factions: ${existingFactionTitles || 'none'}
  Rules/Locations: ${existingRuleTitles || 'none'}
  Timeline: ${existingTimelineTitles || 'none'}
Only add codex entries with titles NOT already in those lists.
Only create codex entries for STABLE world facts: factions, locations, institutions, lasting rules, lasting historical events.
DO NOT create codex entries for temporary offers, single messages, one-scene actions, emotions, or metaphorical descriptions.
DO NOT create a codex entry for a title that differs from an existing one only by an article like "The"/"A"/"An".

EXISTING OPEN LOOPS (already tracked — do NOT duplicate into newOpenLoops):
  ${existingOpenLoopsText}
To mark a loop as resolved, add its exact ID string (e.g. "abc123def") to resolvedLoopIds.
ACTIVELY RESOLVE loops: if a question from the list above is ANSWERED or no longer relevant in this chapter, you MUST add its ID to resolvedLoopIds. Do not leave resolvedLoopIds empty if progress was made.
Only add to newOpenLoops if a BRAND NEW unresolved question appears in THIS chapter that is NOT already listed above. Do NOT rephrase existing loops as new ones.
If the chapter only deepens an existing mystery, return newOpenLoops as [] for that thread.

CHARACTER RELATIONSHIP TRACKING:
For each character update, also note any relationships that are revealed or changed in the prose (allies, enemies, romantic interests, mentors, etc.). Include this in the character's lastAction or emotionalState fields.`,

        user: `
        ${langMandateText}
        CHAPTER TEXT:
        ${finalProse}

        Return only valid JSON:
        {
          "summary": "Concise one-paragraph chapter summary naming protagonist, location, and what happened",
          "characterUpdates": [
            { "characterId": "id", "name": "Name", "status": "Vivo", "location": "Where they are now", "emotionalState": "How they feel", "lastAction": "What they just did" }
          ],
          "newOpenLoops": [
            { "description": "An unresolved question or plot thread introduced in this chapter" }
          ],
          "resolvedLoopIds": [],
          "recentEvents": ["Key event 1", "Key event 2"],
          "newCodex": {
            "factions": [{ "title": "Name", "content": "Description" }],
            "rules": [{ "title": "Name or Location", "content": "Description" }],
            "timeline": [{ "title": "Event name", "content": "What happened and when" }]
          },
          "auditFlags": {
            "wordOveruse": ["word1", "word2"],
            "sceneObjectiveCheck": "ok | complicado | falhou",
            "passiveProtagonist": "não | sim"
          }
        }
        characterUpdates MUST include an entry for every named character that appears. Do not return empty arrays if characters exist.
        wordOveruse: list ONLY words that appear 3+ times in the chapter prose. Return empty array [] if none.
        passiveProtagonist: "sim" if the protagonist uses passive verbs (sentia/estava/parecia/olhava/observava/ficou/aguardava) for 4+ beats OR never initiates a single action. Do NOT default to "não" when unsure — flag "sim".
        newCodex entries: only include entries where "content" is a non-empty concrete fact from the prose. Omit entries with no new fact rather than leaving content blank.
        `,
        fallback: null as unknown as ChroniclerOutput,
        schema: ZChroniclerOutput as z.ZodType<ChroniclerOutput>,
        temperature: 0.15,
        label: 'Chronicler · Extrator',
        maxTokens: compactMode ? 2400 : 3200,
        provider: getPreferredHighCapabilityProvider(),
    });

    // Retry if the model echoed the schema type instead of filling it in
    if (!chroniclerOutput?.summary) {
        emitAgentOutput({ agent: 'chronicler', label: 'Chronicler · Retry', status: 'thinking' });
        chroniclerOutput = await chatJson<ChroniclerOutput>({
            system: `You are a strict JSON extractor. Read the chapter text and fill in the exact JSON schema provided. Output ONLY valid JSON — no prose, no markdown formatting blocks.`,
            user: `
        ${langMandateText}
        EXISTING CHARACTER ROSTER (reuse these exact IDs when the name matches):
        ${existingCharacterRoster}

        CHAPTER TEXT:
        ${finalProse}

        Return ONLY this JSON, fully populated with extracted facts:
        {
          "summary": "One paragraph: who is here, where, what happened",
          "characterUpdates": [
            { "characterId": "existing_id_or_NEW_Name", "name": "Name", "status": "Vivo", "location": "location", "emotionalState": "emotion", "lastAction": "what they did" }
          ],
          "newOpenLoops": [{ "description": "unresolved question from this chapter" }],
          "resolvedLoopIds": [],
          "recentEvents": ["event 1", "event 2"],
          "newCodex": { "factions": [], "rules": [], "timeline": [] },
          "auditFlags": { "wordOveruse": [], "sceneObjectiveCheck": "ok", "passiveProtagonist": "não" }
        }
        `,
            fallback: null as unknown as ChroniclerOutput,
            schema: ZChroniclerOutput as z.ZodType<ChroniclerOutput>,
            temperature: 0.1,
            label: 'Chronicler · Retry',
            maxTokens: compactMode ? 2000 : 2600,
            provider: getPreferredHighCapabilityProvider(),
        });
        blueprint = normalizeLongformBlueprint(blueprint, preparedUniverse);
    }

    // ── Shadow Chronicler — Groq plain-text fallback if Cerebras failed twice ──
    if (!chroniclerOutput?.summary) {
        emitAgentOutput({ agent: 'chronicler', label: 'Shadow Chronicler · Fallback', status: 'thinking' });
        try {
            const shadowText = await chat({
                system: 'You are a story fact extractor. Read the text and produce a plain factual summary in 2-3 sentences: who appeared, where, and what happened.',
                user: `${langMandateText}\n\nCHAPTER TEXT:\n${finalProse.slice(0, 3000)}`,
                json: false,
                temperature: 0.2,
                maxTokens: 400,
                label: 'Shadow Chronicler',
                provider: 'groq',
            });
            // Build a minimal valid ChroniclerOutput from the plain text
            const protagonist = universe.characters[0];
            chroniclerOutput = {
                summary: shadowText.trim() || 'Capítulo processado (modo fallback).',
                characterUpdates: protagonist
                    ? [{ characterId: protagonist.id, name: protagonist.name, status: 'Vivo' as const }]
                    : [],
                newOpenLoops: [],
                resolvedLoopIds: [],
                recentEvents: [shadowText.slice(0, 120).trim()],
                newCodex: { factions: [], rules: [], timeline: [] },
            };
            emitAgentOutput({ agent: 'chronicler', label: 'Shadow Chronicler · Fallback', status: 'done', summary: 'Fallback text extracted via Groq' });
        } catch {
            emitAgentOutput({ agent: 'chronicler', label: 'Shadow Chronicler · Fallback', status: 'error', summary: 'All providers failed — chapter saved without memory update' });
        }
    }

    emitAgentOutput({ agent: 'chronicler', label: 'Chronicler · Extrator', status: 'done', summary: chroniclerOutput?.summary?.slice(0, 120) || 'Fatos extraídos', detail: JSON.stringify(chroniclerOutput, null, 2) });

    // Sanitize: strip empty objects, remap rogue keys
    const safeChronicler = canonicalizeChroniclerOutput(universe, sanitizeChroniclerOutput(chroniclerOutput ?? {}));

    // Merge Lector's surgical audit flags into the Chronicler output — Lector is more accurate
    // since it reads specifically for these issues. Merge: take the more severe value.
    if (safeChronicler && lectorAudit) {
        const mergedWordOveruse = Array.from(new Set([
            ...(lectorAudit.wordOveruse ?? []),
            ...(safeChronicler.auditFlags?.wordOveruse ?? []),
        ])).slice(0, 8);

        const worstPassive = (lectorAudit.passiveProtagonist === 'sim' || safeChronicler.auditFlags?.passiveProtagonist === 'sim')
            ? 'sim' : 'não';

        const worseSco = (() => {
            const scores = { 'ok': 0, 'complicado': 1, 'falhou': 2 };
            const lSco = lectorAudit.sceneObjectiveCheck ?? 'ok';
            const cSco = (safeChronicler.auditFlags?.sceneObjectiveCheck as string) ?? 'ok';
            return (scores[lSco as keyof typeof scores] ?? 0) >= (scores[cSco as keyof typeof scores] ?? 0) ? lSco : cSco;
        })();

        safeChronicler.auditFlags = {
            wordOveruse: mergedWordOveruse.length > 0 ? mergedWordOveruse : undefined,
            passiveProtagonist: worstPassive,
            sceneObjectiveCheck: worseSco,
            rhetoricalPatternOveruse: lectorAudit.rhetoricalPatternOveruse || safeChronicler.auditFlags?.rhetoricalPatternOveruse,
            rhetoricalPatternCount: Math.max(lectorAudit.rhetoricalPatternCount ?? 0, safeChronicler.auditFlags?.rhetoricalPatternCount ?? 0),
            imageryOveruse: Array.from(new Set([...(lectorAudit.imageryOveruse ?? []), ...(safeChronicler.auditFlags?.imageryOveruse ?? [])])),
            openingSimilarityToRecentChapters: lectorAudit.openingSimilarityToRecentChapters || safeChronicler.auditFlags?.openingSimilarityToRecentChapters,
            endingSimilarityToRecentChapters: lectorAudit.endingSimilarityToRecentChapters || safeChronicler.auditFlags?.endingSimilarityToRecentChapters,
            mustRewrite: lectorAudit.mustRewrite || safeChronicler.auditFlags?.mustRewrite,
        };
    }

    const chapter: Chapter = {
        id: generateId(),
        title: plan.chapterTitle || params.title,
        status: 'Rascunho',
        summary: safeChronicler?.summary || plan.chapterSummary || 'Resumo não disponível.',
        content: finalProse,
        endHook: plan.endHook,
        openingStyle: opening.style,
    };

    return { chapter, chroniclerOutput: safeChronicler };
};

// ═══════════════════════════════════════════════════════════════════════════
// Public wrapper — used by ChaptersView
// ═══════════════════════════════════════════════════════════════════════════

export const generateChapterWithAgents = async (
    universe: Universe,
    params: ChapterGenerationParams,
): Promise<{ chapter: Chapter; updatedUniverse: Universe }> => {
    const preparedUniverse = params.directorPrepared
        ? universe
        : await prepareUniverseForManualDirection(universe, params.qualityMode);
    const { chapter, chroniclerOutput } = await generateChapterThreePass(preparedUniverse, {
        ...params,
        directorPrepared: true,
    });

    // Build a new universe object — no direct React state mutation
    const idx = params.chapterIndex ?? preparedUniverse.chapters.length;
    const updatedChapters = [
        ...preparedUniverse.chapters.slice(0, idx),
        chapter,
        ...preparedUniverse.chapters.slice(idx),
    ];
    let updatedUniverse: Universe = { ...preparedUniverse, chapters: updatedChapters };

    if (chroniclerOutput) {
        updatedUniverse = applyChroniclerSideEffects(updatedUniverse, chroniclerOutput, idx, chapter.id);
    }

    return { chapter, updatedUniverse };
};

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTOR — per-chapter narrative health check, guides the Weaver
// ═══════════════════════════════════════════════════════════════════════════

const generateDirectorGuidance = async (
    universe: Universe,
    compactMode: boolean,
): Promise<DirectorGuidance> => {
    emitAgentOutput({ agent: 'director', label: 'Director · Análise', status: 'thinking' });
    const directorPrompt = getAgentPrompt(universe, 'director', compactMode);
    const effectiveLang = universe.lang ?? 'pt';
    const langMandateText = langMandate(effectiveLang);
    const mem = universe.narrativeMemory;
    const protagonist = universe.characters[0];
    const protagonistLie = protagonist?.coreLie?.trim() || '';
    const prevLieState = mem?.lieStates?.find(state => state.characterId === protagonist?.id);

    const openLoops = mem?.openLoops.filter(l => l.resolved === undefined) ?? [];
    const recentEvents = mem?.recentEvents ?? [];
    const factions = universe.codex.factions.map(f => f.title).join(', ') || 'none';
    const activeTimelinePressure = universe.codex.timeline.filter(entry => entry.eventState === 'active_pressure').slice(0, 4);
    const longformBlueprint = universe.longformBlueprint;
    const longformProgress = universe.longformProgress;
    const structuralMeta = longformBlueprint && longformProgress
        ? `LONGFORM STRUCTURE:
- Chapter ${longformProgress.currentChapter} of ${longformBlueprint.targetChapters}
- Act ${longformProgress.currentAct}
- Expected function: ${longformProgress.currentFunction || 'n/a'}
- Current milestone: ${longformProgress.currentMilestone || 'n/a'}
- Completed milestones: ${longformProgress.completedMilestones.join(' | ') || 'none'}`
        : '';
    // Words already on cooldown — pass them so Director can avoid re-adding them
    const currentChIdx = universe.chapters.length;
    const activeCooldownWords = Object.entries(mem?.lexicalCooldown ?? {})
        .filter(([, expiry]) => expiry > currentChIdx)
        .map(([word]) => word);
    const activeStylePatterns = Object.entries(mem?.stylePatternCooldown ?? {})
        .filter(([, expiry]) => expiry > currentChIdx)
        .map(([pattern]) => pattern);
    const newOveruse = mem?.lastAuditFlags?.wordOveruse ?? [];
    const imageryOveruse = mem?.lastAuditFlags?.imageryOveruse ?? [];

    const fallback: DirectorGuidance = {
        openLoopCount: openLoops.length,
        loopPriority: openLoops[0]?.description
            ? `${openLoops[0].description} — resolve within 2 cycles`
            : 'No open loops — introduce a new mystery organically',
        factionPressure: 'Balance faction presence — ensure all factions have recent narrative activity',
        characterFocus: mem?.lastAuditFlags?.passiveProtagonist === 'sim'
            ? 'CRITICAL: protagonist was passive last chapter — must initiate a decisive physical action this chapter'
            : 'Protagonist agency is healthy — deepen their internal contradiction',
        thematicConstraint: 'The central conflict must bear down on every scene — no relief without cost',
        narrativePressure: activeTimelinePressure[0]
            ? `Active timeline pressure: ${activeTimelinePressure[0].title} must dictate the rhythm and urgency of the next chapter`
            : openLoops.length > 5
            ? `Pressure cooker: ${openLoops.length} unresolved loops — at least one must crack this chapter`
            : 'Raise the stakes on the central tension with a concrete, irreversible consequence',
        wordsToSetOnCooldown: newOveruse,
        cooldownSubstitutions: newOveruse.slice(0, 5).map(word => ({
            term: word,
            note: `Do not use "${word}". Replace it with sensory description, metaphor, or consequence.`,
        })),
        rhetoricalBans: [
            'nao_x_mas_y',
            'nao_era_x_era_y',
            ...(mem?.lastAuditFlags?.openingSimilarityToRecentChapters === 'high' ? ['opening_nome_movimento', 'opening_sensorial_densa'] : []),
            ...(mem?.lastAuditFlags?.endingSimilarityToRecentChapters === 'high' ? ['ending_pergunta_identitaria'] : []),
        ],
        imageryCooldown: imageryOveruse,
        openingConstraint: mem?.lastAuditFlags?.openingSimilarityToRecentChapters === 'high'
            ? 'Do not open with dense atmospheric sensation or protagonist-name-plus-motion. Start with interruption, action, dialogue, or blunt consequence.'
            : 'Avoid defaulting to smell+taste+texture+architecture in the first paragraph.',
        closingConstraint: mem?.lastAuditFlags?.endingSimilarityToRecentChapters === 'high'
            ? 'Do not close with a rhetorical identity question. End on image, action, revelation, or irreversible choice.'
            : 'Avoid generic rhetorical hooks; vary the ending mechanism.',
        densityTarget: mem?.lastAuditFlags?.rhetoricalPatternCount && mem.lastAuditFlags.rhetoricalPatternCount >= 4 ? 'lean' : 'balanced',
        contradictionSummary: protagonist?.coreLie ? `Track contradictions against the protagonist lie: ${protagonist.coreLie}` : 'No protagonist lie registered.',
        liePressureSource: 'escalation',
        protagonistLieStability: mem?.lieStates?.find(state => state.characterId === protagonist?.id)?.lieStability ?? 10,
        ruptureRequired: (mem?.lieStates?.find(state => state.characterId === protagonist?.id)?.lieStability ?? 10) <= 3,
    };

    const guidance = await chatJson<DirectorGuidance>({
        system: directorPrompt,
        user: `${langMandateText}

UNIVERSE: "${universe.name}" — ${universe.codex.overview}
FACTIONS: ${factions}
PROTAGONIST: ${protagonist?.name || 'Unknown'} — ${protagonist?.bio?.slice(0, 150) || 'no bio'}
PROTAGONIST CORE LIE: ${protagonistLie || 'none recorded'}
PREVIOUS LIE STABILITY: ${prevLieState?.lieStability ?? 10}/10
PREVIOUS LIE PRESSURE: ${prevLieState?.pressureSources.join(', ') || 'none'}
PREVIOUS CONTRADICTIONS: ${prevLieState?.contradictions.slice(-3).join(' | ') || 'none'}
CHAPTERS WRITTEN SO FAR: ${universe.chapters.length}

NARRATIVE MEMORY STATE:
Global Summary: ${mem?.globalSummary?.slice(0, 300) || 'No summary yet'}
Recent Events: ${recentEvents.slice(-3).map(e => `- ${e}`).join('\n') || '- none'}
Open Loops (${openLoops.length} total): ${openLoops.slice(0, 5).map(l => `- [Ch.${l.introduced + 1}] ${l.description}`).join('\n') || '- none'}
Previous Audit Flags:
  - Passive protagonist: ${mem?.lastAuditFlags?.passiveProtagonist || 'não'}
  - Scene check: ${mem?.lastAuditFlags?.sceneObjectiveCheck || 'ok'}
  - Overused words last chapter: ${newOveruse.join(', ') || 'none'}
  - Overused imagery families last chapter: ${imageryOveruse.join(', ') || 'none'}
  - Currently on cooldown: ${activeCooldownWords.join(', ') || 'none'}
  - Style patterns currently on cooldown: ${activeStylePatterns.join(', ') || 'none'}
  - Contrastive-negation crutch count: ${mem?.lastAuditFlags?.rhetoricalPatternCount ?? 0}
  - Contrastive-negation warning: ${mem?.lastAuditFlags?.rhetoricalPatternOveruse || 'none'}
  - Opening similarity to recent chapters: ${mem?.lastAuditFlags?.openingSimilarityToRecentChapters || 'low'}
  - Ending similarity to recent chapters: ${mem?.lastAuditFlags?.endingSimilarityToRecentChapters || 'low'}

Active Timeline Pressures:
${activeTimelinePressure.map(entry => `- ${entry.title}: ${entry.content}`).join('\n') || '- none'}

${structuralMeta}

Return ONLY valid JSON:
{
  "openLoopCount": ${openLoops.length},
  "loopPriority": "The most urgent open loop + how many chapters until it must resolve (e.g. 'The poison source — resolve within 2 cycles')",
  "factionPressure": "Which faction needs more narrative attention and why",
  "characterFocus": "What the protagonist must actively confront or decide — a character action, not an emotion",
  "thematicConstraint": "One sentence: what thematic cost or question must press against every scene this chapter",
  "narrativePressure": "The GM-level tension to inject — a pressure on the world, not a prescribed action (e.g. 'Someone is about to betray trust')",
  "rhetoricalBans": ["nao_x_mas_y", "nao_era_x_era_y"],
  "imageryCooldown": ${JSON.stringify(imageryOveruse.slice(0, 8))},
  "openingConstraint": "One sentence banning repeated opening behavior",
  "closingConstraint": "One sentence banning repeated ending behavior",
  "densityTarget": "lean | balanced | lush",
  "cooldownSubstitutions": [{ "term": "mirror", "note": "Do not name it directly; use sensory description, metaphor, action, or consequence instead." }],
  "contradictionSummary": "What fresh evidence or event now attacks the protagonist core lie",
  "liePressureSource": "betrayal | guilt | factual proof | failure | revelation | escalation",
  "protagonistLieStability": 7,
  "ruptureRequired": false,
  "wordsToSetOnCooldown": ${JSON.stringify(newOveruse.slice(0, 10))}
}`,
        fallback,
        schema: ZDirectorGuidance as z.ZodType<DirectorGuidance>,
        temperature: 0.4,
        maxTokens: compactMode ? 1400 : 1800,
        label: 'Director · Análise',
        provider: getPreferredHighCapabilityProvider(),
    });

    // Ensure wordsToSetOnCooldown is populated — at minimum carry over new overuse
    if (!guidance.wordsToSetOnCooldown || guidance.wordsToSetOnCooldown.length === 0) {
        guidance.wordsToSetOnCooldown = newOveruse;
    }


    emitAgentOutput({
        agent: 'director',
        label: 'Director · Análise',
        status: 'done',
        summary: guidance.narrativePressure?.slice(0, 100) || 'Guidance issued',
        detail: JSON.stringify(guidance, null, 2),
    });

    return guidance;
};

const applyDirectorGuidance = (
    universe: Universe,
    directorGuidance: DirectorGuidance,
): Universe => {
    const chapterIdxNow = universe.chapters.length;
    const prevCooldown = universe.narrativeMemory?.lexicalCooldown ?? {};
    const prevCooldownGuidance = universe.narrativeMemory?.lexicalCooldownGuidance ?? {};
    const prevStylePatternCooldown = universe.narrativeMemory?.stylePatternCooldown ?? {};
    const updatedCooldown: Record<string, number> = {};
    const updatedCooldownGuidance: Record<string, string> = {};
    const updatedStylePatternCooldown: Record<string, number> = {};

    for (const [word, expiry] of Object.entries(prevCooldown)) {
        if (expiry > chapterIdxNow) {
            updatedCooldown[word] = expiry;
            if (prevCooldownGuidance[word]) updatedCooldownGuidance[word] = prevCooldownGuidance[word];
        }
    }
    for (const [pattern, expiry] of Object.entries(prevStylePatternCooldown)) {
        if (expiry > chapterIdxNow) {
            updatedStylePatternCooldown[pattern] = expiry;
        }
    }

    for (const word of directorGuidance.wordsToSetOnCooldown ?? []) {
        updatedCooldown[word.toLowerCase()] = chapterIdxNow + 2;
    }
    for (const image of directorGuidance.imageryCooldown ?? []) {
        updatedCooldown[image.toLowerCase()] = chapterIdxNow + 2;
        if (!updatedCooldownGuidance[image.toLowerCase()]) {
            updatedCooldownGuidance[image.toLowerCase()] = `Avoid centering the prose around "${image}" again so soon. Change the image family and dramatize through another concrete texture or action.`;
        }
    }
    for (const substitution of directorGuidance.cooldownSubstitutions ?? []) {
        if (!substitution.term?.trim()) continue;
        updatedCooldownGuidance[substitution.term.toLowerCase()] = substitution.note;
    }
    for (const pattern of directorGuidance.rhetoricalBans ?? []) {
        updatedStylePatternCooldown[pattern] = chapterIdxNow + 2;
    }

    const protagonist = universe.characters[0];
    const prevLieStates = universe.narrativeMemory?.lieStates ?? [];
    const nextLieStates = [...prevLieStates];
    if (protagonist?.coreLie?.trim()) {
        const idx = nextLieStates.findIndex(state => state.characterId === protagonist.id);
        const baseState = idx >= 0
            ? nextLieStates[idx]
            : {
                characterId: protagonist.id,
                name: protagonist.name,
                coreLie: protagonist.coreLie,
                lieStability: 10,
                pressureSources: [],
                contradictions: [],
                ruptureRequired: false,
                lastUpdatedChapter: Math.max(0, chapterIdxNow - 1),
            };
        const contradictionSummary = directorGuidance.contradictionSummary?.trim();
        const contradictions = contradictionSummary && contradictionSummary !== 'No protagonist lie registered.'
            ? Array.from(new Set([...baseState.contradictions, contradictionSummary])).slice(-6)
            : baseState.contradictions;
        const pressureSource = directorGuidance.liePressureSource?.trim();
        const pressureSources = pressureSource
            ? Array.from(new Set([...baseState.pressureSources, pressureSource])).slice(-6)
            : baseState.pressureSources;
        const nextState: CharacterLieState = {
            ...baseState,
            name: protagonist.name,
            coreLie: protagonist.coreLie,
            lieStability: Math.max(1, Math.min(10, directorGuidance.protagonistLieStability ?? baseState.lieStability)),
            pressureSources,
            contradictions,
            ruptureRequired: directorGuidance.ruptureRequired ?? baseState.ruptureRequired,
            lastUpdatedChapter: chapterIdxNow,
        };
        if (idx >= 0) nextLieStates[idx] = nextState;
        else nextLieStates.push(nextState);
    }

    return {
        ...universe,
        narrativeMemory: {
            ...universe.narrativeMemory ?? {
                lastChapterIndex: 0,
                globalSummary: '',
                characterStates: [],
                openLoops: [],
                recentEvents: [],
                newCodexEntries: { factions: [], rules: [], timeline: [] },
            },
            directorGuidance,
            lexicalCooldown: updatedCooldown,
            lexicalCooldownGuidance: updatedCooldownGuidance,
            stylePatternCooldown: updatedStylePatternCooldown,
            lieStates: nextLieStates,
        } as NarrativeMemory,
    };
};

const prepareUniverseForManualDirection = async (
    universe: Universe,
    qualityMode?: GenerationQualityMode,
): Promise<Universe> => {
    const syncedUniverse = (universe.syncMeta?.dirtyScopes?.length ?? 0) > 0
        ? syncUniverseCanon(universe, 'light')
        : ensureUniverseDefaults(universe);
    const compactMode = isEconomyMode(qualityMode);
    const directorGuidance = await generateDirectorGuidance(syncedUniverse, compactMode);
    return applyDirectorGuidance(syncedUniverse, directorGuidance);
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTOGEN — Sequential chapter arc loop
// ═══════════════════════════════════════════════════════════════════════════

export interface AutogenProgress {
    chaptersDone: number;
    totalChapters: number;
    phase: 'director' | 'weaver' | 'bard' | 'chronicler' | 'done' | 'aborted';
    currentUniverse: Universe;
}

const applyLongformProgress = (
    universe: Universe,
    blueprint: LongformBlueprint,
    chapterNumber: number,
): Universe => {
    const chapterMeta = getBlueprintChapterMeta(blueprint, chapterNumber);
    const completedMilestones = blueprint.milestones
        .filter(item => item.chapter < chapterNumber)
        .map(item => item.label);
    const nextProgress: LongformProgressState = {
        currentChapter: chapterNumber,
        currentAct: chapterMeta?.actIndex ?? 1,
        currentFunction: chapterMeta?.function,
        currentMilestone: chapterMeta?.milestone,
        completedMilestones,
    };
    return {
        ...universe,
        creationMode: 'autogen_longform',
        longformBlueprint: blueprint,
        longformProgress: nextProgress,
    };
};

export const generateLongformBlueprint = async (
    universe: Universe,
    qualityMode: GenerationQualityMode = 'economy',
): Promise<LongformBlueprint> => {
    const preparedUniverse = ensureUniverseDefaults(universe);
    const compactMode = isEconomyMode(qualityMode);
    const protagonist = preparedUniverse.characters[0];
    const effectiveLang = preparedUniverse.lang ?? preparedUniverse.storyProfile?.lang ?? 'pt';
    const langMandateText = langMandate(effectiveLang);
    const blueprintContext = buildLongformBlueprintContext(preparedUniverse, protagonist, compactMode);
    const fallback = normalizeLongformBlueprint(buildFallbackLongformBlueprint(preparedUniverse), preparedUniverse);
    const blueprintDirectives = buildCompactLongformBlueprintDirectives(preparedUniverse.storyProfile, effectiveLang);
    const anchorPool = [
        preparedUniverse.name,
        protagonist?.name || '',
        ...preparedUniverse.codex.factions.map(entry => entry.title),
        ...preparedUniverse.codex.rules.map(entry => entry.title),
        ...preparedUniverse.codex.timeline.map(entry => entry.title),
    ].filter(Boolean);
    const isGenericGoal = (goal: string) =>
        BLUEPRINT_GENERIC_PATTERNS.some(pattern => pattern instanceof RegExp && pattern.test(goal)) ||
        /concrete new cost|irreversible choice|custo concreto|escolha irrevers/i.test(goal);
    const needsBlueprintRepair = (blueprint: LongformBlueprint) => {
        const genericGoals = blueprint.chapterMap.filter(entry => isGenericGoal(entry.goal)).length;
        const anchorlessGoals = blueprint.chapterMap.filter(entry => !blueprintTextHasNamedAnchor(entry.goal, anchorPool)).length;
        const repeatedCore = blueprint.promise.trim() === blueprint.conflictCore.trim();
        const mergedCore =
            blueprint.promise.trim() === blueprint.protagonistFocus.trim() ||
            blueprint.conflictCore.trim() === blueprint.protagonistFocus.trim();
        const wrongLanguageActs = effectiveLang === 'pt'
            ? blueprint.acts.some(act => /\bAct\b/i.test(act.label))
            : blueprint.acts.some(act => /\bAto\b/i.test(act.label));
        const genericActs = blueprint.acts.filter(act => !blueprintTextHasNamedAnchor(`${act.purpose} ${act.milestone}`, anchorPool)).length;
        return genericGoals > 1 || anchorlessGoals > 6 || genericActs > 1 || repeatedCore || mergedCore || wrongLanguageActs;
    };

    emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint', status: 'thinking' });
    const blueprintProvider: 'cerebras' | 'auto' = loadApiKeys()?.cerebras?.trim() ? 'cerebras' : 'auto';
    const blueprintModel = loadApiKeys()?.cerebras?.trim() ? CEREBRAS_DEFAULT_MODEL : undefined;
    const directivesText = blueprintDirectives.directivesText || (effectiveLang === 'en' ? 'Honor the selected profile naturally.' : 'Honre o perfil selecionado de forma natural.');

    const coreFallback = {
        title: fallback.title,
        logline: fallback.logline,
        promise: fallback.promise,
        conflictCore: fallback.conflictCore,
        protagonistFocus: fallback.protagonistFocus,
    };

    let blueprint: LongformBlueprint = fallback;

    emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Core', status: 'thinking' });
    const corePass = await chatJson<z.infer<typeof ZLongformBlueprintCore>>({
        system: `Rewrite only the top-level identity of a seed longform blueprint.
Return JSON only.
No markdown. No explanations.
Keep all fields concise and story-specific.
promise, conflictCore, and protagonistFocus must be clearly distinct.`,
        user: `${langMandateText}

${blueprintContext}

STRUCTURAL MODEL:
- ${blueprintDirectives.model}

MANDATORY DIRECTIVES:
- ${directivesText}

Rewrite only these fields so they become native to this universe:
${JSON.stringify(coreFallback, null, 2)}

Return:
{
  "title": "",
  "logline": "",
  "promise": "",
  "conflictCore": "",
  "protagonistFocus": ""
}`,
        fallback: coreFallback,
        schema: ZLongformBlueprintCore,
        model: blueprintModel,
        temperature: 0.2,
        maxTokens: 900,
        label: 'Longform Blueprint · Core',
        provider: blueprintProvider,
    });
    blueprint = normalizeLongformBlueprint({ ...blueprint, ...corePass }, preparedUniverse);
    emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Core', status: 'done', summary: blueprint.title });

    const actsFallback = {
        acts: fallback.acts.map(act => ({
            actIndex: act.actIndex,
            label: act.label,
            purpose: act.purpose,
            milestone: act.milestone,
        })),
        milestones: fallback.milestones.map(item => ({
            chapter: item.chapter,
            label: item.label,
            objective: item.objective,
        })),
    };

    emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Acts', status: 'thinking' });
    const actsPass = await chatJson<z.infer<typeof ZLongformBlueprintActsPass>>({
        system: `Rewrite only the act and milestone text of a seed blueprint.
Return JSON only.
Preserve actIndex order and milestone chapters.
Keep labels and objectives concise, specific, and anchored to named story material.`,
        user: `${langMandateText}

${blueprintContext}

STRUCTURAL MODEL:
- ${blueprintDirectives.model}

MANDATORY DIRECTIVES:
- ${directivesText}

Rewrite this act structure so it becomes native to the universe:
${JSON.stringify(actsFallback, null, 2)}

Return:
{
  "acts": [{ "actIndex": 1, "label": "", "purpose": "", "milestone": "" }],
  "milestones": [{ "chapter": 4, "label": "", "objective": "" }]
}`,
        fallback: actsFallback,
        schema: ZLongformBlueprintActsPass,
        model: blueprintModel,
        temperature: 0.2,
        maxTokens: 1400,
        label: 'Longform Blueprint · Acts',
        provider: blueprintProvider,
    });
    blueprint = normalizeLongformBlueprint({
        ...blueprint,
        acts: blueprint.acts.map((act, index) => ({
            ...act,
            ...actsPass.acts[index],
            chapterStart: act.chapterStart,
            chapterEnd: act.chapterEnd,
        })),
        milestones: blueprint.milestones.map((item, index) => ({
            ...item,
            ...actsPass.milestones[index],
            chapter: item.chapter,
        })),
    }, preparedUniverse);
    emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Acts', status: 'done', summary: `${blueprint.acts.length} acts refined` });

    const chapterPassFallback = (actIndex: number) => ({
        chapters: fallback.chapterMap
            .filter(entry => entry.actIndex === actIndex)
            .map(entry => ({
                chapterNumber: entry.chapterNumber,
                actIndex: entry.actIndex,
                function: entry.function,
                goal: entry.goal,
                ...(entry.milestone ? { milestone: entry.milestone } : {}),
            })),
    });

    for (const act of blueprint.acts) {
        const currentChapterSlice = blueprint.chapterMap
            .filter(entry => entry.actIndex === act.actIndex)
            .map(entry => ({
                chapterNumber: entry.chapterNumber,
                actIndex: entry.actIndex,
                function: entry.function,
                goal: entry.goal,
                ...(entry.milestone ? { milestone: entry.milestone } : {}),
            }));
        const sliceFallback = chapterPassFallback(act.actIndex);

        emitAgentOutput({ agent: 'weaver', label: `Longform Blueprint · Act ${act.actIndex}`, status: 'thinking' });
        const chapterPass = await chatJson<z.infer<typeof ZLongformBlueprintChapterPass>>({
            system: `Rewrite chapter goals for one act of a seed blueprint.
Return JSON only.
Preserve chapterNumber, actIndex, and function exactly.
Rewrite goal and optional milestone only.
Every goal must be concrete, unique, and anchored to named story material.`,
            user: `${langMandateText}

${blueprintContext}

ACT TO REWRITE:
${JSON.stringify({
    actIndex: act.actIndex,
    label: act.label,
    purpose: act.purpose,
    milestone: act.milestone,
    objective: blueprint.milestones.find(item => item.chapter === act.chapterEnd)?.objective || '',
}, null, 2)}

MANDATORY DIRECTIVES:
- ${directivesText}

CURRENT CHAPTER SLICE:
${JSON.stringify(currentChapterSlice, null, 2)}

SEED CHAPTER SLICE:
${JSON.stringify(sliceFallback, null, 2)}

RULES:
- preserve chapterNumber, actIndex, and function exactly as given
- keep each goal short and story-specific
- mention named anchors from the context whenever possible
- ban generic filler like hidden truth, price of victory, training, adaptation, false shelter, or central promise

Return:
{
  "chapters": [{ "chapterNumber": 1, "actIndex": 1, "function": "setup", "goal": "", "milestone": "" }]
}`,
            fallback: sliceFallback,
            schema: ZLongformBlueprintChapterPass,
            model: blueprintModel,
            temperature: 0.15,
            maxTokens: compactMode ? 1100 : 1400,
            label: `Longform Blueprint · Act ${act.actIndex}`,
            provider: blueprintProvider,
        });

        const chapterMapByNumber = new Map(chapterPass.chapters.map(entry => [entry.chapterNumber, entry]));
        blueprint = normalizeLongformBlueprint({
            ...blueprint,
            chapterMap: blueprint.chapterMap.map(entry => {
                const rewritten = chapterMapByNumber.get(entry.chapterNumber);
                if (!rewritten) return entry;
                return {
                    ...entry,
                    goal: rewritten.goal,
                    milestone: rewritten.milestone ?? entry.milestone,
                };
            }),
        }, preparedUniverse);
        emitAgentOutput({ agent: 'weaver', label: `Longform Blueprint · Act ${act.actIndex}`, status: 'done', summary: `${chapterPass.chapters.length} chapters refined` });
    }

    if (needsBlueprintRepair(blueprint)) {
        blueprint = normalizeLongformBlueprint({
            ...blueprint,
            promise: blueprint.promise.trim() === blueprint.conflictCore.trim() ? fallback.promise : blueprint.promise,
            conflictCore: blueprint.conflictCore.trim() === blueprint.protagonistFocus.trim() ? fallback.conflictCore : blueprint.conflictCore,
            protagonistFocus: blueprint.protagonistFocus.trim() === blueprint.promise.trim() ? fallback.protagonistFocus : blueprint.protagonistFocus,
            acts: blueprint.acts.map((act, index) =>
                blueprintTextHasNamedAnchor(`${act.purpose} ${act.milestone}`, anchorPool)
                    ? act
                    : fallback.acts[index]
            ),
            milestones: blueprint.milestones.map((item, index) =>
                blueprintTextHasNamedAnchor(`${item.label} ${item.objective}`, anchorPool)
                    ? item
                    : fallback.milestones[index]
            ),
            chapterMap: blueprint.chapterMap.map((entry, index) =>
                (!isGenericGoal(entry.goal) && blueprintTextHasNamedAnchor(entry.goal, anchorPool))
                    ? entry
                    : fallback.chapterMap[index]
            ),
        }, preparedUniverse);
    }

    try {
        emitAgentOutput({
            agent: 'weaver',
            label: 'Longform Blueprint',
            status: 'done',
            summary: `${blueprint.title} (${blueprint.targetChapters} chapters)`,
            detail: JSON.stringify({
                title: blueprint.title,
                logline: blueprint.logline,
                targetChapters: blueprint.targetChapters,
                acts: blueprint.acts.map(act => ({
                    actIndex: act.actIndex,
                    label: act.label,
                    chapterStart: act.chapterStart,
                    chapterEnd: act.chapterEnd,
                    milestone: act.milestone,
                })),
                chapterMapPreview: blueprint.chapterMap.slice(0, 6),
            }, null, 2),
        });
    } catch (emitError) {
        console.warn('[MythosEngine] Failed to emit final Longform Blueprint event.', emitError);
    }

    return blueprint;
};

export const runAutogenLongform = async (
    universe: Universe,
    blueprint: LongformBlueprint,
    baseParams: Omit<ChapterGenerationParams, 'chapterIndex'>,
    onProgress: (p: AutogenProgress) => void,
    signal: AbortSignal,
): Promise<Universe> => {
    const totalChapters = Math.max(15, Math.min(20, blueprint.targetChapters || 18));
    let current = {
        ...ensureUniverseDefaults(universe),
        creationMode: 'autogen_longform' as const,
        longformBlueprint: blueprint,
    };
    const compactMode = isEconomyMode(baseParams.qualityMode);

    for (let i = 0; i < totalChapters; i++) {
        if (signal.aborted) {
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }

        const chapterNumber = current.chapters.length + 1;
        const chapterMeta = getBlueprintChapterMeta(blueprint, chapterNumber);
        current = applyLongformProgress(current, blueprint, chapterNumber);

        onProgress({ chaptersDone: i, totalChapters, phase: 'director', currentUniverse: current });
        const directorGuidance = await generateDirectorGuidance(current, compactMode);
        current = applyDirectorGuidance(current, directorGuidance);

        onProgress({ chaptersDone: i, totalChapters, phase: 'weaver', currentUniverse: current });

        const { updatedUniverse } = await generateChapterWithAgents(current, {
            ...baseParams,
            chapterIndex: current.chapters.length,
            directorPrepared: true,
            longformMode: true,
            targetChapterCount: totalChapters,
            chapterFunction: chapterMeta?.function,
            actIndex: chapterMeta?.actIndex,
            milestoneFocus: chapterMeta?.milestone || chapterMeta?.goal,
            title: chapterMeta?.goal ? '' : baseParams.title,
            plotDirection: chapterMeta?.goal || baseParams.plotDirection,
        });

        current = {
            ...updatedUniverse,
            creationMode: 'autogen_longform',
            longformBlueprint: blueprint,
            longformProgress: current.longformProgress,
        };

        onProgress({
            chaptersDone: i + 1,
            totalChapters,
            phase: i === totalChapters - 1 ? 'done' : 'chronicler',
            currentUniverse: current,
        });

        if (i < totalChapters - 1 && AUTOGEN_INTER_CHAPTER_DELAY_MS > 0) {
            await wait(AUTOGEN_INTER_CHAPTER_DELAY_MS);
        }
    }

    return current;
};

export const generateStoryArc = async (
    universe: Universe,
    totalChapters: number,
    baseParams: Omit<ChapterGenerationParams, 'chapterIndex'>,
    onProgress: (p: AutogenProgress) => void,
    signal: AbortSignal,
): Promise<Universe> => {
    let current = universe;
    const compactMode = isEconomyMode(baseParams.qualityMode);

    for (let i = 0; i < totalChapters; i++) {
        if (signal.aborted) {
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }

        // ── Director — reads world state, issues per-chapter guidance ──
        onProgress({ chaptersDone: i, totalChapters, phase: 'director', currentUniverse: current });
        const directorGuidance = await generateDirectorGuidance(current, compactMode);
        current = applyDirectorGuidance(current, directorGuidance);

        onProgress({ chaptersDone: i, totalChapters, phase: 'weaver', currentUniverse: current });

        const { updatedUniverse } = await generateChapterWithAgents(current, {
            ...baseParams,
            directorPrepared: true,
        });
        current = updatedUniverse;

        onProgress({
            chaptersDone: i + 1,
            totalChapters,
            phase: i === totalChapters - 1 ? 'done' : 'chronicler',
            currentUniverse: current,
        });

        if (i < totalChapters - 1 && AUTOGEN_INTER_CHAPTER_DELAY_MS > 0) {
            await wait(AUTOGEN_INTER_CHAPTER_DELAY_MS);
        }
    }

    return current;
};

// ═══════════════════════════════════════════════════════════════════════════
// Narrative Memory Update
// ═══════════════════════════════════════════════════════════════════════════

const normalizeTitle = (s: string) => s
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an|o|a|os|as)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');

const normalizeLoopDescription = (s: string) => s
    .toLowerCase()
    .trim()
    .replace(/^(what|who|why|how|when|onde|quem|o que|por que|como|quando)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');

const isSameOpenLoop = (left: string, right: string): boolean => {
    const normLeft = normalizeLoopDescription(left);
    const normRight = normalizeLoopDescription(right);
    if (!normLeft || !normRight) {
        return false;
    }
    return normLeft === normRight || normLeft.includes(normRight) || normRight.includes(normLeft);
};

const canonicalizeCharacterIdToken = (characterId?: string): string => {
    const trimmed = characterId?.trim() || '';
    if (!trimmed || trimmed === 'id' || trimmed === 'unknown' || trimmed.startsWith('NEW_')) {
        return trimmed;
    }
    if (trimmed.includes(':')) {
        return trimmed.split(':')[0].trim();
    }
    return trimmed;
};

const canonicalizeChroniclerOutput = (universe: Universe, output: ChroniclerOutput): ChroniclerOutput => {
    const rosterByName = new Map<string, Character>();
    for (const character of universe.characters) {
        rosterByName.set(normalizeTitle(character.name), character);
        for (const alias of character.aliases ?? []) {
            rosterByName.set(normalizeTitle(alias), character);
        }
    }
    const protagonist = universe.characters[0];
    const dedupedStates = new Map<string, CharacterState>();

    for (const update of output.characterUpdates || []) {
        const rawName = update.name?.trim() || '';
        const normalizedName = normalizeTitle(rawName);
        const isNarratorPronoun = normalizedName === 'eu' || normalizedName === 'i';
        const matchedCharacter = isNarratorPronoun && protagonist
            ? protagonist
            : rosterByName.get(normalizedName);

        let characterId = canonicalizeCharacterIdToken(update.characterId);
        if (matchedCharacter) {
            characterId = matchedCharacter.id;
        } else if (!characterId || characterId === 'id' || characterId === 'unknown') {
            characterId = rawName ? `NEW_${rawName}` : '';
        }

        const canonicalName = matchedCharacter?.name || rawName;
        if (!characterId || !canonicalName) {
            continue;
        }

        const canonicalState: CharacterState = {
            ...update,
            characterId,
            name: canonicalName,
        };
        dedupedStates.set(characterId, canonicalState);
    }

    return {
        ...output,
        characterUpdates: Array.from(dedupedStates.values()),
    };
};

const applyChroniclerSideEffects = (
    universe: Universe,
    output: ChroniclerOutput,
    chapterIndex: number,
    chapterId: string,
): Universe => {
    const normalizedOutput: ChroniclerOutput = (() => {
        const existingTimeline = output.newCodex?.timeline ?? [];
        if (existingTimeline.length > 0) return output;
        const summary = output.summary?.trim() || '';
        const recentEvents = (output.recentEvents || []).map(event => event.trim()).filter(Boolean);
        if (!summary && recentEvents.length === 0) return output;

        const titleSeed = recentEvents[0] || summary.split(/[.!?]/)[0] || `CapÃ­tulo ${chapterIndex + 1}`;
        const timelineTitle = truncateText(`CapÃ­tulo ${chapterIndex + 1} â€” ${titleSeed}`, 90);
        const timelineContent = truncateText([summary, ...recentEvents.slice(0, 3)].filter(Boolean).join(' '), 260);
        if (!timelineContent) return output;

        return {
            ...output,
            newCodex: {
                factions: output.newCodex?.factions ?? [],
                rules: output.newCodex?.rules ?? [],
                timeline: [{ title: timelineTitle, content: timelineContent }],
            },
        };
    })();

    let updatedUniverse: Universe = {
        ...universe,
        codex: {
            overview: universe.codex.overview,
            factions: [...universe.codex.factions],
            rules: [...universe.codex.rules],
            timeline: [...universe.codex.timeline],
        },
    };

    applyChroniclerOutput(updatedUniverse, normalizedOutput, chapterId);
    updateNarrativeMemoryFromChronicler(updatedUniverse, normalizedOutput, chapterIndex);

    const mentionedByName = new Set((normalizedOutput.characterUpdates || []).map(cu => normalizeTitle(cu.name)));
    const currentCharacters = updatedUniverse.characters.map(character => {
        if (!mentionedByName.has(normalizeTitle(character.name)) || character.chapters.includes(chapterId)) {
            return character;
        }
        return {
            ...character,
            chapters: [...character.chapters, chapterId],
        };
    });

    const existingNames = new Set(currentCharacters.map(c => normalizeTitle(c.name)));
    const newChars: Character[] = [];
    for (const cu of normalizedOutput.characterUpdates || []) {
        const normalizedName = normalizeTitle(cu.name);
        const isNew = !cu.characterId || cu.characterId === 'id' || cu.characterId === 'unknown' || cu.characterId.startsWith('NEW_');
        if (isNew && cu.name && !existingNames.has(normalizedName)) {
            const newId = generateId();
            newChars.push({
                id: newId,
                name: cu.name,
                aliases: [],
                imageUrl: '',
                role: 'Figurante',
                faction: '',
                status: (cu.status as Character['status']) || 'Vivo',
                age: 0,
                alignment: 'Unknown',
                bio: `${cu.lastAction || ''} ${cu.emotionalState ? `— ${cu.emotionalState}` : ''}`.trim() || `Discovered in Chapter ${chapterIndex + 1}.`,
                notesPrivate: '',
                aiVisibility: DEFAULT_AI_VISIBILITY,
                tracking: { ...DEFAULT_TRACKING },
                relationships: [],
                chapters: [chapterId],
            });
            existingNames.add(normalizedName);
        }
    }

    return {
        ...updatedUniverse,
        characters: [...currentCharacters, ...newChars],
    };
};

const applyChroniclerOutput = (universe: Universe, output: ChroniclerOutput, chapterId?: string): void => {
    const codex = output.newCodex;
    if (!codex) return;

    // Deduplicate by normalized title across the entire codex, not just within one bucket.
    const knownTitles = new Set([
        ...universe.codex.factions.map(f => normalizeTitle(f.title)),
        ...universe.codex.rules.map(r => normalizeTitle(r.title)),
        ...universe.codex.timeline.map(t => normalizeTitle(t.title)),
    ]);

    const takeIfUnknown = <T extends { title: string }>(entries: T[]): T[] => {
        const accepted: T[] = [];
        for (const entry of entries || []) {
            const normalized = normalizeTitle(entry.title);
            if (!normalized || knownTitles.has(normalized)) {
                continue;
            }
            accepted.push(entry);
            knownTitles.add(normalized);
        }
        return accepted;
    };

    const newFactions = takeIfUnknown(codex.factions || []);
    const newRules = takeIfUnknown(codex.rules || []);
    const newTimeline = takeIfUnknown(codex.timeline || []);

    if (newFactions.length) universe.codex.factions.push(...newFactions.map(f => ensureCodexEntryDefaults({
        id: generateId(),
        ...f,
        relatedEntityIds: inferRelatedEntityIds(universe, `${f.title} ${f.content}`),
        truth: createTruthBundle(`faction:${normalizeTitle(f.title)}`, f.content, chapterId, truncateText(f.content, 180)),
    })));
    if (newRules.length) universe.codex.rules.push(...newRules.map(r => ensureCodexEntryDefaults({
        id: generateId(),
        ...r,
        ruleKind: inferRuleEntryKind(r.title, r.content),
        relatedEntityIds: inferRelatedEntityIds(universe, `${r.title} ${r.content}`),
        truth: createTruthBundle(`rule:${normalizeTitle(r.title)}`, r.content, chapterId, truncateText(r.content, 180)),
    })));
    if (newTimeline.length) universe.codex.timeline.push(...newTimeline.map(t => ensureCodexEntryDefaults({
        id: generateId(),
        ...t,
        eventState: inferTimelineEventState(t.title, t.content),
        discoveryKind: inferTimelineDiscoveryKind(t.title, t.content),
        timelineImpact: inferTimelineImpact(t.title, t.content),
        timelineScope: inferTimelineScope(t.title, t.content),
        relatedEntityIds: inferRelatedEntityIds(universe, `${t.title} ${t.content}`),
        truth: createTruthBundle(`timeline:${normalizeTitle(t.title)}`, t.content, chapterId, truncateText(t.content, 180)),
    })));
};

const updateNarrativeMemoryFromChronicler = (
    universe: Universe,
    output: ChroniclerOutput,
    chapterIndex: number,
): void => {
    const prev = universe.narrativeMemory;

    // Character states — merge: new updates overwrite existing by characterId
    const prevStates = prev?.characterStates || [];
    const stateMap = new Map(prevStates.map(s => [s.characterId, s]));
    for (const upd of output.characterUpdates || []) {
        stateMap.set(upd.characterId, upd);
    }

    // Open loops — merge: add new, mark resolved
    const prevLoops = prev?.openLoops || [];
    const resolvedSet = new Set(output.resolvedLoopIds || []);
    const mergedLoops: OpenLoop[] = prevLoops.map(l =>
        resolvedSet.has(l.id) ? { ...l, resolved: chapterIndex } : l
    );
    for (const nl of output.newOpenLoops || []) {
        const alreadyTracked = mergedLoops.some(loop => isSameOpenLoop(loop.description, nl.description));
        if (!alreadyTracked) {
            mergedLoops.push({ id: generateId(), description: nl.description, introduced: chapterIndex });
        }
    }

    // Recent events — keep last 5
    const prevRecent = prev?.recentEvents || [];
    const allRecent = [...prevRecent, ...(output.recentEvents || [])];
    const recentEvents = allRecent.slice(-5);

    // Global summary — replace with the latest
    const globalSummary = output.summary || prev?.globalSummary || '';

    // Accumulate global banned words — merge new overuse into the arc plan's list (cap at 30)
    universe.narrativeMemory = {
        lastChapterIndex: chapterIndex,
        globalSummary,
        characterStates: Array.from(stateMap.values()),
        openLoops: mergedLoops,
        recentEvents,
        newCodexEntries: output.newCodex || { factions: [], rules: [], timeline: [] },
        lastAuditFlags: output.auditFlags ?? prev?.lastAuditFlags,
        lexicalCooldownGuidance: prev?.lexicalCooldownGuidance,
        lieStates: prev?.lieStates,
        lexicalCooldown: prev?.lexicalCooldown,  // preserved — Director manages expiry each chapter
        stylePatternCooldown: prev?.stylePatternCooldown,
        directorGuidance: prev?.directorGuidance,  // preserved — Director updates it each chapter
    };
};

/**
 * Exported for App.tsx \u2014 identity function kept for API compat.
 * The real memory update happens inside generateChapterWithAgents.
 */
export const updateNarrativeMemory = (universe: Universe): Universe => universe;

// ═══════════════════════════════════════════════════════════════════════════
// Remaining public API
// ═══════════════════════════════════════════════════════════════════════════

export const generateCharacter = async (universeName: string, lang?: 'pt' | 'en'): Promise<Character> => {
    const langMandateText = langMandate(lang ?? 'pt');
    const data = await chatJson<Partial<Character>>({
        user: `
        ${langMandateText}
        Generate a character for the universe "${universeName}".
        Return only valid JSON with this exact shape:
        {
          "name": "Character name",
          "role": "Protagonista",
          "faction": "Faction name",
          "age": 25,
          "alignment": "Alignment",
          "bio": "Detailed biography"
        }
        `,
        fallback: {},
    });

    const fallbackName = data.name || 'Unknown Hero';

    return {
        id: generateId(),
        name: fallbackName,
        aliases: [],
        imageUrl: createPortraitUrl({
            name: fallbackName,
            role: String(data.role || 'Coadjuvante'),
            faction: (data.faction || '').trim(),
            seed: `${fallbackName}|${data.bio || ''}`,
            size: 768,
        }),
        role: (data.role as Character['role']) || 'Coadjuvante',
        faction: (data.faction || '').trim(),
        status: 'Vivo',
        age: data.age || 25,
        alignment: data.alignment || 'Neutro',
        bio: data.bio || 'Uma figura misteriosa.',
        notesPrivate: '',
        aiVisibility: DEFAULT_AI_VISIBILITY,
        tracking: { ...DEFAULT_TRACKING },
        relationships: [],
        chapters: [],
    };
};

export const suggestNextChapterPlot = async (universe: Universe, chapterIndex?: number): Promise<{ title: string, plot: string, activeCharacters: string[] }> => {
    const preparedUniverse = await prepareUniverseForManualDirection(universe);
    const memoryCtx = buildMemoryContext(preparedUniverse, chapterIndex);
    const worldContext = buildUniverseContext(preparedUniverse, { relatedEntityIds: preparedUniverse.characters.map(character => character.id), maxTimeline: 4 });
    const weaverPrompt = getAgentPrompt(preparedUniverse, 'weaver');
    const langMandateText = langMandate(preparedUniverse.lang ?? 'pt');
    const profileCtx = buildProfileContext(preparedUniverse.storyProfile);

    const result = await chatJson<{
        title?: string;
        plot?: string;
        suggestedCharacterIds?: string[];
    }>({
        system: `
        ${weaverPrompt}

        Your task is to devise the plan for the next chapter.
        Do not write the chapter content. Write only the title and the plot summary.
        Analyze the narrative memory to ensure causality.
        If the previous chapter ended on a cliffhanger, resolve it or complicate it.
        If it is a new story, suggest an inciting incident.
        Pay attention to open plot threads — address or complicate at least one.
        `,
        user: `
        ${langMandateText}
        ${profileCtx}
        ${worldContext}
        ${memoryCtx}

        === DIRECTOR GUIDANCE ===
        Narrative Pressure: ${preparedUniverse.narrativeMemory?.directorGuidance?.narrativePressure || 'Keep escalation coherent and avoid rush.'}
        Character Focus: ${preparedUniverse.narrativeMemory?.directorGuidance?.characterFocus || 'Keep the protagonist active.'}
        Loop Priority: ${preparedUniverse.narrativeMemory?.directorGuidance?.loopPriority || 'Advance the most urgent unresolved thread.'}
        Thematic Constraint: ${preparedUniverse.narrativeMemory?.directorGuidance?.thematicConstraint || 'Let consequence and theme press into each scene.'}

        ACTIVE CHARACTERS:
        ${buildCompactCharacterList(preparedUniverse)}

        Return only valid JSON with this exact shape:
        {
          "title": "Chapter title",
          "plot": "What happens in the next chapter",
          "suggestedCharacterIds": ["id1", "id2"]
        }
        `,
        fallback: {},
        temperature: 0.5,
        label: 'Weaver · Sugestão',
    });

    return {
        title: result.title || 'New Chapter',
        plot: result.plot || 'The story continues...',
        activeCharacters: result.suggestedCharacterIds || []
    };
};

// ═══════════════════════════════════════════════════════════════════════════
// BVSR — Generate 3 divergent Weaver plans in parallel for user selection
// ═══════════════════════════════════════════════════════════════════════════

export const generateWeaverPlans = async (
    universe: Universe,
    params: ChapterGenerationParams,
): Promise<WeaverPlan[]> => {
    const preparedUniverse = await prepareUniverseForManualDirection(universe, params.qualityMode);
    const memoryCtx = buildMemoryContext(preparedUniverse, params.chapterIndex);
    const worldContext = buildUniverseContext(preparedUniverse, { relatedEntityIds: deriveContextEntityIds(preparedUniverse, params.activeCharacterIds), maxTimeline: 4 });
    const profileCtx = buildProfileContext(preparedUniverse.storyProfile);
    const langMandateText = langMandate(params.lang ?? preparedUniverse.lang ?? 'pt');
    const weaverPrompt = getAgentPrompt(preparedUniverse, 'weaver');

    const systemPrompt = `${weaverPrompt}

You are planning the structure of a single chapter.
CRITICAL CONTINUITY RULES:
- The chapter MUST directly continue from where the previous chapter ended.
- If there is a cliffhanger or open plot thread, it MUST be addressed or actively developed.
- The POV character must remain consistent with the established protagonist unless the plot explicitly requires a change.
- Do NOT reset to a new status quo — the previous chapter's consequences carry forward.
The FORMAT_SPEC in the profile tells you how many scenes fit in a chapter.
Output a structured plan — do NOT write prose.
CONCISION MANDATE: Each "beat" field must be ONE sentence, maximum 20 words. No elaboration.
COMPLETENESS MANDATE:
- You MUST fill chapterTitle, scenes, chapterSummary, and endHook.
- chapterSummary must be a full paragraph with at least 2 complete sentences.
- endHook must be a full sentence that creates immediate forward pull.
- scenes must contain at least 5 beats.
- Never leave summary or hook blank.`;

    const userPrompt = `
        ${langMandateText}
        ${profileCtx}
        ${worldContext}
        ${memoryCtx}

        === DIRECTOR GUIDANCE ===
        Narrative Pressure: ${preparedUniverse.narrativeMemory?.directorGuidance?.narrativePressure || 'Keep escalation coherent and avoid rush.'}
        Character Focus: ${preparedUniverse.narrativeMemory?.directorGuidance?.characterFocus || 'Keep the protagonist active.'}
        Faction Pressure: ${preparedUniverse.narrativeMemory?.directorGuidance?.factionPressure || 'Keep the world politically alive.'}
        Loop Priority: ${preparedUniverse.narrativeMemory?.directorGuidance?.loopPriority || 'Advance the most urgent unresolved thread.'}
        Thematic Constraint: ${preparedUniverse.narrativeMemory?.directorGuidance?.thematicConstraint || 'Let consequence and theme press into each scene.'}

        === ASSIGNMENT ===
        Title/Idea: "${params.title}"
        Plot Direction: "${params.plotDirection}"
        Tone: ${params.tone}
        Focus: ${params.focus}

        ACTIVE CHARACTERS:
        ${buildCompactCharacterList(preparedUniverse)}

        Return only valid JSON:
        {
          "chapterTitle": "Title for this chapter",
          "scenes": [
            { "beat": "What happens", "characters": ["Character Name"], "tension": "rising/peak/falling" }
          ],
          "chapterSummary": "One paragraph summary of the whole chapter",
          "endHook": "The cliffhanger or question that pulls the reader to the next chapter"
        }
        All 4 fields are mandatory. If you are unsure, infer the missing parts from the chapter logic instead of leaving them empty.
        `;

    const normalizePlan = (plan: Partial<WeaverPlan> | null | undefined, fallbackLabel: string): WeaverPlan => {
        const safeScenes = Array.isArray(plan?.scenes)
            ? plan!.scenes
                .filter(scene => scene && typeof scene.beat === 'string' && scene.beat.trim().length > 0)
                .map(scene => ({
                    beat: scene.beat.trim(),
                    characters: Array.isArray(scene.characters) ? scene.characters.filter(Boolean) : [],
                    tension: typeof scene.tension === 'string' && scene.tension.trim().length > 0 ? scene.tension.trim() : 'rising',
                }))
            : [];

        const inferredSummary = safeScenes.length > 0
            ? safeScenes.map(scene => scene.beat).slice(0, 3).join(' ')
            : params.plotDirection.trim();
        const inferredHook = safeScenes.length > 0
            ? safeScenes[safeScenes.length - 1].beat
            : params.plotDirection.trim();

        return {
            chapterTitle: plan?.chapterTitle?.trim() || params.title.trim() || fallbackLabel,
            scenes: safeScenes,
            chapterSummary: plan?.chapterSummary?.trim() || inferredSummary || (params.lang === 'en' ? 'The chapter develops the chosen conflict and pushes the protagonist into a harder next move.' : 'O capítulo desenvolve o conflito escolhido e empurra o protagonista para um próximo movimento mais difícil.'),
            endHook: plan?.endHook?.trim() || inferredHook || (params.lang === 'en' ? 'The chapter ends with a new threat already in motion.' : 'O capítulo termina com uma nova ameaça já em movimento.'),
        };
    };

    const needsRepair = (plan: WeaverPlan) =>
        !plan.chapterTitle.trim() ||
        plan.scenes.length < 3 ||
        plan.chapterSummary.trim().length < 60 ||
        plan.endHook.trim().length < 24;

    const weaverPlannerProvider: 'cerebras' = 'cerebras';
    const weaverPlannerModel = CEREBRAS_WEAVER_MODEL;

    const repairPlan = async (plan: WeaverPlan, fallbackLabel: string): Promise<WeaverPlan> => {
        const repaired = await chatJson<WeaverPlan>({
            system: `${systemPrompt}

You are repairing an incomplete chapter plan.
Keep the same premise, but fill any missing or weak fields so the plan becomes fully usable.
Return valid JSON only.`,
            user: `${userPrompt}

INCOMPLETE PLAN TO REPAIR:
${JSON.stringify(plan, null, 2)}

Repair it now. Keep the same title direction, but make the summary and hook complete and ensure there are at least 5 useful beats.`,
            fallback: plan,
            model: weaverPlannerModel,
            temperature: 0.35,
            label: `${fallbackLabel} · Repair`,
            maxTokens: 800,
            provider: weaverPlannerProvider,
        });

        return normalizePlan(repaired, fallbackLabel);
    };

    // Three calls with increasing temperature to force creative divergence
    const configs = [
        { temperature: 0.45, label: 'Weaver · Plano A' },
        { temperature: 0.65, label: 'Weaver · Plano B' },
        { temperature: 0.82, label: 'Weaver · Plano C' },
    ];

    emitAgentOutput({ agent: 'weaver', label: 'Weaver · BVSR (3 planos)', status: 'thinking' });
    const normalized: WeaverPlan[] = [];
    for (let index = 0; index < configs.length; index++) {
        const { temperature, label } = configs[index];
        const fallbackLabel = label.split(' ?? ')[1] || `Plan ${index + 1}`;
        const result = await chatJson<WeaverPlan>({
            system: systemPrompt,
            user: userPrompt,
            fallback: { chapterTitle: fallbackLabel, scenes: [], chapterSummary: '', endHook: '' },
            model: weaverPlannerModel,
            temperature,
            label,
            maxTokens: 800,
            provider: weaverPlannerProvider,
        });
        const plan = normalizePlan(result, fallbackLabel);
        normalized.push(needsRepair(plan) ? await repairPlan(plan, fallbackLabel) : plan);

        if (index < configs.length - 1 && WEAVER_PLAN_STAGGER_MS > 0) {
            await wait(WEAVER_PLAN_STAGGER_MS);
        }
    }

    emitAgentOutput({ agent: 'weaver', label: 'Weaver · BVSR (3 planos)', status: 'done', summary: `${normalized.filter(p => p?.chapterTitle).length} planos gerados` });

    return normalized.filter((p): p is WeaverPlan => Boolean(p?.chapterTitle));
};

/** @deprecated — absorbed by Pass 3 automatic extraction. Kept for backward compat. */
export const extractLoreFromChapter = async (chapter: Chapter, universe: Universe): Promise<{ newRules: CodexEntry[], newFactions: CodexEntry[] }> => {
    const context = buildUniverseContext(universe);
    const chroniclerPrompt = getAgentPrompt(universe, 'chronicler');
    const langMandateText = langMandate(universe.lang ?? 'pt');

    const data = await chatJson<{
        newRules?: Array<{ title: string; content: string }>;
        newFactions?: Array<{ title: string; content: string }>;
    }>({
        system: chroniclerPrompt,
        user: `
        ${langMandateText}
        EXISTING CODEX:
        ${context}

        NEW CHAPTER:
        ${chapter.content}

        Return only valid JSON with this exact shape:
        {
          "newRules": [{ "title": "Name of rule/magic/location", "content": "Description" }],
          "newFactions": [{ "title": "Name of group", "content": "Description" }]
        }
        If nothing new is found, return empty arrays.
        `,
        fallback: {},
    });

    return {
        newRules: (data.newRules || []).map((r) => ({ id: generateId(), ...r })),
        newFactions: (data.newFactions || []).map((f) => ({ id: generateId(), ...f }))
    };
};

export const reviewChapterWithArbiter = async (chapter: Chapter, universe: Universe): Promise<ArbiterIssue[]> => {
    const codexContext = buildUniverseContext(universe);
    const arbiterPrompt = getAgentPrompt(universe, 'arbiter');

    // Build character roster with alive/dead status
    const characterRoster = universe.characters.length > 0
        ? universe.characters.map(c =>
            `- ${c.name} [${c.status}] | Role: ${c.role} | Faction: ${c.faction}`
          ).join('\n')
        : 'No characters registered.';

    // Build character memory states if available
    const mem = universe.narrativeMemory;
    const memoryBlock = mem
        ? `NARRATIVE MEMORY — Character States:
${mem.characterStates.map(cs =>
    `- ${cs.name} [${cs.status}]${cs.location ? ` @ ${cs.location}` : ''}${cs.emotionalState ? ` | mood: ${cs.emotionalState}` : ''}${cs.lastAction ? ` | last action: ${cs.lastAction}` : ''}`
).join('\n')}

OPEN PLOT LOOPS (unresolved threads):
${mem.openLoops.filter(l => !l.resolved).map(l => `- [introduced Ch.${l.introduced + 1}] ${l.description}`).join('\n') || 'None.'}

RECENT EVENTS:
${mem.recentEvents.join('\n') || 'None.'}`
        : 'No narrative memory recorded yet.';

    // Build story history
    const chapterIdx = universe.chapters.findIndex(c => c.id === chapter.id);
    const prevChapters = chapterIdx > 0
        ? universe.chapters.slice(0, chapterIdx).map((c, i) =>
            `Chapter ${i + 1} [${c.title}]: ${c.summary}${c.endHook ? ` | Ends on: ${c.endHook}` : ''}`
          ).join('\n')
        : 'This is the first chapter.';

    const data = await chatJson<{ issues?: ArbiterIssue[] }>({
        system: arbiterPrompt,
        user: `
=== WORLD CODEX ===
${codexContext}

=== CHARACTER ROSTER (with alive/dead status) ===
${characterRoster}

=== STORY HISTORY (previous chapters) ===
${prevChapters}

=== NARRATIVE MEMORY ===
${memoryBlock}

=== CHAPTER TO REVIEW: "${chapter.title}" ===
${chapter.content}

Return ONLY valid JSON with this exact shape — no prose outside the JSON:
{
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "type": "continuity" | "pacing" | "character" | "magic_rule" | "timeline" | "logic",
      "description": "Clear explanation of the problem and what specifically in the text caused it.",
      "suggestion": "Specific actionable fix to resolve this issue in the rewrite."
    }
  ]
}
If no real issues are found, return { "issues": [] }.`,
        fallback: {},
        label: 'Arbiter · Revisão',
    });

    return (data.issues || []).filter(
        (i): i is ArbiterIssue =>
            typeof i === 'object' && i !== null &&
            typeof i.description === 'string' && i.description.trim().length > 0
    );
};

export const rewriteChapterBySuggestions = async (
    chapter: Chapter,
    issues: ArbiterIssue[],
    universe: Universe
): Promise<string> => {
    const worldCtx = buildUniverseContext(universe);
    const memCtx = buildMemoryContext(universe, universe.chapters.findIndex(c => c.id === chapter.id));
    const bardPrompt = getAgentPrompt(universe, 'bard');

    const issueList = issues.map((issue, i) =>
        `${i + 1}. [${issue.severity.toUpperCase()} / ${issue.type}] ${issue.description}\n   FIX: ${issue.suggestion}`
    ).join('\n\n');

    const prose = await chat({
        system: bardPrompt,
        user: `You are rewriting an existing chapter to fix specific narrative issues identified by the Arbiter.
Preserve the story events, characters, and chapter title. Rewrite the full chapter prose — do not summarize.

=== WORLD CONTEXT ===
${worldCtx}

=== NARRATIVE MEMORY ===
${memCtx}

=== ISSUES TO FIX (apply ALL of them) ===
${issueList}

=== ORIGINAL CHAPTER: "${chapter.title}" ===
${chapter.content}

Write the full rewritten chapter below. Output continuous prose only — no headers, no numbered sections, no preamble, no closing remarks.`,
        label: 'Bard · Reescrita',
        provider: getPreferredHighCapabilityProvider(),
    }).catch(() => chapter.content);

    return stripLLMPrefixes(prose);
};

export const generateLongformGenesisBase = async (
    profile: StoryProfile,
    onProgress: (step: string) => void,
    lang?: 'pt' | 'en',
    qualityMode: GenerationQualityMode = 'economy'
): Promise<Universe> => {
    const profileWithLang = lang ? { ...profile, lang } : profile;
    const effectiveLang = lang ?? (profile as StoryProfile & { lang?: string }).lang ?? 'pt';
    const skeletonIdea: UniverseIdea = { name: '', description: '', profile: { ...profileWithLang, lang: effectiveLang as 'pt' | 'en' } };
    const compactMode = isEconomyMode(qualityMode);
    const profileCtx = buildProfileContext(skeletonIdea.profile, compactMode);
    const langMandateText = langMandate(effectiveLang);
    const hasPremise = !!(skeletonIdea.profile?.premise?.trim());
    const factionSeed = !hasPremise ? pickFactionArchetypes(compactMode ? 2 : 3).map(h => `- ${h}`).join('\n') : '';
    const bgSeed = !hasPremise ? pickBackground() : '';
    const premiseLock = hasPremise
        ? '\nPREMISE LOCK ? NON-NEGOTIABLE: ALL world structure, factions, title, setting, conflict, and protagonist MUST derive directly from the user premise. Literary influences and tone are STYLE parameters ? they shape HOW the premise is told, not WHAT is invented.\n'
        : '';

    let uni: Universe = {
        id: generateId(),
        name: '',
        description: '',
        lastGenerated: new Date().toISOString(),
        lang: effectiveLang,
        codex: { overview: '', timeline: [], factions: [], rules: [] },
        characters: [],
        chapters: [],
        assets: { visual: [], sound: [] },
        agentConfigs: {},
        storyProfile: skeletonIdea.profile,
    };

    onProgress('anchors');
    const stepLabel = 'Architect · Universo e Ancoras';
    emitAgentOutput({ agent: 'architect', label: stepLabel, status: 'thinking' });
    const architectPrompt = getAgentPrompt(uni, 'architect', compactMode);
    const anchorData = await chatJson<{
        name?: string;
        description?: string;
        overview?: string;
        setting?: string;
        settingBelief?: string;
        settingMyth?: string;
        conflict?: string;
        conflictBelief?: string;
        conflictMyth?: string;
        factions?: Array<{ title: string; content: string; belief?: string; myth?: string }>;
    }>({
        system: architectPrompt,
        user: effectiveLang === 'en' ? `
${langMandateText}
${profileCtx}
${premiseLock}
You are creating a new fictional universe from scratch.
Invent a unique, high-concept universe idea that perfectly suits the Story Profile, then immediately define its minimal anchors.
Do NOT over-specify ? the world will emerge from the prose.
TITLE RULES ? "name" is the TITLE OF THE LITERARY WORK (book/light novel/serial), not a planet or place name.
Choose whatever title structure best fits the work ? single evocative words, phrases, questions, poetic fragments, verb-led titles are all valid.
Examples of fitting structures (not obligatory): "Shadows of the Dead", "Ashes", "The Architect of Chaos", "Cold Blood", "Who Keeps the Fire"
FORBIDDEN: a single invented proper noun used as a world/planet name ("Valdur", "Aetheria", "Eldoria"), "The Kingdom of X", "The World of Y".
Return only valid JSON:
{
  "name": "Literary work title",
  "description": "Evocative 25-30 word description capturing tone and themes",
  "overview": "One paragraph setting atmosphere and central tension",
  "setting": "Specific location where Chapter 1 takes place",
  "conflict": "The inciting tension or threat driving the opening",
  "factions": [{ "title": "Faction name (invented proper noun, not a genre label)", "content": "What the faction controls + what it structurally needs + who it structurally conflicts with (competing needs, not moral opposition)", "belief": "Optional: what insiders or nearby characters believe about this faction", "myth": "Optional: the city's rumor, propaganda, or sacred story about this faction" }],
  "settingBelief": "Optional: what locals believe or fear about the opening location",
  "settingMyth": "Optional: the folklore or public narrative surrounding the opening location",
  "conflictBelief": "Optional: how characters misread or emotionally frame the opening conflict",
  "conflictMyth": "Optional: the official, ritual, or cultural version of the opening conflict"
}
${factionSeed ? `FACTION STRUCTURE SEED (use these power structures ? invent proper names, do NOT copy verbatim):\n${factionSeed}\nGenerate 2-3 factions in structural tension. Avoid protagonist's side vs antagonist's side framing.` : 'Generate 2-3 factions that emerge from the user premise. Factions must compete for the specific resources or power the premise makes relevant.'}
`
: `
${langMandateText}
${profileCtx}
${premiseLock}
Voc? est? criando um universo ficcional do zero.
Invente uma ideia de universo ?nica e de alto conceito que se encaixe perfeitamente no Perfil da Hist?ria, e ent?o defina suas ?ncoras m?nimas.
N?O especifique demais ? o mundo emergir? da prosa.
REGRAS DO T?TULO ? "name" ? o T?TULO DA OBRA LITER?RIA (livro/light novel/serial), n?o o nome de um planeta ou lugar.
Escolha a estrutura de t?tulo que melhor encaixar na obra ? palavras ?nicas evocativas, frases, perguntas, fragmentos po?ticos, t?tulos com verbo, tudo ? v?lido.
Exemplos de boas estruturas (n?o obrigat?rias): "As Sombras da Morte", "Cinzas", "O Arquiteto do Caos", "Sangue Frio", "Quem Guarda o Fogo"
PROIBIDO: um ?nico substantivo pr?prio inventado como nome de mundo/planeta ("Valdur", "Aetheria", "Eldoria"), "O Reino de X", "O Mundo de Y".
Retorne apenas JSON v?lido:
{
  "name": "T?tulo da obra liter?ria",
  "description": "Descri??o evocativa de 25-30 palavras capturando tom e temas",
  "overview": "Um par?grafo definindo atmosfera e tens?o central",
  "setting": "Local espec?fico onde o Cap?tulo 1 acontece",
  "conflict": "A tens?o incitante ou amea?a que impulsiona a abertura",
  "factions": [{ "title": "Nome da fac??o (substantivo pr?prio inventado, n?o r?tulo de g?nero)", "content": "O que a fac??o controla + o que ela estruturalmente precisa + com quem conflita (necessidades concorrentes, n?o oposi??o moral)", "belief": "Opcional: o que membros ou v?timas acreditam sobre esta fac??o", "myth": "Opcional: o rumor, propaganda ou narrativa sagrada sobre esta fac??o" }],
  "settingBelief": "Opcional: o que os locais acreditam ou temem sobre o cen?rio inicial",
  "settingMyth": "Opcional: o folclore ou narrativa p?blica sobre o cen?rio inicial",
  "conflictBelief": "Opcional: como os personagens interpretam errado ou emocionalmente o conflito inicial",
  "conflictMyth": "Opcional: a vers?o oficial, ritual ou cultural do conflito inicial"
}
${factionSeed ? `FACTION STRUCTURE SEED (use estas estruturas de poder ? invente nomes pr?prios, N?O copie verbatim):\n${factionSeed}\nGere 2-3 fac??es em tens?o estrutural.` : 'Gere 2-3 fac??es que emergem da premissa do usu?rio. As fac??es devem competir pelos recursos espec?ficos relevantes ? premissa.'}
`,
        fallback: {},
        temperature: 0.5,
        label: stepLabel,
        maxTokens: compactMode ? 1600 : 2000,
        provider: 'cerebras',
    });

    if (anchorData.name) {
        uni.name = anchorData.name;
        uni.description = anchorData.description || anchorData.name;
    }

    emitAgentOutput({ agent: 'architect', label: stepLabel, status: 'done', summary: anchorData.overview?.slice(0, 120) || (anchorData.name ?? 'Ancoras criadas'), detail: JSON.stringify(anchorData, null, 2) });

    uni.codex.overview = anchorData.overview || uni.description;
    uni.codex.factions = (anchorData.factions || []).map(x => ensureCodexEntryDefaults({
        id: generateId(),
        title: x.title,
        content: x.content,
        truth: createLayeredTruthBundle(`faction:${normalizeTitle(x.title)}`, x.content, { belief: x.belief, myth: x.myth }),
    }));

    if (anchorData.setting) {
        uni.codex.rules.push(ensureCodexEntryDefaults({
            id: generateId(),
            title: 'Initial Setting',
            content: anchorData.setting,
            aliases: ['Abertura', 'Cenario inicial'],
            aiVisibility: 'global',
            truth: createLayeredTruthBundle('rule:initial-setting', anchorData.setting, { belief: anchorData.settingBelief, myth: anchorData.settingMyth }),
        }));
    }
    if (anchorData.conflict) {
        uni.codex.rules.push(ensureCodexEntryDefaults({
            id: generateId(),
            title: 'Central Conflict',
            content: anchorData.conflict,
            aliases: ['Conflito central'],
            aiVisibility: 'global',
            truth: createLayeredTruthBundle('rule:central-conflict', anchorData.conflict, { belief: anchorData.conflictBelief, myth: anchorData.conflictMyth }),
        }));
    }

    onProgress('characters');
    emitAgentOutput({ agent: 'soulforger', label: 'Soulforger · Protagonista', status: 'thinking' });
    const soulforgerPrompt = getAgentPrompt(uni, 'soulforger', compactMode);
    const factionsList = uni.codex.factions.map(f => f.title).join(', ');
    const protData = await chatJson<{
        name?: string;
        aliases?: string[];
        role?: Character['role'];
        faction?: string;
        bio?: string;
        age?: number;
        alignment?: string;
        ghost?: string;
        lie?: string;
    }>({
        system: soulforgerPrompt,
        user: effectiveLang === 'en' ? `
${langMandateText}
${profileCtx}
Universe: "${uni.name}" ? ${uni.codex.overview}
Factions: ${factionsList}

Create ONE protagonist. Include their Ghost (past trauma) and Lie (misconception about the world).
${bgSeed ? `BACKGROUND SEED (use this social position as starting point ? invent all names and details):\n${bgSeed}` : "Derive the protagonist's background and social position directly from the user premise and the world factions above."}
Return only valid JSON:
{
  "name": "Name",
  "aliases": ["Nickname or in-world title"],
  "role": "Protagonista",
  "faction": "Faction name",
  "bio": "2-sentence biography including Ghost and Lie",
  "age": 30,
  "alignment": "Alignment",
  "ghost": "A specific past DECISION the character made that caused harm ? not something that happened to them passively",
  "lie": "A specific falsifiable belief that creates friction with trustworthy characters in this story"
}
`
: `
${langMandateText}
${profileCtx}
Universo: "${uni.name}" ? ${uni.codex.overview}
Fac??es: ${factionsList}

Crie UM protagonista. Inclua o Ghost (trauma do passado) e a Lie (vis?o equivocada do mundo).
${bgSeed ? `BACKGROUND SEED (use esta posi??o social como ponto de partida ? invente todos os nomes e detalhes):\n${bgSeed}` : 'Derive o background e posi??o social do protagonista diretamente da premissa do usu?rio e das fac??es do mundo acima.'}
Retorne apenas JSON v?lido:
{
  "name": "Nome",
  "aliases": ["Apelido ou titulo usado no mundo"],
  "role": "Protagonista",
  "faction": "Nome da fac??o",
  "bio": "Biografia de 2 frases incluindo Ghost e Lie",
  "age": 30,
  "alignment": "Alinhamento",
  "ghost": "Uma DECIS?O espec?fica do passado que o personagem tomou e causou dano ? n?o algo que aconteceu com ele passivamente",
  "lie": "Uma cren?a espec?fica e falsific?vel que cria conflito com personagens dignos de confian?a nesta hist?ria"
}
`,
        fallback: {},
        temperature: 0.5,
        label: 'Soulforger · Protagonista',
        maxTokens: compactMode ? 1400 : 1800,
        provider: 'cerebras',
    });

    emitAgentOutput({ agent: 'soulforger', label: 'Soulforger · Protagonista', status: 'done', summary: protData.name || 'Protagonista criado sem nome — veja detail', detail: JSON.stringify(protData, null, 2) });

    const protName = protData.name || (effectiveLang === 'en' ? 'Unknown Hero' : 'Her?i Desconhecido');
    uni.characters.push({
        id: generateId(),
        name: protName,
        aliases: normalizeAliasList(protData.aliases),
        role: protData.role || 'Protagonista',
        faction: (protData.faction || '').trim(),
        age: protData.age || 25,
        alignment: protData.alignment || 'N/A',
        bio: protData.bio || (effectiveLang === 'en' ? 'A mysterious figure.' : 'Uma figura misteriosa.'),
        ghost: protData.ghost,
        coreLie: protData.lie,
        status: 'Vivo',
        notesPrivate: '',
        aiVisibility: 'global',
        tracking: { ...DEFAULT_TRACKING },
        relationships: [],
        chapters: [],
        imageUrl: createPortraitUrl({
            name: protName,
            role: protData.role || 'Protagonista',
            faction: (protData.faction || '').trim(),
            seed: `${protName}|${protData.bio || ''}`,
            size: 768,
        }),
    });

    return ensureUniverseDefaults(uni);
};

export const generateDivineGenesis = async (
    profile: StoryProfile,
    onProgress: (step: string) => void,
    lang?: 'pt' | 'en',
    qualityMode: GenerationQualityMode = 'balanced'
): Promise<Universe> => {
    const profileWithLang = lang ? { ...profile, lang } : profile;
    const effectiveLang = lang ?? (profile as StoryProfile & { lang?: string }).lang ?? 'pt';
    // Skeleton idea — Step 1 of genesis generates name + anchors in a single merged call
    const skeletonIdea: UniverseIdea = { name: '', description: '', profile: { ...profileWithLang, lang: effectiveLang as 'pt' | 'en' } };
    return generateFullUniverseGenesis(skeletonIdea, onProgress, qualityMode);
};

export const generateImage = async (prompt: string): Promise<VisualAsset> => {
    return {
        id: generateId(),
        url: buildImagePlaceholder(prompt, 'Mythos Engine Placeholder'),
        prompt,
        type: 'concept',
        relatedTo: 'General',
    };
};
