import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import type { ApiKeys, LlmProvider } from '../../utils/apiKeys';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keys: ApiKeys) => void;
  initialKeys?: ApiKeys;
}

const PROVIDER_OPTIONS: { value: LlmProvider; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Escolhe o melhor provedor disponível.' },
  { value: 'openrouter', label: 'OpenRouter Free', hint: 'Usa qwen/qwen3.6-plus:free por padrão, com modelos gratuitos.' },
  { value: 'groq', label: 'Groq', hint: 'Prioriza os modelos configurados no Groq.' },
  { value: 'gemini', label: 'Gemini', hint: 'Prioriza Gemini 2.0/2.5 Lite quando a chave estiver válida.' },
  { value: 'cerebras', label: 'Cerebras', hint: 'Prioriza os modelos configurados no Cerebras.' },
];

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave, initialKeys }) => {
  const [groq, setGroq] = useState(initialKeys?.groq || '');
  const [gemini, setGemini] = useState(initialKeys?.gemini || '');
  const [cerebras, setCerebras] = useState(initialKeys?.cerebras || '');
  const [openrouter, setOpenrouter] = useState(initialKeys?.openrouter || '');
  const [preferredProvider, setPreferredProvider] = useState<LlmProvider>(initialKeys?.preferredProvider || 'auto');

  useEffect(() => {
    setGroq(initialKeys?.groq || '');
    setGemini(initialKeys?.gemini || '');
    setCerebras(initialKeys?.cerebras || '');
    setOpenrouter(initialKeys?.openrouter || '');
    setPreferredProvider(initialKeys?.preferredProvider || 'auto');
  }, [initialKeys, isOpen]);

  const canSave = groq.trim() || gemini.trim() || cerebras.trim() || openrouter.trim();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Configure pelo menos uma API Key">
      <div className="space-y-4">
        <p className="text-sm text-stone-500 leading-relaxed">
          As chaves ficam salvas localmente no navegador deste usuário. Você pode usar só um provider, inclusive OpenRouter com modelos gratuitos.
        </p>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Provider preferido</label>
          <select
            className="w-full px-3 py-2 border rounded bg-white"
            value={preferredProvider}
            onChange={e => setPreferredProvider(e.target.value as LlmProvider)}
          >
            {PROVIDER_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-400">
            {PROVIDER_OPTIONS.find(option => option.value === preferredProvider)?.hint}
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">OpenRouter API Key</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={openrouter} onChange={e => setOpenrouter(e.target.value)} placeholder="sk-or-v1-..." />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Groq API Key</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={groq} onChange={e => setGroq(e.target.value)} placeholder="gsk_..." />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Gemini API Key</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={gemini} onChange={e => setGemini(e.target.value)} placeholder="AIza..." />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Cerebras API Key</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={cerebras} onChange={e => setCerebras(e.target.value)} placeholder="csk-..." />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => onSave({ groq, gemini, cerebras, openrouter, preferredProvider })}
            disabled={!canSave}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ApiKeyModal;
