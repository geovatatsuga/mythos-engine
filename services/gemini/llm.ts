import OpenAI from "openai";
import { loadApiKeys } from '../../utils/apiKeys';
import { z } from "zod";
import type {
    Universe, Character, Chapter, VisualAsset, UniverseIdea,
    ChapterGenerationParams, CodexEntry, StoryProfile, StoryFormat,
    NarrativeMemory, CharacterState, OpenLoop, OpeningStyle, ArbiterIssue,
    TokenUsageEvent, AgentOutputEvent, AgentOutputStatus, WeaverPlan, GenerationQualityMode,
    DirectorGuidance, AIVisibility, DirtyScope, SyncMeta, TrackingConfig, TruthBundle, CharacterLieState, TimelineEventState, TimelineDiscoveryKind, RuleEntryKind, TimelineImpact, TimelineScope,
    LongformBlueprint, LongformProgressState, LongformChapterFunction,
} from '../../types';
import { DEFAULT_AGENTS } from '../../constants';
import { createPortraitUrl } from '../../utils/portraits';
import {
    DEFAULT_AI_VISIBILITY,
    DEFAULT_TRACKING,
    buildTrackedTerms,
    containsTrackedTerm,
    createLayeredTruthBundle,
    createTruthBundle,
    markTruthForReview,
    normalizeAliasList,
    normalizeTitle,
} from './canon';
import {
    emitAgentOutput as emitAgentOutputEvent,
    emitUsage,
    subscribeToAgentOutput,
    subscribeToTokenUsage,
} from './pubsub';

export { subscribeToAgentOutput, subscribeToTokenUsage };

// â”€â”€â”€ Token Usage Pub/Sub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ Agent Output Pub/Sub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const emitAgentOutput = (event: Parameters<typeof emitAgentOutputEvent>[0]) =>
    emitAgentOutputEvent(event, repairTextArtifacts);

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

// â”€â”€â”€ Gemini (Google AI Studio) â€” OpenAI-compatible endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const GEMINI_DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
export const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash-lite';

// â”€â”€â”€ Cerebras â€” OpenAI-compatible endpoint (free tier) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
export const CEREBRAS_DEFAULT_MODEL = process.env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507';
export const CEREBRAS_WEAVER_MODEL = process.env.CEREBRAS_WEAVER_MODEL || 'zai-glm-4.7';
const CEREBRAS_LAST_RESORT = 'llama3.1-8b'; // absolute last fallback (free tier 8B)
const CEREBRAS_GPT_OSS_MODELS = new Set(['gpt-oss-120b', 'gpt-oss-20b']);
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'qwen/qwen3.6-plus:free';
const OPENROUTER_STRUCTURE_MODEL = process.env.OPENROUTER_STRUCTURE_MODEL || 'openai/gpt-oss-120b:free';
export const AUTOGEN_INTER_CHAPTER_DELAY_MS = Number(process.env.AUTOGEN_INTER_CHAPTER_DELAY_MS || 0);
export const WEAVER_PLAN_STAGGER_MS = Number(process.env.WEAVER_PLAN_STAGGER_MS || 0);
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

export const getPreferredHighCapabilityProvider = (): 'openrouter' | 'cerebras' | 'auto' => {
    const keys = loadApiKeys();
    const preferred = keys?.preferredProvider ?? 'auto';

    if (preferred === 'openrouter' && keys?.openrouter?.trim()) return 'openrouter';
    if (preferred === 'cerebras' && keys?.cerebras?.trim()) return 'cerebras';
    return 'auto';
};

export const generateId = () => Math.random().toString(36).substr(2, 9);
export const isEconomyMode = (mode?: GenerationQualityMode): boolean => mode === 'economy';
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
export const withLlmTimeout = async <T>(label: string, work: Promise<T>, timeoutMs = LLM_REQUEST_TIMEOUT_MS): Promise<T> => {
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

const inferTimelineEventState = (title: string, content: string): TimelineEventState => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(profecia|prophecy|premon|forecast|previsto|pressagio|pressÃ¡gio)/.test(blob)) return 'forecast';
    if (/(veneno|maldicao|maldiÃ§Ã£o|timer|contagem|prazo|ritual em curso|ca[cÃ§]a|pursuit|persegui)/.test(blob)) return 'active_pressure';
    if (/(latente|selado|adormecido|hibernando|dormente|esperando)/.test(blob)) return 'latent';
    if (/(resolvido|encerrado|curado|closed|resolved|apurado|concluido|concluÃ­do)/.test(blob)) return 'resolved';
    return 'historical';
};

const inferTimelineDiscoveryKind = (title: string, content: string): TimelineDiscoveryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(flashback|visao|visÃ£o|recordacao|recordaÃ§Ã£o|descoberta|revela|memory recovered|vision)/.test(blob)) return 'present_discovery';
    if (/(profecia|prophecy|premon|forecast)/.test(blob)) return 'forecast';
    return 'past_occurrence';
};

const inferRuleEntryKind = (title: string, content: string): RuleEntryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(bairro|torre|templo|cidade|reino|fortaleza|palacio|palÃ¡cio|porto|floresta|ruina|ruÃ­na|distrito|megacidade|district|tower|temple|city|kingdom|forest|hall|passagem|passage)/.test(blob)) return 'location';
    if (/(magia|magic|spell|mana|arcano|arcane|ritual de poder|grimorio|grimoire|feiti|poder|ability|gift|curse system|source of power)/.test(blob)) return 'magic';
    if (/(mito|myth|lenda|legend|cosmologia|cosmology|religiao|religiÃ£o|folk|folclore|propaganda|rumor|origem do mundo|deuses|gods)/.test(blob)) return 'lore';
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
    if (/(fac[cÃ§][aÃ£]o|faction|house|guild|cult|ordem|clan|clÃ£)/.test(blob)) return 'faction';
    if (/(cidade|city|hall|bairro|district|temple|palace|palacio|palÃ¡cio|fortress|fortaleza)/.test(blob)) return 'local';
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

