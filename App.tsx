
import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { View, Universe, ToastMessage, GenerationStep, StoryProfile } from './types';
import { LanguageProvider } from './LanguageContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import CodexView from './components/CodexView';
import CharactersView from './components/CharactersView';
import ChaptersView from './components/ChaptersView';
import AssetsView from './components/AssetsView';
import AgentsView from './components/AgentsView';
import Toast from './components/ui/Toast';

import LandingPage from './components/LandingPage';
import AgentThinkingPanel from './components/ui/AgentThinkingPanel';
import { generateDivineGenesis, createNewUniverse, generateCharacter, generateImage, generateStoryArc } from './services/geminiService';
import type { AutogenProgress } from './services/geminiService';
import { createPortraitUrl } from './utils/portraits';

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [genesisStep, setGenesisStep] = useState<GenerationStep>('idle');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [autoGenProgress, setAutoGenProgress] = useState<AutogenProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);



  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 8000 : 3000);
  };

  // Architect Mode: user provides name + description directly
  const handleBuildUniverseManual = useCallback(async (name: string, description: string) => {
    setIsLoading(true);
    try {
      const newUniverse = await createNewUniverse({ name, description });
      setUniverse(newUniverse);
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
      setUniverse(newUniverse);
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

  // AutoGen: divine genesis + sequential chapter generation
  const handleAutoGen = useCallback(async (profile: StoryProfile, chaptersCount: number) => {
    setIsLoading(true);
    setGenesisStep('anchors');
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const storyLang = profile.lang ?? (localStorage.getItem('mythos-lang') as 'pt' | 'en') ?? 'pt';
      const newUniverse = await generateDivineGenesis(profile, (step: string) => setGenesisStep(step as GenerationStep), storyLang, 'economy');
      setUniverse(newUniverse);
      setGenesisStep('idle');

      const baseParams = {
        title: '',
        plotDirection: '',
        activeCharacterIds: newUniverse.characters.map(c => c.id),
        tone: 'Épico' as const,
        focus: 'Ação' as const,
        lang: storyLang,
        qualityMode: 'economy' as const,
      };

      const finalUniverse = await generateStoryArc(
        newUniverse,
        chaptersCount,
        baseParams,
        (p) => {
          setAutoGenProgress(p);
          setUniverse(p.currentUniverse);
        },
        controller.signal,
      );

      setUniverse(finalUniverse);
      setCurrentView('chapters');
      showToast(`AutoGen completo: ${finalUniverse.chapters.length} capítulos gerados!`);
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'Falha no AutoGen.';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
      setGenesisStep('idle');
      setAutoGenProgress(null);
      abortControllerRef.current = null;
    }
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
      setUniverse(updatedUniverse);
      showToast('Configurações salvas com sucesso!', 'success');
  };

  const handleUpdateUniverseSilent = useCallback((updatedUniverse: Universe) => {
      setUniverse(updatedUniverse);
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
              setUniverse(imported);
              setCurrentView('dashboard');
              showToast('Universo importado com sucesso!');
          } catch {
              showToast('Arquivo inválido ou corrompido.', 'error');
          }
      };
      reader.readAsText(file);
  }, []);

  const renderContent = () => {
    if (!universe) {
      return (
        <Dashboard
          universe={null}
          onBuildUniverseManual={handleBuildUniverseManual}
          onDivineGenesis={handleDivineGenesis}
          onAutoGen={handleAutoGen}
          onAbortAutoGen={handleAbortAutoGen}
          autoGenProgress={autoGenProgress}
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
          onGenerateCharacter={handleGenerateSingleCharacter}
          onGenerateChapter={handleGenerateChapter}
          onExport={handleExportUniverse}
          setCurrentView={setCurrentView}
        />;
      case 'codex':
        return <CodexView universe={universe} isLoading={isLoading} />;
      case 'characters':
        return <CharactersView universe={universe} onGenerateCharacter={handleGenerateSingleCharacter} onGenerateImage={handleGenerateImage} onUpdateCharacterImage={handleUpdateCharacterImage} isLoading={isLoading} />;
      case 'chapters':
        return <ChaptersView universe={universe} onGenerateChapter={handleGenerateChapter} onUpdateUniverse={handleUpdateUniverseSilent} isLoading={isLoading} />;
      case 'assets':
        return <AssetsView universe={universe} onGenerateImage={handleGenerateImage} isLoading={isLoading} />;
      case 'agents':
        return <AgentsView universe={universe} onUpdateUniverse={handleUpdateUniverse} />;
      default:
        return <Dashboard universe={universe} isLoading={isLoading} setCurrentView={setCurrentView} />;
    }
  };

  return (
    <LanguageProvider>
      {!hasStarted ? (
        <LandingPage onStart={() => setHasStarted(true)} />
      ) : (
        <div className="flex h-screen bg-background text-text font-sans">
          <Sidebar currentView={currentView} setCurrentView={setCurrentView} universeExists={!!universe} />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-paper">
            {renderContent()}
          </main>
          {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
          <AgentThinkingPanel />
        </div>
      )}
    </LanguageProvider>
  );
}
