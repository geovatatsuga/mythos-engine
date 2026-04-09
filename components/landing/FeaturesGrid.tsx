import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Database, Download, FileText, Shield, Users } from 'lucide-react';
import { useLanguage } from '../../LanguageContext';

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full border border-nobel text-nobel text-xs uppercase tracking-widest font-serif mb-6">
    {children}
  </span>
);

export default function FeaturesGrid() {
  const { t } = useLanguage();
  const features = [
    { icon: <BookOpen className="w-6 h-6" />, title: t('landing.features.codex.title'), desc: t('landing.features.codex.desc'), accent: '197,160,89' },
    { icon: <Users className="w-6 h-6" />, title: t('landing.features.characters.title'), desc: t('landing.features.characters.desc'), accent: '244,63,94' },
    { icon: <FileText className="w-6 h-6" />, title: t('landing.features.chapters.title'), desc: t('landing.features.chapters.desc'), accent: '120,80,220' },
    { icon: <Database className="w-6 h-6" />, title: t('landing.features.memory.title'), desc: t('landing.features.memory.desc'), accent: '16,185,129' },
    { icon: <Shield className="w-6 h-6" />, title: t('landing.features.arbiter.title'), desc: t('landing.features.arbiter.desc'), accent: '139,92,246' },
    { icon: <Download className="w-6 h-6" />, title: t('landing.features.export.title'), desc: t('landing.features.export.desc'), accent: '100,160,230' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-16">
        <Badge>{t('landing.features.badge')}</Badge>
        <h2 className="font-serif text-4xl md:text-5xl text-stone mt-2">{t('landing.features.title')}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {features.map((feat, i) => (
          <motion.div
            key={i}
            className="relative group p-8 rounded-2xl border border-stone-200 bg-white hover:border-nobel/40 transition-all duration-500 hover:shadow-lg"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.5 }}
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-colors duration-300"
              style={{ background: `rgba(${feat.accent},0.08)`, color: `rgba(${feat.accent},0.85)` }}
            >
              {feat.icon}
            </div>
            <h3 className="font-serif text-xl text-stone-900 mb-3">{feat.title}</h3>
            <p className="text-stone-500 text-sm leading-relaxed">{feat.desc}</p>
            <div
              className="absolute top-0 left-6 right-6 h-[2px] rounded-b opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: `rgba(${feat.accent},0.6)` }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