export const limitItems = <T,>(items: T[], maxItems: number): T[] => items.slice(0, Math.max(0, maxItems));
export const truncateText = (value: string | undefined, maxChars: number): string => {
    if (!value) return '';
    return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trim()}â€¦`;
};

export const COMPACT_AGENT_PROMPTS: Partial<Record<string, string>> = {
    architect: 'Create a coherent fictional universe with strong atmosphere, opposing factions, and clear limits. Return only what was requested.',
    soulforger: 'Create psychologically coherent characters with a Ghost and a Lie. Keep the protagonist active and concrete.',
    director: 'Analyse narrative health and prose drift: open loops, faction balance, protagonist agency, repeated openings/endings, and repeated rhetorical patterns. Issue per-chapter guidance JSON only.',
    weaver: 'Plan 5-7 causal beats. Each beat must include actor, action, obstacle, and consequence. Avoid textbook plot labels and generic screenplay scaffolding. Output structured JSON only.',
    bard: 'Write continuous narrative prose only. No headers or meta text. Start concrete, maintain POV, dramatize actions, avoid repetition or cliches, vary sentence temperature, forbid filtering ("he felt/he knew/he saw"), avoid "parecia/como se" except when indispensable, default to affirmative syntax instead of contrastive negation, and vary openings/endings from recent chapters.',
    chronicler: 'Extract explicit facts into the requested JSON only. Reuse known character IDs, avoid invention, and only record stable codex facts.',
    lector: 'Polish the chapter with minimal edits. Prefer concrete nouns, physical verbs, direct syntax, and lower-temperature phrasing. Remove repetition, filtering, hedged similes, banned rhetoric, repeated openings/endings, and saturated image families without making the prose more dramatic.',
};

export const BARD_STYLE_OVERRIDE = `

FILTERING / HESITATION BAN:
- Do NOT habitually frame prose through "ele sabia", "ele sentiu", "ele percebeu", "ele notou", "ele viu", "ele ouviu", "ela sabia", "ela sentiu", or equivalent English forms.
- Only use a perception verb if the act of perception itself changes the scene.
- Do NOT lean on "parecia", "como se", "as if", or "seemed" as default atmosphere generators. One rare use in a long chapter is acceptable; repeated use is failure.
- Prefer concrete assertion over hedged image.

WEAK GLUE WORDS:
- Do NOT use "mas", "nÃ£o", "apenas", "sÃ³", "quase" as rhythmic crutches in consecutive sentences.
- If you need force, cut the sentence or sharpen the verb. Do not simulate intensity with connective negation.
- Prefer affirmative syntax and concrete sequence over explanatory contrast.

RHETORICAL REPETITION BAN:
- FORBIDDEN default molds: "nÃ£o X, mas Y", "nÃ£o era X. Era Y.", "nÃ£o vinha de X, vinha de Y", "nÃ£o por X, por Y", "nÃ£o com X, mas com Y".
- If contrast is necessary, express it through scene consequence, juxtaposition, or paragraph order â€” not sentence self-correction.
- Do NOT build intensity by repeatedly denying one image and replacing it with another.

