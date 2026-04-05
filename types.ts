export type StoryFormat =
  | 'light_novel'
  | 'web_novel'
  | 'novel';

export type StoryTheme =
  | 'redencao'
  | 'redenção'
  | 'poder_e_corrupcao'
  | 'poder_e_corrupção'
  | 'amor_proibido'
  | 'identidade'
  | 'vinganca'
  | 'vingança'
  | 'revolucao'
  | 'revolução'
  | 'sobrevivencia'
  | 'sobrevivência'
  | 'sacrificio'
  | 'sacrifício'
  | 'traicao'
  | 'traição'
  | 'jornada_do_heroi'
  | 'jornada_do_herói';

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

export type AIVisibility = 'global' | 'tracked' | 'hidden';
export type DirtyScope = 'project' | 'characters' | 'codex' | 'timeline' | 'factions' | 'rules' | 'chapters';

export interface SyncMeta {
  canonVersion: number;
  memoryVersion: number;
  dirtyScopes: DirtyScope[];
  lastSyncAt?: string;
  lastSyncMode?: 'light' | 'deep';
}

export interface TrackingConfig {
  trackByAlias: boolean;
  caseSensitive: boolean;
  exclusions: string[];
}

export type TruthLayerKind = 'CANON' | 'BELIEF' | 'MYTH';

export interface TruthLayerRecord {
  kind: TruthLayerKind;
  statement: string;
  ownerId?: string;
  sourceChapterId?: string;
  sourceExcerpt?: string;
  confidence?: number;
}

export interface TruthBundle {
  eventKey: string;
  needsReview?: boolean;
  layers: TruthLayerRecord[];
}

export type TimelineEventState =
  | 'historical'
  | 'active_pressure'
  | 'latent'
  | 'resolved'
  | 'forecast';

export type TimelineDiscoveryKind =
  | 'past_occurrence'
  | 'present_discovery'
  | 'forecast';

export type RuleEntryKind =
  | 'system'
  | 'magic'
  | 'location'
  | 'lore';

export type TimelineImpact =
  | 'low'
  | 'medium'
  | 'high'
  | 'cataclysmic';

export type TimelineScope =
  | 'personal'
  | 'local'
  | 'faction'
  | 'world';

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  imageUrl: string;
  role: 'Protagonista' | 'Antagonista' | 'Coadjuvante' | 'Mentor' | 'Figurante';
  faction: string;
  status: 'Vivo' | 'Morto' | 'Desconhecido';
  age: number;
  alignment: string;
  bio: string;
  notesPrivate?: string;
  aiVisibility: AIVisibility;
  tracking?: TrackingConfig;
  ghost?: string;
  coreLie?: string;
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
  endHook?: string;
  openingStyle?: OpeningStyle;
  aiVisibility?: AIVisibility;
  notesPrivate?: string;
}

export interface ArbiterIssue {
  severity: 'critical' | 'major' | 'minor';
  type: 'continuity' | 'pacing' | 'character' | 'magic_rule' | 'timeline' | 'logic';
  description: string;
  suggestion: string;
}

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
  introduced: number;
  resolved?: number;
}

export interface DirectorGuidance {
  openLoopCount: number;
  loopPriority: string;
  factionPressure: string;
  characterFocus: string;
  thematicConstraint: string;
  narrativePressure: string;
  wordsToSetOnCooldown: string[];
  cooldownSubstitutions?: Array<{ term: string; note: string }>;
  contradictionSummary?: string;
  liePressureSource?: string;
  protagonistLieStability?: number;
  ruptureRequired?: boolean;
}

export interface CharacterLieState {
  characterId: string;
  name: string;
  coreLie: string;
  lieStability: number;
  pressureSources: string[];
  contradictions: string[];
  ruptureRequired?: boolean;
  lastUpdatedChapter: number;
}

export interface NarrativeMemory {
  lastChapterIndex: number;
  globalSummary: string;
  characterStates: CharacterState[];
  openLoops: OpenLoop[];
  recentEvents: string[];
  newCodexEntries: {
    factions: Array<{ title: string; content: string }>;
    rules: Array<{ title: string; content: string }>;
    timeline: Array<{ title: string; content: string }>;
  };
  lastAuditFlags?: {
    wordOveruse?: string[];
    sceneObjectiveCheck?: string;
    passiveProtagonist?: string;
    rhetoricalPatternOveruse?: string;
    rhetoricalPatternCount?: number;
  };
  lexicalCooldown?: Record<string, number>;
  lexicalCooldownGuidance?: Record<string, string>;
  lieStates?: CharacterLieState[];
  directorGuidance?: DirectorGuidance;
}

export interface VisualAsset {
  id: string;
  url: string;
  prompt: string;
  type: 'character' | 'location' | 'cover' | 'concept';
  relatedTo: string;
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
  aliases: string[];
  content: string;
  notesPrivate?: string;
  aiVisibility: AIVisibility;
  tracking?: TrackingConfig;
  truth?: TruthBundle;
  ruleKind?: RuleEntryKind;
  eventState?: TimelineEventState;
  discoveryKind?: TimelineDiscoveryKind;
  timelineImpact?: TimelineImpact;
  timelineScope?: TimelineScope;
  relatedEntityIds?: string[];
  anchorCharacterIds?: string[];
  dependsOnIds?: string[];
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  color: string;
}

export interface Universe {
  id: string;
  name: string;
  subtitle?: string;
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
  notesPrivate?: string;
  syncMeta?: SyncMeta;
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
  chapterIndex?: number;
  lang?: 'pt' | 'en';
  skipWeaver?: boolean;
  prebuiltPlan?: WeaverPlan;
  qualityMode?: GenerationQualityMode;
  density?: 'scene' | 'chapter' | 'arc';
  directorPrepared?: boolean;
}

export type GenerationStep = 'idle' | 'anchors' | 'protagonist' | 'world_rules' | 'factions' | 'characters' | 'plotting' | 'writing_intro' | 'chronicler' | 'visualizing' | 'done';

export interface TokenUsageEvent {
  id: string;
  timestamp: number;
  provider: 'groq' | 'gemini' | 'cerebras' | 'openrouter';
  model: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type AgentOutputStatus = 'thinking' | 'done' | 'error';

export interface AgentOutputEvent {
  id: string;
  timestamp: number;
  agent: string;
  label: string;
  status: AgentOutputStatus;
  summary?: string;
  detail?: string;
}
