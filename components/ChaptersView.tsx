
import React, { useState, useEffect } from 'react';
import type { Universe, Chapter, ChapterGenerationParams, ArbiterIssue, WeaverPlan } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';
import Modal from './ui/Modal';
import InlineHelp from './ui/InlineHelp';
import { Plus, Edit, FileText, Sparkles, BookOpen, Microchip, UserCheck, Search, Save, Eye, RefreshCw, ArrowLeft, CheckCircle2, Globe } from 'lucide-react';
import { generateChapterWithAgents, suggestNextChapterPlot, reviewChapterWithArbiter, rewriteChapterBySuggestions, generateWeaverPlans } from '../services/geminiService';
import Toast from './ui/Toast';
import { MeanderDivider } from './ui/MeanderDivider';
import { useLanguage } from '../LanguageContext';

interface ChaptersViewProps {
  universe: Universe;
  onGenerateChapter: () => void;
  onUpdateUniverse?: (universe: Universe) => void;
  isLoading: boolean;
}

const ChapterListItem: React.FC<{ chapter: Chapter; onSelect: () => void, isSelected: boolean }> = ({ chapter, onSelect, isSelected }) => {
    const { t } = useLanguage();
    const statusColors: Record<Chapter['status'], string> = {
        'Rascunho': 'bg-yellow-500',
        'Revisado': 'bg-blue-500',
        'Aprovado': 'bg-green-500'
    };
    const chapterTitle = typeof chapter.title === 'string' && chapter.title.trim().length > 0
        ? chapter.title
        : 'Capítulo sem título';
    const chapterSummary = typeof chapter.summary === 'string' ? chapter.summary : '';
    const chapterStatus = chapter.status in statusColors ? chapter.status : 'Rascunho';
    return (
    <div onClick={onSelect} className={`p-4 rounded-lg cursor-pointer transition-colors duration-200 ${isSelected ? 'bg-nobel/10 border-l-4 border-nobel' : 'hover:bg-surface hover:shadow-sm'}`}>
        <div className="flex justify-between items-center">
            <h4 className="font-serif font-semibold text-stone-dark">{chapterTitle}</h4>
            <span className={`px-2 py-1 text-[10px] uppercase tracking-wider text-white rounded-full ${statusColors[chapterStatus]}`}>{t(`status.${chapterStatus}`)}</span>
        </div>
        <p className="text-sm text-text-secondary mt-1 truncate font-sans">{chapterSummary}</p>
    </div>
    );
};

