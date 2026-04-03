import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Language } from './i18n';
import { translate } from './i18n';

interface LanguageContextType {
  lang: Language;
  toggleLang: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'pt',
  toggleLang: () => {},
  t: (key) => key,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('mythos-lang');
      return saved === 'en' ? 'en' : 'pt';
    } catch {
      return 'pt';
    }
  });

  const toggleLang = useCallback(() => {
    setLang(prev => {
      const next: Language = prev === 'pt' ? 'en' : 'pt';
      try { localStorage.setItem('mythos-lang', next); } catch {}
      return next;
    });
  }, []);

  const t = useCallback(
    (key: string): string => translate(key, lang),
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
