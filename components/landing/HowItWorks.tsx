import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Feather, GitBranch } from 'lucide-react';
import { useLanguage } from '../../LanguageContext';

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full border border-nobel text-nobel text-xs uppercase tracking-widest font-serif mb-6">
    {children}
  </span>
);

export default function HowItWorks() {
  const { t } = useLanguage();
  const steps = [
    { num: '01', icon: <Feather className="w-6 h-6" />, title: t('landing.how.step1.title'), desc: t('landing.how.step1.desc') },
    { num: '02', icon: <GitBranch className="w-6 h-6" />, title: t('landing.how.step2.title'), desc: t('landing.how.step2.desc') },
    { num: '03', icon: <BookOpen className="w-6 h-6" />, title: t('landing.how.step3.title'), desc: t('landing.how.step3.desc') },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-16">
        <Badge>{t('landing.how.badge')}</Badge>
        <h2 className="font-serif text-4xl md:text-5xl text-stone mt-2">{t('landing.how.title')}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="relative text-center md:text-left"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.15, duration: 0.6 }}
          >
            {i < 2 && (
              <div className="hidden md:block absolute top-10 left-full w-12 flex items-center justify-center z-10 -translate-x-6">
                <ArrowRight className="w-4 h-4 text-nobel/30" />
              </div>
            )}
            <div className="w-20 h-20 rounded-2xl border border-nobel/30 bg-stone-50 flex flex-col items-center justify-center mx-auto md:mx-0 mb-6 shadow-sm">
              <span className="text-[10px] font-mono text-nobel/50 tracking-widest">{step.num}</span>
              <div className="text-nobel mt-1">{step.icon}</div>
            </div>
            <h3 className="font-serif text-2xl text-stone-900 mb-3">{step.title}</h3>
            <p className="text-stone-500 text-sm leading-relaxed">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
