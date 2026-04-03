import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import type { ApiKeys } from '../../utils/apiKeys';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keys: ApiKeys) => void;
  initialKeys?: ApiKeys;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave, initialKeys }) => {
  const [groq, setGroq] = useState(initialKeys?.groq || '');
  const [gemini, setGemini] = useState(initialKeys?.gemini || '');
  const [cerebras, setCerebras] = useState(initialKeys?.cerebras || '');

  useEffect(() => {
    setGroq(initialKeys?.groq || '');
    setGemini(initialKeys?.gemini || '');
    setCerebras(initialKeys?.cerebras || '');
  }, [initialKeys, isOpen]);

  const canSave = groq.trim() && gemini.trim() && cerebras.trim();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Insira suas API Keys">
      <div className="space-y-4">
        <p className="text-sm text-stone-500 leading-relaxed">
          As chaves ficam salvas localmente no navegador deste usu&aacute;rio e s&oacute; depois disso o engine pode iniciar.
        </p>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Groq API Key *</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={groq} onChange={e => setGroq(e.target.value)} placeholder="sk-..." />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Gemini API Key *</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={gemini} onChange={e => setGemini(e.target.value)} placeholder="..." />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">Cerebras API Key *</label>
          <input type="text" className="w-full px-3 py-2 border rounded" value={cerebras} onChange={e => setCerebras(e.target.value)} placeholder="..." />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => onSave({ groq, gemini, cerebras })} disabled={!canSave}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
};

export default ApiKeyModal;
