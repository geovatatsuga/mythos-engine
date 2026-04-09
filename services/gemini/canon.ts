import type {
    AIVisibility,
    Chapter,
    Character,
    CodexEntry,
    DirtyScope,
    NarrativeMemory,
    RuleEntryKind,
    SyncMeta,
    TimelineDiscoveryKind,
    TimelineEventState,
    TimelineImpact,
    TimelineScope,
    TrackingConfig,
    TruthBundle,
    Universe,
} from '../../types';

export const DEFAULT_AI_VISIBILITY: AIVisibility = 'tracked';
export const DEFAULT_TRACKING: TrackingConfig = {
    trackByAlias: true,
    caseSensitive: false,
    exclusions: [],
};

const generateId = () => Math.random().toString(36).substr(2, 9);

export const normalizeTitle = (value: string) => value
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an|o|a|os|as)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');

const truncateText = (value: string | undefined, maxChars: number): string => {
    if (!value) return '';
    return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
};

export const normalizeAliasList = (aliases?: string[]): string[] => {
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

export const buildTrackedTerms = (name: string, aliases: string[], tracking?: TrackingConfig): string[] => {
    const base = tracking?.trackByAlias === false ? [name] : [name, ...aliases];
    return normalizeAliasList(base).sort((a, b) => b.length - a.length);
};

export const containsTrackedTerm = (text: string, terms: string[], tracking?: TrackingConfig): boolean => {
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

export const createTruthBundle = (
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

export const createLayeredTruthBundle = (
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

export const markTruthForReview = (truth?: TruthBundle): TruthBundle | undefined =>
    truth
        ? { ...truth, needsReview: truth.layers.some(layer => layer.kind !== 'CANON') }
        : truth;

export const inferTimelineEventState = (title: string, content: string): TimelineEventState => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(profecia|prophecy|premon|forecast|previsto|pressagio|presságio)/.test(blob)) return 'forecast';
    if (/(veneno|maldicao|maldição|timer|contagem|prazo|ritual em curso|ca[cç]a|pursuit|persegui)/.test(blob)) return 'active_pressure';
    if (/(latente|selado|adormecido|hibernando|dormente|esperando)/.test(blob)) return 'latent';
    if (/(resolvido|encerrado|curado|closed|resolved|apurado|concluido|concluído)/.test(blob)) return 'resolved';
    return 'historical';
};

export const inferTimelineDiscoveryKind = (title: string, content: string): TimelineDiscoveryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(flashback|visao|visão|recordacao|recordação|descoberta|revela|memory recovered|vision)/.test(blob)) return 'present_discovery';
    if (/(profecia|prophecy|premon|forecast)/.test(blob)) return 'forecast';
    return 'past_occurrence';
};

export const inferRuleEntryKind = (title: string, content: string): RuleEntryKind => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(bairro|torre|templo|cidade|reino|fortaleza|palacio|palácio|porto|floresta|ruina|ruína|distrito|megacidade|district|tower|temple|city|kingdom|forest|hall|passagem|passage)/.test(blob)) return 'location';
    if (/(magia|magic|spell|mana|arcano|arcane|ritual de poder|grimorio|grimoire|feiti|poder|ability|gift|curse system|source of power)/.test(blob)) return 'magic';
    if (/(mito|myth|lenda|legend|cosmologia|cosmology|religiao|religião|folk|folclore|propaganda|rumor|origem do mundo|deuses|gods)/.test(blob)) return 'lore';
    return 'system';
};

export const inferTimelineImpact = (title: string, content: string): TimelineImpact => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(apocalipse|world-ending|cataclism|cataclismo|extin|ruina total|queda do imperio|fall of the empire)/.test(blob)) return 'cataclysmic';
    if (/(guerra|war|massacre|rebeli|rebellion|assassinat|coup|ritual major|ritual maior)/.test(blob)) return 'high';
    if (/(revela|discovery|descoberta|juramento|oath|pacto|fuga|escape|capture|captura)/.test(blob)) return 'medium';
    return 'low';
};

export const inferTimelineScope = (title: string, content: string): TimelineScope => {
    const blob = normalizeTitle(`${title} ${content}`);
    if (/(mundo|world|imperio|empire|all realms|todos os reinos|cosmos|reino inteiro)/.test(blob)) return 'world';
    if (/(fac[cç][aã]o|faction|house|guild|cult|ordem|clan|clã)/.test(blob)) return 'faction';
    if (/(cidade|city|hall|bairro|district|temple|palace|palacio|palácio|fortress|fortaleza)/.test(blob)) return 'local';
    return 'personal';
};

export const ensureSyncMeta = (syncMeta?: SyncMeta): SyncMeta => ({
    canonVersion: syncMeta?.canonVersion ?? 1,
    memoryVersion: syncMeta?.memoryVersion ?? 1,
    dirtyScopes: syncMeta?.dirtyScopes ?? [],
    lastSyncAt: syncMeta?.lastSyncAt,
    lastSyncMode: syncMeta?.lastSyncMode,
});

export const ensureCodexEntryDefaults = (entry: CodexEntry): CodexEntry => ({
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

export const ensureCharacterDefaults = (character: Character): Character => ({
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

export const ensureUniverseDefaults = (universe: Universe): Universe => ({
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

export const inferRelatedEntityIds = (universe: Universe, text: string, excludeId?: string): string[] => {
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

const deriveRecentEventsFromChapters = (chapters: Chapter[]): string[] =>
    chapters
        .filter(chapter => (chapter.aiVisibility ?? DEFAULT_AI_VISIBILITY) !== 'hidden')
        .slice(-5)
        .map(chapter => chapter.summary || chapter.endHook || chapter.title)
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
            lastChapterIndex: latestChapter ? prepared.chapters.findIndex(chapter => chapter.id === latestChapter.id) : prepared.narrativeMemory?.lastChapterIndex ?? 0,
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

    const memory = prepared.narrativeMemory;
    if (memory) {
        const memoryBlocks = [
            { id: 'globalSummary', label: 'Memoria · resumo global', text: memory.globalSummary },
            { id: 'recentEvents', label: 'Memoria · eventos recentes', text: memory.recentEvents.join(' ') },
            { id: 'openLoops', label: 'Memoria · pontas abertas', text: memory.openLoops.map(loop => loop.description).join(' ') },
            { id: 'characterStates', label: 'Memoria · estados', text: memory.characterStates.map(state => `${state.name} ${state.status} ${state.location ?? ''} ${state.emotionalState ?? ''} ${state.lastAction ?? ''}`).join(' ') },
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

    const memory = prepared.narrativeMemory;
    if (memory) {
        const memoryBlocks = [
            { id: 'globalSummary', label: 'Memoria · resumo global', text: memory.globalSummary },
            { id: 'recentEvents', label: 'Memoria · eventos recentes', text: memory.recentEvents.join(' ') },
            { id: 'openLoops', label: 'Memoria · pontas abertas', text: memory.openLoops.map(loop => loop.description).join(' ') },
            { id: 'characterStates', label: 'Memoria · estados', text: memory.characterStates.map(state => `${state.name} ${state.status} ${state.location ?? ''} ${state.emotionalState ?? ''} ${state.lastAction ?? ''}`).join(' ') },
        ];

        for (const block of memoryBlocks) {
            if (containsTrackedTerm(block.text, terms, entry.tracking)) {
                hits.push({ sourceType: 'memory', sourceId: block.id, label: block.label, excerpt: truncateText(block.text, 180) });
            }
        }
    }

    return hits;
};

