
import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { View, Universe, ToastMessage, GenerationStep, StoryProfile, LongformBlueprint } from './types';
import { LanguageProvider } from './LanguageContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import CodexView from './components/CodexView';
import ChaptersView from './components/ChaptersView';
import AssetsView from './components/AssetsView';
import AgentsView from './components/AgentsView';
import Toast from './components/ui/Toast';

import LandingPage from './components/LandingPage';
import AgentThinkingPanel from './components/ui/AgentThinkingPanel';
import ApiKeyModal from './components/ui/ApiKeyModal';
import ErrorBoundary, { type BoundaryErrorDetails } from './components/ui/ErrorBoundary';
import { generateDivineGenesis, generateLongformGenesisBase, createNewUniverse, generateCharacter, generateImage, generateLongformBlueprint, runAutogenLongform, syncUniverseCanon } from './services/geminiService';
import type { AutogenProgress } from './services/geminiService';
import { createPortraitUrl } from './utils/portraits';
import { EMPTY_API_KEYS, hasAllApiKeys, loadApiKeys, saveApiKeys } from './utils/apiKeys';

interface RuntimeIssue {
  source: 'render' | 'window' | 'promise' | 'agent-panel';
  message: string;
  stack?: string;
}

interface PendingLongformRun {
  universe: Universe;
  blueprint: LongformBlueprint;
}

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState(() => loadApiKeys() || EMPTY_API_KEYS);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [genesisStep, setGenesisStep] = useState<GenerationStep>('idle');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [autoGenProgress, setAutoGenProgress] = useState<AutogenProgress | null>(null);
  const [pendingLongformRun, setPendingLongformRun] = useState<PendingLongformRun | null>(null);
  const [runtimeIssue, setRuntimeIssue] = useState<RuntimeIssue | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const apiKeysReady = hasAllApiKeys(apiKeys);

  useEffect(() => {
    setApiKeys(loadApiKeys() || EMPTY_API_KEYS);
  }, []);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const message = event.error instanceof Error
        ? event.error.message
        : event.message || 'Erro síncrono em tempo de execução';

      setRuntimeIssue({
        source: 'window',
        message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Promise rejeitada sem tratamento';

      setRuntimeIssue({
        source: 'promise',
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const handleStartRequest = useCallback(() => {
    if (!apiKeysReady) {
      setApiModalOpen(true);
      return;
    }
    setHasStarted(true);
  }, [apiKeysReady]);

  const handleSaveApiKeys = useCallback((keys: typeof EMPTY_API_KEYS) => {
    saveApiKeys(keys);
    setApiKeys(keys);
    setApiModalOpen(false);
    setHasStarted(true);
  }, []);



  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 8000 : 3000);
  };

  // Architect Mode: user provides name + description directly
  const handleBuildUniverseManual = useCallback(async (name: string, description: string) => {
    setIsLoading(true);
    try {
      const newUniverse = await createNewUniverse({ name, description });
      setUniverse(syncUniverseCanon(newUniverse, 'light'));
      setCurrentView('dashboard');
      showToast('Universo iniciado! Agora adicione personagens.');
    } catch (error) {
      console.error(error);
      showToast('Erro ao criar universo.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Divine Genesis: generate idea from profile + run full pipeline in one shot
  const handleDivineGenesis = useCallback(async (profile: StoryProfile) => {
    setIsLoading(true);
    setGenesisStep('anchors');
    try {
      const storyLang = profile.lang ?? (localStorage.getItem('mythos-lang') as 'pt' | 'en') ?? 'pt';
      const newUniverse = await generateDivineGenesis(profile, (step: string) => setGenesisStep(step as GenerationStep), storyLang);
      setUniverse(syncUniverseCanon(newUniverse, 'light'));
      setCurrentView('dashboard');
      showToast('Genesis Completo: Universo criado com sucesso!');
    } catch (error) {
      console.error('[Genesis Error]', error);
      const msg = error instanceof Error ? error.message : 'Falha no Genesis Mode.';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
      setGenesisStep('idle');
    }
  }, []);

  const handleAutoGenLongform = useCallback(async (profile: StoryProfile) => {
    setIsLoading(true);
    setGenesisStep('anchors');
    try {
      const storyLang = profile.lang ?? (localStorage.getItem('mythos-lang') as 'pt' | 'en') ?? 'pt';
      const newUniverse = await generateLongformGenesisBase(profile, (step: string) => setGenesisStep(step as GenerationStep), storyLang, 'economy');
      const preparedUniverse = syncUniverseCanon(newUniverse, 'light');
      const blueprint = await generateLongformBlueprint(preparedUniverse, 'economy');
      const stagedUniverse = {
        ...preparedUniverse,
        creationMode: 'autogen_longform' as const,
        longformBlueprint: blueprint,
      };
      setUniverse(stagedUniverse);
      setCurrentView('dashboard');
      setPendingLongformRun({ universe: stagedUniverse, blueprint });
      showToast(storyLang === 'pt' ? 'Blueprint da obra pronto para aprovação.' : 'Longform blueprint ready for approval.');
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'Falha no AutoGen.';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
      setGenesisStep('idle');
    }
  }, []);

  const handleConfirmAutoGen = useCallback(async () => {
    if (!pendingLongformRun) return;

    setIsLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const preparedUniverse = pendingLongformRun.universe;
    const blueprint = pendingLongformRun.blueprint;
    try {
      const storyLang = preparedUniverse.lang ?? preparedUniverse.storyProfile?.lang ?? 'pt';
      const baseParams = {
        title: '',
        plotDirection: '',
        activeCharacterIds: preparedUniverse.characters.map(c => c.id),
        tone: (preparedUniverse.storyProfile?.tone ?? 'Épico') as const,
        focus: 'Ação' as const,
        lang: storyLang,
        qualityMode: 'economy' as const,
      };

      setPendingLongformRun(null);
      setCurrentView('dashboard');
      setAutoGenProgress({
        chaptersDone: 0,
        totalChapters: blueprint.targetChapters,
        phase: 'director',
        currentUniverse: preparedUniverse,
      });
      setUniverse(preparedUniverse);

      const finalUniverse = await runAutogenLongform(
        preparedUniverse,
        blueprint,
        baseParams,
        (p) => {
          setAutoGenProgress(p);
          setUniverse(syncUniverseCanon(p.currentUniverse, 'light'));
        },
        controller.signal,
      );

      setUniverse(syncUniverseCanon(finalUniverse, 'light'));
      setCurrentView('chapters');
      showToast(storyLang === 'pt'
        ? `Obra completa iniciada: ${finalUniverse.chapters.length} capítulos gerados.`
        : `Longform run complete: ${finalUniverse.chapters.length} chapters generated.`);
    } catch (error) {
      console.error(error);
      setPendingLongformRun({ universe: preparedUniverse, blueprint });
      const msg = error instanceof Error ? error.message : 'Falha no AutoGen.';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
      setGenesisStep('idle');
      setAutoGenProgress(null);
      abortControllerRef.current = null;
    }
  }, [pendingLongformRun]);

  const handleCancelAutoGen = useCallback(() => {
    setPendingLongformRun(null);
  }, []);

  const handleAbortAutoGen = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleGenerateSingleCharacter = useCallback(async () => {
    if (!universe) return;
    setIsLoading(true);
    try {
      const newCharacter = await generateCharacter(universe.name, universe.lang);
      setUniverse(prev => prev ? { ...prev, characters: [...prev.characters, newCharacter] } : null);
      showToast('Novo personagem adicionado!');
    } catch (error) {
        showToast('Erro ao gerar personagem.', 'error');
    } finally {
        setIsLoading(false);
    }
  }, [universe]);

  const handleGenerateChapter = useCallback(() => {
    setCurrentView('chapters');
  }, []);

  const handleGenerateImage = useCallback(async (prompt: string) => {
    if (!universe) return;
    setIsLoading(true);
    try {
        const newImage = await generateImage(prompt);
        setUniverse(prev => prev ? { ...prev, assets: { ...prev.assets, visual: [...prev.assets.visual, newImage] } } : null);
        showToast('Nova imagem gerada!');
    } catch (error) {
        showToast('Erro ao gerar imagem.', 'error');
    } finally {
        setIsLoading(false);
    }
  }, [universe]);

  const handleUpdateCharacterImage = useCallback(async (characterId: string, prompt: string) => {
    if (!universe) return;
    setIsLoading(true);
    try {
        setUniverse(prev => {
            if (!prev) return null;
        const character = prev.characters.find(c => c.id === characterId);
        if (!character) return prev;
        const portraitUrl = createPortraitUrl({
          name: character.name,
          role: character.role,
          faction: character.faction,
          seed: `${character.name}|${prompt}`,
          size: 768,
        });
        const newImage = {
          id: Math.random().toString(36).slice(2, 11),
          url: portraitUrl,
          prompt,
          type: 'character' as const,
          relatedTo: characterId,
        };
            const updatedCharacters = prev.characters.map(c => 
          c.id === characterId ? { ...c, imageUrl: portraitUrl } : c
            );
            return { 
                ...prev, 
                characters: updatedCharacters,
                assets: { ...prev.assets, visual: [...prev.assets.visual, newImage] } 
            };
        });
        showToast('Imagem do personagem atualizada!');
    } catch (error) {
        showToast('Erro ao gerar imagem.', 'error');
    } finally {
        setIsLoading(false);
    }
  }, [universe]);

  const handleUpdateUniverse = (updatedUniverse: Universe) => {
      setUniverse(syncUniverseCanon(updatedUniverse, 'light'));
      showToast('Configurações salvas com sucesso!', 'success');
  };

  const handleUpdateUniverseSilent = useCallback((updatedUniverse: Universe) => {
      setUniverse(syncUniverseCanon(updatedUniverse, 'light'));
  }, []);

  const handleExportUniverse = useCallback(() => {
      if (!universe) return;
      const blob = new Blob([JSON.stringify(universe, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${universe.name.replace(/\s+/g, '_')}_mythos.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Universo exportado com sucesso!');
  }, [universe]);

  const handleImportUniverse = useCallback((file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const imported = JSON.parse(e.target?.result as string) as Universe;
              setUniverse(syncUniverseCanon(imported, 'light'));
              setCurrentView('dashboard');
              showToast('Universo importado com sucesso!');
          } catch {
              showToast('Arquivo inválido ou corrompido.', 'error');
          }
      };
      reader.readAsText(file);
  }, []);

  const renderContent = () => {
    if (autoGenProgress && autoGenProgress.phase !== 'done') {
      return (
        <Dashboard
          universe={universe}
          onBuildUniverseManual={handleBuildUniverseManual}
          onDivineGenesis={handleDivineGenesis}
          onAutoGen={handleAutoGenLongform}
          onConfirmAutoGen={handleConfirmAutoGen}
          onCancelAutoGen={handleCancelAutoGen}
          onAbortAutoGen={handleAbortAutoGen}
          autoGenProgress={autoGenProgress}
          pendingLongformRun={pendingLongformRun}
          onImport={handleImportUniverse}
          isLoading={isLoading}
          genesisStep={genesisStep}
        />
      );
    }

    if (!universe) {
      return (
        <Dashboard
          universe={null}
          onBuildUniverseManual={handleBuildUniverseManual}
          onDivineGenesis={handleDivineGenesis}
          onAutoGen={handleAutoGenLongform}
          onConfirmAutoGen={handleConfirmAutoGen}
          onCancelAutoGen={handleCancelAutoGen}
          onAbortAutoGen={handleAbortAutoGen}
          autoGenProgress={autoGenProgress}
          pendingLongformRun={pendingLongformRun}
          onImport={handleImportUniverse}
          isLoading={isLoading}
          genesisStep={genesisStep}
        />
      );
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard 
          universe={universe} 
          isLoading={isLoading} 
          onConfirmAutoGen={handleConfirmAutoGen}
          onCancelAutoGen={handleCancelAutoGen}
          pendingLongformRun={pendingLongformRun}
          onGenerateCharacter={handleGenerateSingleCharacter}
          onGenerateChapter={handleGenerateChapter}
          onExport={handleExportUniverse}
          setCurrentView={setCurrentView}
        />;
      case 'codex':
        return <CodexView universe={universe} onUpdateUniverse={handleUpdateUniverse} isLoading={isLoading} initialSection="overview" />;
      case 'characters':
        return <CodexView universe={universe} onUpdateUniverse={handleUpdateUniverse} isLoading={isLoading} initialSection="characters" />;
      case 'chapters':
        return <ChaptersView universe={universe} onGenerateChapter={handleGenerateChapter} onUpdateUniverse={handleUpdateUniverseSilent} isLoading={isLoading} />;
      case 'assets':
        return <AssetsView universe={universe} onGenerateImage={handleGenerateImage} isLoading={isLoading} />;
      case 'agents':
        return <AgentsView universe={universe} onUpdateUniverse={handleUpdateUniverse} />;
      default:
        return <Dashboard
          universe={universe}
          isLoading={isLoading}
          onConfirmAutoGen={handleConfirmAutoGen}
          onCancelAutoGen={handleCancelAutoGen}
          pendingLongformRun={pendingLongformRun}
          setCurrentView={setCurrentView}
        />;
    }
  };

  const handleBoundaryError = useCallback((details: BoundaryErrorDetails, source: RuntimeIssue['source']) => {
    setRuntimeIssue({
      source,
      message: details.error.message,
      stack: details.error.stack || details.componentStack,
    });
  }, []);

  const runtimeSourceLabel: Record<RuntimeIssue['source'], string> = {
    render: 'Erro de renderização',
    window: 'Erro de script',
    promise: 'Promise sem tratamento',
    'agent-panel': 'Painel de agentes',
  };

  return (
    <LanguageProvider>
      {!hasStarted ? (
        <>
          <LandingPage
            onStart={handleStartRequest}
            onConfigureApiKeys={() => setApiModalOpen(true)}
            hasApiKeys={apiKeysReady}
          />
          <ApiKeyModal
            isOpen={apiModalOpen}
            onClose={() => setApiModalOpen(false)}
            onSave={handleSaveApiKeys}
            initialKeys={apiKeys}
          />
        </>
      ) : (
        <div className="flex h-screen bg-background text-text font-sans">
          <Sidebar currentView={currentView} setCurrentView={setCurrentView} universeExists={!!universe} />
          <ErrorBoundary
            onError={(details) => handleBoundaryError(details, 'render')}
            fallback={(details) => (
              <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-paper">
                <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-red-500">Erro de renderização</p>
                  <h1 className="mt-2 font-serif text-3xl font-bold">A interface quebrou, mas o erro agora está visível</h1>
                  <p className="mt-3 text-sm text-red-900">{details.error.message}</p>
                  {(details.error.stack || details.componentStack) && (
                    <pre className="mt-4 max-h-[50vh] overflow-auto rounded-xl bg-white/80 p-4 text-xs whitespace-pre-wrap text-red-950">
                      {details.error.stack || details.componentStack}
                    </pre>
                  )}
                </div>
              </main>
            )}
          >
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-paper">
              {renderContent()}
            </main>
          </ErrorBoundary>
          {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
          <ErrorBoundary
            onError={(details) => handleBoundaryError(details, 'agent-panel')}
            fallback={null}
          >
            <AgentThinkingPanel />
          </ErrorBoundary>
          {runtimeIssue && (
            <div className="fixed left-4 top-4 z-[60] max-w-xl rounded-2xl border border-red-200 bg-red-50/95 p-4 text-red-950 shadow-2xl backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-red-500">
                    {runtimeSourceLabel[runtimeIssue.source]}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{runtimeIssue.message}</p>
                </div>
                <button
                  onClick={() => setRuntimeIssue(null)}
                  className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                >
                  Fechar
                </button>
              </div>
              {runtimeIssue.stack && (
                <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-white/80 p-3 text-xs whitespace-pre-wrap text-red-950">
                  {runtimeIssue.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </LanguageProvider>
  );
}