OPENING / ENDING VARIETY:
- Do NOT open consecutive chapters with the same atmospheric recipe.
- Avoid always opening with smell + texture + bodily discomfort + pulsing architecture.
- Avoid ending every chapter with an identity riddle or rhetorical question.
- Vary chapter temperature: some chapters should cut cleaner, move faster, or speak more plainly.
`;

export const STYLE_PATTERN_LABELS: Record<string, string> = {
    nao_x_mas_y: 'Avoid contrastive-negation formulas like "nÃ£o X, mas Y".',
    nao_era_x_era_y: 'Avoid sentence-pair correction formulas like "nÃ£o era X. Era Y."',
    opening_sensorial_densa: 'Do not open with dense atmospheric sensation. Start with action, dialogue, intrusion, or concrete event.',
    ending_pergunta_identitaria: 'Do not close with a rhetorical identity question. End on action, image, choice, or factual revelation.',
    opening_nome_movimento: 'Do not start the first sentence with protagonist name + movement verb.',
};

export const inferOpeningPattern = (text: string, protagonistName = ''): string | null => {
    const first = text.split(/\n+/).map(line => line.trim()).find(Boolean)?.toLowerCase() || '';
    if (!first) return null;
    const normalizedName = protagonistName.toLowerCase();
    if (normalizedName && new RegExp(`^${normalizedName}\\s+(caminhou|correu|desceu|subiu|entrou|atravessou|seguiu|avanÃ§ou|walked|ran|moved|descended|climbed|entered)\\b`).test(first)) {
        return 'opening_nome_movimento';
    }
    const sensoryHits = ['cheiro', 'gosto', 'ar ', 'umidade', 'cobre', 'ferro', 'terra', 'raiz', 'odor', 'puls', 'latej', 'respir']
        .filter(token => first.includes(token)).length;
    if (sensoryHits >= 3) return 'opening_sensorial_densa';
    return null;
};

export const inferEndingPattern = (text: string): string | null => {
    const lines = text.trim().split(/\n+/).map(line => line.trim()).filter(Boolean);
    const tail = lines.slice(-2).join(' ').toLowerCase();
    if (!tail) return null;
    if (tail.includes('?') && /(quem|o que|serÃ¡|seria|por que|porque|why|who|what)/.test(tail)) {
        return 'ending_pergunta_identitaria';
    }
    return null;
};

export const getRecentChapterStarts = (universe: Universe, count = 2): string[] =>
    universe.chapters.slice(-count).map(ch => ch.content.split(/\n+/).map(line => line.trim()).find(Boolean) || '').filter(Boolean);

export const getRecentChapterEndings = (universe: Universe, count = 2): string[] =>
    universe.chapters.slice(-count).map(ch => ch.content.trim().split(/\n+/).map(line => line.trim()).filter(Boolean).slice(-1)[0] || '').filter(Boolean);

export const detectImageryOveruse = (text: string): string[] => {
    const families = [
        ['osso', 'ossos', 'fÃªmur', 'femur', 'vÃ©rtebra', 'vertebra', 'dente', 'dentes', 'crÃ¢nio', 'cranio'],
        ['pedra', 'rocha', 'pedra-viva', 'rocha-viva'],
        ['cobre', 'ferro', 'metal', 'metÃ¡lico', 'metalico'],
        ['umidade', 'Ãºmido', 'umido', 'terra molhada', 'raiz', 'raÃ­zes', 'raizes'],
        ['abismo', 'poÃ§o', 'poco', 'vazio'],
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

// â”€â”€â”€ Story Profile Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FORMAT_SPEC: Record<StoryFormat, { label: string; wordsPerChapter: string; chapterCount: string; style: string }> = {
    light_novel: {
        label: 'Light Novel',
        wordsPerChapter: '1500â€“2500',
        chapterCount: 'many short chapters',
        style: 'dialogue-heavy, fast-paced, anime-esque, expressive inner monologue',
    },
    web_novel: {
        label: 'Web Novel',
        wordsPerChapter: '2000â€“3500',
        chapterCount: 'serialized chapters with strong hooks',
        style: 'strong chapter hooks, cliffhangers, informal prose, reader-engagement focus',
    },
    novel: {
        label: 'Novel',
        wordsPerChapter: '4000â€“7000',
        chapterCount: 'longer immersive chapters',
        style: 'literary prose, richly described scenes, slow deliberate pacing, complex subtext',
    },
};

const ARCHETYPE_STYLE: Record<string, string> = {
    tolkien: 'dense mythological worldbuilding, archaic prose, rare magic, grand scale, languages and histories',
    dostoevski: 'psychological depth, moral philosophy, suffering and redemption, intense interior monologue',
    shakespeare: 'poetic language, tragic irony, complex villains, fate vs free will',
    isekai: 'protagonist transported to fantasy world, system mechanics, leveling, overpowered growth, friendship and rivalry arcs',
    realismo_magico: 'magical elements woven seamlessly into mundane reality, matter-of-fact treatment of the supernatural, lyrical prose, GarcÃ­a MÃ¡rquez / Mia Couto style',
    opera_espacial: 'galactic empires and political factions, space diplomacy, interstellar conflict, grand scale, sophisticated power struggles between civilizations',
    romance_gothico: 'atmospheric dread, forbidden love, decaying grandeur, secrets and curses',
    noir: 'cynical narrator, moral ambiguity, crime, rain-soaked cities, femme fatale archetypes',
};

export const buildProfileContext = (profile?: StoryProfile, compact = false): string => {
    if (!profile) return '';

    const fmt = profile.format ? FORMAT_SPEC[profile.format] : null;
    const archetypeStyles = profile.archetypes.map(a => ARCHETYPE_STYLE[a]).filter(Boolean).join('; ');
    const themes = profile.themes.join(', ');

    const fmtLine = fmt
        ? `FORMAT: ${fmt.label}\n  - Words per chapter: ~${fmt.wordsPerChapter}\n  - Chapter structure: ${fmt.chapterCount}\n  - Prose style: ${fmt.style}`
        : 'FORMAT: AI decides freely â€” choose the most fitting format';

    const hasPremise = !!profile.premise?.trim();
    const premiseBlock = hasPremise
        ? `âš‘ USER PREMISE â€” NON-NEGOTIABLE CONTENT ANCHOR:\n"${profile.premise!.trim()}"\nâ†’ ALL generated content (title, world, factions, conflict, setting, characters) MUST emerge from and serve this premise.\nâ†’ The style directives below (literary influences, tone, format) shape HOW this premise is told â€” they do NOT replace or dilute it.`
        : 'USER PREMISE: none provided â€” invent freely following the style directives below.';

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
=== STORY PROFILE (MANDATORY â€” FOLLOW STRICTLY) ===
${premiseBlock}

STYLE DIRECTIVES â€” apply these to shape the premise:
${fmtLine}

NARRATIVE TONE: ${profile.tone || 'AI decides freely'}
POINT OF VIEW: ${profile.pov ? profile.pov.replace(/_/g, ' ') : 'AI decides freely'}
CORE THEMES: ${themes || 'AI decides freely'}
LITERARY INFLUENCES (style/world-feel/prose register â€” shape HOW, not WHAT): ${archetypeStyles || 'neutral'}
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
        factionA: factionTitles[0] || (universe.lang === 'en' ? 'the ruling faction' : 'a facÃ§Ã£o dominante'),
        factionB: factionTitles[1] || factionTitles[0] || (universe.lang === 'en' ? 'the opposing faction' : 'a facÃ§Ã£o rival'),
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

export const normalizeLongformBlueprint = (blueprint: LongformBlueprint, universe: Universe): LongformBlueprint => ({
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

export const BLUEPRINT_GENERIC_PATTERNS = [
    /training, initiation, infiltration,? or adaptation/i,
    /treinamento, inicia[cÃ§][aÃ£]o, infiltra[cÃ§][aÃ£]o ou adapta[cÃ§][aÃ£]o/i,
    /price of victory/i,
    /preÃ§o da vitÃ³ria/i,
    /hidden truth/i,
    /verdade oculta/i,
    /apparent victory/i,
    /vit[Ã³o]ria aparente/i,
    /false shelter/i,
    /abrigo falso/i,
    /narrower path/i,
    /caminho estreito/i,
    /surviving forces/i,
    /forÃ§as sobreviventes/i,
    /central promise/i,
    /promessa central/i,
    /central engine of the conflict/i,
    /motor central do conflito/i,
    /what must be won, lost, or exposed/i,
    /o que precisa ser ganho, perdido ou exposto/i,
    [/revelaÃ§Ã£oo/gi, 'revelaÃ§Ã£o'], [/exposiÃ§Ã£oo/gi, 'exposiÃ§Ã£o'], [/deterioraÃ§Ã£oo/gi, 'deterioraÃ§Ã£o'],
    [/puniÃ§Ã£oo/gi, 'puniÃ§Ã£o'], [/facÃ§Ãµeses/gi, 'facÃ§Ãµes'], [/prote\?\?o/gi, 'proteÃ§Ã£o'],
    [/institui\?\?/gi, 'instituiÃ§Ãµes'], [/rel\?quia/gi, 'relÃ­quia'], [/espec\?fica/gi, 'especÃ­fica'],
    [/viol\?ncia/gi, 'violÃªncia'], [/imposs\?vel/gi, 'impossÃ­vel'], [/sacrif\?cio/gi, 'sacrifÃ­cio'],
    [/cl\?max/gi, 'clÃ­max'],
    [/ÃƒÂ¢Ã…Â¡Ã‚Â /g, 'WARN '], [/invÃƒÂ¡lido/gi, 'invalido'],
];

export const blueprintTextHasNamedAnchor = (text: string, anchors: string[]): boolean =>
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
    const proseStyle = (profile as StoryProfile & { proseStyle?: string } | undefined)?.proseStyle ?? '';

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

export const buildFallbackLongformBlueprint = (universe: Universe): LongformBlueprint => {
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
        ? 'isekai progression using Save the Cat opening displacement, Heroâ€™s Journey threshold crossing, midpoint rule revelation, and late belonging choice'
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

    directivesPt.push('TÃ‰CNICA ESTRUTURAL: escolha conscientemente 1-2 frameworks entre Save the Cat, Seven-Point Story Structure, Heroâ€™s Journey, Fichtean curve, Kishotenketsu ou scene-sequel rhythm. Use-os de verdade na distribuiÃ§Ã£o dos atos e marcos, sem citar teoria no texto final.');
    directivesEn.push('STRUCTURAL CRAFT: deliberately choose 1-2 frameworks from Save the Cat, Seven-Point Story Structure, Heroâ€™s Journey, Fichtean curve, Kishotenketsu, or scene-sequel rhythm. Actually use them in act and milestone distribution without naming theory in the final text.');

    if (tone.includes('sombrio') || tone.includes('dark')) {
        directivesPt.push('TOM SOMBRIO: midpoint e ato final devem cobrar perda, custo, degradaÃ§Ã£o e ausÃªncia de redenÃ§Ã£o fÃ¡cil.');
        directivesEn.push('DARK TONE: midpoint and final act must demand loss, cost, deterioration, and no easy redemption.');
    }
    if (tone.includes('epico') || tone.includes('epic')) {
        directivesPt.push('TOM Ã‰PICO: escale de conflito pessoal para implicaÃ§Ã£o coletiva, polÃ­tica ou civilizacional atÃ© o clÃ­max.');
        directivesEn.push('EPIC TONE: escalate from personal conflict toward collective, political, or civilizational stakes by the climax.');
    }
    if (tone.includes('misterioso') || tone.includes('mysterious')) {
        directivesPt.push('TOM MISTERIOSO: distribua perguntas e revelaÃ§Ãµes em camadas; cada ato deve responder algo e abrir outra pergunta maior.');
        directivesEn.push('MYSTERIOUS TONE: distribute questions and revelations in layers; each act must answer something and open a larger question.');
    }
    if (tone.includes('dramatico') || tone.includes('dramatic')) {
        directivesPt.push('TOM DRAMÃTICO: pelo menos uma relaÃ§Ã£o central deve mudar de estado em cada ato.');
        directivesEn.push('DRAMATIC TONE: at least one core relationship must change state in each act.');
    }
    if (tone.includes('humoristico') || tone.includes('humorous')) {
        directivesPt.push('TOM HUMORÃSTICO: inclua reversÃµes irÃ´nicas, contraste e alÃ­vio sem desmontar a pressÃ£o central.');
        directivesEn.push('HUMOROUS TONE: include ironic reversals, contrast, and relief without dissolving core pressure.');
    }
    if (tone.includes('lirico') || tone.includes('lyrical')) {
        directivesPt.push('TOM LÃRICO: preserve a clareza estrutural, mas permita marcos com forte peso imagÃ©tico e simbÃ³lico.');
        directivesEn.push('LYRICAL TONE: preserve structural clarity while allowing milestones with strong imagistic and symbolic weight.');
    }

    if (themes.includes('redencao')) {
        directivesPt.push('TEMA REDENÃ‡ÃƒO: o protagonista deve enfrentar culpa, falhar moralmente e sÃ³ poder reparar algo depois de pagar custo real.');
        directivesEn.push('REDEMPTION THEME: the protagonist must face guilt, fail morally, and only earn repair after paying real cost.');
    }
    if (themes.includes('poder_e_corrupcao')) {
        directivesPt.push('TEMA PODER E CORRUPÃ‡ÃƒO: cada ganho de poder precisa vir com deformaÃ§Ã£o Ã©tica, dependÃªncia ou risco de desumanizaÃ§Ã£o.');
        directivesEn.push('POWER & CORRUPTION THEME: every power gain must carry ethical distortion, dependency, or dehumanizing risk.');
    }
    if (themes.includes('amor_proibido')) {
        directivesPt.push('TEMA AMOR PROIBIDO: introduza vÃ­nculo afetivo sob barreira real e faÃ§a o custo dessa ligaÃ§Ã£o aumentar por ato.');
        directivesEn.push('FORBIDDEN LOVE THEME: introduce an emotional bond under a real barrier and increase its cost each act.');
    }
    if (themes.includes('identidade')) {
        directivesPt.push('TEMA IDENTIDADE: midpoint ou virada do ato 2 deve quebrar a autoimagem do protagonista.');
        directivesEn.push('IDENTITY THEME: the midpoint or late act-two turn must break the protagonistâ€™s self-image.');
    }
    if (themes.includes('vinganca')) {
        directivesPt.push('TEMA VINGANÃ‡A: a busca retaliatÃ³ria deve ganhar um preÃ§o moral claro e disputar espaÃ§o com outras lealdades.');
        directivesEn.push('VENGEANCE THEME: the retaliatory drive must incur a clear moral price and compete with other loyalties.');
    }
    if (themes.includes('revolucao')) {
        directivesPt.push('TEMA REVOLUÃ‡ÃƒO: mostre custo sistÃªmico, facÃ§Ãµes em conflito e ausÃªncia de soluÃ§Ã£o moral simples.');
        directivesEn.push('REVOLUTION THEME: show systemic cost, factions in conflict, and no morally simple solution.');
    }
    if (themes.includes('sobrevivencia')) {
        directivesPt.push('TEMA SOBREVIVÃŠNCIA: todo bloco precisa pressionar recursos, tempo, risco fÃ­sico ou abrigo.');
        directivesEn.push('SURVIVAL THEME: every block must pressure resources, time, physical risk, or shelter.');
    }
    if (themes.includes('traicao')) {
        directivesPt.push('TEMA TRAIÃ‡ÃƒO: plante sementes cedo e exija ao menos uma ruptura importante de confianÃ§a.');
        directivesEn.push('BETRAYAL THEME: plant seeds early and require at least one major rupture of trust.');
    }

    if (archetypes.includes('isekai')) {
        directivesPt.push('ISEKAI: o blueprint deve conter ruptura explÃ­cita entre mundo comum e mundo outro. CapÃ­tulos 1-2 precisam cobrir morte/reencarnaÃ§Ã£o, convocaÃ§Ã£o/transporte ou aprisionamento em outro mundo; o ato 1 precisa ensinar as regras do novo mundo; o midpoint precisa revelar por que o protagonista foi parar ali; o ato final precisa forÃ§ar escolha entre pertencer, voltar ou reescrever os dois mundos.');
        directivesEn.push('ISEKAI: the blueprint must contain an explicit rupture between ordinary world and other world. Chapters 1-2 must cover death/reincarnation, summoning/transport, or entrapment in another world; act one must teach the new worldâ€™s rules; the midpoint must reveal why the protagonist arrived there; the final act must force a choice between belonging, returning, or rewriting both worlds.');
    }
    if (archetypes.includes('noir')) {
        directivesPt.push('NOIR: inclua investigaÃ§Ã£o, corrupÃ§Ã£o em camadas, ambiguidade moral e uma verdade tardia que custe algo ao protagonista.');
        directivesEn.push('NOIR: include investigation, layered corruption, moral ambiguity, and a late truth that costs the protagonist something.');
    }
    if (archetypes.includes('romance_gothico')) {
        directivesPt.push('GÃ“TICO: use segredo de linhagem, casa/instituiÃ§Ã£o decadente, intimidade proibida e sensaÃ§Ã£o de heranÃ§a maldita.');
        directivesEn.push('GOTHIC: use lineage secrets, a decaying house/institution, forbidden intimacy, and the sense of cursed inheritance.');
    }
    if (archetypes.includes('opera_espacial')) {
        directivesPt.push('SPACE OPERA: distribua conflito entre facÃ§Ãµes, escala interestelar, diplomacia tensa e promessa de expansÃ£o de arena.');
        directivesEn.push('SPACE OPERA: distribute conflict across factions, interstellar scale, tense diplomacy, and the promise of expanding arena.');
    }
    if (archetypes.includes('realismo_magico')) {
        directivesPt.push('REALISMO MÃGICO: o sobrenatural deve coexistir com o cotidiano sem virar tutorial de sistema rÃ­gido.');
        directivesEn.push('MAGICAL REALISM: the supernatural must coexist with the ordinary without turning into a rigid system tutorial.');
    }
    if (archetypes.includes('dostoevski')) {
        directivesPt.push('DRAMA PSICOLÃ“GICO: aumente contradiÃ§Ãµes internas, culpa, autoengano e dilemas sem saÃ­da limpa.');
        directivesEn.push('PSYCHOLOGICAL DRAMA: intensify inner contradiction, guilt, self-deception, and dilemmas without clean exits.');
    }
    if (archetypes.includes('tolkien')) {
        directivesPt.push('HIGH FANTASY: deixe claro o pano de fundo mÃ­tico, a histÃ³ria profunda do mundo e a relaÃ§Ã£o entre facÃ§Ãµes, legado e cosmologia.');
        directivesEn.push('HIGH FANTASY: make the mythic backdrop, deep history, and relation between factions, legacy, and cosmology explicit.');
    }
    if (archetypes.includes('shakespeare')) {
        directivesPt.push('TRAGÃ‰DIA CLÃSSICA: faÃ§a o blueprint caminhar para ironia, erro fatal e catarse, nÃ£o apenas para vitÃ³ria limpa.');
        directivesEn.push('CLASSICAL TRAGEDY: drive the blueprint toward irony, fatal error, and catharsis, not merely clean victory.');
    }

    if (pov === 'primeira_pessoa') {
        directivesPt.push('POV PRIMEIRA PESSOA: organize revelaÃ§Ãµes para o leitor descobrir o mundo pelos limites subjetivos do protagonista.');
        directivesEn.push('FIRST-PERSON POV: structure revelations so the reader discovers the world through the protagonistâ€™s subjective limits.');
    } else if (pov === 'terceiro_limitado') {
        directivesPt.push('POV TERCEIRO LIMITADO: mantenha foco concentrado e segure informaÃ§Ãµes fora do alcance imediato do protagonista.');
        directivesEn.push('THIRD-LIMITED POV: keep focus concentrated and withhold information beyond the protagonistâ€™s immediate reach.');
    } else if (pov === 'terceiro_onisciente') {
        directivesPt.push('POV TERCEIRO ONISCIENTE: permita ironia dramÃ¡tica e contraponto entre facÃ§Ãµes, mas sem dissolver a linha principal do protagonista.');
        directivesEn.push('THIRD-OMNISCIENT POV: allow dramatic irony and factional counterpoint without dissolving the protagonistâ€™s main line.');
    }

    return {
        model,
        directivesText: lang === 'en'
            ? directivesEn.join('\n- ')
            : directivesPt.join('\n- '),
    };
};

export const buildCompactLongformBlueprintDirectives = (profile: StoryProfile | undefined, lang: 'pt' | 'en') => {
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

    const directivesPt: string[] = ['Escolha 1-2 frameworks e aplique-os de verdade na distribuiÃ§Ã£o dos atos.'];
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
        directivesPt.push('FaÃ§a ao menos uma relaÃ§Ã£o central mudar por ato.');
        directivesEn.push('Make at least one core relationship change each act.');
    }

    if (themes.includes('identidade')) {
        directivesPt.push('Frature a autoimagem do protagonista no midpoint ou fim do ato 2.');
        directivesEn.push('Fracture the protagonist self-image at the midpoint or late act two.');
    }
    if (themes.includes('redencao')) {
        directivesPt.push('A reparaÃ§Ã£o sÃ³ vem depois de culpa, falha e custo.');
        directivesEn.push('Repair only comes after guilt, failure, and cost.');
    }
    if (themes.includes('poder_e_corrupcao')) {
        directivesPt.push('Todo ganho de poder precisa deformar algo humano.');
        directivesEn.push('Every power gain must deform something human.');
    }
    if (themes.includes('amor_proibido')) {
        directivesPt.push('FaÃ§a o vÃ­nculo proibido ficar mais caro a cada ato.');
        directivesEn.push('Make the forbidden bond costlier each act.');
    }
    if (themes.includes('vinganca')) {
        directivesPt.push('A vinganÃ§a deve competir com outras lealdades.');
        directivesEn.push('Vengeance must compete with other loyalties.');
    }
    if (themes.includes('revolucao')) {
        directivesPt.push('Mostre custo sistÃªmico e facÃ§Ãµes em choque.');
        directivesEn.push('Show systemic cost and clashing factions.');
    }
    if (themes.includes('sobrevivencia')) {
        directivesPt.push('Pressione tempo, recurso, abrigo ou risco fÃ­sico em cada bloco.');
        directivesEn.push('Pressure time, resources, shelter, or physical risk in every block.');
    }
    if (themes.includes('traicao')) {
        directivesPt.push('Plante cedo a ruptura de confianÃ§a e cobre-a depois.');
        directivesEn.push('Plant the trust rupture early and collect on it later.');
    }

    if (archetypes.includes('isekai')) {
        directivesPt.push('CapÃ­tulos 1-2 devem cobrir a ruptura entre mundos.');
        directivesEn.push('Chapters 1-2 must cover the rupture between worlds.');
    }
    if (archetypes.includes('noir')) {
        directivesPt.push('Inclua investigaÃ§Ã£o, corrupÃ§Ã£o em camadas e verdade tardia com custo.');
        directivesEn.push('Include investigation, layered corruption, and a costly late truth.');
    }
    if (archetypes.includes('romance_gothico')) {
        directivesPt.push('Use decadÃªncia, segredo e intimidade proibida.');
        directivesEn.push('Use decay, secrecy, and forbidden intimacy.');
    }
    if (archetypes.includes('opera_espacial')) {
        directivesPt.push('Distribua pressÃ£o entre facÃ§Ãµes, arena ampla e diplomacia tensa.');
        directivesEn.push('Distribute pressure across factions, broad arena, and tense diplomacy.');
    }
    if (archetypes.includes('realismo_magico')) {
        directivesPt.push('O sobrenatural deve coexistir com o cotidiano sem tutorial de sistema.');
        directivesEn.push('The supernatural must coexist with the ordinary without a system tutorial.');
    }
    if (archetypes.includes('dostoevski')) {
        directivesPt.push('Aumente culpa, autoengano e contradiÃ§Ã£o interna.');
        directivesEn.push('Intensify guilt, self-deception, and inner contradiction.');
    }
    if (archetypes.includes('tolkien')) {
        directivesPt.push('Deixe explÃ­citos legado, profundidade histÃ³rica e pano de fundo mÃ­tico.');
        directivesEn.push('Make legacy, deep history, and mythic backdrop explicit.');
    }
    if (archetypes.includes('shakespeare')) {
        directivesPt.push('Conduza para ironia, erro fatal e catarse.');
        directivesEn.push('Drive toward irony, fatal error, and catharsis.');
    }

    if (pov === 'primeira_pessoa') {
        directivesPt.push('Passe as revelaÃ§Ãµes pelos limites subjetivos do protagonista.');
        directivesEn.push('Route revelations through the protagonist subjective limits.');
    } else if (pov === 'terceiro_limitado') {
        directivesPt.push('Segure informaÃ§Ã£o fora do alcance imediato do protagonista.');
        directivesEn.push('Withhold information beyond the protagonist immediate reach.');
    } else if (pov === 'terceiro_onisciente') {
        directivesPt.push('Permita contraponto entre facÃ§Ãµes sem dissolver a linha principal.');
        directivesEn.push('Allow factional counterpoint without dissolving the main line.');
    }

    return {
        model,
        directivesText: lang === 'en'
            ? directivesEn.slice(0, 8).join('\n- ')
            : directivesPt.slice(0, 8).join('\n- '),
    };
};

export const getBlueprintChapterMeta = (blueprint: LongformBlueprint | undefined, chapterNumber: number) =>
    blueprint?.chapterMap.find(entry => entry.chapterNumber === chapterNumber) ?? null;

export const langMandate = (lang?: 'pt' | 'en'): string => {
    if (lang === 'en') {
        return 'Write everything in English only.';
    }
    return 'Escreva tudo em portuguÃªs brasileiro. NÃ£o misture inglÃªs no texto. Use acentuaÃ§Ã£o correta quando necessÃ¡rio. ReferÃªncia rÃ¡pida: aÃ§Ã£o, coraÃ§Ã£o, Ã³rbita, capÃ­tulo, memÃ³ria, estaÃ§Ã£o, ficÃ§Ã£o, bÃªnÃ§Ã£o, impossÃ­vel.';
};

export const langMandateVerbose = (lang?: 'pt' | 'en'): string => {
    if (!lang || lang === 'pt') {
        return `
