import { createPortraitUrl } from '../../utils/portraits';
import type { ChapterGenerationParams, Character, GenerationQualityMode, StoryProfile, Universe, UniverseIdea, VisualAsset } from '../../types';
import { DEFAULT_TRACKING, createLayeredTruthBundle, ensureCodexEntryDefaults, ensureSyncMeta, ensureUniverseDefaults, normalizeAliasList, normalizeTitle } from './canon';
import { buildImagePlaceholder, getAgentPrompt, pickBackground, pickFactionArchetypes } from './context';
import { applyChroniclerSideEffects, generateChapterThreePass } from './chapterPipeline';
import { buildProfileContext, chatJson, emitAgentOutput, generateId, isEconomyMode, langMandate } from './llm';

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
        aliases: [],
        aiVisibility: 'tracked',
        truth: createLayeredTruthBundle(`faction:${normalizeTitle(f.title)}`, f.content, { belief: f.belief, myth: f.myth }),
    }));
    if (data.rules) newUniverse.codex.rules = data.rules.map((r) => ensureCodexEntryDefaults({
        id: generateId(),
        title: r.title,
        content: r.content,
        aliases: [],
        aiVisibility: 'tracked',
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
        aliases: [],
        aiVisibility: 'tracked',
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
        aliases: [],
        aiVisibility: 'tracked',
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

