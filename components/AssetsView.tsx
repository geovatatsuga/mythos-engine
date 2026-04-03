
import React, { useState } from 'react';
import type { Universe } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { Plus, ImageIcon, Music } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

interface AssetsViewProps {
  universe: Universe;
  onGenerateImage: (prompt: string) => void;
  isLoading: boolean;
}

const ImageCard: React.FC<{ asset: { url: string; prompt: string }; onClick: () => void }> = ({ asset, onClick }) => (
  <Card className="overflow-hidden group cursor-pointer" onClick={onClick}>
    <div className="relative">
      <img src={asset.url} alt={asset.prompt} className="w-full h-48 object-cover transition-transform duration-300 group-hover:scale-105" />
      <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
        <p className="text-white text-sm">{asset.prompt}</p>
      </div>
    </div>
  </Card>
);

const GenerateImageModal: React.FC<{ 
    isOpen: boolean; 
    onClose: () => void; 
    onGenerate: (prompt: string) => void;
    isLoading: boolean;
}> = ({ isOpen, onClose, onGenerate, isLoading }) => {
    const [prompt, setPrompt] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(prompt.trim()) {
            onGenerate(prompt);
            onClose();
            setPrompt('');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Gerar Nova Imagem">
            <form onSubmit={handleSubmit}>
                <p className="mb-4 text-text-secondary">Descreva a imagem que você deseja criar. Seja detalhado para melhores resultados.</p>
                <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ex: Uma cidade flutuante ao pôr do sol, com arquitetura élfica e cachoeiras de energia..."
                    className="w-full p-2 bg-gray-900 border border-gray-700 rounded-md h-32 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="mt-6 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" isLoading={isLoading} disabled={!prompt.trim()}>
                        {isLoading ? 'Gerando...' : 'Gerar'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default function AssetsView({ universe, onGenerateImage, isLoading }: AssetsViewProps) {
  const { t } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; prompt: string } | null>(null);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold flex items-center"><ImageIcon className="mr-3 h-8 w-8 text-secondary"/> {t('assets.title')}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
            <ImageIcon className="mr-2 h-4 w-4" /> {t('assets.generateImage')}
          </Button>
          <Button variant="secondary" disabled>
            <Music className="mr-2 h-4 w-4" /> {t('assets.generateSound')}
          </Button>
        </div>
      </div>

      <div className="mb-6">{/* TODO: Filters */}</div>

      <h2 className="text-2xl font-semibold mb-4">{t('assets.generatedImages')}</h2>
      {universe.assets.visual.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {universe.assets.visual.map(asset => (
            <ImageCard key={asset.id} asset={asset} onClick={() => setSelectedImage(asset)} />
          ))}
        </div>
      ) : (
        <div className="text-center py-10 text-text-secondary">
          <p>{t('assets.noImages')}</p>
        </div>
      )}

       <h2 className="text-2xl font-semibold my-8">{t('assets.generatedSounds')}</h2>
        <div className="text-center py-10 text-text-secondary">
          <p>{t('assets.noSound')}</p>
        </div>

      <GenerateImageModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerate={onGenerateImage}
        isLoading={isLoading}
      />
      
      {selectedImage && (
        <Modal isOpen={!!selectedImage} onClose={() => setSelectedImage(null)} title="Visualizar Imagem">
            <img src={selectedImage.url} alt={selectedImage.prompt} className="w-full h-auto rounded-lg" />
            <p className="mt-4 text-text-secondary italic">{selectedImage.prompt}</p>
        </Modal>
      )}
    </div>
  );
}