=== LANGUAGE MANDATE â€” OBRIGATÃ“RIO ===
Escreva TODO o texto gerado em PORTUGUÃŠS BRASILEIRO. Sem exceÃ§Ãµes.
PROIBIDO misturar inglÃªs no meio do texto portuguÃªs.
Exemplos de erros PROIBIDOS (use a traduÃ§Ã£o ao lado):
  âŒ "o ar estava thick"      â†’ âœ… "o ar estava espesso / denso"
  âŒ "fluir through ele"      â†’ âœ… "fluir atravÃ©s dele"
  âŒ "tÃ£o vivid"              â†’ âœ… "tÃ£o vÃ­vido / nÃ­tido"
  âŒ "uma sensaÃ§Ã£o de flow"   â†’ âœ… "uma sensaÃ§Ã£o de fluidez"
  âŒ "her eyes"               â†’ âœ… "seus olhos"
Nomes prÃ³prios de personagens, lugares e faÃ§Ãµes criados anteriormente devem ser mantidos como estÃ£o.
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

// â”€â”€â”€ Clean English leakage from PT prose â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const cleanLanguageLeakage = (text: string, lang?: 'pt' | 'en'): string => {
    if (lang === 'en') return text; // nothing to clean
    return text
        .replace(/\bthrough\b/gi, 'atravÃ©s de')
        .replace(/\b(thick|dense)\b(?=\s+(?:com|de|o|a|os|as)\b)/gi, 'denso')
        .replace(/\bthick\b/gi, 'espesso')
        .replace(/\bvivid\b/gi, 'vÃ­vido')
        .replace(/\bflow\b/gi, 'fluir')
        .replace(/\bshadow\b/gi, 'sombra')
        .replace(/\bshimmering\b/gi, 'cintilante')
        .replace(/\bglowing\b/gi, 'brilhante')
        .replace(/\bgrim\b/gi, 'sombrio')
        .replace(/\bominous\b/gi, 'ominoso');
};

