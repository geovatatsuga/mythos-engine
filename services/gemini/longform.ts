import { z } from 'zod';
import { loadApiKeys } from '../../utils/apiKeys';
import type { ChapterGenerationParams, GenerationQualityMode, LongformBlueprint, LongformProgressState, Universe } from '../../types';
import { ensureUniverseDefaults } from './canon';
import { buildLongformBlueprintContext } from './context';
import { applyDirectorGuidance, generateChapterWithAgents, generateDirectorGuidance } from './chapterPipeline';
import {
  AUTOGEN_INTER_CHAPTER_DELAY_MS,
  BLUEPRINT_GENERIC_PATTERNS,
  CEREBRAS_DEFAULT_MODEL,
  WEAVER_PLAN_STAGGER_MS,
  ZLongformBlueprint,
  ZLongformBlueprintActsPass,
  ZLongformBlueprintChapterPass,
  ZLongformBlueprintCore,
  blueprintTextHasNamedAnchor,
  buildCompactLongformBlueprintDirectives,
  buildFallbackLongformBlueprint,
  chatJson,
  emitAgentOutput,
  getBlueprintChapterMeta,
  isEconomyMode,
  langMandate,
  normalizeLongformBlueprint,
  wait,
} from './llm';

export interface AutogenProgress {
    chaptersDone: number;
    totalChapters: number;
    phase: 'director' | 'weaver' | 'bard' | 'chronicler' | 'done' | 'aborted';
    currentUniverse: Universe;
}

const summarizeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const safeNormalizeBlueprint = (
    candidate: LongformBlueprint,
    universe: Universe,
    fallback: LongformBlueprint,
): LongformBlueprint => {
    try {
        return normalizeLongformBlueprint(candidate, universe);
    } catch (error) {
        console.warn('[MythosEngine] Failed to normalize longform blueprint. Using fallback.', error);
        return fallback;
    }
};

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
    const fallback = safeNormalizeBlueprint(buildFallbackLongformBlueprint(preparedUniverse), preparedUniverse, buildFallbackLongformBlueprint(preparedUniverse));
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
    let corePass = coreFallback;
    try {
        corePass = await chatJson<z.infer<typeof ZLongformBlueprintCore>>({
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
    } catch (error) {
        emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Core', status: 'error', summary: 'Core pass falhou — usando fallback local', detail: summarizeError(error) });
    }
    blueprint = safeNormalizeBlueprint({ ...blueprint, ...corePass }, preparedUniverse, fallback);
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
    let actsPass = actsFallback;
    try {
        actsPass = await chatJson<z.infer<typeof ZLongformBlueprintActsPass>>({
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
    } catch (error) {
        emitAgentOutput({ agent: 'weaver', label: 'Longform Blueprint · Acts', status: 'error', summary: 'Acts pass falhou — usando fallback local', detail: summarizeError(error) });
    }
    blueprint = safeNormalizeBlueprint({
        ...blueprint,
        acts: blueprint.acts.map((act, index) => ({
            ...act,
            ...(actsPass.acts[index] ?? actsFallback.acts[index] ?? {}),
            chapterStart: act.chapterStart,
            chapterEnd: act.chapterEnd,
        })),
        milestones: blueprint.milestones.map((item, index) => ({
            ...item,
            ...(actsPass.milestones[index] ?? actsFallback.milestones[index] ?? {}),
            chapter: item.chapter,
        })),
    }, preparedUniverse, fallback);
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
        let chapterPass = sliceFallback;
        try {
            chapterPass = await chatJson<z.infer<typeof ZLongformBlueprintChapterPass>>({
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
        } catch (error) {
            emitAgentOutput({ agent: 'weaver', label: `Longform Blueprint · Act ${act.actIndex}`, status: 'error', summary: 'Act pass falhou — usando slice fallback', detail: summarizeError(error) });
        }

        const chapterMapByNumber = new Map(chapterPass.chapters.map(entry => [entry.chapterNumber, entry]));
        blueprint = safeNormalizeBlueprint({
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
        }, preparedUniverse, fallback);
        emitAgentOutput({ agent: 'weaver', label: `Longform Blueprint · Act ${act.actIndex}`, status: 'done', summary: `${chapterPass.chapters.length} chapters refined` });
    }

    if (needsBlueprintRepair(blueprint)) {
        blueprint = safeNormalizeBlueprint({
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
        }, preparedUniverse, fallback);
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
    let current: Universe = {
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
        try {
            const directorGuidance = await generateDirectorGuidance(current, compactMode);
            current = applyDirectorGuidance(current, directorGuidance);
        } catch (error) {
            emitAgentOutput({ agent: 'director', label: 'Director · Longform Loop', status: 'error', summary: 'Director falhou — loop abortado com estado preservado', detail: summarizeError(error) });
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }

        onProgress({ chaptersDone: i, totalChapters, phase: 'weaver', currentUniverse: current });

        let updatedUniverse: Universe;
        try {
            ({ updatedUniverse } = await generateChapterWithAgents(
                current,
                {
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
                },
                (phase) => {
                    onProgress({ chaptersDone: i, totalChapters, phase, currentUniverse: current });
                },
            ));
        } catch (error) {
            emitAgentOutput({ agent: 'weaver', label: `Longform Chapter ${chapterNumber}`, status: 'error', summary: 'Geração de capítulo falhou — loop abortado com estado preservado', detail: summarizeError(error) });
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }

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
        try {
            const directorGuidance = await generateDirectorGuidance(current, compactMode);
            current = applyDirectorGuidance(current, directorGuidance);
        } catch (error) {
            emitAgentOutput({ agent: 'director', label: 'Director · Story Arc Loop', status: 'error', summary: 'Director falhou — arco abortado com estado preservado', detail: summarizeError(error) });
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }

        onProgress({ chaptersDone: i, totalChapters, phase: 'weaver', currentUniverse: current });

        let updatedUniverse: Universe;
        try {
            ({ updatedUniverse } = await generateChapterWithAgents(
                current,
                {
                    ...baseParams,
                    directorPrepared: true,
                },
                (phase) => {
                    onProgress({ chaptersDone: i, totalChapters, phase, currentUniverse: current });
                },
            ));
        } catch (error) {
            emitAgentOutput({ agent: 'weaver', label: `Story Arc Chapter ${i + 1}`, status: 'error', summary: 'Geração de capítulo falhou — arco abortado com estado preservado', detail: summarizeError(error) });
            onProgress({ chaptersDone: i, totalChapters, phase: 'aborted', currentUniverse: current });
            return current;
        }
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


