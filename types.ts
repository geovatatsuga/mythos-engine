
export type StoryFormat =
  | 'light_novel'
  | 'web_novel'
  | 'novel';

export type StoryTheme =
  | 'redenção'
  | 'poder_e_corrupção'
  | 'amor_proibido'
  | 'identidade'
  | 'vingança'
  | 'revolução'
  | 'sobrevivência'
  | 'traição';

export type LiteraryArchetype =
  | 'tolkien'
  | 'dostoevski'
  | 'shakespeare'
  | 'isekai'
  | 'realismo_magico'
  | 'opera_espacial'
  | 'romance_gothico'
  | 'noir';

export type NarrativePOV = 'primeira_pessoa' | 'terceiro_limitado' | 'terceiro_onisciente';

export interface StoryProfile {
  premise?: string;
  format?: StoryFormat;
  themes: StoryTheme[];
  archetypes: LiteraryArchetype[];
  pov?: NarrativePOV;
  tone?: 'Sombrio' | 'Épico' | 'Misterioso' | 'Dramático' | 'Humorístico' | 'Lírico';
  lang?: 'pt' | 'en';
}

export interface UniverseIdea {
  name: string;
  description: string;
  profile?: StoryProfile;
}

export type View = 'dashboard' | 'codex' | 'characters' | 'chapters' | 'assets' | 'agents';

export interface ToastMessage {
  message: string;
  type: 'success' | 'error';
}

export interface Character {
  id: string;
  name: string;
  imageUrl: string;
  role: 'Protagonista' | 'Antagonista' | 'Coadjuvante' | 'Mentor' | 'Figurante';
  faction: string;
  status: 'Vivo' | 'Morto' | 'Desconhecido';
  age: number;
  alignment: string;
  bio: string;
  relationships: { characterId: string; description: string }[];
  chapters: string[];
}

export type OpeningStyle =
  | 'action'
  | 'dialogue'
  | 'description'
  | 'introspection'
  | 'in_medias_res'
  | 'flashback'
  | 'epistolary';

export interface Chapter {
  id: string;
  title: string;
  status: 'Rascunho' | 'Revisado' | 'Aprovado';
  content: string;
  summary: string;
  endHook?: string;       // The cliffhanger/hook the Weaver planned for this chapter
  openingStyle?: OpeningStyle;
}

export interface ArbiterIssue {
  severity: 'critical' | 'major' | 'minor';
  type: 'continuity' | 'pacing' | 'character' | 'magic_rule' | 'timeline' | 'logic';
  description: string;
  suggestion: string;
}

// ─── Narrative Memory (Layered Memory System) ───────────────────────────────

export interface CharacterState {
  characterId: string;
  name: string;
  status: 'Vivo' | 'Morto' | 'Desconhecido';
  location?: string;
  emotionalState?: string;
  lastAction?: string;
}

export interface OpenLoop {
  id: string;
  description: string;
  introduced: number;   // chapter index where it first appeared
  resolved?: number;    // chapter index where it was resolved (undefined = still open)
}

export interface DirectorGuidance {
  openLoopCount: number;                       // how many loops are currently unresolved
  loopPriority: string;                        // the oldest/most urgent open loop + deadline in cycles
  factionPressure: string;                     // which faction is underrepresented or dominant
  characterFocus: string;                      // what the protagonist must actively do/confront this chapter
  thematicConstraint: string;                  // the thematic pressure that must bear down on this chapter
  narrativePressure: string;                   // the GM-level tension to inject — not a prescribed action
  wordsToSetOnCooldown: string[];              // words detected as overused — engine will apply 2-chapter cooldown
}