// â”€â”€â”€ Clients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


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
    [/ÃƒÂ¡/g, 'Ã¡'], [/Ãƒ /g, 'Ã '], [/ÃƒÂ¢/g, 'Ã¢'], [/ÃƒÂ£/g, 'Ã£'], [/ÃƒÂ¤/g, 'Ã¤'],
    [/ÃƒÂ©/g, 'Ã©'], [/ÃƒÂª/g, 'Ãª'], [/ÃƒÂ¨/g, 'Ã¨'],
    [/ÃƒÂ­/g, 'Ã­'], [/ÃƒÂ¬/g, 'Ã¬'], [/ÃƒÂ®/g, 'Ã®'],
    [/ÃƒÂ³/g, 'Ã³'], [/ÃƒÂ´/g, 'Ã´'], [/ÃƒÂµ/g, 'Ãµ'], [/ÃƒÂ¶/g, 'Ã¶'],
    [/ÃƒÂº/g, 'Ãº'], [/ÃƒÂ¹/g, 'Ã¹'], [/ÃƒÂ»/g, 'Ã»'], [/ÃƒÂ¼/g, 'Ã¼'],
    [/ÃƒÂ§/g, 'Ã§'], [/Ãƒâ€˜/g, 'Ã‘'], [/ÃƒÂ±/g, 'Ã±'],
    [/Ã¢â‚¬â„¢/g, "'"], [/Ã¢â‚¬Å“/g, '"'], [/Ã¢â‚¬Â/g, '"'], [/Ã¢â‚¬â€œ/g, '-'], [/Ã¢â‚¬â€/g, 'â€”'], [/Ã¢â‚¬Â¦/g, '...'],
    [/Ã‚Â·/g, 'Â·'], [/Ã‚/g, ''],
    [/press\?o/gi, 'pressÃ£o'], [/consequ\?ncia/gi, 'consequÃªncia'], [/seguran\?a/gi, 'seguranÃ§a'],
    [/inevit\?vel/gi, 'inevitÃ¡vel'], [/revela\?\?/gi, 'revelaÃ§Ã£o'], [/exp\?e/gi, 'expÃµe'],
    [/fac\?\?/gi, 'facÃ§Ãµes'], [/v\?nculos/gi, 'vÃ­nculos'], [/v\?nculo/gi, 'vÃ­nculo'],
    [/exposi\?\?/gi, 'exposiÃ§Ã£o'], [/deteriora\?\?/gi, 'deterioraÃ§Ã£o'], [/op\?\?es/gi, 'opÃ§Ãµes'],
    [/for\?as/gi, 'forÃ§as'], [/colis\?o/gi, 'colisÃ£o'], [/fr\?gil/gi, 'frÃ¡gil'], [/amea\?a/gi, 'ameaÃ§a'],
    [/\bn\?o\b/gi, 'nÃ£o'], [/sil\?ncio/gi, 'silÃªncio'], [/pr\?xima/gi, 'prÃ³xima'], [/puni\?\?/gi, 'puniÃ§Ã£o'],
    [/ref\?gio/gi, 'refÃºgio'], [/alian\?a/gi, 'alianÃ§a'], [/at\?/gi, 'atÃ©'], [/pre\?o/gi, 'preÃ§o'],
    [/ser\?/gi, 'serÃ¡'], [/tra\?do/gi, 'traÃ­do'], [/cap\?tulo/gi, 'capÃ­tulo'], [/estabele\?a/gi, 'estabeleÃ§a'],
];

