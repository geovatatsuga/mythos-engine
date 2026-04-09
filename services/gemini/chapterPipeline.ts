import { z } from 'zod';
import { createPortraitUrl } from '../../utils/portraits';
import { DEFAULT_AGENTS } from '../../constants';
import type {
  ArbiterIssue,
  Chapter,
  ChapterGenerationParams,
  Character,
  CharacterLieState,
  CharacterState,
  CodexEntry,
  DirectorGuidance,
  GenerationQualityMode,
  LongformBlueprint,
  LongformProgressState,
  NarrativeMemory,
  OpenLoop,
  OpeningStyle,
  StoryProfile,
  Universe,
  WeaverPlan,
} from '../../types';
import {
  DEFAULT_AI_VISIBILITY,
  DEFAULT_TRACKING,
  buildTrackedTerms,
  collectCharacterMentions,
  collectCodexEntryMentions,
  containsTrackedTerm,
  createLayeredTruthBundle,
  createTruthBundle,
  ensureCodexEntryDefaults,
  ensureUniverseDefaults,
  inferRelatedEntityIds,
  inferRuleEntryKind,
  inferTimelineDiscoveryKind,
  inferTimelineEventState,
  inferTimelineImpact,
  inferTimelineScope,
  markTruthForReview,
  markUniverseDirty,
  normalizeAliasList,
  syncUniverseCanon,
  type MentionHit,
} from './canon';
import {
  WEAVER_PLAN_STAGGER_MS,
  CEREBRAS_WEAVER_MODEL,
  ZChroniclerOutput,
  ZDirectorGuidance,
  ZSurgicalLectorOutput,
  ZWeaverPlan,
  buildProfileContext,
  chat,
  chatJson,
  cleanLanguageLeakage,
  detectImageryOveruse,
  emitAgentOutput,
  generateId,
  getPreferredHighCapabilityProvider,
  inferEndingPattern,
  inferOpeningPattern,
  isEconomyMode,
  langMandate,
  langMandateVerbose,
  getBlueprintChapterMeta,
  getRecentChapterEndings,
  getRecentChapterStarts,
  truncateText,
  wait,
} from './llm';
import {
  buildBardMemoryHints,
  buildCharacterContext,
  buildCompactCharacterList,
  buildMemoryContext,
  buildStoryContext,
  buildUniverseContext,
  countContrastiveNegationPatterns,
  deriveContextEntityIds,
  getAgentPrompt,
  pickOpeningStyle,
  stripLLMPrefixes,
  truncateRepetitionLoops,
} from './context';

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

type ChapterRuntimePhase = 'weaver' | 'bard' | 'chronicler';

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

export const generateChapterThreePass = async (
    universe: Universe,
    params: ChapterGenerationParams,
    onPhaseChange?: (phase: ChapterRuntimePhase) => void,
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
        onPhaseChange?.('weaver');
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
    onPhaseChange?.('bard');
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
    }

    } // end if (!arcModeProse) — Lector + 3b rewrite

    // ── Pass 4: Chronicler (extractor) — reads the FINAL polished prose ──
    onPhaseChange?.('chronicler');
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
    onPhaseChange?: (phase: ChapterRuntimePhase) => void,
): Promise<{ chapter: Chapter; updatedUniverse: Universe }> => {
    const preparedUniverse = params.directorPrepared
        ? universe
        : await prepareUniverseForManualDirection(universe, params.qualityMode);
    const { chapter, chroniclerOutput } = await generateChapterThreePass(
        preparedUniverse,
        {
            ...params,
            directorPrepared: true,
        },
        onPhaseChange,
    );

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

export const generateDirectorGuidance = async (
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

export const applyDirectorGuidance = (
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

interface AutogenProgress {
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

export const applyChroniclerSideEffects = (
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
        aliases: [],
        aiVisibility: DEFAULT_AI_VISIBILITY,
        relatedEntityIds: inferRelatedEntityIds(universe, `${f.title} ${f.content}`),
        truth: createTruthBundle(`faction:${normalizeTitle(f.title)}`, f.content, chapterId, truncateText(f.content, 180)),
    })));
    if (newRules.length) universe.codex.rules.push(...newRules.map(r => ensureCodexEntryDefaults({
        id: generateId(),
        ...r,
        aliases: [],
        aiVisibility: DEFAULT_AI_VISIBILITY,
        ruleKind: inferRuleEntryKind(r.title, r.content),
        relatedEntityIds: inferRelatedEntityIds(universe, `${r.title} ${r.content}`),
        truth: createTruthBundle(`rule:${normalizeTitle(r.title)}`, r.content, chapterId, truncateText(r.content, 180)),
    })));
    if (newTimeline.length) universe.codex.timeline.push(...newTimeline.map(t => ensureCodexEntryDefaults({
        id: generateId(),
        ...t,
        aliases: [],
        aiVisibility: DEFAULT_AI_VISIBILITY,
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
        newRules: (data.newRules || []).map((r) => ({ id: generateId(), aliases: [], aiVisibility: DEFAULT_AI_VISIBILITY, ...r })),
        newFactions: (data.newFactions || []).map((f) => ({ id: generateId(), aliases: [], aiVisibility: DEFAULT_AI_VISIBILITY, ...f }))
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