const TextEditor: React.FC<{ 
    chapter: Chapter | null; 
    onReviewChapter: () => void;
    isReviewing: boolean;
    reviewIssues: ArbiterIssue[];
    onRewriteChapter: () => void;
    isRewriting: boolean;
}> = ({ chapter, onReviewChapter, isReviewing, reviewIssues, onRewriteChapter, isRewriting }) => {
    const { t } = useLanguage();
    const [isEditMode, setIsEditMode] = useState(false);
    const [content, setContent] = useState('');
    const [showIssues, setShowIssues] = useState(false);
    const chapterTitle = typeof chapter?.title === 'string' && chapter.title.trim().length > 0
        ? chapter.title
        : 'Capítulo sem título';
    const chapterContent = typeof chapter?.content === 'string' ? chapter.content : '';

    useEffect(() => {
        if (chapter) {
            setContent(chapterContent);
            setIsEditMode(false);
        } else {
            setContent('');
        }
    }, [chapter, chapterContent]);

    if (!chapter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-stone-400 opacity-50">
                <FeatherIcon className="w-16 h-16 mb-4" />
                <p className="font-serif italic text-lg">{t('chapters.selectHint')}</p>
            </div>
        );
    }
    
    const aiSuggestions = [t('ai.suggest.1'), t('ai.suggest.2'), t('ai.suggest.3'), t('ai.suggest.4')];

    // ── Prose renderer ────────────────────────────────────────────────────
    // Parses inline markdown tokens: **/__ bold, _/_ italic (thoughts),
    // "dialogue", and renders scene-break lines (---, ***, ===) as dividers.

    const renderInline = (text: string): React.ReactNode[] => {
        const nodes: React.ReactNode[] = [];
        // Token pattern: **bold**, __bold__, _italic_, *italic*, "quoted dialogue"
        const TOKEN = /(\*\*|__)(.+?)\1|(_|\*)(.+?)\3|("([^"]*)")/g;
        let last = 0;
        let m: RegExpExecArray | null;
        let key = 0;

        while ((m = TOKEN.exec(text)) !== null) {
            // Push plain text before match
            if (m.index > last) {
                nodes.push(<React.Fragment key={key++}>{text.slice(last, m.index)}</React.Fragment>);
            }

            if (m[1]) {
                // **bold** or __bold__
                nodes.push(<strong key={key++} className="font-bold text-stone-900">{m[2]}</strong>);
            } else if (m[3]) {
                // _italic_ or *italic* — inner thought
                nodes.push(
                    <em key={key++} className="italic text-stone-500 not-italic" style={{ fontStyle: 'italic', color: '#78716c' }}>
                        {m[4]}
                    </em>
                );
            } else if (m[5]) {
                // "dialogue" — styled with subtle color + quotation marks preserved
                nodes.push(
                    <span key={key++} className="text-stone-800 font-medium" style={{ color: '#1c1917' }}>
                        {m[5]}
                    </span>
                );
            }

            last = m.index + m[0].length;
        }

        // Remaining plain text
        if (last < text.length) {
            nodes.push(<React.Fragment key={key++}>{text.slice(last)}</React.Fragment>);
        }

        return nodes;
    };

    const isSceneBreak = (line: string) => /^(\*{3}|-{3}|={3}|#{1,3}\s*\*{3})$/.test(line.trim());
    const isHeading = (line: string) => /^#{1,4}\s+/.test(line.trim());
    const getHeadingText = (line: string) => line.replace(/^#{1,4}\s+/, '').trim();

    const renderParagraph = (p: string, idx: number, isFirst: boolean): React.ReactNode => {
        const trimmed = p.trim();

        // Scene break
        if (isSceneBreak(trimmed)) {
            return <MeanderDivider key={idx} className="text-nobel my-8" />;
        }

        // Headings (#, ##, ###)
        if (isHeading(trimmed)) {
            const text = getHeadingText(trimmed);
            const level = (trimmed.match(/^(#{1,4})/) || ['', '#'])[1].length;
            const cls = level === 1
                ? 'text-2xl font-serif font-bold text-stone-dark mt-10 mb-4'
                : 'text-lg font-serif font-semibold text-stone-600 mt-8 mb-3 uppercase tracking-widest';
            return <p key={idx} className={cls}>{text}</p>;
        }

        // First paragraph — drop cap
        if (isFirst) {
            return (
                <p key={idx} className="mb-5 leading-[1.9] text-stone-800 text-[1.05rem] first-letter:float-left first-letter:text-7xl first-letter:font-serif first-letter:text-nobel first-letter:leading-[0.8] first-letter:mr-3 first-letter:mt-2">
                    {renderInline(trimmed)}
                </p>
            );
        }

        // Dialogue-dominant paragraph — very light left border
        const isDialogueParagraph = /^["""«—]/.test(trimmed) || /^["«]/.test(trimmed);

        return (
            <p
                key={idx}
                className={`mb-5 leading-[1.9] text-stone-800 text-[1.05rem]${isDialogueParagraph ? ' pl-3 border-l-2 border-stone-200' : ''}`}
            >
                {renderInline(trimmed)}
            </p>
        );
    };

    const rawLines = content.split('\n').filter(l => l.trim() !== '');
    let firstParagraphSeen = false;
    const renderedParagraphs = rawLines.map((line, idx) => {
        const trimmed = line.trim();
        const thisIsFirst = !firstParagraphSeen && !isHeading(trimmed) && !isSceneBreak(trimmed);
        if (thisIsFirst) firstParagraphSeen = true;
        return renderParagraph(line, idx, thisIsFirst);
    });

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full">
            <div className="flex-grow h-full flex flex-col bg-paper rounded-lg shadow-sm border border-stone-200 overflow-hidden relative">
                 <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/aged-paper.png')]" />
                 <div className="bg-stone-50 p-3 border-b border-stone-200 flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-2">
                         <span className="text-xs font-bold uppercase tracking-widest text-stone-500">{t('chapters.editorLabel')}</span>
                         <span className="text-xs text-stone-400 px-2 border-l border-stone-300">{content.length} {t('chapters.chars')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                         <Button 
                             variant="ghost" 
                             size="sm" 
                             onClick={() => setIsEditMode(!isEditMode)}
                         >
                             {isEditMode ? <><Eye className="w-3 h-3 mr-1" /> {t('chapters.readMode')}</> : <><Edit className="w-3 h-3 mr-1" /> {t('chapters.editMode')}</>}
                         </Button>
                         {isEditMode && <Button variant="ghost" size="sm"><Save className="w-3 h-3 mr-1" /> {t('chapters.save')}</Button>}
                    </div>
                 </div>
                 
                 <div className="flex-grow overflow-y-auto relative z-10">
                     {isEditMode ? (
                        <textarea 
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full h-full p-8 bg-transparent text-stone-800 font-serif text-lg leading-relaxed focus:outline-none resize-none"
                        />
                     ) : (
                        <div className="p-8 md:p-12 max-w-3xl mx-auto">
                            <h1 className="text-4xl font-serif font-bold text-center mb-12 text-stone-dark">{chapterTitle.replace(/^#+\s*/, '')}</h1>
                            <div className="font-serif text-stone-800">
                                {renderedParagraphs}
                            </div>
                        </div>
                     )}
                 </div>
            </div>
            <div className="lg:w-1/4 flex-shrink-0 space-y-4">
                <Card className="p-4 bg-stone-50 border-stone-200">
                    <h4 className="font-bold text-xs uppercase tracking-widest mb-3 flex items-center text-primary">
                        <Sparkles className="h-4 w-4 mr-2"/>{t('chapters.aiEditor')}
                        <span className="ml-2"><InlineHelp content={t('help.chapters.arbiter')} /></span>
                    </h4>
                    <div className="space-y-2 mb-4">
                        {aiSuggestions.map(sugg => (
                            <button key={sugg} className="w-full text-left text-sm text-stone-600 hover:text-primary hover:bg-stone-100 p-2 rounded transition-colors flex items-center">
                                <span className="w-1.5 h-1.5 rounded-full bg-nobel mr-2"></span>
                                {sugg}
                            </button>
                        ))}
                    </div>
                    <div className="border-t border-stone-200 pt-4">
                        <Button 
                            variant="secondary" 
                            size="sm" 
                            className="w-full justify-center" 
                            onClick={onReviewChapter}
                            isLoading={isReviewing}
                        >
                            <Search className="w-3 h-3 mr-2" /> {t('chapters.arbiterReview')}
                        </Button>

                        {/* Teaser badge — appears after review completes */}
                        {!isReviewing && reviewIssues.length > 0 && (
                            <button
                                onClick={() => setShowIssues(v => !v)}
                                className="mt-3 w-full flex items-center justify-between px-3 py-2 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors group"
                            >
                                <span className="flex items-center gap-2 text-xs font-semibold text-red-600">
                                    <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                        {reviewIssues.length}
                                    </span>
                                    {reviewIssues.length === 1
                                        ? t('chapters.arbiter.oneIssue')
                                        : t('chapters.arbiter.manyIssues').replace('{n}', String(reviewIssues.length))}
                                </span>
                                <span className="text-red-400 text-xs group-hover:text-red-600 transition-colors">
                                    {showIssues ? '▲' : '▼'}
                                </span>
                            </button>
                        )}

                        {/* Collapsed issue list */}
                        {showIssues && reviewIssues.length > 0 && (
                            <div className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200 space-y-2">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-red-500 mb-1">
                                    {t('chapters.issuesFound')}
                                </p>
                                <ul className="space-y-3">
                                    {reviewIssues.map((issue, i) => {
                                        const severityColor = issue.severity === 'critical'
                                            ? 'bg-red-600'
                                            : issue.severity === 'major'
                                            ? 'bg-orange-500'
                                            : 'bg-yellow-500';
                                        return (
                                            <li key={i} className="text-xs text-stone-700 leading-snug">
                                                <div className="flex items-start gap-2">
                                                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold text-white flex-shrink-0 ${severityColor}`}>
                                                        {issue.severity}
                                                    </span>
                                                    <span className="font-medium text-stone-800">{issue.description}</span>
                                                </div>
                                                {issue.suggestion && (
                                                    <p className="mt-1 ml-1 text-[11px] text-stone-500 italic pl-2 border-l border-stone-300">
                                                        {t('chapters.arbiter.fix')}: {issue.suggestion}
                                                    </p>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                                {/* Rewrite button */}
                                <div className="pt-2 border-t border-red-200">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="w-full justify-center bg-amber-50 border-amber-400 text-amber-800 hover:bg-amber-100"
                                        onClick={onRewriteChapter}
                                        isLoading={isRewriting}
                                    >
                                        <RefreshCw className="w-3 h-3 mr-2" />
                                        {t('chapters.arbiter.rewrite')}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {!isReviewing && reviewIssues.length === 0 && (
                            <p className="text-xs text-stone-400 mt-2 italic text-center">{t('chapters.noIssues')}</p>
                        )}
                    </div>
                </Card>
                <Card className="p-4 bg-stone-50 border-stone-200">
                     <h4 className="font-bold text-xs uppercase tracking-widest mb-3 flex items-center text-stone-500">
                        <BookOpen className="h-4 w-4 mr-2"/>{t('chapters.references')}
                     </h4>
                     <button className="text-sm text-stone-600 hover:text-primary underline decoration-dotted">
                         {t('chapters.linkedChars')}
                     </button>
                </Card>
            </div>
        </div>
    );
};

const LoomSigil: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4v16" />
        <path d="M18 4v16" />
        <path d="M6 8h12" />
        <path d="M6 16h12" />
        <path d="M9 8v8" />
        <path d="M12 8v8" />
        <path d="M15 8v8" />
    </svg>
);

const DirectorSigil: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <path d="M9.5 14.5 15 9" />
        <path d="m15 9-1 4-4 1" />
    </svg>
);

const BardSeal: React.FC<{ className?: string }> = ({ className }) => (
    <div className={`inline-flex items-center justify-center rounded-full ${className || ''}`}>
        <FeatherIcon className="w-full h-full" />
    </div>
);

const sanitizeToneValue = (value: string): ChapterGenerationParams['tone'] => {
    const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalized.includes('epic') || normalized.includes('pico')) return '\u00C9pico';
    if (normalized.includes('mister')) return 'Misterioso';
    if (normalized.includes('dramat')) return 'Dram\u00E1tico';
    if (normalized.includes('humor')) return 'Humor\u00EDstico';
    if (normalized.includes('liric') || normalized.includes('lirico')) return 'L\u00EDrico';
    return 'Sombrio';
};

const sanitizeFocusValue = (value: string): ChapterGenerationParams['focus'] => {
    const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalized.includes('dialog')) return 'Di\u00E1logo';
    if (normalized.includes('lore')) return 'Lore';
    if (normalized.includes('introspec')) return 'Introspec\u00E7\u00E3o';
    return 'A\u00E7\u00E3o';
};

const getToneLabel = (value: ChapterGenerationParams['tone'], lang: 'pt' | 'en') => {
    const labels: Record<ChapterGenerationParams['tone'], { pt: string; en: string }> = {
        Sombrio: { pt: 'Sombrio', en: 'Dark' },
        '\u00C9pico': { pt: 'Épico', en: 'Epic' },
        Misterioso: { pt: 'Misterioso', en: 'Mysterious' },
        'Dram\u00E1tico': { pt: 'Dramático', en: 'Dramatic' },
        'Humor\u00EDstico': { pt: 'Humorístico', en: 'Humorous' },
        'L\u00EDrico': { pt: 'Lírico', en: 'Lyrical' },
    };
    return labels[value][lang];
};

const getFocusLabel = (value: ChapterGenerationParams['focus'], lang: 'pt' | 'en') => {
    const labels: Record<ChapterGenerationParams['focus'], { pt: string; en: string }> = {
        'A\u00E7\u00E3o': { pt: 'Ação', en: 'Action' },
        'Di\u00E1logo': { pt: 'Diálogo', en: 'Dialogue' },
        Lore: { pt: 'Lore', en: 'Lore' },
        'Introspec\u00E7\u00E3o': { pt: 'Introspecção', en: 'Introspection' },
    };
    return labels[value][lang];
};

// --- New Modal for Agent Configuration ---

const NarrativeLabModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    universe: Universe;
    onSubmit: (params: ChapterGenerationParams) => void;
    isLoading: boolean;
}> = ({ isOpen, onClose, universe, onSubmit, isLoading }) => {
    const { t, lang } = useLanguage();
    const [params, setParams] = useState<ChapterGenerationParams>({
        title: '',
        plotDirection: '',
        activeCharacterIds: [],
        tone: 'Dramático',
        focus: 'Ação'
    });
    const [chapterPosition, setChapterPosition] = useState<number | 'end'>('end');
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestError, setSuggestError] = useState<string | null>(null);
    // BVSR state
    const [step, setStep] = useState<'form' | 'plans'>('form');
    const [weaverPlans, setWeaverPlans] = useState<WeaverPlan[]>([]);
    const [selectedPlanIdx, setSelectedPlanIdx] = useState<number | null>(null);
    const [isGeneratingPlans, setIsGeneratingPlans] = useState(false);
    const [planError, setPlanError] = useState<string | null>(null);
    const toneOptions: Array<{ value: ChapterGenerationParams['tone']; sigil: string; accent: string; description: { pt: string; en: string } }> = [
        { value: 'Sombrio', sigil: 'S', accent: 'from-stone-900 via-stone-800 to-stone-700', description: { pt: 'Peso, perda e consequência sem consolo fácil.', en: 'Weight, loss, and consequence without easy relief.' } },
        { value: 'Ã‰pico', sigil: 'E', accent: 'from-amber-700 via-yellow-600 to-amber-500', description: { pt: 'Escala mítica, destino e feitos dignos de crônica.', en: 'Mythic scale, fate, and deeds worthy of legend.' } },
        { value: 'Misterioso', sigil: 'M', accent: 'from-sky-900 via-slate-800 to-indigo-700', description: { pt: 'Véus, suspeitas e revelações mantidas na sombra.', en: 'Veils, suspicion, and revelations kept in shadow.' } },
        { value: 'DramÃ¡tico', sigil: 'D', accent: 'from-rose-800 via-red-700 to-amber-600', description: { pt: 'Ruptura emocional, confronto e custo íntimo.', en: 'Emotional rupture, confrontation, and intimate cost.' } },
        { value: 'HumorÃ­stico', sigil: 'H', accent: 'from-emerald-700 via-teal-600 to-cyan-500', description: { pt: 'Leveza afiada, ironia e fôlego entre golpes.', en: 'Sharp levity, irony, and breathing room between blows.' } },
        { value: 'LÃ­rico', sigil: 'L', accent: 'from-violet-700 via-fuchsia-600 to-rose-500', description: { pt: 'Cadência poética e imagem sensorial mais rica.', en: 'Poetic cadence and richer sensory imagery.' } },
    ];
    const focusOptions: Array<{ value: ChapterGenerationParams['focus']; sigil: string; accent: string; description: { pt: string; en: string } }> = [
        { value: 'AÃ§Ã£o', sigil: 'I', accent: 'from-stone-900 via-amber-700 to-red-700', description: { pt: 'Choque, deslocamento e decisão física no centro da cena.', en: 'Collision, movement, and physical decisions at the center of the scene.' } },
        { value: 'DiÃ¡logo', sigil: 'II', accent: 'from-stone-900 via-stone-700 to-amber-500', description: { pt: 'Vozes em atrito, subtexto e alianças testadas.', en: 'Voices in friction, subtext, and alliances under strain.' } },
        { value: 'Lore', sigil: 'III', accent: 'from-stone-900 via-blue-800 to-teal-600', description: { pt: 'Segredos do mundo, instituições e memória antiga.', en: 'World secrets, institutions, and ancient memory.' } },
        { value: 'IntrospecÃ§Ã£o', sigil: 'IV', accent: 'from-stone-900 via-indigo-800 to-violet-600', description: { pt: 'Pressão interior, desejo, culpa e contradição.', en: 'Inner pressure, desire, guilt, and contradiction.' } },
    ];
    const normalizedToneOptions = toneOptions.map(option => ({ ...option, value: sanitizeToneValue(option.value) }));
    const normalizedFocusOptions = focusOptions.map(option => ({ ...option, value: sanitizeFocusValue(option.value) }));
    const selectedTone = normalizedToneOptions.find(option => option.value === sanitizeToneValue(params.tone)) ?? normalizedToneOptions[3];
    const selectedFocus = normalizedFocusOptions.find(option => option.value === sanitizeFocusValue(params.focus)) ?? normalizedFocusOptions[0];

    useEffect(() => {
        setParams(prev => ({
            ...prev,
            tone: sanitizeToneValue(prev.tone),
            focus: sanitizeFocusValue(prev.focus),
        }));
    }, []);

    const toggleCharacter = (id: string) => {
        setParams(prev => ({
            ...prev,
            activeCharacterIds: prev.activeCharacterIds.includes(id)
                ? prev.activeCharacterIds.filter(cid => cid !== id)
                : [...prev.activeCharacterIds, id]
        }));
    };

    const handleSubmit = () => {
        if (!params.title || !params.plotDirection) return;
        onSubmit({
            ...params,
            chapterIndex: chapterPosition === 'end' ? undefined : chapterPosition,
            lang,
        });
    };

    const handleGeneratePlans = async () => {
        if (!params.title || !params.plotDirection) return;
        setIsGeneratingPlans(true);
        setPlanError(null);
        setSelectedPlanIdx(null);
        try {
            const baseParams: ChapterGenerationParams = {
                ...params,
                chapterIndex: chapterPosition === 'end' ? undefined : chapterPosition,
                lang,
            };
            const plans = await generateWeaverPlans(universe, baseParams);
            setWeaverPlans(plans);
            setStep('plans');
        } catch (e) {
            setPlanError(e instanceof Error ? e.message : t('chapters.errorPlans'));
        } finally {
            setIsGeneratingPlans(false);
        }
    };

    const handleWriteWithPlan = () => {
        if (selectedPlanIdx === null) return;
        onSubmit({
            ...params,
            chapterIndex: chapterPosition === 'end' ? undefined : chapterPosition,
            lang,
            skipWeaver: true,
            prebuiltPlan: weaverPlans[selectedPlanIdx],
        });
    };

    const handleAutoSuggest = async () => {
        setIsSuggesting(true);
        setSuggestError(null);
        const targetIndex = chapterPosition === 'end' ? undefined : chapterPosition;
        try {
            const idea = await suggestNextChapterPlot(universe, targetIndex);
            setParams(prev => ({
                ...prev,
                title: idea.title,
                plotDirection: idea.plot,
                activeCharacterIds: idea.activeCharacters.length > 0 ? idea.activeCharacters : prev.activeCharacterIds
            }));
        } catch (error) {
            console.error(error);
            const msg = error instanceof Error ? error.message : t('chapters.errorSuggest');
            setSuggestError(msg);
        } finally {
            setIsSuggesting(false);
        }
    };

    const appendLabel = `${t('chapters.newChapterAppend')} ${universe.chapters.length + 1}`;

    return (
        <>
        <Modal isOpen={isOpen} onClose={onClose} title={t('chapters.modal.title')}>
            <div className="space-y-6">
                <div className="relative overflow-hidden rounded-2xl border border-amber-200/60 bg-gradient-to-br from-stone-950 via-stone-900 to-amber-950 p-5 text-stone-100 shadow-xl">
                    <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.35),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(251,191,36,0.18),_transparent_35%)]" />
                    <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.26em] text-amber-200">
                                <LoomSigil className="h-3.5 w-3.5" />
                                {lang === 'en' ? 'Weaver Chamber' : 'Câmara do Tecelão'}
                            </div>
                            <div>
                                <p className="font-serif text-xl text-amber-50">
                                    {lang === 'en'
                                        ? 'The Director judges the rhythm. The Weaver spins the plot. The Bard sings the prose.'
                                        : 'O Director julga o ritmo. O Tecelão fia o enredo. O Bardo canta a prosa.'}
                                </p>
                                <p className="mt-2 text-sm leading-relaxed text-stone-300">{t('chapters.modal.auto')}</p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-stone-300">
                                <span className="inline-flex items-center gap-2 rounded-full border border-stone-500/60 bg-stone-900/40 px-3 py-1">
                                    <DirectorSigil className="h-3.5 w-3.5 text-amber-300" />
                                    Director
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-stone-500/60 bg-stone-900/40 px-3 py-1">
                                    <LoomSigil className="h-3.5 w-3.5 text-amber-300" />
                                    Weaver
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-stone-500/60 bg-stone-900/40 px-3 py-1">
                                    <BardSeal className="h-3.5 w-3.5 text-amber-300" />
                                    Bard
                                </span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleAutoSuggest}
                            disabled={isSuggesting}
                            className="group inline-flex items-center justify-center gap-3 self-start rounded-2xl border border-amber-300/30 bg-amber-100 px-5 py-3 text-left text-stone-900 shadow-lg shadow-black/30 transition-all hover:-translate-y-0.5 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            <LoomSigil className="h-5 w-5 text-amber-700 transition-transform group-hover:rotate-6" />
                            <span className="flex flex-col">
                                <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-amber-700/80">
                                    {lang === 'en' ? 'Invoke the Weaver' : 'Invocar o Tecelão'}
                                </span>
                                <span className="text-sm font-semibold">{isSuggesting ? (lang === 'en' ? 'Weaving plot...' : 'Tecendo enredo...') : t('chapters.modal.autoCta')}</span>
                            </span>
                        </button>
                    </div>
                </div>
                {suggestError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                        ⚠ {suggestError}
                    </div>
                )}

                {/* Chapter Position Selector */}
                <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">
                        {t('chapters.chapterPosition')}
                    </label>
                    <select
                        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-stone-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        value={chapterPosition === 'end' ? 'end' : String(chapterPosition)}
                        onChange={e => setChapterPosition(e.target.value === 'end' ? 'end' : Number(e.target.value))}
                    >
                        <option value="end">{appendLabel}</option>
                        {universe.chapters.map((ch, i) => (
                            <option key={i} value={i}>
                                {`${t('chapters.insertBefore')} "${ch.title}" (${t('chapters.position')} ${i + 1})`}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Setup */}
                    <div className="space-y-5">
                        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.chTitle')}</label>
                            <input 
                                type="text" 
                                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                placeholder={t('chapters.modal.chPlaceholder')}
                                value={params.title}
                                onChange={e => setParams({...params, title: e.target.value})}
                            />
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.plot')}</label>
                            <textarea 
                                className="h-32 w-full resize-none rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                placeholder={t('chapters.modal.plotPlaceholder')}
                                value={params.plotDirection}
                                onChange={e => setParams({...params, plotDirection: e.target.value})}
                            />
                        </div>
                         <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                            <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
                                    <span>{t('chapters.modal.tone')}</span>
                                    <InlineHelp content={t('help.chapters.tone')} />
                                </label>
                                <select 
                                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    value={params.tone}
                                    onChange={e => setParams({...params, tone: e.target.value as any})}
                                >
                                    {TONE_VALUES.map(tn => <option key={tn} value={tn}>{getToneLabel(tn, lang)}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
                                    <span>{t('chapters.modal.focus')}</span>
                                    <InlineHelp content={t('help.chapters.focus')} />
                                </label>
                                <select 
                                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 text-stone-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    value={params.focus}
                                    onChange={e => setParams({...params, focus: e.target.value as any})}
                                >
                                    {FOCUS_VALUES.map(fc => <option key={fc} value={fc}>{getFocusLabel(fc, lang)}</option>)}
                                </select>
                            </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <div className="relative min-h-[120px] overflow-hidden rounded-2xl border border-amber-300 bg-white p-3 shadow-sm shadow-amber-100">
                                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${selectedTone.accent}`} />
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex h-10 w-10 min-w-10 items-center justify-center rounded-full border border-amber-200 bg-amber-50 font-serif text-sm text-amber-700">
                                            {selectedTone.sigil}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-serif text-base leading-tight text-stone-900">{getToneLabel(selectedTone.value, lang)}</p>
                                            <p className="mt-1 text-xs leading-relaxed text-stone-500">{selectedTone.description[lang]}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="relative min-h-[120px] overflow-hidden rounded-2xl border border-stone-900 bg-white p-3 shadow-sm shadow-stone-200">
                                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${selectedFocus.accent}`} />
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex h-10 min-w-10 items-center justify-center rounded-full border border-stone-300 bg-stone-900 px-2 font-serif text-xs text-amber-100">
                                            {selectedFocus.sigil}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-serif text-base leading-tight text-stone-900">{getFocusLabel(selectedFocus.value, lang)}</p>
                                            <p className="mt-1 text-xs leading-relaxed text-stone-500">{selectedFocus.description[lang]}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Characters */}
                    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                         <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-500">
                            <span>{t('chapters.modal.chars')}</span>
                            <InlineHelp content={t('help.chapters.activeCharacters')} />
                         </label>
                         <div className="border border-stone-200 rounded-2xl max-h-64 overflow-y-auto bg-stone-50/80 p-2 space-y-2">
                            {universe.characters.length === 0 && <p className="text-xs text-stone-400 p-2">{t('chapters.modal.noChars')}</p>}
                            {universe.characters.map(char => (
                                <div 
                                    key={char.id}
                                    onClick={() => toggleCharacter(char.id)}
                                    className={`p-3 rounded-xl cursor-pointer flex items-center border transition-all ${params.activeCharacterIds.includes(char.id) ? 'bg-white border-amber-300 shadow-sm' : 'bg-transparent border-transparent hover:bg-white hover:border-stone-300'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center mr-3 ${params.activeCharacterIds.includes(char.id) ? 'bg-amber-500 border-amber-500' : 'border-stone-400 bg-white'}`}>
                                        {params.activeCharacterIds.includes(char.id) && <UserCheck className="w-3 h-3 text-white" />}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-sm text-stone-800">{char.name}</div>
                                        <div className="text-xs uppercase tracking-[0.16em] text-stone-400">{char.role}</div>
                                        {char.faction && <div className="mt-1 text-xs text-stone-500">{char.faction}</div>}
                                    </div>
                                </div>
                            ))}
                         </div>
                    </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-stone-200 gap-3">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={handleSubmit} isLoading={isLoading} disabled={!params.title || !params.plotDirection} className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 hover:border-stone-500 hover:bg-white">
                            <BardSeal className="mr-2 h-4 w-4 text-primary" />
                            {t('chapters.writeDirect')}
                        </Button>
                        <InlineHelp content={t('help.chapters.writeDirect')} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={handleGeneratePlans} isLoading={isGeneratingPlans} disabled={isLoading || !params.title || !params.plotDirection} className="rounded-xl bg-stone-900 px-4 py-3 text-amber-50 hover:bg-black">
                            <LoomSigil className="mr-2 h-4 w-4 text-amber-300" />
                            {t('chapters.generate3Plans')}
                        </Button>
                        <InlineHelp content={t('help.chapters.generatePlans')} />
                    </div>
                </div>
                {planError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">
                        ⚠ {planError}
                    </div>
                )}
            </div>
        </Modal>

        {/* Plan Selector — second step, separate modal */}
        <Modal isOpen={step === 'plans'} onClose={() => setStep('form')} title={t('chapters.choosePlan')}>
            <div className="space-y-4">
                <p className="text-xs text-stone-500">
                    {t('chapters.choosePlanDesc')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {weaverPlans.map((plan, idx) => {
                        const label = ['A', 'B', 'C'][idx];
                        const isSelected = selectedPlanIdx === idx;
                        return (
                            <button
                                key={idx}
                                onClick={() => setSelectedPlanIdx(idx)}
                                className={`text-left p-4 rounded-xl border-2 transition-all duration-200 flex flex-col gap-2 ${
                                    isSelected
                                        ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                                        : 'border-stone-200 bg-stone-50 hover:border-stone-400'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                                        {`${t('chapters.planLabel')} ${label}`}
                                    </span>
                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                                </div>
                                <h4 className="font-serif font-bold text-stone-800 text-sm leading-tight">
                                    {plan.chapterTitle}
                                </h4>
                                <div className="flex flex-wrap gap-1">
                                    {(plan.scenes || []).slice(0, 4).map((s, si) => (
                                        <span
                                            key={si}
                                            className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                                                s.tension === 'peak' ? 'bg-red-100 text-red-600'
                                                : s.tension === 'rising' ? 'bg-amber-100 text-amber-700'
                                                : 'bg-blue-100 text-blue-600'
                                            }`}
                                        >
                                            {s.tension}
                                        </span>
                                    ))}
                                    {(plan.scenes?.length ?? 0) > 4 && (
                                        <span className="text-[9px] text-stone-400">+{(plan.scenes?.length ?? 0) - 4}</span>
                                    )}
                                </div>
                                <p className="text-[11px] text-stone-500 leading-relaxed line-clamp-3">
                                    {plan.chapterSummary}
                                </p>
                                <div className="border-t border-stone-200 pt-2 mt-auto">
                                    <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-0.5">
                                        Hook
                                    </p>
                                    <p className="text-[11px] text-stone-600 italic line-clamp-2">
                                        {plan.endHook}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-stone-200">
                    <Button variant="ghost" size="sm" onClick={() => setStep('form')}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {t('chapters.back')}
                    </Button>
                    <Button
                        onClick={handleWriteWithPlan}
                        isLoading={isLoading}
                        disabled={selectedPlanIdx === null}
                        className="rounded-xl bg-stone-900 px-4 py-3 text-amber-50 hover:bg-black"
                    >
                        <BardSeal className="mr-2 h-4 w-4 text-amber-300" />
                        {t('chapters.writeWithPlan')}
                    </Button>
                </div>
            </div>
        </Modal>
        </>
    );
};

const FeatherIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path>
        <line x1="16" y1="8" x2="2" y2="22"></line>
        <line x1="17.5" y1="15" x2="9" y2="15"></line>
    </svg>
);

export default function ChaptersView({ universe, onGenerateChapter: _legacyGenerate, onUpdateUniverse, isLoading: globalLoading }: ChaptersViewProps) {
    const { t, lang, toggleLang } = useLanguage();
    const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(universe.chapters[0] || null);
    const [isLabOpen, setIsLabOpen] = useState(false);
    const [localLoading, setLocalLoading] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewIssues, setReviewIssues] = useState<ArbiterIssue[]>([]);
    const [isRewriting, setIsRewriting] = useState(false);
    const [toast, setToast] = useState<{msg: string, type: 'success'|'error'} | null>(null);

    // Reset review issues when chapter changes
    useEffect(() => {
        setReviewIssues([]);
    }, [selectedChapter?.id]);

    useEffect(() => {
        if (!selectedChapter && universe.chapters.length > 0) {
            setSelectedChapter(universe.chapters[universe.chapters.length - 1]);
            return;
        }

        if (selectedChapter && !universe.chapters.some(chapter => chapter.id === selectedChapter.id)) {
            setSelectedChapter(universe.chapters[universe.chapters.length - 1] ?? null);
        }
    }, [universe.chapters, selectedChapter]);

    const handleAgentGeneration = async (params: ChapterGenerationParams) => {
        setLocalLoading(true);
        try {
            const { chapter: newChapter, updatedUniverse } = await generateChapterWithAgents(universe, params);
            onUpdateUniverse?.(updatedUniverse);
            setSelectedChapter(newChapter);
            setIsLabOpen(false);
            setToast({msg: t('chapters.modal.generate') + ' ✓', type: 'success'});
        } catch (e) {
            console.error('[Chapter Generation Error]', e);
            const msg = e instanceof Error ? e.message : t('chapters.errorGenerating');
            setToast({msg, type: 'error'});
        } finally {
            setLocalLoading(false);
        }
    };

    const handleReviewChapter = async () => {
        if (!selectedChapter) return;
        setIsReviewing(true);
        try {
            const issues = await reviewChapterWithArbiter(selectedChapter, universe);
            setReviewIssues(issues);
            if (issues.length === 0) {
                setToast({msg: t('chapters.arbiter.noIssuesFound'), type: 'success'});
            } else {
                setToast({msg: t('chapters.arbiter.issuesFound').replace('{n}', String(issues.length)), type: 'error'});
            }
        } catch (e) {
            setToast({msg: t('chapters.arbiter.reviewFailed'), type: 'error'});
        } finally {
            setIsReviewing(false);
        }
    };

    const handleRewriteChapter = async () => {
        if (!selectedChapter || reviewIssues.length === 0) return;
        setIsRewriting(true);
        try {
            const newContent = await rewriteChapterBySuggestions(selectedChapter, reviewIssues, universe);
            const updatedChapter: Chapter = { ...selectedChapter, content: newContent };
            const updatedChapters = universe.chapters.map(c =>
                c.id === selectedChapter.id ? updatedChapter : c
            );
            const updatedUniverse = { ...universe, chapters: updatedChapters };
            onUpdateUniverse?.(updatedUniverse);
            setSelectedChapter(updatedChapter);
            setReviewIssues([]);
            setToast({msg: t('chapters.arbiter.rewriteDone'), type: 'success'});
        } catch (e) {
            setToast({msg: t('chapters.arbiter.rewriteFailed'), type: 'error'});
        } finally {
            setIsRewriting(false);
        }
    };

    const isLoading = globalLoading || localLoading;

  return (
    <div className="h-full flex flex-col">
        <div className="flex justify-between items-center mb-6 flex-shrink-0">
            <div>
                <h1 className="text-3xl font-serif font-bold text-stone-dark flex items-center">
                    <FileText className="mr-3 h-8 w-8 text-primary"/> 
                    {t('chapters.header')}
                </h1>
                <p className="text-stone-500 text-sm mt-1 ml-11">{t('chapters.headerSub')}</p>
            </div>
            
            <div className="flex gap-2 items-center">
                <button
                    onClick={toggleLang}
                    title={lang === 'pt' ? 'Switch to English' : 'Mudar para Português'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-stone-300 bg-paper hover:bg-stone-100 hover:border-stone-400 transition-all text-stone-500 hover:text-stone-800"
                >
                    <Globe className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">{lang === 'pt' ? 'PT' : 'EN'}</span>
                </button>
                <Button variant="secondary" size="sm"><Edit className="mr-2 h-4 w-4" /> {t('chapters.manualEntry')}</Button>
                <Button onClick={() => setIsLabOpen(true)} isLoading={isLoading} className="bg-stone-800 hover:bg-black text-white">
                    <Microchip className="mr-2 h-4 w-4 text-primary" />
                    {t('chapters.initEngine')}
                </Button>
            </div>
        </div>

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-8 min-h-0">
            <aside className="lg:col-span-1 h-full min-h-0 flex flex-col">
                <Card className="p-2 flex-grow overflow-y-auto bg-stone-50 border-stone-200">
                    {universe.chapters.length > 0 ? (
                        <div className="space-y-2">
                            {universe.chapters.map(chap => 
                                <ChapterListItem 
                                    key={chap.id} 
                                    chapter={chap} 
                                    onSelect={() => setSelectedChapter(chap)}
                                    isSelected={selectedChapter?.id === chap.id}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-10 text-stone-400 italic">
                            {t('chapters.emptyArchives')}
                        </div>
                    )}
                </Card>
            </aside>
            <main className="lg:col-span-3 min-h-0 h-full">
                 <TextEditor 
                    chapter={selectedChapter} 
                    onReviewChapter={handleReviewChapter}
                    isReviewing={isReviewing}
                    reviewIssues={reviewIssues}
                    onRewriteChapter={handleRewriteChapter}
                    isRewriting={isRewriting}
                />
            </main>
        </div>

        <NarrativeLabModal 
            isOpen={isLabOpen} 
            onClose={() => setIsLabOpen(false)}
            universe={universe}
            onSubmit={handleAgentGeneration}
            isLoading={isLoading}
        />
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