export const repairTextArtifacts = (value: string): string => {
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
    const preferredCandidate: 'cerebras' | 'groq' | 'openrouter' | 'gemini' | null =
        preferred === 'cerebras' && keys?.cerebras?.trim() ? 'cerebras'
        : preferred === 'openrouter' && keys?.openrouter?.trim() ? 'openrouter'
        : preferred === 'groq' && keys?.groq?.trim() ? 'groq'
        : preferred === 'gemini' && keys?.gemini?.trim() ? 'gemini'
        : null;
    const candidateProviders = Array.from(new Set<'cerebras' | 'groq' | 'openrouter' | 'gemini'>([
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
                label: `${label ?? 'Structured Output'} Â· JSON Repair`,
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

// â”€â”€â”€ Core LLM call â€” now accepts explicit temperature â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const chat = async ({
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
async function executeOpenRouter(withJsonMode: boolean, modelOverride?: string): Promise<string> {
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
                console.warn(`[MythosEngine] OpenRouter ${openRouterCandidate} failed â€” trying next fast fallback.`, error instanceof Error ? error.message : error);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(`[MythosEngine] OpenRouter failed for ${label}.`);
    }


    // â”€â”€ Direct Cerebras routing (bypass Groq/Gemini entirely) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (provider === 'cerebras') {
        const cerebrasClient = getCerebrasClient();
        if (cerebrasClient) {
            const cerebrasModel = model !== DEFAULT_MODEL ? model : CEREBRAS_DEFAULT_MODEL;
            const isGptOss = CEREBRAS_GPT_OSS_MODELS.has(cerebrasModel);
            try {
                const completion = await withLlmTimeout(`Cerebras direct Â· ${label}`, cerebrasClient.chat.completions.create({
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
                console.warn(`[MythosEngine] Cerebras direct ${cerebrasModel} failed â€” falling through to auto.`, cerebrasErr);
            }
        }
    }

    // â”€â”€ Direct Gemini routing (bypass Groq entirely) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (provider === 'gemini') {
        const geminiClient = getGeminiClient();
        if (geminiClient) {
            for (const geminiModel of [GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL]) {
                try {
                    const completion = await withLlmTimeout(`Gemini direct Â· ${label}`, geminiClient.chat.completions.create({
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
                    console.warn(`[MythosEngine] Gemini ${geminiModel} failed â€” trying next.`, geminiErr);
                }
            }
            console.warn('[MythosEngine] All Gemini models failed â€” falling back to Groq.');
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
            console.warn('[MythosEngine] Gemini preferred provider failed Ã¢â‚¬â€ falling back.', error);
        }
    }

    if (preferredProvider === 'cerebras' && keys?.cerebras.trim()) {
        try {
            return await executeCerebras(json);
        } catch (error) {
            console.warn('[MythosEngine] Cerebras preferred provider failed Ã¢â‚¬â€ falling back.', error);
        }
    }

    const execute = async (activeModel: string, withJsonMode: boolean) => {
        if (!client) throw new Error('GROQ_API_KEY not configured.');
        const completion = await withLlmTimeout(`Groq Â· ${label}`, client.chat.completions.create({
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

    // â”€â”€â”€ Gemini fallback executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function executeGemini(withJsonMode: boolean, modelOverride?: string): Promise<string> {
        const geminiClient = getGeminiClient();
        if (!geminiClient) throw new Error('GEMINI_API_KEY not configured â€” cannot use Gemini fallback.');
        const geminiModel = modelOverride ?? GEMINI_DEFAULT_MODEL;
        try {
            const completion = await withLlmTimeout(`Gemini Â· ${label}`, geminiClient.chat.completions.create({
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
                console.warn(`[MythosEngine] Gemini ${geminiModel} JSON mode failed â€” retrying without.`, errMsg);
                try {
                    const noJsonCompletion = await withLlmTimeout(`Gemini no-json Â· ${label}`, geminiClient.chat.completions.create({
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
                console.warn(`[MythosEngine] Gemini ${geminiModel} failed â€” retrying with ${GEMINI_FALLBACK_MODEL}.`, errMsg);
                return executeGemini(withJsonMode, GEMINI_FALLBACK_MODEL);
            }
            console.error(`[MythosEngine] All Gemini models failed.`, errMsg);

        }
    }

    // â”€â”€â”€ Cerebras fallback executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function executeCerebras(withJsonMode: boolean, modelOverride?: string): Promise<string> {
        const cerebrasClient = getCerebrasClient();
        if (!cerebrasClient) throw new Error('CEREBRAS_API_KEY not configured â€” cannot use Cerebras fallback.');
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
            const completion = await withLlmTimeout(`Cerebras Â· ${label}`, cerebrasClient.chat.completions.create({
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
                    console.warn(`[MythosEngine] Cerebras ${cerebrasModel} json_mode failed â€” retrying without.`, err instanceof Error ? err.message : err);
                    return await cerebrasCall(false);
                    } catch (noJsonErr) {
                        lastError = noJsonErr;
                    }
            }
            console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed Ã¢â‚¬â€ trying next model.`, err instanceof Error ? err.message : err);
                console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed â€” retrying with ${CEREBRAS_LAST_RESORT}.`, err instanceof Error ? err.message : err);

            }
            throw err;
        }
    }
        */

        for (const cerebrasModel of cerebrasModels) {
            const isGptOss = CEREBRAS_GPT_OSS_MODELS.has(cerebrasModel);
            const cerebrasCall = async (useJsonMode: boolean) => {
                const completion = await withLlmTimeout(`Cerebras Ã‚Â· ${label}`, cerebrasClient.chat.completions.create({
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
                        console.warn(`[MythosEngine] Cerebras ${cerebrasModel} json_mode failed Ã¢â‚¬â€ retrying without.`, err instanceof Error ? err.message : err);
                        return await cerebrasCall(false);
                    } catch (noJsonErr) {
                        lastError = noJsonErr;
                    }
                }

                console.warn(`[MythosEngine] Cerebras ${cerebrasModel} failed Ã¢â‚¬â€ trying next model.`, err instanceof Error ? err.message : err);
            }
        }

        throw lastError instanceof Error ? lastError : new Error(`[MythosEngine] All Cerebras models failed for ${label}.`);
    };

    // â”€â”€ Full fallback chain: Gemini 2.5 â†’ Gemini 2.0 â†’ Cerebras qwen-3-235b â†’ llama3.1-8b â”€â”€
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
        // â”€â”€ 429 Rate Limit: immediately go to fallback chain (no Groq retry delays) â”€â”€
        if (is429Error(error)) {
            console.warn('[MythosEngine] Groq rate limit hit â€” going to fallback chain immediately.');
            return tryFallbackProviders('Groq 429');
        }
        // â”€â”€ Model/format errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (isRetryableModelError(error)) {
            return tryFallbackProviders('Groq model error');
        }
        // â”€â”€ Any other error (connection, timeout, 500, etc.) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        console.error('[MythosEngine] Groq error:', error instanceof Error ? error.message : error);
        return tryFallbackProviders('Groq request failed');
    }
};

// â”€â”€â”€ LLM Output Schemas (Zod) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Validates runtime JSON from LLM agents â€” catches wrong types, missing fields,
// and silent coercion bugs before they propagate through the pipeline.

export const ZDirectorGuidance = z.object({
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

export const ZLongformBlueprint = z.object({
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

export const ZLongformBlueprintCore = z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
    promise: z.string().min(1),
    conflictCore: z.string().min(1),
    protagonistFocus: z.string().min(1),
});

export const ZLongformBlueprintActsPass = z.object({
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

export const ZLongformBlueprintChapterPass = z.object({
    chapters: z.array(z.object({
        chapterNumber: z.number().int().min(1),
        actIndex: z.number().int().min(1).max(4),
        function: z.enum(['setup', 'inciting_break', 'lock_in', 'complication', 'reversal', 'midpoint', 'descent', 'collapse', 'pre_climax', 'climax', 'aftermath']),
        goal: z.string().min(1),
        milestone: z.string().optional(),
    })),
});

export const ZWeaverPlan = z.object({
    chapterTitle:   z.string().optional(),
    chapterSummary: z.string().optional(),
    endHook:        z.string().optional(),
    scenes: z.array(z.object({
        beat:       z.string(),
        characters: z.array(z.string()),
        tension:    z.string(),
    })).optional(),
});

export const ZSurgicalLectorOutput = z.object({
    replacements: z.array(z.object({
        find:        z.string(),
        replaceWith: z.string(),
    })).default([]),
    wordOveruse:          z.array(z.string()).default([]),
    passiveProtagonist:   z.enum(['sim', 'nÃ£o']).default('nÃ£o'),
    sceneObjectiveCheck:  z.enum(['ok', 'complicado', 'falhou']).default('ok'),
    rhetoricalPatternOveruse: z.string().default(''),
    rhetoricalPatternCount: z.number().int().min(0).default(0),
    imageryOveruse: z.array(z.string()).default([]),
    openingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).default('low'),
    endingSimilarityToRecentChapters: z.enum(['low', 'medium', 'high']).default('low'),
    mustRewrite: z.boolean().default(false),
});

export const ZChroniclerOutput = z.object({
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const chatJson = async <T>({
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
                ? (isParseIssue ? 'Modelo respondeu, mas o JSON veio invÃ¡lido â€” usando fallback local' : 'Modelo falhou â€” usando fallback local')
                : 'Todos os provedores falharam Ã¢â‚¬â€ usando fallback vazio';
            emitAgentOutput({
                agent: 'system',
                label: '⚠ ' + label,
                status: 'done',
                summary: fallbackSummary,
                detail: debugDetail,
            });
        }
        return deepRepairTextArtifacts(fallback);
    }
};