export interface NarrativeMemory {
  lastChapterIndex: number;
  globalSummary: string;                       // running story summary
  characterStates: CharacterState[];           // latest state per character
  openLoops: OpenLoop[];                       // unresolved plot threads
  recentEvents: string[];                      // last ~5 key events for quick context
  newCodexEntries: {                           // extracted by Chronicler (Pass 3)
    factions: Array<{ title: string; content: string }>;
    rules: Array<{ title: string; content: string }>;
    timeline: Array<{ title: string; content: string }>;
  };
  lastAuditFlags?: {                           // quality flags from previous Chronicler
    wordOveruse?: string[];
    sceneObjectiveCheck?: string;
    passiveProtagonist?: string;
  };
  lexicalCooldown?: Record<string, number>;    // word → chapterIndex at which cooldown expires
  directorGuidance?: DirectorGuidance;         // Director output — per-chapter narrative health
}

export interface VisualAsset {
  id: string;
  url: string;
  prompt: string;
  type: 'character' | 'location' | 'cover' | 'concept';
  relatedTo: string; // Character ID, Location Name, Chapter ID etc.
}

export interface SoundAsset {
  id: string;
  url: string;
  prompt: string;
  type: 'trilha' | 'ambiente';
  mood: string;
}

export interface CodexEntry {
  id: string;
  title: string;
  content: string;
}

export interface AgentConfig {
    id: string;
    name: string;
    role: string;
    description: string;
    systemPrompt: string; // The customizable brain
    color: string;
}

export interface Universe {
  id: string;
  name: string;
  description: string;
  lastGenerated: string;
  lang?: 'pt' | 'en';
  codex: {
    overview: string;
    timeline: CodexEntry[];
    factions: CodexEntry[];
    rules: CodexEntry[];
  };
  characters: Character[];
  chapters: Chapter[];
  assets: {
    visual: VisualAsset[];
    sound: SoundAsset[];
  };
  agentConfigs?: Record<string, AgentConfig>;
  storyProfile?: StoryProfile;
  narrativeMemory?: NarrativeMemory;
}

export interface WeaverPlan {
    chapterTitle: string;
    scenes: Array<{ beat: string; characters: string[]; tension: string }>;
    chapterSummary: string;
    endHook: string;
}

export type GenerationQualityMode = 'balanced' | 'economy';

export interface ChapterGenerationParams {
    title: string;
    plotDirection: string;
    activeCharacterIds: string[];
    tone: 'Sombrio' | 'Épico' | 'Misterioso' | 'Dramático' | 'Humorístico' | 'Lírico';
    focus: 'Ação' | 'Diálogo' | 'Lore' | 'Introspecção';
    chapterIndex?: number; // 0-based position in the chapter list to write at
    lang?: 'pt' | 'en';
    skipWeaver?: boolean;  // bypass Weaver LLM call and use pre-built plan (e.g. genesis chapter)
    prebuiltPlan?: WeaverPlan; // plan to use when skipWeaver is true
    qualityMode?: GenerationQualityMode;
    density?: 'scene' | 'chapter' | 'arc'; // scene=1-3 beats, chapter=5-7 (default), arc=time-skip prose
}

export type GenerationStep = 'idle' | 'anchors' | 'protagonist' | 'world_rules' | 'factions' | 'characters' | 'plotting' | 'writing_intro' | 'chronicler' | 'visualizing' | 'done';

// ─── Token Usage Tracker ─────────────────────────────────────────────────────

export interface TokenUsageEvent {
  id: string;
  timestamp: number;
  provider: 'groq' | 'gemini' | 'cerebras';
  model: string;
  label: string;          // e.g. "Weaver · Capítulo 3"
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── Agent Output Events (thinking panel) ────────────────────────────────────

export type AgentOutputStatus = 'thinking' | 'done' | 'error';

export interface AgentOutputEvent {
  id: string;
  agent: string;           // e.g. "weaver", "bard", "chronicler"
  label: string;           // e.g. "Weaver · Planner"
  status: AgentOutputStatus;
  summary?: string;        // short human-readable output summary
  detail?: string;         // full output (JSON stringified or prose snippet)
  timestamp: number;
}
