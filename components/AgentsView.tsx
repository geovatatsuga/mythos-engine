
import React, { useState } from 'react';
import type { Universe, AgentConfig } from '../types';
import { DEFAULT_AGENTS } from '../constants';
import Button from './ui/Button';
import Card from './ui/Card';
import InlineHelp from './ui/InlineHelp';
import { Crown, Scroll, GitBranch, Users, Scale, Music, Save, RotateCcw, CircuitBoard } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

interface AgentsViewProps {
  universe: Universe;
  onUpdateUniverse: (u: Universe) => void;
}

const AgentNodeDisplay: React.FC<{ 
    agent: AgentConfig, 
    onClick: () => void, 
    isSelected: boolean 
}> = ({ agent, onClick, isSelected }) => {
    
    const IconMap: any = {
        architect: Crown,
        chronicler: Scroll,
        weaver: GitBranch,
        soulforger: Users,
        arbiter: Scale,
        bard: Music
    };
    const Icon = IconMap[agent.id] || CircuitBoard;

    return (
        <div 
            onClick={onClick}
            className={`relative cursor-pointer transition-all duration-300 p-4 rounded-xl border-2 flex flex-col items-center text-center gap-2
            ${isSelected 
                ? 'bg-white border-primary shadow-lg shadow-primary/20 scale-105 z-10' 
                : 'bg-stone-50 border-stone-200 hover:border-primary/50 hover:shadow-md'
            }`}
        >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm`} style={{ backgroundColor: agent.color }}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <h3 className="font-serif font-bold text-stone-dark">{agent.name}</h3>
                <p className="text-[10px] uppercase tracking-widest text-stone-500">{agent.role}</p>
            </div>
        </div>
    );
};

export default function AgentsView({ universe, onUpdateUniverse }: AgentsViewProps) {
  const { t } = useLanguage();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('architect');
  // Merge Universe configs with Defaults to ensure we have all agents even if not saved yet
  const activeConfig = universe.agentConfigs?.[selectedAgentId] || DEFAULT_AGENTS[selectedAgentId];
  
  const [promptText, setPromptText] = useState(activeConfig.systemPrompt);
  const [isDirty, setIsDirty] = useState(false);

  // Update local state when selection changes
  React.useEffect(() => {
    const config = universe.agentConfigs?.[selectedAgentId] || DEFAULT_AGENTS[selectedAgentId];
    setPromptText(config.systemPrompt);
    setIsDirty(false);
  }, [selectedAgentId, universe.agentConfigs]);

  const handleSave = () => {
    const updatedConfigs = { ...universe.agentConfigs };
    updatedConfigs[selectedAgentId] = {
        ...activeConfig,
        systemPrompt: promptText
    };
    
    onUpdateUniverse({
        ...universe,
        agentConfigs: updatedConfigs
    });
    setIsDirty(false);
  };

  const handleReset = () => {
    setPromptText(DEFAULT_AGENTS[selectedAgentId].systemPrompt);
    setIsDirty(true);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-3xl font-serif font-bold text-stone-dark flex items-center">
                <Crown className="mr-3 h-8 w-8 text-primary"/> 
                {t('agents.title')}
            </h1>
            <p className="text-stone-500 text-sm mt-1 ml-11">{t('agents.desc')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow min-h-0">
        
        {/* Left: Visual Hierarchy (Organogram Style) */}
        <div className="lg:col-span-5 flex flex-col h-full">
            <Card className="flex-grow bg-stone-100/50 border-stone-200 relative overflow-hidden p-8 flex items-center justify-center">
                {/* Background Lines */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                     <path d="M 50% 20% L 50% 50%" stroke="#C5A059" strokeWidth="2" />
                     <path d="M 20% 50% L 80% 50%" stroke="#C5A059" strokeWidth="2" />
                     <path d="M 20% 50% L 20% 80%" stroke="#C5A059" strokeWidth="2" />
                     <path d="M 80% 50% L 80% 80%" stroke="#C5A059" strokeWidth="2" />
                     <path d="M 50% 50% L 50% 80%" stroke="#C5A059" strokeWidth="2" />
                </svg>

                <div className="w-full h-full relative grid grid-rows-3 gap-4">
                    {/* Top: Architect */}
                    <div className="flex justify-center items-end pb-4">
                        <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['architect']} 
                            isSelected={selectedAgentId === 'architect'}
                            onClick={() => setSelectedAgentId('architect')}
                        />
                    </div>

                    {/* Middle: Core Processors */}
                    <div className="flex justify-between items-center px-4">
                         <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['soulforger']} 
                            isSelected={selectedAgentId === 'soulforger'}
                            onClick={() => setSelectedAgentId('soulforger')}
                        />
                        <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['weaver']} 
                            isSelected={selectedAgentId === 'weaver'}
                            onClick={() => setSelectedAgentId('weaver')}
                        />
                        <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['chronicler']} 
                            isSelected={selectedAgentId === 'chronicler'}
                            onClick={() => setSelectedAgentId('chronicler')}
                        />
                    </div>

                    {/* Bottom: Polishers */}
                    <div className="flex justify-center items-start pt-4 gap-8">
                         <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['arbiter']} 
                            isSelected={selectedAgentId === 'arbiter'}
                            onClick={() => setSelectedAgentId('arbiter')}
                        />
                        <AgentNodeDisplay 
                            agent={DEFAULT_AGENTS['bard']} 
                            isSelected={selectedAgentId === 'bard'}
                            onClick={() => setSelectedAgentId('bard')}
                        />
                    </div>
                </div>
            </Card>
        </div>

        {/* Right: The Brain (Editor) */}
        <div className="lg:col-span-7 flex flex-col h-full">
            <Card className="flex-col h-full bg-white border-stone-200 shadow-xl overflow-hidden flex">
                <div className="p-6 border-b border-stone-100 bg-stone-50 flex justify-between items-start">
                    <div className="flex gap-4">
                        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white shadow-md" style={{ backgroundColor: activeConfig.color }}>
                            {/* Dynamic Icon rendering would ideally be duplicated or passed differently, simplifying here */}
                             <Crown className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-serif font-bold text-stone-dark">{activeConfig.name}</h2>
                            <p className="text-xs uppercase tracking-widest text-primary font-bold">{activeConfig.role}</p>
                            <p className="text-stone-500 text-sm mt-1">{activeConfig.description}</p>
                        </div>
                    </div>
                </div>

                <div className="flex-grow p-6 flex flex-col min-h-0">
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2 flex items-center">
                        <CircuitBoard className="w-4 h-4 mr-2" />
                        {t('agents.systemInstruction')}
                        <span className="ml-2"><InlineHelp content={t('help.agents.systemInstruction')} /></span>
                    </label>
                    <div className="relative flex-grow">
                        <textarea 
                            className="w-full h-full p-4 bg-stone-900 text-stone-200 font-mono text-sm rounded-lg focus:ring-2 focus:ring-primary focus:outline-none resize-none leading-relaxed"
                            value={promptText}
                            onChange={(e) => {
                                setPromptText(e.target.value);
                                setIsDirty(true);
                            }}
                        />
                        <div className="absolute top-2 right-2 bg-stone-800 px-2 py-1 rounded text-[10px] text-stone-500 uppercase">
                            {t('agents.jsonMode')}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-stone-100 bg-stone-50 flex justify-between items-center">
                    <Button variant="ghost" size="sm" onClick={handleReset} disabled={!isDirty && promptText === DEFAULT_AGENTS[selectedAgentId].systemPrompt}>
                        <RotateCcw className="w-3 h-3 mr-2" /> {t('agents.resetDefault')}
                    </Button>
                    <div className="flex items-center gap-4">
                        {isDirty && <span className="text-xs text-stone-400 italic">{t('agents.unsaved')}</span>}
                        <Button onClick={handleSave} disabled={!isDirty}>
                            <Save className="w-4 h-4 mr-2" /> {t('agents.saveConfig')}
                        </Button>
                    </div>
                </div>
            </Card>
        </div>

      </div>
    </div>
  );
}
