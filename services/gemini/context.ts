import { DEFAULT_AGENTS } from '../../constants';
import type { AIVisibility, Chapter, Character, CodexEntry, OpeningStyle, StoryProfile, Universe } from '../../types';
import { DEFAULT_AI_VISIBILITY, inferRuleEntryKind, normalizeAliasList, normalizeTitle } from './canon';
import { BARD_STYLE_OVERRIDE, COMPACT_AGENT_PROMPTS, STYLE_PATTERN_LABELS, limitItems, truncateText } from './llm';

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export const buildImagePlaceholder = (prompt: string, label: string): string => {
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

export const getAgentPrompt = (universe: Universe | null, agentId: string, compact = false): string => {
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

export const buildUniverseContext = (
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

export const buildLongformBlueprintContext = (
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
export const buildCompactCharacterList = (universe: Universe): string => {
    const stateMap = new Map(
        (universe.narrativeMemory?.characterStates ?? []).map(cs => [cs.name, cs])
    );
    return sortByVisibility(universe.characters).map(c => {
        const st = stateMap.get(c.name);
        const state = st ? ` | ${st.status}${st.location ? ` @ ${st.location}` : ''}` : '';
        return `${c.name}${formatAliasesInline(c.aliases)} (${c.role})${state}`;
    }).join('\n');
};

export const deriveContextEntityIds = (universe: Universe, activeCharacterIds: string[]): string[] => {
    const ids = new Set<string>(activeCharacterIds);
    for (const character of universe.characters.filter(item => activeCharacterIds.includes(item.id))) {
        if (character.faction) {
            const matchingFaction = universe.codex.factions.find(entry => normalizeTitle(entry.title) === normalizeTitle(character.faction));
            if (matchingFaction) ids.add(matchingFaction.id);
        }
    }
    return Array.from(ids);
};

export const buildCharacterContext = (universe: Universe, activeIds: string[], compact = false): string => {
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

export const buildStoryContext = (universe: Universe, chapterIndex?: number): string => {
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

export const buildMemoryContext = (universe: Universe, chapterIndex?: number, compact = false): string => {
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
export const buildBardMemoryHints = (universe: Universe, chapterIndex?: number, compact = false): string => {
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

export const pickOpeningStyle = (universe?: Universe): { style: OpeningStyle; instruction: string } => {
    const recent = universe?.chapters.slice(-2).map(ch => ch.openingStyle).filter(Boolean) as OpeningStyle[] | undefined;
    const blocked = new Set(recent ?? []);
    const preferred = OPENING_STYLES.filter(item => !blocked.has(item.style) && item.style !== 'description');
    const pool = preferred.length > 0 ? preferred : OPENING_STYLES.filter(item => !blocked.has(item.style));
    const finalPool = pool.length > 0 ? pool : OPENING_STYLES;
    return finalPool[Math.floor(Math.random() * finalPool.length)];
};

// ─── Prose cleanup helpers ──────────────────────────────────────────────────

export const stripLLMPrefixes = (text: string): string => {
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
export const truncateRepetitionLoops = (text: string): string => {
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

export const countContrastiveNegationPatterns = (text: string): { count: number; message?: string } => {
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

export const pickFactionArchetypes = (count: number): string[] => {
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

export const pickBackground = (): string => {
    return PROTAGONIST_BACKGROUNDS[Math.floor(Math.random() * PROTAGONIST_BACKGROUNDS.length)];
};

export const deriveRecentEventsFromChapters = (chapters: Chapter[]): string[] =>
    chapters
        .filter(ch => (ch.aiVisibility ?? DEFAULT_AI_VISIBILITY) !== 'hidden')
        .slice(-5)
        .map(ch => ch.summary || ch.endHook || ch.title)
        .filter(Boolean);



