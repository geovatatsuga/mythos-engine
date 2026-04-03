
import React, { useState, useEffect } from 'react';
import type { Universe, Chapter, ChapterGenerationParams, ArbiterIssue, WeaverPlan } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { Plus, Edit, FileText, Sparkles, BookOpen, Microchip, UserCheck, Search, Save, GitBranch, Eye, RefreshCw, Layers, ArrowLeft, CheckCircle2, Globe } from 'lucide-react';
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
    return (
    <div onClick={onSelect} className={`p-4 rounded-lg cursor-pointer transition-colors duration-200 ${isSelected ? 'bg-nobel/10 border-l-4 border-nobel' : 'hover:bg-surface hover:shadow-sm'}`}>
        <div className="flex justify-between items-center">
            <h4 className="font-serif font-semibold text-stone-dark">{chapter.title}</h4>
            <span className={`px-2 py-1 text-[10px] uppercase tracking-wider text-white rounded-full ${statusColors[chapter.status]}`}>{t(`status.${chapter.status}`)}</span>
        </div>
        <p className="text-sm text-text-secondary mt-1 truncate font-sans">{chapter.summary}</p>
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

    useEffect(() => {
        if (chapter) {
            setContent(chapter.content);
            setIsEditMode(false);
        }
    }, [chapter]);

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
                            <h1 className="text-4xl font-serif font-bold text-center mb-12 text-stone-dark">{chapter.title.replace(/^#+\s*/, '')}</h1>
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
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 flex justify-between items-center">
                    <p className="text-sm text-stone-600 flex items-center">
                        <Microchip className="w-4 h-4 mr-2 text-primary" />
                        {t('chapters.modal.auto')}
                    </p>
                    <Button variant="secondary" size="sm" onClick={handleAutoSuggest} isLoading={isSuggesting}>
                        <GitBranch className="w-3 h-3 mr-2" /> {t('chapters.modal.autoCta')}
                    </Button>
                </div>
                {suggestError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                        ⚠ {suggestError}
                    </div>
                )}

                {/* Chapter Position Selector */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">
                        {t('chapters.chapterPosition')}
                    </label>
                    <select
                        className="w-full p-2 bg-white border border-stone-300 rounded focus:ring-2 focus:ring-primary focus:outline-none"
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
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.chTitle')}</label>
                            <input 
                                type="text" 
                                className="w-full p-2 bg-white border border-stone-300 rounded focus:ring-2 focus:ring-primary focus:outline-none"
                                placeholder={t('chapters.modal.chPlaceholder')}
                                value={params.title}
                                onChange={e => setParams({...params, title: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.plot')}</label>
                            <textarea 
                                className="w-full p-2 bg-white border border-stone-300 rounded focus:ring-2 focus:ring-primary focus:outline-none h-24 resize-none"
                                placeholder={t('chapters.modal.plotPlaceholder')}
                                value={params.plotDirection}
                                onChange={e => setParams({...params, plotDirection: e.target.value})}
                            />
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.tone')}</label>
                                <select 
                                    className="w-full p-2 bg-white border border-stone-300 rounded"
                                    value={params.tone}
                                    onChange={e => setParams({...params, tone: e.target.value as any})}
                                >
                                    {['Sombrio', 'Épico', 'Misterioso', 'Dramático', 'Humorístico'].map(tn => <option key={tn} value={tn}>{t(`tone.${tn}`)}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">{t('chapters.modal.focus')}</label>
                                <select 
                                    className="w-full p-2 bg-white border border-stone-300 rounded"
                                    value={params.focus}
                                    onChange={e => setParams({...params, focus: e.target.value as any})}
                                >
                                    {['Ação', 'Diálogo', 'Lore', 'Introspecção'].map(fc => <option key={fc} value={fc}>{t(`focus.${fc}`)}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Characters */}
                    <div>
                         <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">{t('chapters.modal.chars')}</label>
                         <div className="border border-stone-200 rounded-lg max-h-64 overflow-y-auto bg-stone-50 p-2 space-y-2">
                            {universe.characters.length === 0 && <p className="text-xs text-stone-400 p-2">{t('chapters.modal.noChars')}</p>}
                            {universe.characters.map(char => (
                                <div 
                                    key={char.id}
                                    onClick={() => toggleCharacter(char.id)}
                                    className={`p-2 rounded cursor-pointer flex items-center border transition-all ${params.activeCharacterIds.includes(char.id) ? 'bg-white border-primary shadow-md' : 'bg-transparent border-transparent hover:bg-stone-200'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center mr-3 ${params.activeCharacterIds.includes(char.id) ? 'bg-primary border-primary' : 'border-stone-400'}`}>
                                        {params.activeCharacterIds.includes(char.id) && <UserCheck className="w-3 h-3 text-white" />}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-sm text-stone-800">{char.name}</div>
                                        <div className="text-xs text-stone-500">{char.role}</div>
                                    </div>
                                </div>
                            ))}
                         </div>
                    </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-stone-200 gap-3">
                    <Button variant="ghost" size="sm" onClick={handleSubmit} isLoading={isLoading} disabled={!params.title || !params.plotDirection} className="text-stone-500">
                        <Sparkles className="mr-2 h-4 w-4" />
                        {t('chapters.writeDirect')}
                    </Button>
                    <Button onClick={handleGeneratePlans} isLoading={isGeneratingPlans} disabled={isLoading || !params.title || !params.plotDirection}>
                        <Layers className="mr-2 h-4 w-4" />
                        {t('chapters.generate3Plans')}
                    </Button>
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
                    >
                        <Sparkles className="mr-2 h-4 w-4" />
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
