
import React, { useState, useMemo, useEffect } from 'react';
import { motion as _motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronDown, BookOpen, Sparkles, Users, Feather, Crown, Scroll, Brain, Scale, Music, GitBranch, ImageIcon, Map, Film, Palette, FileText, Download, Shield, Database, KeyRound } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

// Fix: framer-motion 10.x + React 19 className/onClick typing conflict
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const motion = _motion as any;

interface LandingPageProps {
  onStart: () => void;
  onConfigureApiKeys: () => void;
  hasApiKeys: boolean;
}

// --- Components ---

const CosmicParticles = () => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: { x: number, y: number, vx: number, vy: number, size: number, alpha: number }[] = [];
    let mouse = { x: -1000, y: -1000 };
    let animationFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      const numParticles = Math.floor((canvas.width * canvas.height) / 8000);
      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          size: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.5 + 0.1
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 200) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(197, 160, 89, ${0.3 * (1 - dist / 200)})`;
          ctx.lineWidth = 1;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
          
          p.x += dx * 0.02;
          p.y += dy * 0.02;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(197, 160, 89, ${p.alpha})`;
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    canvas.addEventListener('mouseleave', () => {
      mouse.x = -1000;
      mouse.y = -1000;
    });

    resize();
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-auto mix-blend-screen opacity-60" />;
};

const Section: React.FC<{ 
  children: React.ReactNode; 
  className?: string; 
  dark?: boolean;
  id?: string;
}> = ({ children, className = '', dark = false, id }) => (
  <section id={id} className={`py-24 px-6 md:px-12 lg:px-24 relative overflow-hidden ${dark ? 'bg-stone-dark text-paper' : 'bg-paper text-stone'} ${className}`}>
    {children}
  </section>
);

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full border border-nobel text-nobel text-xs uppercase tracking-widest font-serif mb-6">
    {children}
  </span>
);

const DropCap: React.FC<{ children: string }> = ({ children }) => (
  <span className="float-left text-7xl font-serif text-nobel leading-[0.8] mr-3 mt-2">
    {children}
  </span>
);

// --- Interactive Diagrams ---

const PHASE_DURATION = 9000;

// ── Phase Illustration — detailed animated manuscript SVGs ─────────────────
const PhaseIllustration = ({ phase }: { phase: number }) => {
  const { lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;

  const ink      = 'rgba(80,48,12,0.88)';
  const inkMid   = 'rgba(80,48,12,0.50)';
  const inkFaint = 'rgba(80,48,12,0.28)';
  const gold     = 'rgba(150,100,20,0.95)';
  const goldMid  = 'rgba(150,100,20,0.55)';
  const goldFaint= 'rgba(150,100,20,0.22)';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        className="w-full h-full flex flex-col items-center justify-center"
        style={{ padding: '0.75rem 0.5rem', gap: '0.5rem' }}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {phase === 0 && (
          /* ── Phase I: Premise → World ─────────────────────────────────────
             A single quill writes. Text transforms into geography.
             Left: premise sentence on parchment strip.
             Arrow with spark. Right: continent map emerging stroke by stroke. */
          <>
            <svg viewBox="0 0 280 200" style={{ width: '100%', maxWidth: 390 }}>
              <defs>
                <marker id="arrow0" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M1,1 L6,3.5 L1,6" fill="none" stroke={inkMid} strokeWidth="1.2"/>
                </marker>
              </defs>

              {/* ── Parchment premise card ── */}
              <rect x="4" y="30" width="110" height="68" rx="3"
                fill="rgba(220,190,120,0.18)" stroke={ink} strokeWidth="1.4"/>
              {/* Title bar */}
              <rect x="4" y="30" width="110" height="14" rx="2"
                fill="rgba(150,100,20,0.12)" stroke="none"/>
              <text x="59" y="41" textAnchor="middle" fontSize="6.5"
                fill={gold} fontFamily="Georgia,serif" letterSpacing="0.14em">
                {l === 'pt' ? 'PREMISSA' : 'PREMISE'}
              </text>
              {/* Quill icon */}
              <path d="M13 52 C13 44 24 42 26 52 L20 72 Z" fill="none" stroke={inkMid} strokeWidth="1"/>
              <path d="M20 72 L19 80 M20 72 L21 80" stroke={inkMid} strokeWidth="0.8"/>
              {/* Lines of "text" */}
              {[56,64,72,80,88].map((y, i) => (
                <motion.line key={i}
                  x1="34" y1={y} x2={104 - i*5} y2={y}
                  stroke={inkMid} strokeWidth="1.1" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: 0.7, delay: 0.1 + i * 0.15, ease: 'easeOut' }}
                />
              ))}
              {/* Corner ornaments */}
              {[[4,30],[114,30],[4,98],[114,98]].map(([cx,cy],i)=>(
                <circle key={i} cx={cx} cy={cy} r="2" fill={goldMid}/>
              ))}

              {/* ── Arrow + spark ── */}
              <motion.line x1="118" y1="64" x2="145" y2="64"
                stroke={inkMid} strokeWidth="1.2" strokeDasharray="3 3"
                markerEnd="url(#arrow0)"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.9 }}
              />
              {/* spark */}
              <motion.g
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 1, 0.6], scale: [0, 1.2, 1, 0.9] }}
                transition={{ duration: 0.5, delay: 1.1 }}
                style={{ transformOrigin: '131px 57px' }}
              >
                {[0, 45, 90, 135].map((deg, i) => {
                  const r = 7;
                  const rad = (deg * Math.PI) / 180;
                  return (
                    <line key={i}
                      x1={131 + Math.cos(rad) * 3} y1={57 + Math.sin(rad) * 3}
                      x2={131 + Math.cos(rad) * r} y2={57 + Math.sin(rad) * r}
                      stroke={gold} strokeWidth="1.2" strokeLinecap="round"
                    />
                  );
                })}
                <circle cx="131" cy="57" r="2.5" fill={gold}/>
              </motion.g>

              {/* ── Map / World card ── */}
              <rect x="150" y="14" width="126" height="150" rx="3"
                fill="rgba(220,190,120,0.12)" stroke={ink} strokeWidth="1.4"/>
              {/* Map title */}
              <text x="213" y="28" textAnchor="middle" fontSize="6.5"
                fill={gold} fontFamily="Georgia,serif" letterSpacing="0.12em">
                {l === 'pt' ? 'MUNDO' : 'WORLD'}
              </text>

              {/* Continent silhouette — drawn stroke by stroke */}
              <motion.path
                d="M175 55 C180 47 190 48 196 44 C202 40 208 46 205 54
                   C212 55 216 64 210 68 C214 76 208 86 200 82
                   C196 92 186 91 182 83 C174 80 170 68 175 55Z"
                fill="rgba(150,100,20,0.1)" stroke={ink} strokeWidth="1.4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.2, delay: 1.1, ease: 'easeOut' }}
              />
              {/* Island */}
              <motion.path d="M220 70 C224 65 231 68 228 75 C232 80 226 84 222 80Z"
                fill="none" stroke={ink} strokeWidth="1.1"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 2.0 }}
              />
              {/* Mountain symbols */}
              {[[182,68],[192,72],[186,78]].map(([mx,my],i)=>(
                <motion.path key={i}
                  d={`M${mx-4} ${my+4} L${mx} ${my-2} L${mx+4} ${my+4}`}
                  fill="none" stroke={inkMid} strokeWidth="0.9"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: 1.8 + i*0.15 }}
                />
              ))}
              {/* Compass rose */}
              <motion.g
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 2.2 }}
              >
                <circle cx="248" cy="140" r="10" fill="none" stroke={inkFaint} strokeWidth="0.8"/>
                {['N','S','E','O'].map((d,i)=>{
                  const angles = [270,90,0,180];
                  const rad = angles[i]*Math.PI/180;
                  return <text key={d} x={248+Math.cos(rad)*14} y={140+Math.sin(rad)*14+3}
                    textAnchor="middle" fontSize="5" fill={inkMid} fontFamily="Georgia,serif">{d}</text>;
                })}
                <line x1="248" y1="130" x2="248" y2="150" stroke={inkMid} strokeWidth="0.8"/>
                <line x1="238" y1="140" x2="258" y2="140" stroke={inkMid} strokeWidth="0.8"/>
              </motion.g>

              {/* Legend dots */}
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}>
                {[
                  { y: 100, label: l==='pt'?'Capital':'Capital' },
                  { y: 112, label: l==='pt'?'Facção':'Faction' },
                  { y: 124, label: l==='pt'?'Segredo':'Secret' },
                ].map((item, i)=>(
                  <g key={i}>
                    <circle cx="162" cy={item.y} r="2" fill={i===0 ? gold : inkFaint}/>
                    <text x="168" y={item.y+3} fontSize="6" fill={inkMid} fontFamily="Georgia,serif">
                      {item.label}
                    </text>
                  </g>
                ))}
              </motion.g>
            </svg>

            {/* Caption */}
            <p style={{ fontSize: 10, color: inkMid, fontFamily: 'Georgia,serif', fontStyle: 'italic', textAlign: 'center', letterSpacing: '0.06em' }}>
              {l === 'pt'
                ? 'Arquiteto · Forjador — expandem a premissa em universo'
                : 'Architect · Soulforger — expand the premise into a universe'}
            </p>
          </>
        )}

        {phase === 1 && (
          /* ── Phase II: Writing — beats → prose ─────────────────────────────
             Top row: 5 agent seals.
             Below: beat cards flowing into text lines (prose). */
          <>
            <svg viewBox="0 0 384 215" style={{ width: '100%', maxWidth: 520 }}>
              <defs>
                <marker id="arrow1" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M1,1 L5,3 L1,5" fill="none" stroke={inkMid} strokeWidth="1.1"/>
                </marker>
              </defs>

              {/* ── 7 agent seals — 6 sequential + Director (always on) ── */}
              {([
                { label: l==='pt'?'Arquiteto':'Architect',   col: '150,100,20',  x: 14  },
                { label: l==='pt'?'Forjador':'Soulforger',   col: '180,60,60',   x: 65  },
                { label: l==='pt'?'Tecelão':'Weaver',        col: '70,70,200',   x: 116 },
                { label: l==='pt'?'Bardo':'Bard',            col: '30,150,100',  x: 167 },
                { label: l==='pt'?'Leitor':'Lector',         col: '180,30,180',  x: 218 },
                { label: l==='pt'?'Cronista':'Chronicler',   col: '120,60,200',  x: 269 },
                { label: l==='pt'?'Diretor':'Director',      col: '168,85,247',  x: 326, isDirector: true },
              ] as { label: string; col: string; x: number; isDirector?: boolean }[]).map((ag, i) => (
                <motion.g key={i}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                >
                  {ag.isDirector ? (
                    /* Director — divine crown, always watching */
                    <>
                      {/* Visual separator */}
                      <line x1={ag.x - 5} y1="4" x2={ag.x - 5} y2="62"
                        stroke={`rgba(${ag.col},0.14)`} strokeWidth="0.6" strokeDasharray="2.5 2.5" />
                      <g transform={`translate(${ag.x}, 0)`}>
                        {/* Halo ring */}
                        <motion.circle cx="24" cy="24" r="22"
                          stroke={`rgba(${ag.col},0.28)`} strokeWidth="0.7" strokeDasharray="1.5 5"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
                          style={{ transformOrigin: '24px 24px' }}
                        />
                        {/* 8 radiant rays */}
                        {[0,45,90,135,180,225,270,315].map((deg, k) => {
                          const rad = (deg * Math.PI) / 180;
                          const long = k % 2 === 0; const r1 = 11, r2 = long ? 20 : 15;
                          return <line key={k}
                            x1={24 + r1 * Math.cos(rad)} y1={24 + r1 * Math.sin(rad)}
                            x2={24 + r2 * Math.cos(rad)} y2={24 + r2 * Math.sin(rad)}
                            stroke={`rgba(${ag.col},${long ? 0.72 : 0.35})`}
                            strokeWidth={long ? 0.95 : 0.6} strokeLinecap="round" />;
                        })}
                        {/* Crown */}
                        <path d="M15 29 L15 25 L18 19 L21 23 L24 15 L27 23 L30 19 L33 25 L33 29 Z"
                          fill={`rgba(${ag.col},0.1)`} stroke={`rgba(${ag.col},0.85)`}
                          strokeWidth="0.85" strokeLinejoin="round" />
                        <rect x="14" y="29" width="20" height="4" rx="1"
                          fill={`rgba(${ag.col},0.12)`} stroke={`rgba(${ag.col},0.6)`} strokeWidth="0.7" />
                        <motion.circle cx="24" cy="22" r="2" fill={`rgba(${ag.col},0.95)`}
                          animate={{ r: [2, 2.6, 2], opacity: [0.65, 1, 0.65] }}
                          transition={{ duration: 2.2, repeat: Infinity }} />
                        <circle cx="18" cy="19" r="1" fill={`rgba(${ag.col},0.55)`} />
                        <circle cx="30" cy="19" r="1" fill={`rgba(${ag.col},0.55)`} />
                        {/* Name */}
                        <text x="24" y="51" textAnchor="middle" fontSize="5.5"
                          fill={`rgba(${ag.col},0.9)`} fontFamily="Georgia,serif" fontStyle="italic">
                          {ag.label}
                        </text>
                        <text x="24" y="59" textAnchor="middle" fontSize="4.2"
                          fill={`rgba(${ag.col},0.4)`} fontFamily="monospace" letterSpacing="0.18em">
                          {l === 'pt' ? 'SEMPRE·ACTIVO' : 'ALWAYS·ON'}
                        </text>
                      </g>
                    </>
                  ) : (
                    /* Sequential agent — plain seal */
                    <>
                      <rect x={ag.x} y="8" width="48" height="38" rx="3"
                        fill={`rgba(${ag.col},0.08)`} stroke={`rgba(${ag.col},0.7)`} strokeWidth="1.1"/>
                      <circle cx={ag.x+24} cy="20" r="5.5"
                        fill={`rgba(${ag.col},0.15)`} stroke={`rgba(${ag.col},0.8)`} strokeWidth="0.9"/>
                      <text x={ag.x+24} y="24" textAnchor="middle" fontSize="6"
                        fill={`rgba(${ag.col},0.9)`} fontFamily="Georgia,serif" fontWeight="bold">{i+1}</text>
                      <text x={ag.x+24} y="40" textAnchor="middle" fontSize="6"
                        fill={`rgba(${ag.col},0.8)`} fontFamily="Georgia,serif" fontStyle="italic">
                        {ag.label}
                      </text>
                    </>
                  )}
                </motion.g>
              ))}

              {/* ── Beat cards row ── */}
              {([
                { label: l==='pt'?'Gancho':'Hook',       sub: l==='pt'?'conflito inicial':'initial conflict' },
                { label: l==='pt'?'Virada':'Turn',       sub: l==='pt'?'ponto de mudança':'turning point' },
                { label: l==='pt'?'Clímax':'Climax',    sub: l==='pt'?'tensão máxima':'peak tension' },
                { label: l==='pt'?'Arco':'Arc',          sub: l==='pt'?'resolução':'resolution' },
              ] as { label: string; sub: string }[]).map((beat, i) => (
                <motion.g key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.55 + i * 0.14 }}
                >
                  <rect x={10 + i*67} y="58" width="58" height="38" rx="2"
                    fill="rgba(220,190,120,0.14)" stroke={ink} strokeWidth="1.1"/>
                  <text x={10 + i*67 + 29} y="74" textAnchor="middle" fontSize="7"
                    fill={ink} fontFamily="Georgia,serif" fontWeight="bold">
                    {beat.label}
                  </text>
                  <text x={10 + i*67 + 29} y="88" textAnchor="middle" fontSize="5.5"
                    fill={inkMid} fontFamily="Georgia,serif" fontStyle="italic">
                    {beat.sub}
                  </text>
                </motion.g>
              ))}

              {/* ── Arrow: beats → prose ── */}
              <motion.line x1="140" y1="100" x2="140" y2="118"
                stroke={inkMid} strokeWidth="1.2" markerEnd="url(#arrow1)"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ delay: 1.2 }}
              />
              <motion.text x="152" y="113" fontSize="6" fill={goldMid}
                fontFamily="Georgia,serif" fontStyle="italic"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 1.3 }}>
                {l === 'pt' ? 'Bardo escreve' : 'Bard writes'}
              </motion.text>

              {/* ── Prose output — lines appearing one by one ── */}
              <rect x="10" y="122" width="260" height="76" rx="3"
                fill="rgba(220,190,120,0.1)" stroke={ink} strokeWidth="1.2"/>
              {/* title bar */}
              <rect x="10" y="122" width="260" height="14" rx="2"
                fill="rgba(150,100,20,0.1)" stroke="none"/>
              <text x="140" y="133" textAnchor="middle" fontSize="6"
                fill={gold} fontFamily="Georgia,serif" letterSpacing="0.14em">
                {l === 'pt' ? 'CAPÍTULO I — RASCUNHO' : 'CHAPTER I — DRAFT'}
              </text>
              {[
                { len: 230, delay: 1.4 },
                { len: 210, delay: 1.7 },
                { len: 225, delay: 2.0 },
                { len: 190, delay: 2.3 },
              ].map((line, i) => (
                <motion.line key={i}
                  x1="22" y1={142 + i*13} x2={22 + line.len} y2={142 + i*13}
                  stroke={inkMid} strokeWidth="1.1" strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: 0.55, delay: line.delay, ease: 'easeOut' }}
                />
              ))}
            </svg>

            <p style={{ fontSize: 10, color: inkMid, fontFamily: 'Georgia,serif', fontStyle: 'italic', textAlign: 'center', letterSpacing: '0.06em' }}>
              {l === 'pt'
                ? 'Diretor · Tecelão · Bardo · Lector · Cronista — governam, escrevem, revisam e memorizam'
                : 'Director · Weaver · Bard · Lector · Chronicler — govern, write, polish and remember'}
            </p>
          </>
        )}

        {phase === 2 && (
          /* ── Phase III: The Codex — tome + four category cards ────────────
             Center: open book / codex.
             Four cards radiating out: Personagens, Locais, Facções, Timeline */
          <>
            <svg viewBox="0 0 280 210" style={{ width: '100%', maxWidth: 390 }}>
              {/* ── Open book / Codex ── */}
              {/* left page */}
              <motion.path d="M68 30 Q66 24 140 24 L140 178 Q66 178 68 174 Z"
                fill="rgba(220,190,120,0.15)" stroke={ink} strokeWidth="1.4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              />
              {/* right page */}
              <motion.path d="M140 24 Q214 24 212 30 L212 174 Q214 178 140 178 Z"
                fill="rgba(220,190,120,0.1)" stroke={ink} strokeWidth="1.4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              />
              {/* spine */}
              <line x1="140" y1="24" x2="140" y2="178" stroke={ink} strokeWidth="1.8"/>

              {/* Left page: 4 labeled lines (entries) */}
              {[
                l==='pt'?'Kael — protagonista':  'Kael — protagonist',
                l==='pt'?'Sira — antagonista':   'Sira — antagonist',
                l==='pt'?'Pedra da Origem — lore':'Origin Stone — lore',
                l==='pt'?'Torre Cinza — local':  'Gray Tower — location',
              ].map((entry, i) => (
                <motion.g key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.2 }}
                >
                  <circle cx="78" cy={45 + i*28} r="2.5" fill={goldMid}/>
                  <line x1="85" y1={45+i*28} x2={130 - (i%2)*6} y2={45+i*28}
                    stroke={inkFaint} strokeWidth="0.9" strokeLinecap="round"/>
                  <text x="78" y={57+i*28} fontSize="5.5"
                    fill={inkMid} fontFamily="Georgia,serif" fontStyle="italic">
                    {entry}
                  </text>
                </motion.g>
              ))}

              {/* Right page: chapter number + seal */}
              <motion.text x="176" y="70" textAnchor="middle" fontSize="28"
                fill={goldFaint} fontFamily="Georgia,serif" fontStyle="italic"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >I</motion.text>
              <motion.circle cx="176" cy="108" r="16"
                fill="rgba(255,248,225,0.7)" stroke={gold} strokeWidth="1.4"
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                style={{ transformOrigin: '176px 108px' }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.6 }}
              />
              <motion.text x="176" y="113" textAnchor="middle" fontSize="14"
                fill={gold} fontFamily="Georgia,serif"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}>✦</motion.text>
              <motion.text x="176" y="142" textAnchor="middle" fontSize="6"
                fill={inkMid} fontFamily="Georgia,serif" letterSpacing="0.16em"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 1.0 }}>
                {l === 'pt' ? 'CRONISTA' : 'CHRONICLER'}
              </motion.text>
              {/* Page number */}
              <text x="176" y="170" textAnchor="middle" fontSize="6" fill={inkFaint} fontFamily="Georgia,serif">
                pág. 1
              </text>

              {/* ── 4 floating info tags ── */}
              {([
                { label: l==='pt'?'Personagens':'Characters', x:   2, y: 8,   col: '150,100,20' },
                { label: l==='pt'?'Locais':'Locations',       x: 218, y: 8,   col: '70,70,180'  },
                { label: l==='pt'?'Facções':'Factions',       x:   2, y: 164, col: '160,60,60'  },
                { label: l==='pt'?'Timeline':'Timeline',      x: 218, y: 164, col: '30,140,90'  },
              ] as { label: string; x: number; y: number; col: string }[]).map((tag, i) => (
                <motion.g key={i}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ transformOrigin: `${tag.x+29}px ${tag.y+13}px` }}
                  transition={{ delay: 1.2 + i * 0.15, type: 'spring', stiffness: 180 }}
                >
                  <rect x={tag.x} y={tag.y} width="58" height="26" rx="3"
                    fill={`rgba(${tag.col},0.08)`} stroke={`rgba(${tag.col},0.55)`} strokeWidth="1"/>
                  <text x={tag.x+29} y={tag.y+17} textAnchor="middle" fontSize="6.5"
                    fill={`rgba(${tag.col},0.85)`} fontFamily="Georgia,serif" fontStyle="italic">
                    {tag.label}
                  </text>
                </motion.g>
              ))}

              {/* Connecting dashes from corners of book to tags */}
              {([
                { x1:68,  y1:40,  x2:60, y2:21 },
                { x1:212, y1:40,  x2:218,y2:21 },
                { x1:68,  y1:162, x2:60, y2:177 },
                { x1:212, y1:162, x2:218,y2:177 },
              ]).map((ln, i) => (
                <motion.line key={i}
                  x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke={inkFaint} strokeWidth="0.8" strokeDasharray="2 3"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ delay: 1.25 + i*0.1 }}
                />
              ))}
            </svg>

            <p style={{ fontSize: 10, color: inkMid, fontFamily: 'Georgia,serif', fontStyle: 'italic', textAlign: 'center', letterSpacing: '0.06em' }}>
              {l === 'pt'
                ? 'Cronista — registra tudo. O Motor nunca esquece.'
                : 'Chronicler — records everything. The Engine never forgets.'}
            </p>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

// ─── DEAD COMPONENT (kept for reference, unused) ──────────────────────────
const AgentConstellationVisual = ({ phase, embedded }: { phase: number; embedded?: boolean }) => {
  const { lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;

  // 5 agents in a regular pentagon (cx=150,cy=152,r=110, starting at top)
  const agents: { name: Record<L, string>; col: string; x: number; y: number }[] = [
    { name: { pt: 'Arquiteto', en: 'Architect'  }, col: '197,160,89', x: 150, y: 42  },
    { name: { pt: 'Forjador',  en: 'Soulforger' }, col: '244,63,94',  x: 254, y: 114 },
    { name: { pt: 'Tecelão',   en: 'Weaver'     }, col: '120,80,220', x: 215, y: 235 },
    { name: { pt: 'Bardo',     en: 'Bard'       }, col: '16,185,129', x: 85,  y: 235 },
    { name: { pt: 'Cronista',  en: 'Chronicler' }, col: '139,92,246', x: 46,  y: 114 },
  ];

  // which agent indices glow per phase
  const activeByPhase = [[0, 1], [2, 3], [0,1,2,3,4]];
  const activeIdx = activeByPhase[phase];

  // traveling pulses: from → to
  const signalsByPhase: { from: number; to: number; col: string; delay: number }[][] = [
    [
      { from: 0, to: 1, col: '197,160,89', delay: 0 },
      { from: 1, to: 0, col: '244,63,94',  delay: 0.9 },
    ],
    [
      { from: 2, to: 3, col: '120,80,220', delay: 0 },
      { from: 3, to: 2, col: '16,185,129', delay: 1.0 },
    ],
    [
      { from: 0, to: 4, col: '197,160,89', delay: 0    },
      { from: 1, to: 4, col: '244,63,94',  delay: 0.4  },
      { from: 2, to: 4, col: '120,80,220', delay: 0.8  },
      { from: 3, to: 4, col: '16,185,129', delay: 1.2  },
    ],
  ];
  const signals = signalsByPhase[phase];

  // bright dashed lines for active edges
  const edgesByPhase: [number,number][][] = [
    [[0,1]],
    [[2,3]],
    [[0,4],[1,4],[2,4],[3,4]],
  ];
  const activeEdges = edgesByPhase[phase];
  const pentEdges: [number,number][] = [[0,1],[1,2],[2,3],[3,4],[4,0]];

  const phaseCols = ['197,140,60','90,55,180','100,65,200'];
  const ac = `rgba(${phaseCols[phase]},`;

  // label text anchor + y-offset per node
  const textAnchor:  ('middle'|'start'|'end')[] = ['middle','start','start','end','end'];
  const labelOffset: [number,number][] = [[0,-14],[10,-6],[8,16],[-8,16],[-10,-6]];

  return (
    <div
      className={embedded ? 'relative h-full overflow-hidden' : 'relative mt-12 overflow-hidden'}
      style={embedded ? {} : { border: '1px solid rgba(197,160,89,0.1)', borderRadius: 2 }}
    >
      <div
        className="relative"
        style={{ height: embedded ? '100%' : 300, minHeight: 280, background: 'linear-gradient(160deg, #06050e 0%, #0a0716 55%, #060410 100%)' }}
      >
        {/* radial phase-colored ambient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 40% 40% at 50% 54%, ${ac}0.07) 0%, transparent 72%)` }}
        />

        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 300 290"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="agGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="agGlowSoft" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* dim pentagon outline */}
          {pentEdges.map(([a, b], i) => (
            <line key={i}
              x1={agents[a].x} y1={agents[a].y}
              x2={agents[b].x} y2={agents[b].y}
              stroke="rgba(197,160,89,0.07)" strokeWidth="0.8"
            />
          ))}

          {/* active dashed edges */}
          <AnimatePresence>
            {activeEdges.map(([a, b], i) => (
              <motion.line key={`${phase}-e${i}`}
                x1={agents[a].x} y1={agents[a].y}
                x2={agents[b].x} y2={agents[b].y}
                stroke={`rgba(${agents[b].col},0.3)`}
                strokeWidth="0.8" strokeDasharray="3 5"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              />
            ))}
          </AnimatePresence>

          {/* traveling signal pulses */}
          {signals.map((sig, i) => (
            <motion.circle
              key={`${phase}-s${i}`}
              r="3"
              fill={`rgba(${sig.col},0.95)`}
              filter="url(#agGlow)"
              animate={{
                cx: [agents[sig.from].x, agents[sig.to].x],
                cy: [agents[sig.from].y, agents[sig.to].y],
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 1.8,
                delay: sig.delay,
                repeat: Infinity,
                ease: 'easeInOut',
                times: [0, 0.1, 0.88, 1],
              }}
            />
          ))}

          {/* agent nodes */}
          {agents.map((ag, i) => {
            const active = activeIdx.includes(i);
            return (
              <g key={i}>
                {active && (
                  <motion.circle cx={ag.x} cy={ag.y} r="14"
                    fill="none" stroke={`rgba(${ag.col},0.25)`} strokeWidth="1"
                    animate={{ r: [10, 18, 10], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2.6, delay: i * 0.35, repeat: Infinity }}
                  />
                )}
                <motion.circle cx={ag.x} cy={ag.y} r="9"
                  fill={`rgba(${ag.col},${active ? 0.12 : 0.03})`}
                  stroke={`rgba(${ag.col},${active ? 0.8 : 0.14})`}
                  strokeWidth="1"
                  animate={{ opacity: active ? 1 : 0.35 }}
                  transition={{ duration: 0.7 }}
                />
                <motion.circle cx={ag.x} cy={ag.y} r="3.5"
                  fill={`rgba(${ag.col},${active ? 0.9 : 0.18})`}
                  filter={active ? 'url(#agGlow)' : undefined}
                  animate={{ opacity: active ? [0.75, 1, 0.75] : 0.18 }}
                  transition={{ duration: 2.2, repeat: Infinity }}
                />
                <text
                  x={ag.x + labelOffset[i][0]}
                  y={ag.y + labelOffset[i][1]}
                  textAnchor={textAnchor[i]}
                  fontSize="7"
                  fontFamily="Georgia, serif"
                  fontStyle="italic"
                  fill={`rgba(${ag.col},${active ? 0.8 : 0.22})`}
                >
                  {ag.name[l]}
                </text>
              </g>
            );
          })}

          {/* center icon — phase-specific */}
          <AnimatePresence mode="wait">
            <motion.g key={phase}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              {phase === 0 && (
                /* flame */
                <>
                  <motion.path
                    d="M150 133 C148 139 142 143 142 150 C142 157 146 163 150 163 C154 163 158 157 158 150 C158 143 152 139 150 133Z"
                    fill={`${ac}0.85)`} filter="url(#agGlow)"
                    animate={{ scaleY: [1,1.06,0.95,1] }}
                    transition={{ duration: 2.2, repeat: Infinity }}
                    style={{ transformOrigin: '150px 158px' }}
                  />
                  <motion.path
                    d="M150 141 C149 145 146 147 146 151 C146 155 148 158 150 158 C152 158 154 155 154 151 C154 147 151 145 150 141Z"
                    fill="rgba(255,235,150,0.75)"
                    animate={{ scaleY: [1,1.1,0.92,1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    style={{ transformOrigin: '150px 158px' }}
                  />
                </>
              )}
              {phase === 1 && (
                /* scroll being written */
                <>
                  <rect x="136" y="138" width="28" height="24" rx="2"
                    fill="rgba(12,8,22,0.8)" stroke={`${ac}0.5)`} strokeWidth="0.8" />
                  {[4,10,16].map((dy, i) => (
                    <motion.line key={i}
                      x1="139" x2="161" y1={138+dy} y2={138+dy}
                      stroke={`${ac}${0.7 - i*0.15})`} strokeWidth="1.2" strokeLinecap="round"
                      initial={{ pathLength: 0 }} animate={{ pathLength: [0,1,1,0] }}
                      transition={{ duration: 3, delay: i*0.45, repeat: Infinity, times: [0,0.3,0.85,1] }}
                    />
                  ))}
                </>
              )}
              {phase === 2 && (
                /* sealed tome */
                <>
                  <rect x="135" y="135" width="30" height="28" rx="1.5"
                    fill="rgba(12,8,22,0.85)" stroke={`${ac}0.65)`} strokeWidth="0.8" />
                  <line x1="150" y1="137" x2="150" y2="161"
                    stroke={`${ac}0.2)`} strokeWidth="0.7" />
                  {[139,145,151,157].map((y, i) => (
                    <motion.line key={i} x1="137" x2="148" y1={y} y2={y}
                      stroke={`${ac}0.5)`} strokeWidth="0.9" strokeLinecap="round"
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, delay: i*0.2 }}
                    />
                  ))}
                  <motion.circle cx="150" cy="135" r="4.5"
                    fill="rgba(8,5,16,0.9)" stroke={`${ac}0.7)`} strokeWidth="0.8"
                    filter="url(#agGlowSoft)"
                    animate={{ opacity: [0.7,1,0.7] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                  />
                </>
              )}
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>
    </div>
  );
};

// ── Phase 01 — A Chama Prometéica ──────────────────────────────────────────
const SparkVisual = () => {
  const embers = React.useMemo(() =>
    Array.from({ length: 28 }, (_, i) => ({
      x: 41 + (Math.random() - 0.5) * 24,
      delay: Math.random() * 3.5,
      dur: 1.8 + Math.random() * 2.2,
      size: 1.4 + Math.random() * 2.8,
      drift: (Math.random() - 0.5) * 54,
      col: i % 3 === 0 ? 'rgba(255,210,80,0.95)' : i % 3 === 1 ? 'rgba(255,140,40,0.85)' : 'rgba(255,75,25,0.7)',
    })), []);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* Sky gradient — night above, fire below */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, #0a0705 0%, #1a0e06 50%, #2d1204 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 35% at 50% 82%, rgba(200,80,20,0.45) 0%, transparent 70%)' }} />

      {/* Stars in sky */}
      {React.useMemo(() => Array.from({ length: 30 }, (_, i) => ({
        cx: 5 + Math.random() * 90, cy: 5 + Math.random() * 45,
        r: 0.5 + Math.random() * 1, delay: Math.random() * 4,
      })), []).map((s, i) => (
        <motion.div key={i} className="absolute rounded-full"
          style={{ width: s.r * 2, height: s.r * 2, left: `${s.cx}%`, top: `${s.cy}%`, background: 'rgba(255,240,200,0.9)' }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2 + Math.random() * 3, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* Rising embers */}
      {embers.map((e, i) => (
        <motion.div key={i} className="absolute rounded-full"
          style={{ width: e.size, height: e.size, left: `${e.x}%`, bottom: '40%', background: e.col }}
          animate={{ y: [0, -(100 + Math.random() * 90)], x: [0, e.drift], opacity: [1, 0], scale: [1, 0.15] }}
          transition={{ duration: e.dur, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* Flame — layered CSS shapes */}
      <div className="absolute flex items-end justify-center" style={{ bottom: '30%', width: 160, height: 180 }}>
        {/* Outer glow blur */}
        <motion.div className="absolute rounded-full"
          style={{ width: 90, height: 50, bottom: -6, background: 'rgba(180,70,15,0.7)', filter: 'blur(18px)' }}
          animate={{ opacity: [0.6, 1, 0.6], scaleX: [1, 1.15, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Outer flame body */}
        <motion.div className="absolute"
          style={{
            width: 78, height: 140, bottom: 0,
            background: 'radial-gradient(ellipse 55% 75% at 50% 92%, rgba(160,55,10,1) 0%, rgba(210,100,20,0.85) 40%, rgba(240,170,45,0.5) 72%, transparent 100%)',
            borderRadius: '48% 48% 28% 28% / 55% 55% 45% 45%',
            filter: 'blur(2.5px)',
          }}
          animate={{ scaleX: [1, 1.06, 0.96, 1.03, 1], scaleY: [1, 0.97, 1.04, 0.98, 1] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Mid flame */}
        <motion.div className="absolute"
          style={{
            width: 50, height: 108, bottom: 0,
            background: 'radial-gradient(ellipse 55% 78% at 50% 92%, rgba(210,110,15,1) 0%, rgba(245,175,55,0.85) 55%, rgba(255,225,110,0.5) 80%, transparent)',
            borderRadius: '48% 48% 28% 28% / 55% 55% 45% 45%',
            filter: 'blur(1.5px)',
          }}
          animate={{ scaleX: [1, 0.93, 1.07, 0.97, 1], scaleY: [1, 1.05, 0.96, 1.03, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Inner gold-white core */}
        <motion.div className="absolute"
          style={{
            width: 26, height: 70, bottom: 0,
            background: 'radial-gradient(ellipse 55% 78% at 50% 92%, rgba(255,255,200,1) 0%, rgba(255,230,130,0.9) 60%, transparent)',
            borderRadius: '48% 48% 28% 28% / 55% 55% 45% 45%',
          }}
          animate={{ scaleX: [1, 0.88, 1.12, 0.95, 1] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Stone altar / tripod base */}
      <svg className="absolute" style={{ bottom: '26%', width: 180 }} viewBox="0 0 180 28" overflow="visible">
        {/* Altar top slab */}
        <rect x="25" y="0" width="130" height="10" rx="1" fill="rgba(197,160,89,0.22)" />
        <rect x="15" y="10" width="150" height="6" rx="1" fill="rgba(197,160,89,0.14)" />
        {/* Greek meander on altar */}
        {Array.from({ length: 8 }, (_, i) => {
          const x = 22 + i * 17;
          return <path key={i} d={`M${x} 2 L${x} 8 L${x+7} 8 L${x+7} 2`} stroke="rgba(197,160,89,0.38)" fill="none" strokeWidth="0.7" />;
        })}
        {/* Tripod legs */}
        <line x1="60"  y1="16" x2="40"  y2="28" stroke="rgba(197,160,89,0.25)" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="90"  y1="16" x2="90"  y2="28" stroke="rgba(197,160,89,0.25)" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="120" y1="16" x2="140" y2="28" stroke="rgba(197,160,89,0.25)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
};

// ── Phase 02 — O Tear do Destino ────────────────────────────────────────────
const ForgingVisual = () => {
  // Star positions for a constellation (fixed)
  const stars = React.useMemo(() => [
    { x: 150, y: 55,  r: 3.5 }, // top center — the "idea"
    { x: 68,  y: 95,  r: 2.5 }, // upper left
    { x: 232, y: 95,  r: 2.5 }, // upper right
    { x: 55,  y: 165, r: 2   }, // mid left
    { x: 245, y: 165, r: 2   }, // mid right
    { x: 100, y: 218, r: 2.5 }, // lower left
    { x: 200, y: 218, r: 2.5 }, // lower right
    { x: 150, y: 248, r: 3.5 }, // bottom — the "chapter"
  ], []);

  // Edges to draw
  const edges = [
    [0,1],[0,2],[1,3],[2,4],[1,5],[2,6],[3,5],[4,6],[5,7],[6,7],[0,7],[1,2],[3,6],
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* Night sky */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #05050f 0%, #0b0818 50%, #060410 100%)' }} />
      {/* Subtle nebula */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 48%, rgba(80,50,160,0.14) 0%, transparent 70%)' }} />

      {/* Background micro-stars */}
      {React.useMemo(() => Array.from({ length: 40 }, (_, i) => ({
        cx: Math.random() * 100, cy: Math.random() * 100, r: 0.4 + Math.random() * 0.8, d: Math.random() * 5,
      })), []).map((s, i) => (
        <motion.div key={i} className="absolute rounded-full"
          style={{ width: s.r * 2, height: s.r * 2, left: `${s.cx}%`, top: `${s.cy}%`, background: 'rgba(220,210,255,0.7)' }}
          animate={{ opacity: [0.2, 0.9, 0.2] }}
          transition={{ duration: 2 + Math.random() * 4, delay: s.d, repeat: Infinity }}
        />
      ))}

      {/* Constellation SVG */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="starGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Constellation lines */}
        {edges.map(([a, b], i) => (
          <motion.line key={i}
            x1={stars[a].x} y1={stars[a].y} x2={stars[b].x} y2={stars[b].y}
            stroke="rgba(180,160,255,0.2)" strokeWidth="0.7"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.3 + i * 0.25, ease: 'easeInOut' }}
          />
        ))}

        {/* Bright connecting filament — fate thread */}
        <motion.path
          d={`M${stars[0].x} ${stars[0].y} C 80 130, 220 130, ${stars[7].x} ${stars[7].y}`}
          fill="none" stroke="rgba(197,160,89,0.5)" strokeWidth="0.9" strokeDasharray="3 5"
          initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.4, 0.8, 1] }}
        />

        {/* Star nodes */}
        {stars.map((s, i) => (
          <g key={i}>
            <motion.circle cx={s.x} cy={s.y} r={s.r * 2.2}
              fill="rgba(197,160,89,0.07)"
              animate={{ r: [s.r * 2, s.r * 3.5, s.r * 2] }}
              transition={{ duration: 2 + i * 0.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.circle cx={s.x} cy={s.y} r={s.r}
              fill="rgba(230,215,255,0.95)" filter="url(#starGlow)"
              animate={{ opacity: [0.7, 1, 0.7], r: [s.r, s.r * 1.25, s.r] }}
              transition={{ duration: 1.8 + i * 0.3, delay: i * 0.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </g>
        ))}

        {/* Labels — top and bottom star */}
        <motion.text x={stars[0].x} y={stars[0].y - 9} textAnchor="middle"
          fontSize="7" fill="rgba(197,160,89,0.6)" fontFamily="monospace" letterSpacing="0.15em"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }}>
          PREMISSA
        </motion.text>
        <motion.text x={stars[7].x} y={stars[7].y + 14} textAnchor="middle"
          fontSize="7" fill="rgba(197,160,89,0.6)" fontFamily="monospace" letterSpacing="0.15em"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 4.5 }}>
          CAPÍTULO
        </motion.text>
      </svg>
    </div>
  );
};

// ── Phase 03 — O Tomo Sagrado ───────────────────────────────────────────────
const ArtifactVisual = () => {
  const textLines = [
    { x1: 88, x2: 195, y: 122 },
    { x1: 88, x2: 210, y: 133 },
    { x1: 88, x2: 200, y: 144 },
    { x1: 88, x2: 185, y: 155 },
    { x1: 88, x2: 205, y: 166 },
    { x1: 88, x2: 170, y: 177 },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* Parchment atmosphere */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(150deg, #0e0b07 0%, #130f08 50%, #0a0805 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 55% at 50% 50%, rgba(197,140,40,0.11) 0%, transparent 70%)' }} />

      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="tomoGlow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="scrollGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(120,90,50,0.6)" />
            <stop offset="15%" stopColor="rgba(197,155,80,0.25)" />
            <stop offset="50%" stopColor="rgba(197,155,80,0.12)" />
            <stop offset="85%" stopColor="rgba(197,155,80,0.25)" />
            <stop offset="100%" stopColor="rgba(120,90,50,0.6)" />
          </linearGradient>
        </defs>

        {/* Tome body */}
        <motion.rect x="72" y="88" width="156" height="128" rx="3"
          fill="url(#scrollGrad)" stroke="rgba(197,155,80,0.4)" strokeWidth="1"
          initial={{ opacity: 0, scaleY: 0.7 }} animate={{ opacity: 1, scaleY: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: '150px 152px' }}
        />

        {/* Spine line (book crease) */}
        <motion.line x1="150" y1="90" x2="150" y2="214"
          stroke="rgba(197,155,80,0.3)" strokeWidth="0.8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.6 }}
        />

        {/* Top + bottom scroll curl */}
        <motion.path d="M 72 92 Q 60 92 60 100 Q 60 108 72 108"
          fill="rgba(100,70,30,0.5)" stroke="rgba(197,155,80,0.35)" strokeWidth="0.8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
        />
        <motion.path d="M 228 92 Q 240 92 240 100 Q 240 108 228 108"
          fill="rgba(100,70,30,0.5)" stroke="rgba(197,155,80,0.35)" strokeWidth="0.8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}
        />
        <motion.path d="M 72 208 Q 60 208 60 200 Q 60 192 72 192"
          fill="rgba(100,70,30,0.5)" stroke="rgba(197,155,80,0.35)" strokeWidth="0.8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.78 }}
        />
        <motion.path d="M 228 208 Q 240 208 240 200 Q 240 192 228 192"
          fill="rgba(100,70,30,0.5)" stroke="rgba(197,155,80,0.35)" strokeWidth="0.8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
        />

        {/* Illuminated title bar (top of page) */}
        <motion.rect x="82" y="96" width="68" height="1.5" rx="0.5"
          fill="rgba(197,155,80,0.55)"
          initial={{ scaleX: 0, originX: '82px' }} animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, delay: 1.0 }}
        />
        <motion.rect x="152" y="96" width="66" height="1.5" rx="0.5"
          fill="rgba(197,155,80,0.55)"
          initial={{ scaleX: 0, originX: '218px' }} animate={{ scaleX: 1 }}
          style={{ transformOrigin: '218px 96.75px' }}
          transition={{ duration: 0.8, delay: 1.0 }}
        />

        {/* Seal / emblem */}
        <motion.circle cx="150" cy="108" r="9"
          fill="rgba(10,8,4,0.9)" stroke="rgba(197,155,80,0.7)" strokeWidth="1"
          filter="url(#tomoGlow)"
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          style={{ transformOrigin: '150px 108px' }}
          transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 1.2 }}
        />
        <motion.path d="M150 101 L152 106 L157 106 L153 109 L155 114 L150 111 L145 114 L147 109 L143 106 L148 106 Z"
          fill="rgba(197,155,80,0.8)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
        />

        {/* Text lines appearing */}
        {textLines.map((l, i) => (
          <motion.line key={i}
            x1={l.x1} y1={l.y} x2={l.x2} y2={l.y}
            stroke="rgba(220,195,140,0.45)" strokeWidth="0.9" strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, delay: 1.8 + i * 0.35, ease: 'easeOut' }}
          />
        ))}

        {/* Right page text lines */}
        {textLines.map((l, i) => (
          <motion.line key={`r${i}`}
            x1={l.x1 + 68} y1={l.y} x2={Math.min(l.x2 + 62, 218)} y2={l.y}
            stroke="rgba(220,195,140,0.3)" strokeWidth="0.9" strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, delay: 2.1 + i * 0.35, ease: 'easeOut' }}
          />
        ))}

        {/* Corner illumination ornaments */}
        {[[82,96],[228,96],[82,212],[228,212]].map(([cx,cy], i) => (
          <motion.circle key={i} cx={cx} cy={cy} r="2.5"
            fill="rgba(197,155,80,0.6)" filter="url(#tomoGlow)"
            initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
            transition={{ delay: 0.9 + i * 0.1, type: 'spring', stiffness: 250 }}
          />
        ))}

        {/* Greek meander border — top */}
        <motion.path
          d="M75 86 L80 86 L80 82 L88 82 L88 86 L96 86 L96 82 L104 82 L104 86 L112 86 L112 82 L120 82 L120 86"
          fill="none" stroke="rgba(197,155,80,0.2)" strokeWidth="0.7"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, delay: 0.3 }}
        />
      </svg>

      {/* Ambient glow */}
      <motion.div className="absolute rounded-full"
        style={{ width: 160, height: 100, background: 'rgba(197,140,40,0.12)', filter: 'blur(40px)', top: '30%' }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
};

const ForgeOfSoulsDemo = ({ phase, onPhaseChange }: { phase: number; onPhaseChange: (i: number) => void }) => {
  const { t, lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;

  const phases: {
    num: string;
    label: string;
    title: string;
    desc: string;
    accent: string;
    agents: { name: Record<L, string>; col: string }[];
  }[] = [
    {
      num: '01',
      label: t('landing.demo.phase1.label'),
      title: t('landing.demo.phase1.title'),
      desc: t('landing.demo.phase1.desc'),
      accent: '197,160,89',
      agents: [
        { name: { pt: 'Arquiteto', en: 'Architect' }, col: '197,160,89' },
        { name: { pt: 'Forjador', en: 'Soulforger' }, col: '244,63,94' },
      ],
    },
    {
      num: '02',
      label: t('landing.demo.phase2.label'),
      title: t('landing.demo.phase2.title'),
      desc: t('landing.demo.phase2.desc'),
      accent: '120,80,220',
      agents: [
        { name: { pt: 'Tecelão', en: 'Weaver' }, col: '120,80,220' },
        { name: { pt: 'Bardo', en: 'Bard' }, col: '16,185,129' },
      ],
    },
    {
      num: '03',
      label: t('landing.demo.phase3.label'),
      title: t('landing.demo.phase3.title'),
      desc: t('landing.demo.phase3.desc'),
      accent: '139,92,246',
      agents: [
        { name: { pt: 'Cronista', en: 'Chronicler' }, col: '139,92,246' },
      ],
    },
  ];

  return (
    <div className="w-full flex flex-col gap-3">
      {phases.map((ph, i) => {
        const isActive = i === phase;
        return (
          <motion.div
            key={i}
            onClick={() => onPhaseChange(i)}
            animate={{
              borderColor: isActive ? `rgba(${ph.accent},0.45)` : 'rgba(197,160,89,0.08)',
            }}
            transition={{ duration: 0.6 }}
            className="relative overflow-hidden cursor-pointer"
            style={{
              border: '1px solid rgba(197,160,89,0.08)',
              background: isActive
                ? `linear-gradient(135deg, rgba(${ph.accent},0.08) 0%, rgba(14,11,6,0.97) 60%)`
                : 'rgba(14,11,6,0.92)',
              borderRadius: 2,
            }}
          >
            {/* Top meander-style accent — glows when active */}
            <AnimatePresence>
              {isActive && (
                <motion.div
                  layoutId="forge-accent"
                  className="absolute top-0 left-0 right-0"
                  style={{ height: 1, background: `linear-gradient(to right, transparent, rgba(${ph.accent},0.9) 20%, rgba(${ph.accent},0.9) 80%, transparent)` }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                />
              )}
            </AnimatePresence>

            {/* Header row */}
            <div className="flex items-center gap-4 px-5 py-4">
              {/* Roman numeral style number */}
              <span
                className="font-serif text-base select-none"
                style={{ color: isActive ? `rgba(${ph.accent},0.9)` : 'rgba(197,160,89,0.2)', fontStyle: 'italic', minWidth: 28 }}
              >
                {['I', 'II', 'III'][i]}
              </span>

              {/* Thin vertical rule */}
              <div style={{ width: 1, height: 16, background: isActive ? `rgba(${ph.accent},0.3)` : 'rgba(197,160,89,0.1)' }} />

              <span
                className="font-serif text-sm select-none"
                style={{ color: isActive ? `rgba(255,245,220,0.9)` : 'rgba(255,245,220,0.25)', letterSpacing: '0.04em' }}
              >
                {ph.label.replace(/^[IVX]+ — /, '')}
              </span>

              <div className="ml-auto flex items-center gap-3">
                {/* Agent runes — circular seals */}
                <div className="flex gap-2">
                  {ph.agents.map((ag, j) => (
                    <motion.div
                      key={j}
                      style={{ width: 7, height: 7, borderRadius: '50%' }}
                      animate={{
                        background: isActive ? `rgba(${ag.col},0.95)` : `rgba(${ag.col},0.18)`,
                        boxShadow: isActive ? `0 0 8px 1px rgba(${ag.col},0.5)` : 'none',
                      }}
                      transition={{ duration: 0.55 }}
                    />
                  ))}
                </div>

                {/* Progress arc — thin line */}
                {isActive && (
                  <div style={{ width: 44, height: 2, background: 'rgba(197,160,89,0.1)', borderRadius: 1, overflow: 'hidden' }}>
                    <motion.div
                      key={phase}
                      style={{ height: '100%', background: `rgba(${ph.accent},0.75)`, borderRadius: 1 }}
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: PHASE_DURATION / 1000, ease: 'linear' }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Expanded body */}
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="px-5 pb-6 flex flex-col gap-4">
                    {/* Ornamental separator — meander fragment */}
                    <div className="flex items-center gap-3">
                      <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, rgba(${ph.accent},0.25), transparent)` }} />
                      <svg width="18" height="8" viewBox="0 0 18 8">
                        <path d="M0 7 L0 0 L6 0 L6 7 L12 7 L12 0 L18 0" fill="none" stroke={`rgba(${ph.accent},0.35)`} strokeWidth="1" />
                      </svg>
                      <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, rgba(${ph.accent},0.25), transparent)` }} />
                    </div>

                    {/* Title */}
                    <h3 className="font-serif text-xl leading-snug" style={{ color: 'rgba(255,245,220,0.95)' }}>
                      {ph.title}
                    </h3>

                    {/* Description */}
                    <p className="font-serif text-[13.5px] leading-relaxed" style={{ color: 'rgba(220,195,150,0.55)' }}>
                      {ph.desc}
                    </p>

                    {/* Agents — named with colored seal */}
                    <div className="flex items-center gap-4 pt-1 flex-wrap">
                      <span className="font-serif text-[10px] italic" style={{ color: 'rgba(197,160,89,0.3)', letterSpacing: '0.08em' }}>
                        {l === 'pt' ? 'Agentes convocados' : 'Summoned agents'}
                      </span>
                      {ph.agents.map((ag, j) => (
                        <div key={j} className="flex items-center gap-1.5">
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: `rgba(${ag.col},0.9)`, boxShadow: `0 0 6px rgba(${ag.col},0.55)` }} />
                          <span className="font-serif text-[11px]" style={{ color: `rgba(${ag.col},0.85)`, letterSpacing: '0.05em' }}>
                            {ag.name[l]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
};



// ── ForgeSectionContent ────────────────────────────────────────────────────
const ForgeSectionContent = () => {
  const { t, lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;
  const [phase, setPhase] = useState(0);
  const [dir, setDir] = useState(1);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDir(1);
      setPhase(p => (p + 1) % 3);
    }, PHASE_DURATION);
  }, []);

  React.useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTimer]);

  const goTo = (i: number) => {
    setDir(i > phase ? 1 : -1);
    setPhase(i);
    startTimer();
  };

  const phaseCols = ['197,160,89', '120,80,220', '139,92,246'];
  const bgCols    = ['197,140,60', '90,55,180',  '100,65,200'];
  const accent = phaseCols[phase];

  type CardAgent = { name: string; col: string; role: string };
  type CardData  = { title: string; line: string; agents: CardAgent[]; chips: string[]; stat: { label: string; value: string } };
  const cards: Record<L, CardData[]> = {
    pt: [
      {
        title: 'A Premissa',
        line: 'Do caos de uma ideia, um mundo nasce.',
        agents: [
          { name: 'Arquiteto', col: '197,160,89',  role: 'Expande o mundo' },
          { name: 'Forjador',  col: '244,100,100', role: 'Cria o protagonista' },
        ],
        chips: ['Mundo construído', 'Personagem vivo', 'Facções definidas', 'Contexto histórico'],
        stat: { label: 'gerado em', value: '< 60 segundos' },
      },
      {
        title: 'A Escrita',
        line: 'Beats viram prosa. Prosa vira voz.',
        agents: [
          { name: 'Bardo',    col: '140,90,230',  role: 'Escreve a prosa' },
          { name: 'Narrador', col: '100,160,230', role: 'Molda a narrativa' },
          { name: 'Tecelão',  col: '180,110,240', role: 'Tece consistência' },
        ],
        chips: ['Estrutura narrativa', 'Voz autoral', 'Beats encadeados', 'Consistência garantida'],
        stat: { label: 'ritmo por capítulo', value: '4–8 beats · ~2 200 palavras' },
      },
      {
        title: 'O Capítulo',
        line: 'Tudo registrado. O Motor não esquece.',
        agents: [
          { name: 'Cronista',  col: '139,92,246',  role: 'Registra no Codex' },
          { name: 'Guardião',  col: '200,150,80',  role: 'Preserva consistência' },
        ],
        chips: ['Capítulo completo', 'Codex preenchido', 'Memória narrativa', 'Pronto para exportar'],
        stat: { label: 'entradas no Codex', value: 'personagens · locais · facções' },
      },
    ],
    en: [
      {
        title: 'The Premise',
        line: 'From the chaos of an idea, a world is born.',
        agents: [
          { name: 'Architect', col: '197,160,89',  role: 'Expands the world' },
          { name: 'Forger',    col: '244,100,100', role: 'Creates the protagonist' },
        ],
        chips: ['World built', 'Living character', 'Factions defined', 'Historical context'],
        stat: { label: 'generated in', value: '< 60 seconds' },
      },
      {
        title: 'The Writing',
        line: 'Beats become prose. Prose becomes voice.',
        agents: [
          { name: 'Bard',     col: '140,90,230',  role: 'Writes the prose' },
          { name: 'Narrator', col: '100,160,230', role: 'Shapes the narrative' },
          { name: 'Weaver',   col: '180,110,240', role: 'Weaves coherence' },
        ],
        chips: ['Narrative structure', 'Authorial voice', 'Chained beats', 'Coherence ensured'],
        stat: { label: 'pacing per chapter', value: '4–8 beats · ~2 200 words' },
      },
      {
        title: 'The Chapter',
        line: 'Everything logged. The Engine never forgets.',
        agents: [
          { name: 'Chronicler', col: '139,92,246', role: 'Logs to the Codex' },
          { name: 'Guardian',   col: '200,150,80', role: 'Preserves consistency' },
        ],
        chips: ['Full chapter', 'Codex filled', 'Narrative memory', 'Ready to export'],
        stat: { label: 'Codex entries', value: 'characters · places · factions' },
      },
    ],
  };
  const card = cards[l][phase];

  return (
    <>
      {/* Section header — no desc paragraph */}
      <div className="max-w-7xl mx-auto mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div style={{ width: 28, height: 1, background: `rgba(${accent},0.6)` }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.3em]" style={{ color: `rgba(${accent},0.7)` }}>
            {t('landing.forge.badge')}
          </span>
        </div>
        <h2 className="font-serif text-4xl md:text-5xl text-paper leading-tight">
          {t('landing.forge.title')}
        </h2>
      </div>

      {/* Phase nav: roman numerals + progress lines */}
      <div className="max-w-7xl mx-auto flex gap-10 mb-8">
        {(['I', 'II', 'III'] as const).map((num, i) => (
          <button key={i} onClick={() => goTo(i)} className="flex items-center gap-3">
            <span
              className="font-serif text-sm italic transition-colors duration-500"
              style={{ color: i === phase ? `rgba(${phaseCols[i]},0.9)` : 'rgba(197,160,89,0.2)' }}
            >
              {num}
            </span>
            <div style={{ width: 44, height: 1, position: 'relative', overflow: 'hidden', background: 'rgba(197,160,89,0.08)' }}>
              {i === phase && (
                <motion.div
                  key={phase}
                  style={{ position: 'absolute', inset: 0, background: `rgba(${phaseCols[i]},0.7)`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: PHASE_DURATION / 1000, ease: 'linear' }}
                />
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Sliding card */}
      <div className="max-w-7xl mx-auto" style={{ overflow: 'hidden' }}>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={phase}
            custom={dir}
            variants={{
              enter:  (d: number) => ({ x: d > 0 ? 52 : -52, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit:   (d: number) => ({ x: d > 0 ? -52 : 52, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              border: `1px solid rgba(120,80,30,0.2)`,
              borderRadius: 2,
              background: '#0e0b06',
              minHeight: 420,
              overflow: 'hidden',
            }}
          >
            {/* Left — cream manuscript illustration */}
            <div style={{
              background: '#ede3c8',
              minHeight: 420,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              <PhaseIllustration phase={phase} />
              {/* Gradient seam: cream → dark */}
              <div style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0,
                width: 90,
                background: 'linear-gradient(to right, rgba(237,227,200,0) 0%, rgba(30,18,8,0.55) 65%, #0e0b06 100%)',
                pointerEvents: 'none',
              }} />
            </div>

            {/* Right — rich text panel */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '2.5rem 2.25rem', gap: '1rem', background: '#0e0b06' }}>
              {/* Ghost numeral behind */}
              <div
                className="font-serif select-none"
                style={{ fontSize: 80, lineHeight: 1, color: `rgba(${accent},0.05)`, marginBottom: -28 }}
              >
                {['I', 'II', 'III'][phase]}
              </div>

              {/* Title */}
              <h3 className="font-serif leading-tight" style={{ fontSize: 32, color: 'rgba(255,245,225,0.95)' }}>
                {card.title}
              </h3>

              {/* One sentence */}
              <p className="font-serif" style={{ fontSize: 14, lineHeight: 1.75, color: 'rgba(220,195,150,0.5)' }}>
                {card.line}
              </p>

              {/* Active agents */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <p style={{ fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.3em', textTransform: 'uppercase', color: `rgba(${accent},0.35)`, marginBottom: 2 }}>
                  {l === 'pt' ? 'agentes ativos' : 'active agents'}
                </p>
                {card.agents.map((ag, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: `rgba(${ag.col},0.9)`, flexShrink: 0, boxShadow: `0 0 6px rgba(${ag.col},0.5)` }} />
                    <span className="font-serif" style={{ fontSize: 13, color: `rgba(${ag.col},0.9)` }}>{ag.name}</span>
                    <span style={{ fontSize: 11, fontFamily: 'Georgia,serif', fontStyle: 'italic', color: 'rgba(220,195,150,0.28)' }}>— {ag.role}</span>
                  </div>
                ))}
              </div>

              {/* Stat line */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 0', borderTop: `1px solid rgba(${accent},0.1)`, borderBottom: `1px solid rgba(${accent},0.1)` }}>
                <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.25em', color: `rgba(${accent},0.35)` }}>
                  {card.stat.label}
                </span>
                <span className="font-serif" style={{ fontSize: 13, color: `rgba(${accent},0.8)`, fontStyle: 'italic' }}>
                  {card.stat.value}
                </span>
              </div>

              {/* Artifact chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {card.chips.map((chip, i) => (
                  <span
                    key={i}
                    className="font-serif"
                    style={{
                      fontSize: 10,
                      fontStyle: 'italic',
                      padding: '3px 10px',
                      border: `1px solid rgba(${accent},0.2)`,
                      color: `rgba(${accent},0.7)`,
                      borderRadius: 1,
                      background: `rgba(${accent},0.04)`,
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
};

// --- Visual Agents Showcase ---

// ─────────────────────────────────────────────────────────────────────────────
// Visual Artificers — Animated Previews
// ─────────────────────────────────────────────────────────────────────────────

// The Illustrator: anime portrait being drawn stroke by stroke
const IllustratorVisual = () => {
  const inkSplats = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    cx: 8 + Math.random() * 184,
    cy: 8 + Math.random() * 184,
    r:  0.7 + Math.random() * 2.2,
    delay: 1.2 + i * 0.14,
  })), []);

  const paths = [
    // Outer decorative ring
    { d: 'M 100 4 A 96 96 0 1 1 99.99 4', stroke: 'rgba(244,63,94,0.07)', sw: 0.4, dash: '2 5', delay: 0, dur: 4 },
    // Face oval (ellipse centered ~100,86, rx=48, ry=56)
    { d: 'M 100 30 A 48 56 0 1 1 99.99 30', stroke: 'rgba(244,114,182,0.55)', sw: 1.2, delay: 0.1, dur: 2.5 },
    // Hair top
    { d: 'M 68 44 Q 100 6 132 44', stroke: 'rgba(251,207,232,0.8)', sw: 2.5, delay: 0.4, dur: 1.0 },
    // Hair left side  
    { d: 'M 60 60 Q 46 44 60 28 Q 70 16 82 28', stroke: 'rgba(251,207,232,0.6)', sw: 1.8, delay: 0.7, dur: 0.9 },
    // Hair right side
    { d: 'M 140 60 Q 154 44 140 28 Q 130 16 118 28', stroke: 'rgba(251,207,232,0.6)', sw: 1.8, delay: 0.9, dur: 0.9 },
    // Left ear
    { d: 'M 52 80 C 42 80 38 87 38 95 C 38 103 42 108 52 108', stroke: 'rgba(251,207,232,0.5)', sw: 1, delay: 1.1, dur: 0.6 },
    // Right ear
    { d: 'M 148 80 C 158 80 162 87 162 95 C 162 103 158 108 148 108', stroke: 'rgba(251,207,232,0.5)', sw: 1, delay: 1.2, dur: 0.6 },
    // Left eye upper lid
    { d: 'M 72 76 Q 82 67 92 76', stroke: 'rgba(244,114,182,1)', sw: 1.5, delay: 1.4, dur: 0.5 },
    // Left eye lower lid
    { d: 'M 72 76 Q 82 84 92 76', stroke: 'rgba(244,114,182,0.55)', sw: 0.8, delay: 1.6, dur: 0.4 },
    // Left iris
    { d: 'M 82 70 A 5 6 0 1 1 81.99 70', stroke: 'rgba(244,114,182,0.9)', fill: 'rgba(244,63,94,0.25)', sw: 1, delay: 1.75, dur: 0.4 },
    // Right eye upper lid
    { d: 'M 108 76 Q 118 67 128 76', stroke: 'rgba(244,114,182,1)', sw: 1.5, delay: 1.5, dur: 0.5 },
    // Right eye lower lid
    { d: 'M 108 76 Q 118 84 128 76', stroke: 'rgba(244,114,182,0.55)', sw: 0.8, delay: 1.7, dur: 0.4 },
    // Right iris
    { d: 'M 118 70 A 5 6 0 1 1 117.99 70', stroke: 'rgba(244,114,182,0.9)', fill: 'rgba(244,63,94,0.25)', sw: 1, delay: 1.85, dur: 0.4 },
    // Nose
    { d: 'M 97 100 L 94 110 Q 100 112 106 110 L 103 100', stroke: 'rgba(244,114,182,0.5)', sw: 0.8, delay: 1.95, dur: 0.5 },
    // Mouth
    { d: 'M 87 122 Q 100 132 113 122', stroke: 'rgba(244,114,182,0.85)', sw: 1.3, delay: 2.1, dur: 0.6 },
    // Blush marks left
    { d: 'M 63 86 L 71 84 M 63 90 L 69 88', stroke: 'rgba(244,63,94,0.5)', sw: 1, delay: 2.25, dur: 0.3 },
    // Blush marks right
    { d: 'M 129 84 L 137 86 M 131 88 L 137 90', stroke: 'rgba(244,63,94,0.5)', sw: 1, delay: 2.3, dur: 0.3 },
    // Neck
    { d: 'M 92 138 L 90 162 M 108 138 L 110 162', stroke: 'rgba(251,207,232,0.45)', sw: 0.9, delay: 2.45, dur: 0.5 },
    // Shoulders
    { d: 'M 90 162 Q 55 170 30 190 M 110 162 Q 145 170 170 190', stroke: 'rgba(251,207,232,0.4)', sw: 1.1, delay: 2.65, dur: 0.8 },
  ] as const;

  // Brush cursor keyframes (traces around the face)
  const brushCx = [100, 148, 100, 52, 82, 118, 100, 148, 100];
  const brushCy = [30,   86, 142,  86, 76,  76,  30,  86,  30];

  return (
    <div className="w-full h-full relative overflow-hidden bg-stone-950 rounded-xl border border-stone-700">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,0.16)_0%,transparent_70%)]" />
      <div className="absolute inset-0 opacity-[0.04] bg-[linear-gradient(0deg,transparent_calc(100%-1px),rgba(255,200,200,0.6)_100%)] bg-[size:100%_18px]" />

      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full"
        style={{ filter: 'drop-shadow(0 0 7px rgba(244,63,94,0.3))' }}>
        <defs>
          <filter id="brushGlow"><feGaussianBlur stdDeviation="2.5" /></filter>
        </defs>

        {paths.map((p, i) => (
          <motion.path
            key={i} d={p.d}
            fill={('fill' in p ? (p as any).fill : 'none')}
            stroke={p.stroke} strokeWidth={p.sw} strokeLinecap="round"
            strokeDasharray={'dash' in p ? (p as any).dash : undefined}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: p.dur, delay: p.delay, ease: 'easeOut' }}
          />
        ))}

        {inkSplats.map((s, i) => (
          <motion.circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="rgba(244,63,94,0.55)"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.5, 1], opacity: [0, 0.9, 0.45] }}
            transition={{ duration: 0.4, delay: s.delay }}
          />
        ))}

        {/* Brush glow */}
        <motion.circle r="5" fill="rgba(244,114,182,0.85)" filter="url(#brushGlow)"
          animate={{ cx: brushCx, cy: brushCy }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Brush bright core */}
        <motion.circle r="1.8" fill="white"
          animate={{ cx: brushCx, cy: brushCy }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
      </svg>

      <motion.div className="absolute bottom-4 left-4 right-4 bg-stone-950/75 backdrop-blur-sm border border-pink-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <motion.div className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
        <span className="text-[10px] font-mono text-pink-400 tracking-wider flex-1">ILLUSTRATOR · Rendering portrait...</span>
        <span className="text-[10px] font-mono text-stone-500">∞ layers</span>
      </motion.div>
    </div>
  );
};

// The World Builder: living cartographic map being charted
const WorldBuilderVisual = () => {
  const nodes = [
    { cx: 42, cy: 52, label: 'Vorthak' },
    { cx: 108, cy: 30, label: 'Aureth' },
    { cx: 168, cy: 65, label: 'Ironspire' },
    { cx: 48, cy: 152, label: 'Mistmere' },
    { cx: 142, cy: 128, label: 'Veil Cross' },
    { cx: 95, cy: 175, label: 'Port Nul' },
  ];

  const routes = [
    'M 42 52 L 108 30', 'M 108 30 L 168 65', 'M 108 30 L 142 128',
    'M 42 52 L 48 152', 'M 142 128 L 95 175', 'M 48 152 L 95 175',
  ];

  const topoRings = [
    'M 100 12 Q 165 15 188 78 Q 190 148 128 180 Q 78 198 28 162 Q 4 125 8 72 Q 14 20 100 12 Z',
    'M 100 32 Q 152 35 170 85 Q 172 140 120 164 Q 80 178 48 150 Q 26 118 30 80 Q 38 38 100 32 Z',
    'M 100 54 Q 138 56 153 92 Q 154 130 115 150 Q 82 162 57 140 Q 42 114 46 90 Q 52 58 100 54 Z',
  ];

  const hexR = 7;
  const hexPts = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k;
      return `${cx + hexR * Math.cos(a)},${cy + hexR * Math.sin(a)}`;
    }).join(' ');

  return (
    <div className="w-full h-full relative overflow-hidden bg-stone-950 rounded-xl border border-stone-700">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.14)_0%,transparent_70%)]" />
      <div className="absolute inset-0 opacity-[0.025] bg-[linear-gradient(0deg,transparent_calc(100%-1px),rgba(100,240,250,0.7)_100%)] bg-[size:100%_16px]" />

      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full"
        style={{ filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.2))' }}>

        {/* Topographic contour rings */}
        {topoRings.map((d, i) => (
          <motion.path key={i} d={d} fill="none"
            stroke={`rgba(6,182,212,${0.07 - i * 0.015})`} strokeWidth={0.35 + i * 0.08}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 3.5, delay: i * 0.35, ease: 'easeOut' }}
          />
        ))}

        {/* Route lines */}
        {routes.map((d, i) => (
          <motion.path key={i} d={d} fill="none"
            stroke="rgba(6,182,212,0.38)" strokeWidth="0.7" strokeDasharray="3 2.5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, delay: 1.6 + i * 0.18, ease: 'easeOut' }}
          />
        ))}

        {/* Sonar rings from each node */}
        {nodes.map((node, ni) =>
          [0, 0.85, 1.7].map((d, ri) => (
            <motion.circle key={`${ni}-${ri}`} cx={node.cx} cy={node.cy} r={6}
              fill="none" stroke="rgba(6,182,212,0.55)" strokeWidth="0.6"
              animate={{ r: [6, 24], opacity: [0.65, 0] }}
              transition={{ duration: 2.2, delay: 2 + ni * 0.22 + d, repeat: Infinity, ease: 'easeOut' }}
            />
          ))
        )}

        {/* Hexagonal node markers */}
        {nodes.map((node, i) => (
          <motion.polygon key={i} points={hexPts(node.cx, node.cy)}
            fill="rgba(6,182,212,0.07)" stroke="rgba(6,182,212,0.72)" strokeWidth="0.8"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 2.2 + i * 0.12 }}
          />
        ))}

        {/* Node centers */}
        {nodes.map((node, i) => (
          <motion.circle key={i} cx={node.cx} cy={node.cy} r={2.5}
            fill="rgba(6,182,212,0.9)"
            initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 1] }}
            style={{ transformOrigin: `${node.cx}px ${node.cy}px` }}
            transition={{ duration: 0.45, delay: 2.4 + i * 0.12 }}
          />
        ))}

        {/* Compass rose */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.8, duration: 0.7 }}>
          <circle cx="178" cy="178" r="12" fill="rgba(6,182,212,0.04)" stroke="rgba(6,182,212,0.22)" strokeWidth="0.5" />
          <line x1="178" y1="167" x2="178" y2="189" stroke="rgba(6,182,212,0.5)" strokeWidth="0.7" />
          <line x1="167" y1="178" x2="189" y2="178" stroke="rgba(6,182,212,0.3)" strokeWidth="0.7" />
          <polygon points="178,167 180.5,174 175.5,174" fill="rgba(6,182,212,0.75)" />
          <text x="178" y="162" textAnchor="middle" fontSize="4" fill="rgba(6,182,212,0.55)" fontFamily="monospace">N</text>
        </motion.g>
      </svg>

      <motion.div className="absolute bottom-4 left-4 right-4 bg-stone-950/75 backdrop-blur-sm border border-cyan-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <motion.div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
        <span className="text-[10px] font-mono text-cyan-400 tracking-wider flex-1">WORLD BUILDER · Charting territories...</span>
        <span className="text-[10px] font-mono text-stone-500">6 regions</span>
      </motion.div>
    </div>
  );
};

// The Animator: onion-skin slash with speed lines and frame counter
const AnimatorVisual = () => {
  // Onion-skin copies — slightly offset going lower-left (trail of motion)
  const slashMain  = 'M 44 156 C 80 118 122 82 156 44';
  const ghosts = [
    { d: 'M 36 164 C 72 126 114 90 148 52', opacity: 0.55, sw: 1.6 },
    { d: 'M 28 172 C 64 134 106 98 140 60', opacity: 0.3,  sw: 1.1 },
    { d: 'M 20 180 C 56 142  98 106 132 68', opacity: 0.16, sw: 0.7 },
    { d: 'M 12 188 C 48 150  90 114 124 76', opacity: 0.08, sw: 0.4 },
  ];

  // Speed lines (short diagonal segments suggesting motion blur)
  const speedLines = [
    'M 10 78 L 68 20',  'M 20 102 L 82 40',  'M 10 126 L 78 58',
    'M 16 150 L 88 78',  'M 28 170 L 102 96',  'M 48 184 L 126 110',
    'M 72 194 L 150 116', 'M 100 198 L 176 122',
  ];

  const [frame, setFrame] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f % 24) + 1), 85);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden bg-stone-950 rounded-xl border border-stone-700">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_35%_65%,rgba(168,85,247,0.18)_0%,transparent_65%)]" />
      <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(0deg,transparent_calc(100%-1px),rgba(200,150,255,0.6)_100%)] bg-[size:100%_18px]" />

      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full"
        style={{ filter: 'drop-shadow(0 0 8px rgba(168,85,247,0.28))' }}>

        {/* Film strip on left edge */}
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect x="2" y={18 + i * 22} width="14" height="16" rx="1"
              fill="rgba(168,85,247,0.04)" stroke="rgba(168,85,247,0.22)" strokeWidth="0.5" />
            <circle cx="5.5" cy={21 + i * 22} r="1.5" fill="rgba(168,85,247,0.18)" />
            <circle cx="5.5" cy={31 + i * 22} r="1.5" fill="rgba(168,85,247,0.18)" />
          </g>
        ))}

        {/* Speed lines */}
        {speedLines.map((d, i) => (
          <motion.path key={i} d={d} fill="none"
            stroke="rgba(168,85,247,0.13)" strokeWidth="0.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.38, delay: 0.25 + i * 0.04 }}
          />
        ))}

        {/* Impact burst at slash origin */}
        {[0, 0.7, 1.4].map((d, i) => (
          <motion.circle key={i} cx="44" cy="156" r={6 + i * 2}
            fill="none" stroke={`rgba(168,85,247,${0.35 - i * 0.08})`} strokeWidth="0.7"
            animate={{ r: [6 + i * 2, 22 + i * 4], opacity: [0.6, 0] }}
            transition={{ duration: 2, delay: d + 0.8, repeat: Infinity, ease: 'easeOut' }}
          />
        ))}

        {/* Ghost onion-skin copies (oldest first) */}
        {[...ghosts].reverse().map((g, i) => (
          <motion.path key={i} d={g.d} fill="none"
            stroke={`rgba(168,85,247,${g.opacity})`} strokeWidth={g.sw} strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: g.opacity }}
            transition={{ duration: 0.9, delay: 0.5 + i * 0.08 }}
          />
        ))}

        {/* Main slash — loops in/out */}
        <motion.path d={slashMain} fill="none"
          stroke="rgba(210,150,255,1)" strokeWidth="2.8" strokeLinecap="round"
          animate={{ pathLength: [0, 1, 1, 0] }}
          transition={{ duration: 2.8, times: [0, 0.38, 0.82, 1], repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Slash bright core */}
        <motion.path d={slashMain} fill="none"
          stroke="rgba(255,255,255,0.65)" strokeWidth="0.9" strokeLinecap="round"
          animate={{ pathLength: [0, 1, 1, 0] }}
          transition={{ duration: 2.8, times: [0, 0.38, 0.82, 1], repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Tip spark particles */}
        {[0, 0.55, 1.1].map((d, i) => (
          <motion.circle key={i} r={2.2 - i * 0.5} fill="rgba(220,160,255,0.85)"
            animate={{
              cx: [156, 156 + (i + 1) * 9, 156 + (i + 1) * 16],
              cy: [44,  44  - (i + 1) * 7, 44  - (i + 1) * 14],
              opacity: [1, 0.6, 0], r: [2.2 - i * 0.5, 1, 0],
            }}
            transition={{ duration: 2.8, delay: d + 1.0, repeat: Infinity, ease: 'easeOut' }}
          />
        ))}
      </svg>

      <motion.div className="absolute bottom-4 left-4 right-4 bg-stone-950/75 backdrop-blur-sm border border-purple-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <motion.div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.85, repeat: Infinity }} />
        <span className="text-[10px] font-mono text-purple-400 tracking-wider flex-1">ANIMATOR · Rendering motion...</span>
        <span className="text-[10px] font-mono text-stone-500">{String(frame).padStart(2, '0')}/24</span>
      </motion.div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const VisualAgentsShowcase = () => {
    const { t } = useLanguage();
    const [activeAgent, setActiveAgent] = useState(0);

    const agents = [
        {
            id: 'illustrator',
            title: t('landing.illustrator.title'),
            role: t('landing.illustrator.role'),
            desc: t('landing.illustrator.desc'),
            icon: <Palette className="w-8 h-8" />,
            color: 'from-pink-500 to-rose-600',
            glow: 'rgba(244,63,94,0.6)',
            preview: <IllustratorVisual />
        },
        {
            id: 'cartographer',
            title: t('landing.cartographer.title'),
            role: t('landing.cartographer.role'),
            desc: t('landing.cartographer.desc'),
            icon: <Map className="w-8 h-8" />,
            color: 'from-cyan-500 to-blue-600',
            glow: 'rgba(6,182,212,0.6)',
            preview: <WorldBuilderVisual />
        },
        {
            id: 'animator',
            title: t('landing.animator.title'),
            role: t('landing.animator.role'),
            desc: t('landing.animator.desc'),
            icon: <Film className="w-8 h-8" />,
            color: 'from-purple-500 to-indigo-600',
            glow: 'rgba(168,85,247,0.6)',
            preview: <AnimatorVisual />
        }
    ];

    return (
        <div className="relative py-12 w-full max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 items-center">
            
            {/* Left: Agent Selection Cards */}
            <div className="w-full lg:w-5/12 flex flex-col gap-4 relative z-20">
                {agents.map((agent, index) => {
                    const isActive = activeAgent === index;
                    return (
                        <motion.div
                            key={agent.id}
                            onClick={() => setActiveAgent(index)}
                            className={`
                                relative p-6 rounded-2xl cursor-pointer transition-all duration-500 overflow-hidden border
                                ${isActive 
                                    ? 'bg-stone-900 border-stone-600 shadow-[0_0_30px_rgba(0,0,0,0.5)] scale-105 z-10' 
                                    : 'bg-stone-950 border-stone-800 hover:border-stone-700 hover:bg-stone-900/50 scale-100 opacity-70 hover:opacity-100'}
                            `}
                        >
                            {/* Active Glow Background */}
                            {isActive && (
                                <motion.div 
                                    layoutId="activeAgentGlow"
                                    className={`absolute inset-0 bg-gradient-to-r ${agent.color} opacity-10`}
                                    initial={false}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            
                            <div className="relative z-10 flex items-start gap-5">
                                <div className={`p-3 rounded-xl bg-stone-950 border ${isActive ? 'border-stone-500 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'border-stone-800 text-stone-500'}`}>
                                    {agent.icon}
                                </div>
                                <div>
                                    <h4 className={`font-serif text-xl font-bold mb-1 ${isActive ? 'text-white' : 'text-stone-300'}`}>
                                        {agent.title}
                                    </h4>
                                    <p className={`text-xs uppercase tracking-widest mb-3 ${isActive ? 'text-nobel' : 'text-stone-500'}`}>
                                        {agent.role}
                                    </p>
                                    <AnimatePresence>
                                        {isActive && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <p className="text-sm text-stone-400 leading-relaxed font-serif pt-2 border-t border-stone-800">
                                                    {agent.desc}
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Right: Visual Preview Area */}
            <div className="w-full lg:w-7/12 aspect-[4/3] lg:aspect-auto lg:h-[600px] relative z-10">
                <div className="absolute inset-0 bg-stone-900 rounded-3xl border border-stone-800 shadow-2xl p-2 overflow-hidden">
                    {/* Ambient background glow based on active agent */}
                    <div 
                        className="absolute inset-0 blur-[100px] transition-colors duration-1000 opacity-40"
                        style={{ backgroundColor: agents[activeAgent].glow.replace('0.6', '1') }}
                    />
                    
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeAgent}
                            initial={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
                            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
                            className="w-full h-full relative z-10"
                        >
                            {agents[activeAgent].preview}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

        </div>
    );
};


// ─────────────────────────────────────────────────────────────────────────────
// How It Works — 3 steps
// ─────────────────────────────────────────────────────────────────────────────
const HowItWorks = () => {
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Showcase — Mythic agent relay with SVG sigils
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_INTERVAL = 14000;
const THOUGHT_INTERVAL = 2800;

// Mythic SVG sigils for each agent — hand-drawn style, rendered at any size
const AgentSigil = ({ index, lit, col }: { index: number; lit: boolean; col: string }) => {
  const base = lit ? 0.9 : 0.18;
  const glow = lit ? 0.4 : 0;
  const c = (a: number) => `rgba(${col},${a})`;

  const sigils: React.ReactNode[] = [
    // 0 — Architect: astrolabe / compass rose
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="19" stroke={c(base * 0.4)} strokeWidth="0.6" />
      <motion.circle cx="24" cy="24" r="14" stroke={c(base * 0.6)} strokeWidth="0.7"
        strokeDasharray="3 3"
        animate={lit ? { rotate: 360 } : {}}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '24px 24px' }}
      />
      <motion.polygon points="24,6 22.5,20 25.5,20" fill={c(base)}
        animate={lit ? { opacity: [0.6, 1, 0.6] } : { opacity: base }}
        transition={{ duration: 2.2, repeat: Infinity }}
      />
      <polygon points="24,42 22.5,28 25.5,28" fill={c(base * 0.3)} />
      <line x1="6" y1="24" x2="42" y2="24" stroke={c(base * 0.2)} strokeWidth="0.5" />
      <line x1="24" y1="6" x2="24" y2="42" stroke={c(base * 0.2)} strokeWidth="0.5" />
      <motion.circle cx="24" cy="24" r="2.5" fill={c(base)}
        animate={lit ? { r: [2.5, 3.5, 2.5] } : { r: 2.5 }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>,
    // 1 — Soulforger: flame with inner eye
    <svg viewBox="0 0 48 48" fill="none">
      <motion.path
        d="M24 6 C19 14 12 20 13 30 C14 38 19 44 24 46 C29 44 34 38 35 30 C36 20 29 14 24 6Z"
        fill={c(base * 0.15)} stroke={c(base * 0.7)} strokeWidth="0.9" strokeLinejoin="round"
        animate={lit ? { scaleY: [1, 1.06, 0.97, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '24px 26px' }}
      />
      <motion.path
        d="M24 20 C22 24 21 27 22.5 32 C23.5 36 24 36 24 36 C24 36 24.5 36 25.5 32 C27 27 26 24 24 20Z"
        fill={c(base * 0.6)}
        animate={lit ? { opacity: [0.4, 0.9, 0.4] } : { opacity: base * 0.3 }}
        transition={{ duration: 1.4, repeat: Infinity }}
      />
      {/* Inner eye in the flame */}
      <motion.ellipse cx="24" cy="30" rx="4" ry="2.5"
        fill="none" stroke={c(base * 0.5)} strokeWidth="0.6"
        animate={lit ? { ry: [2.5, 1.5, 2.5] } : {}} transition={{ duration: 3, repeat: Infinity }}
      />
      <motion.circle cx="24" cy="30" r="1" fill={c(base * 0.9)}
        animate={lit ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.2 }}
        transition={{ duration: 1.8, repeat: Infinity }}
      />
    </svg>,
    // 2 — Weaver: loom / intertwined threads of fate
    <svg viewBox="0 0 48 48" fill="none">
      <motion.path d="M4 24 C10 14 18 10 24 16 C30 22 38 18 44 8"
        stroke={c(base * 0.8)} strokeWidth="1" strokeLinecap="round"
        animate={lit ? { pathLength: [0.8, 1, 0.8] } : {}}
        transition={{ duration: 2.8, repeat: Infinity }}
      />
      <motion.path d="M4 24 C10 34 18 38 24 32 C30 26 38 30 44 40"
        stroke={c(base * 0.8)} strokeWidth="1" strokeLinecap="round"
        animate={lit ? { pathLength: [0.8, 1, 0.8] } : {}}
        transition={{ duration: 2.8, delay: 0.5, repeat: Infinity }}
      />
      <motion.path d="M4 24 C14 20 20 28 24 24 C28 20 34 28 44 24"
        stroke={c(base * 0.4)} strokeWidth="0.7" strokeLinecap="round" strokeDasharray="2 3"
        animate={lit ? { pathLength: [0.6, 1, 0.6] } : {}}
        transition={{ duration: 3.2, delay: 0.3, repeat: Infinity }}
      />
      <motion.circle cx="24" cy="24" r="3" fill={c(base)}
        animate={lit ? { r: [3, 4, 3] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <circle cx="4" cy="24" r="1.5" fill={c(base * 0.5)} />
      <circle cx="44" cy="24" r="1.5" fill={c(base * 0.5)} />
    </svg>,
    // 3 — Bard: quill with ink trail
    <svg viewBox="0 0 48 48" fill="none">
      <motion.path
        d="M38 6 C32 10 22 20 14 30 L10 40 L19 37 C27 27 36 16 38 6Z"
        fill={c(base * 0.1)} stroke={c(base * 0.7)} strokeWidth="0.9" strokeLinejoin="round"
        animate={lit ? { rotate: [-1, 1.5, -1] } : {}}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '24px 23px' }}
      />
      {/* Feather barbs */}
      {[14, 18, 22, 26, 30].map((y, i) => (
        <line key={i}
          x1={14 + i * 3} y1={y + i * 1.2} x2={19 + i * 2.2} y2={y + i * 1.2 - 4.5}
          stroke={c(base * 0.25)} strokeWidth="0.5"
        />
      ))}
      <line x1="19" y1="37" x2="8" y2="46" stroke={c(base * 0.55)} strokeWidth="0.9" strokeLinecap="round" />
      {/* Ink trail — writing */}
      <motion.path d="M8 46 Q14 44 18 46 Q22 48 28 46"
        stroke={c(lit ? base * 0.5 : 0)} strokeWidth="0.7" strokeLinecap="round" fill="none"
        animate={{ pathLength: lit ? [0, 1] : [0, 0] }}
        transition={{ duration: 1.6, ease: 'easeOut', repeat: lit ? Infinity : 0, repeatDelay: 1.4 }}
      />
    </svg>,
    // 4 — Lector: editorial eye with strike-through pen mark (Bard→Lector→Chronicler order)
    <svg viewBox="0 0 48 48" fill="none">
      {/* Eye outline */}
      <motion.path d="M6 24 Q24 8 42 24 Q24 40 6 24Z"
        stroke={c(base * 0.7)} strokeWidth="0.9" fill={c(base * 0.06)} strokeLinejoin="round"
        animate={lit ? { scaleY: [1, 0.88, 1] } : {}}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '24px 24px' }}
      />
      {/* Iris */}
      <motion.circle cx="24" cy="24" r="6"
        fill={c(base * 0.12)} stroke={c(base * 0.6)} strokeWidth="0.7"
        animate={lit ? { r: [6, 7, 6] } : {}}
        transition={{ duration: 2.8, repeat: Infinity }}
      />
      {/* Pupil */}
      <motion.circle cx="24" cy="24" r="2.5" fill={c(base * 0.85)}
        animate={lit ? { opacity: [0.7, 1, 0.7] } : { opacity: base * 0.5 }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Editorial pen — strikes diagonally across corner */}
      <line x1="34" y1="9" x2="40" y2="15" stroke={c(base * 0.9)} strokeWidth="1.2" strokeLinecap="round" />
      <motion.path d="M14 38 L34 9"
        stroke={c(base * 0.55)} strokeWidth="0.7" strokeLinecap="round" strokeDasharray="3 2.5"
        animate={lit ? { pathLength: [0, 1, 1] } : { pathLength: 0.4 }}
        transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2 }}
      />
      {/* Pen tip */}
      <motion.path d="M12 40 L16 36 L14 38Z" fill={c(base * 0.7)} stroke={c(base * 0.5)} strokeWidth="0.5" />
    </svg>,
    // 5 — Chronicler: sealed tome / open scroll with seal
    <svg viewBox="0 0 48 48" fill="none">
      <rect x="10" y="8" width="28" height="32" rx="2"
        fill={c(base * 0.08)} stroke={c(base * 0.6)} strokeWidth="0.9"
      />
      {/* Scroll curl left */}
      <path d="M10 8 Q5 8 5 13 Q5 18 10 18" stroke={c(base * 0.4)} strokeWidth="0.8" fill="none" />
      <path d="M10 40 Q5 40 5 35 Q5 30 10 30" stroke={c(base * 0.4)} strokeWidth="0.8" fill="none" />
      {/* Text lines */}
      {[16, 22, 28, 34].map((y, i) => (
        <motion.line key={i} x1="16" y1={y} x2={i === 2 ? 26 : 32} y2={y}
          stroke={c(base * 0.5)} strokeWidth="0.7" strokeLinecap="round"
          animate={lit ? { pathLength: [0, 1] } : { pathLength: 0.25 }}
          transition={{ duration: 0.8, delay: i * 0.18 }}
        />
      ))}
      {/* Seal */}
      <motion.circle cx="30" cy="8" r="5"
        fill={c(base * 0.15)} stroke={c(base * 0.7)} strokeWidth="0.7"
        animate={lit ? { opacity: [0.7, 1, 0.7] } : { opacity: base }}
        transition={{ duration: 2.5, repeat: Infinity }}
      />
      <motion.path d="M30 4.5 L31 7 L33.5 7 L31.5 8.8 L32.3 11.5 L30 9.8 L27.7 11.5 L28.5 8.8 L26.5 7 L29 7Z"
        fill={c(base * 0.8)} transform="scale(0.7) translate(12.8, 1.7)"
      />
    </svg>,
    // 6 — Director: divine sovereign — radiant crown
    <svg viewBox="0 0 48 48" fill="none">
      {/* Outer cosmic halo — slow spin */}
      <motion.circle cx="24" cy="24" r="21" stroke={c(base * 0.28)} strokeWidth="0.6"
        strokeDasharray="1.5 5"
        animate={lit ? { rotate: 360 } : {}}
        transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '24px 24px' }}
      />
      {/* 8 radiant rays — alternating long & short */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, k) => {
        const rad = (deg * Math.PI) / 180;
        const long = k % 2 === 0;
        const r1 = 11, r2 = long ? 20 : 15;
        return (
          <motion.line key={k}
            x1={24 + r1 * Math.cos(rad)} y1={24 + r1 * Math.sin(rad)}
            x2={24 + r2 * Math.cos(rad)} y2={24 + r2 * Math.sin(rad)}
            stroke={c(long ? base * 0.82 : base * 0.38)}
            strokeWidth={long ? 0.95 : 0.6} strokeLinecap="round"
            animate={lit ? { opacity: [0.45, 1, 0.45] } : { opacity: base * 0.35 }}
            transition={{ duration: 2.2 + k * 0.18, repeat: Infinity }}
          />
        );
      })}
      {/* Crown — 3 prongs with valley dips */}
      <path d="M15 29 L15 25 L18 19 L21 23 L24 15 L27 23 L30 19 L33 25 L33 29 Z"
        fill={c(base * 0.12)} stroke={c(base * 0.88)} strokeWidth="0.85" strokeLinejoin="round" />
      {/* Crown base band */}
      <rect x="14" y="29" width="20" height="4" rx="1"
        fill={c(base * 0.15)} stroke={c(base * 0.6)} strokeWidth="0.7" />
      {/* Central gem — pulsing */}
      <motion.circle cx="24" cy="22" r="2"
        fill={c(base)}
        animate={lit ? { r: [2, 2.8, 2], opacity: [0.65, 1, 0.65] } : { opacity: base * 0.5 }}
        transition={{ duration: 2.2, repeat: Infinity }}
      />
      {/* Side prong gems */}
      <circle cx="18" cy="19" r="1" fill={c(base * 0.55)} />
      <circle cx="30" cy="19" r="1" fill={c(base * 0.55)} />
    </svg>,
    // 7 — Arbiter: gavel — judges and validates
    <svg viewBox="0 0 48 48" fill="none">
      {/* Gavel head — rotated parallelogram */}
      <path d="M6 13 L22 7 L26 17 L10 23 Z"
        fill={c(base * 0.1)} stroke={c(base * 0.72)} strokeWidth="0.9" strokeLinejoin="round" />
      {/* Striking face — bright bottom edge of head */}
      <line x1="10" y1="23" x2="26" y2="17"
        stroke={c(base * 0.95)} strokeWidth="1.2" strokeLinecap="round" />
      {/* Handle — diagonal */}
      <line x1="18" y1="20" x2="42" y2="40"
        stroke={c(base * 0.68)} strokeWidth="2.2" strokeLinecap="round" />
      {/* Handle grip wraps */}
      {[0.32, 0.56, 0.78].map((t, k) => {
        const x = 18 + (42 - 18) * t, y = 20 + (40 - 20) * t;
        return <line key={k}
          x1={x - 2.2} y1={y + 2.5} x2={x + 2.2} y2={y - 2.5}
          stroke={c(base * 0.35)} strokeWidth="0.7" strokeLinecap="round" />;
      })}
      {/* Strike block */}
      <rect x="4" y="39" width="18" height="5" rx="1"
        fill={c(base * 0.08)} stroke={c(base * 0.45)} strokeWidth="0.75" />
      {/* Impact expansion ring */}
      <motion.circle cx="13" cy="41" r="4"
        fill="none" stroke={c(base * 0.4)} strokeWidth="0.7"
        animate={lit ? { r: [3, 10], opacity: [0.55, 0] } : { opacity: 0 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
      />
      {/* Impact sparks */}
      {lit && [30, 90, 150, 210, 270, 330].map((deg, k) => {
        const rad = (deg * Math.PI) / 180;
        return <motion.line key={k}
          x1={13} y1={41}
          x2={13 + 7 * Math.cos(rad)} y2={41 + 7 * Math.sin(rad)}
          stroke={c(base * 0.55)} strokeWidth="0.65" strokeLinecap="round"
          animate={{ opacity: [0, 0.9, 0] }}
          transition={{ duration: 1.8, delay: k * 0.08, repeat: Infinity, repeatDelay: 0.6 }}
        />;
      })}
    </svg>,
  ];

  return (
    <div style={{ width: '100%', height: '100%', filter: lit ? `drop-shadow(0 0 10px rgba(${col},${glow}))` : 'none' }}>
      {sigils[index]}
    </div>
  );
};

const PipelineShowcase = () => {
  const { t, lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;
  const [active, setActive] = useState(0);

  const agents: {
    name: Record<L, string>;
    role: Record<L, string>;
    col: string;
    receives?: Record<L, string>;
    thoughts: Record<L, string[]>;
    delivers: Record<L, string>;
    deliversDesc: Record<L, string>;
  }[] = [
    {
      name: { pt: 'Arquiteto', en: 'Architect' },
      role: { pt: 'Constrói o Mundo', en: 'Builds the World' },
      col: '197,160,89',
      thoughts: {
        pt: [
          'o pedido chegou. lendo as intenções...',
          'traçando o mapa do continente...',
          'definindo as leis da magia e os seus custos...',
          'nomeando reinos, facções e fronteiras...',
          'o mundo tem peso. ele existe.',
        ],
        en: [
          'the prompt arrived. reading its intent...',
          'drawing the shape of the continent...',
          'defining the laws of magic and their cost...',
          'naming kingdoms, factions, borders...',
          'the world has weight. it exists.',
        ],
      },
      delivers: {
        pt: 'Entrega: Arquivo de Mundo',
        en: 'Delivers: World File',
      },
      deliversDesc: {
        pt: 'terras, leis, facções, história — tudo o que vem a seguir depende disto',
        en: 'lands, laws, factions, history — everything that follows depends on this',
      },
    },
    {
      name: { pt: 'Forjador', en: 'Soulforger' },
      role: { pt: 'Forja a Alma', en: 'Forges the Soul' },
      col: '244,63,94',
      receives: {
        pt: 'recebe o Arquivo de Mundo do Arquiteto',
        en: 'receives the World File from the Architect',
      },
      thoughts: {
        pt: [
          'o mundo existe. agora quem o habita?',
          'escavando o trauma que moldou o protagonista...',
          'qual a mentira que ele acredita ser verdade?',
          'forjando o desejo que o vai destruir ou salvar...',
          'o personagem respira. ele sangra.',
        ],
        en: [
          'the world exists. now who inhabits it?',
          'excavating the trauma that shaped the protagonist...',
          'what lie does he believe to be true?',
          'forging the desire that will destroy or save him...',
          'the character breathes. he bleeds.',
        ],
      },
      delivers: {
        pt: 'Entrega: Alma do Personagem',
        en: 'Delivers: Character Soul',
      },
      deliversDesc: {
        pt: 'Ghost, Lie, Wound e desejo — construído sobre o mundo que recebeu',
        en: 'Ghost, Lie, Wound and desire — built on the world he received',
      },
    },
    {
      name: { pt: 'Tecelão', en: 'Weaver' },
      role: { pt: 'Tece a Estrutura', en: 'Weaves the Structure' },
      col: '120,80,220',
      receives: {
        pt: 'recebe o Mundo e a Alma do Personagem',
        en: 'receives the World and the Character Soul',
      },
      thoughts: {
        pt: [
          'tenho o mundo e o personagem. agora o conflito...',
          'traçando o incidente que quebra o equilíbrio...',
          'cada beat deve nascer do anterior, não do acaso...',
          'plantando o dilema que vai rasgar o protagonista...',
          'a estrutura está de pé. a história tem destino.',
        ],
        en: [
          'I have the world and the character. now the conflict...',
          'tracing the incident that breaks the equilibrium...',
          'each beat must grow from the last, not from chance...',
          'planting the dilemma that will tear the protagonist apart...',
          'the structure stands. the story has a direction.',
        ],
      },
      delivers: {
        pt: 'Entrega: Estrutura da História',
        en: 'Delivers: Story Structure',
      },
      deliversDesc: {
        pt: 'beats causais, arcos e pontos de virada — sobre o personagem que recebeu',
        en: 'causal beats, arcs and turning points — built on the character received',
      },
    },
    {
      name: { pt: 'Bardo', en: 'Bard' },
      role: { pt: 'Escreve a Prosa', en: 'Writes the Prose' },
      col: '16,185,129',
      receives: {
        pt: 'recebe a Estrutura inteira do Tecelão',
        en: 'receives the full Structure from the Weaver',
      },
      thoughts: {
        pt: [
          'os beats estão prontos. encontrando a voz...',
          'ouvindo o peso emocional de cada cena...',
          'a primeira linha precisa prender. tentando...',
          'a prosa nasce fiel à estrutura — mas viva...',
          'o Capítulo 1 está escrito. cada palavra no lugar.',
        ],
        en: [
          'the beats are ready. finding the voice...',
          'listening to the emotional weight of each scene...',
          'the first line must hook. trying...',
          'the prose follows the structure — but breathes...',
          'Chapter 1 is written. every word in its place.',
        ],
      },
      delivers: {
        pt: 'Entrega: Capítulo 1 — Prosa Viva',
        en: 'Delivers: Chapter 1 — Living Prose',
      },
      deliversDesc: {
        pt: 'texto contínuo e revisado, fiel ao personagem e ao mundo recebidos',
        en: 'continuous, revised text, true to the character and world received',
      },
    },
    {
      name: { pt: 'Leitor', en: 'Lector' },
      role: { pt: 'Revisa e Lapida', en: 'Reviews and Polishes' },
      col: '180,30,180',
      receives: {
        pt: 'recebe a Prosa Viva do Bardo',
        en: 'receives the Living Prose from the Bard',
      },
      thoughts: {
        pt: [
          'a prosa chegou. lendo com olhos de fora...',
          'rastreando palavras repetidas e padrões quebrados...',
          'quebrando ritmos monótonos — variando o compasso...',
          'eliminando frases proibidas e clichês...',
          'o capítulo está lapidado. cada palavra ganhou peso.',
        ],
        en: [
          'the prose arrived. reading with outside eyes...',
          'tracking repeated words and broken patterns...',
          'breaking monotone rhythms — varying the beat...',
          'eliminating forbidden phrases and clichés...',
          'the chapter is polished. every word has earned its place.',
        ],
      },
      delivers: {
        pt: 'Entrega: Prosa Final Lapidada',
        en: 'Delivers: Final Polished Prose',
      },
      deliversDesc: {
        pt: 'texto revisado, sem repetições ou clichês — pronto para o Cronista selar',
        en: 'revised text, free of repetition and clichés — ready for the Chronicler to seal',
      },
    },
    {
      name: { pt: 'Cronista', en: 'Chronicler' },
      role: { pt: 'Sela a Memória', en: 'Seals the Memory' },
      col: '139,92,246',
      receives: {
        pt: 'recebe a Prosa Lapidada do Leitor',
        en: 'receives the Polished Prose from the Lector',
      },
      thoughts: {
        pt: [
          'a história foi escrita. agora precisa ser lembrada.',
          'indexando cada personagem e suas contradições...',
          'registrando factos, pactos e segredos...',
          'nada do que aconteceu pode ser esquecido...',
          'o Codex está selado. o Motor não esquece.',
        ],
        en: [
          'the story was written. now it must be remembered.',
          'indexing every character and their contradictions...',
          'recording facts, pacts and secrets...',
          'nothing that happened can be forgotten...',
          'the Codex is sealed. the Engine never forgets.',
        ],
      },
      delivers: {
        pt: 'Entrega: Codex Completo',
        en: 'Delivers: Full Codex',
      },
      deliversDesc: {
        pt: 'memória viva do universo — alimenta todos os capítulos seguintes',
        en: 'living memory of the universe — feeds every chapter that follows',
      },
    },
  ];

  const [thoughtIdx, setThoughtIdx] = useState(0);

  useEffect(() => {
    setThoughtIdx(0);
    const thoughtTimer = setInterval(() => {
      setThoughtIdx(prev => prev + 1);
    }, THOUGHT_INTERVAL);

    const agentTimer = setInterval(() => {
      setActive(prev => (prev + 1) % agents.length);
      setThoughtIdx(0);
    }, RELAY_INTERVAL);

    return () => {
      clearInterval(thoughtTimer);
      clearInterval(agentTimer);
    };
  }, [active]);

  const ag = agents[active];
  const currentThought = ag.thoughts[l][thoughtIdx % ag.thoughts[l].length];

  // Director — independent thought cycle (always watching)
  const directorThoughts: Record<L, string[]> = {
    pt: [
      'analisando todos os loops em aberto...',
      'calibrando pressão das facções...',
      'monitorando deriva do protagonista...',
      'emitindo directiva urgente ao Tecelão...',
      '↺ vigilância contínua — o universo não dorme',
    ],
    en: [
      'analysing all open loops...',
      'calibrating faction pressure...',
      'monitoring protagonist drift...',
      'issuing urgent directive to the Weaver...',
      '↺ continuous vigil — the universe never sleeps',
    ],
  };
  const [dirThoughtIdx, setDirThoughtIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDirThoughtIdx(prev => prev + 1), THOUGHT_INTERVAL + 500);
    return () => clearInterval(id);
  }, []);
  const dirThought = directorThoughts[l][dirThoughtIdx % directorThoughts[l].length];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header — uses the Forge title */}
      <div className="max-w-7xl mx-auto mb-16">
        <div className="flex items-center gap-3 mb-5">
          <div style={{ width: 28, height: 1, background: `rgba(197,160,89,0.6)` }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.3em]" style={{ color: `rgba(197,160,89,0.7)` }}>
            {t('landing.forge.badge')}
          </span>
        </div>
        <h2 className="font-serif text-4xl md:text-5xl text-paper leading-tight">
          {t('landing.forge.title')}
        </h2>
      </div>

      {/* ── Director — visual command center above the relay ─────────── */}
      <div className="max-w-5xl mx-auto mb-0 flex flex-col items-center" style={{ position: 'relative' }}>

        {/* Director sigil + identity */}
        <div className="flex flex-col items-center" style={{ position: 'relative', zIndex: 2 }}>
          {/* Sigil row: Director (large, centered) + Arbiter (small satellite) */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Director — crown sigil */}
            <motion.div
              style={{ width: 96, height: 96 }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <AgentSigil index={6} lit={true} col="168,85,247" />
            </motion.div>

            {/* Arbiter — small gray companion, absolute to the right */}
            <motion.div
              style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.5 }}
            >
              {/* Dashed connector */}
              <div style={{ position: 'absolute', right: '100%', top: '50%', width: 14, height: 1, borderTop: '1px dashed rgba(148,163,184,0.22)', marginRight: 0 }} />
              {/* Intermittent glow — wakes up briefly then fades back */}
              <motion.div
                style={{ width: 52, height: 52 }}
                animate={{ opacity: [0.45, 0.45, 0.9, 0.45, 0.45], filter: [
                  'drop-shadow(0 0 0px rgba(148,163,184,0))',
                  'drop-shadow(0 0 0px rgba(148,163,184,0))',
                  'drop-shadow(0 0 8px rgba(148,163,184,0.55))',
                  'drop-shadow(0 0 0px rgba(148,163,184,0))',
                  'drop-shadow(0 0 0px rgba(148,163,184,0))',
                ] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', times: [0, 0.35, 0.5, 0.65, 1] }}
              >
                <AgentSigil index={7} lit={false} col="148,163,184" />
              </motion.div>
              <span style={{ fontFamily: 'monospace', fontSize: 7, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.45)', whiteSpace: 'nowrap' }}>
                {l === 'pt' ? 'Árbitro' : 'Arbiter'}
              </span>
            </motion.div>
          </div>

          {/* Name + live dot */}
          <div className="flex items-center gap-2 mt-1">
            <motion.div
              className="rounded-full"
              style={{ width: 5, height: 5, background: 'rgba(168,85,247,0.9)', flexShrink: 0 }}
              animate={{ opacity: [1, 0.2, 1], scale: [1, 0.7, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.36em]" style={{ color: 'rgba(168,85,247,0.7)' }}>
              {l === 'pt' ? 'DIRETOR' : 'DIRECTOR'}
            </span>
            <motion.div
              className="rounded-full"
              style={{ width: 5, height: 5, background: 'rgba(168,85,247,0.9)', flexShrink: 0 }}
              animate={{ opacity: [1, 0.2, 1], scale: [1, 0.7, 1] }}
              transition={{ duration: 1.4, delay: 0.7, repeat: Infinity }}
            />
          </div>


        </div>

        {/* Scan arm SVG — wide horizontal bar that "watches" the full relay row */}
        <div className="w-full" style={{ position: 'relative', height: 54, marginTop: 4 }}>
          <svg
            viewBox="0 0 800 54"
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
          >
            {/* Central vertical connector from sigil down */}
            <line x1="400" y1="0" x2="400" y2="28" stroke="rgba(168,85,247,0.5)" strokeWidth="1"/>

            {/* Horizontal scan shelf */}
            <line x1="50" y1="28" x2="750" y2="28" stroke="rgba(168,85,247,0.15)" strokeWidth="0.8"/>

            {/* Left and right fade gradients via two transparent rects with defs */}
            <defs>
              <linearGradient id="dirFadeL" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(14,11,6,1)" />
                <stop offset="100%" stopColor="rgba(14,11,6,0)" />
              </linearGradient>
              <linearGradient id="dirFadeR" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(14,11,6,0)" />
                <stop offset="100%" stopColor="rgba(14,11,6,1)" />
              </linearGradient>
            </defs>
            <rect x="0" y="22" width="160" height="14" fill="url(#dirFadeL)" />
            <rect x="640" y="22" width="160" height="14" fill="url(#dirFadeR)" />

            {/* 6 downward drops — one per agent (roughly evenly spaced) */}
            {[108, 228, 348, 452, 572, 692].map((ax, i) => (
              <g key={i}>
                <motion.line
                  x1={ax} y1="28" x2={ax} y2="54"
                  stroke={`rgba(${agents[i].col},${i === active ? 0.65 : 0.15})`}
                  strokeWidth={i === active ? 1.2 : 0.7}
                  strokeDasharray={i === active ? '0' : '2 3'}
                  animate={{ opacity: i === active ? [0.4, 1, 0.4] : 0.15 }}
                  transition={{ duration: 2.2, repeat: Infinity }}
                />
                {/* small dot on the shelf rail */}
                <motion.circle
                  cx={ax} cy="28" r={i === active ? 2.8 : 1.6}
                  fill={`rgba(${agents[i].col},${i === active ? 0.9 : 0.25})`}
                  animate={i === active ? { opacity: [0.6, 1, 0.6], r: [2.8, 3.8, 2.8] } : { opacity: 0.25 }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </g>
            ))}

            {/* Wave pulses: expand from Director center → outward → return */}
            {/* Left arm: 400 → 50 → 400 */}
            <motion.circle
              cy="28"
              fill="rgba(168,85,247,0.18)" stroke="rgba(168,85,247,0.75)" strokeWidth="0.9"
              animate={{ cx: [400, 50, 400], opacity: [0, 0.9, 0], r: [2, 4.5, 2] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] }}
            />
            {/* Right arm: 400 → 750 → 400 */}
            <motion.circle
              cy="28"
              fill="rgba(168,85,247,0.18)" stroke="rgba(168,85,247,0.75)" strokeWidth="0.9"
              animate={{ cx: [400, 750, 400], opacity: [0, 0.9, 0], r: [2, 4.5, 2] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] }}
            />
            {/* Second wave pair — delayed by half cycle for continuous feel */}
            <motion.circle
              cy="28"
              fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.38)" strokeWidth="0.65"
              animate={{ cx: [400, 50, 400], opacity: [0, 0.55, 0] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: 1.8, times: [0, 0.5, 1] }}
            />
            <motion.circle
              cy="28"
              fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.38)" strokeWidth="0.65"
              animate={{ cx: [400, 750, 400], opacity: [0, 0.55, 0] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: 1.8, times: [0, 0.5, 1] }}
            />
            {/* Center heartbeat — expanding ring from the Director's origin */}
            <motion.circle
              cx="400" cy="28" fill="none"
              stroke="rgba(168,85,247,0.5)" strokeWidth="0.8"
              animate={{ r: [2, 16], opacity: [0.75, 0] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeOut' }}
            />
          </svg>
        </div>
      </div>

      {/* Agent sigil relay line */}
      <div className="flex items-center justify-center gap-3 md:gap-6 mb-16" style={{ marginTop: 0 }}>
        {agents.map((a, i) => {
          const isActive = i === active;
          const isPast = i < active;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <motion.div
                  className="flex-1 max-w-[64px] relative"
                  style={{ height: 1 }}
                >
                  {/* Base line */}
                  <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.04)' }} />
                  {/* Lit line */}
                  <motion.div
                    className="absolute inset-0"
                    style={{ transformOrigin: 'left' }}
                    animate={{
                      scaleX: isPast || isActive ? 1 : 0,
                      background: `rgba(${agents[Math.min(i, active)].col},0.45)`,
                    }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                  {/* Traveling spark when transitioning */}
                  {isPast && (
                    <motion.div
                      className="absolute top-1/2 -translate-y-1/2 rounded-full"
                      style={{ width: 4, height: 4, background: `rgba(${agents[i].col},0.9)` }}
                      initial={{ left: '0%' }}
                      animate={{ left: '100%', opacity: [1, 0] }}
                      transition={{ duration: 0.8 }}
                    />
                  )}
                </motion.div>
              )}
              <button
                onClick={() => { setActive(i); setThoughtIdx(0); }}
                className="relative flex flex-col items-center gap-2.5 group"
              >
                {/* Sigil container */}
                <motion.div
                  animate={{
                    scale: isActive ? 1 : 0.82,
                    opacity: isActive ? 1 : isPast ? 0.5 : 0.32,
                  }}
                  transition={{ type: 'spring', stiffness: 200, damping: 22 }}
                  style={{ width: 70, height: 70 }}
                >
                  <AgentSigil index={i} lit={isActive} col={a.col} />
                </motion.div>
                {/* Name */}
                <motion.span
                  className="font-serif text-[12px] md:text-[13px] italic select-none"
                  animate={{
                    color: isActive
                      ? `rgba(${a.col},0.95)`
                      : isPast
                      ? `rgba(${a.col},0.38)`
                      : 'rgba(255,255,255,0.22)',
                  }}
                  transition={{ duration: 0.4 }}
                >
                  {a.name[l]}
                </motion.span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Central thought area */}
      <div className="relative flex flex-col items-center" style={{ minHeight: 260 }}>
        {/* Ambient glow */}
        <motion.div
          className="absolute top-0 rounded-full pointer-events-none"
          style={{ width: 320, height: 130, filter: 'blur(70px)' }}
          animate={{ background: `rgba(${ag.col},0.07)` }}
          transition={{ duration: 0.8 }}
        />

        {/* Receives — handoff from previous agent */}
        <AnimatePresence mode="wait">
          {ag.receives && (
            <motion.div
              key={`receives-${active}`}
              className="relative z-10 flex items-center justify-center gap-2 mb-7"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div style={{ width: 20, height: 1, background: `rgba(${agents[active - 1]?.col ?? ag.col},0.3)` }} />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: `rgba(${agents[active - 1]?.col ?? ag.col},0.4)` }}>
                {ag.receives[l]}
              </span>
              <div style={{ width: 20, height: 1, background: `rgba(${agents[active - 1]?.col ?? ag.col},0.3)` }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Thought */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${active}-${thoughtIdx}`}
            className="relative z-10 text-center"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Thinking dots */}
            <div className="flex items-center justify-center gap-1.5 mb-5">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="rounded-full"
                  style={{ width: 4, height: 4, background: `rgba(${ag.col},0.55)` }}
                  animate={{ opacity: [0.15, 1, 0.15] }}
                  transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
                />
              ))}
            </div>

            {/* Agent role label */}
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] mb-3" style={{ color: `rgba(${ag.col},0.35)` }}>
              {ag.role[l]}
            </p>

            {/* Thought text */}
            <motion.p
              className="text-lg md:text-xl leading-loose max-w-sm mx-auto tracking-wide"
              style={{ color: `rgba(${ag.col},0.9)`, fontFamily: "'Cormorant Garamond', serif", fontSize: '1.35rem', letterSpacing: '0.02em' }}
              animate={{
                y: [0, -5, 0],
                opacity: [0.75, 1, 0.75],
                textShadow: [
                  `0 0 0px rgba(${ag.col},0)`,
                  `0 0 18px rgba(${ag.col},0.25)`,
                  `0 0 0px rgba(${ag.col},0)`,
                ],
              }}
              transition={{ duration: 4, ease: 'easeInOut', repeat: Infinity, repeatType: 'loop' }}
            >
              {currentThought}
            </motion.p>
          </motion.div>
        </AnimatePresence>

        {/* Delivery block */}
        <motion.div
          className="mt-10 relative z-10 text-center"
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.7 }}
        >
          <p
            className="font-mono text-xs tracking-widest uppercase mb-1.5"
            style={{ color: `rgba(${ag.col},0.55)` }}
          >
            {ag.delivers[l]}
          </p>
          <p
            className="font-serif text-sm italic leading-relaxed max-w-xs mx-auto"
            style={{ color: `rgba(${ag.col},0.25)` }}
          >
            {ag.deliversDesc[l]}
          </p>
        </motion.div>

        {/* Pass arrow */}
        {active < agents.length - 1 && (
          <motion.div
            className="mt-6 relative z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: RELAY_INTERVAL / 1000, ease: 'easeInOut' }}
          >
            <ArrowRight className="w-4 h-4" style={{ color: `rgba(${agents[active + 1].col},0.4)` }} />
          </motion.div>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-3 mt-14">
        {agents.map((a, i) => (
          <motion.div
            key={i}
            className="rounded-full cursor-pointer"
            onClick={() => { setActive(i); setThoughtIdx(0); }}
            style={{ height: 5, borderRadius: 3 }}
            animate={{
              background: i === active ? `rgba(${a.col},0.8)` : i < active ? `rgba(${a.col},0.25)` : 'rgba(255,255,255,0.06)',
              width: i === active ? 28 : 5,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          />
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Typewriter — char by char, blinking cursor, auto-stops
// ─────────────────────────────────────────────────────────────────────────────
const TypewriterText = ({ text, col }: { text: string; col: string }) => {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown('');
    setDone(false);
    let i = 0;
    const ms = Math.max(36, Math.min(62, 1700 / text.length));
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, ms);
    return () => clearInterval(id);
  }, [text]);

  return (
    <>
      <span style={{ color: `rgba(${col},0.92)` }}>{shown}</span>
      <motion.span
        style={{ color: `rgba(${col},0.75)`, marginLeft: 1 }}
        animate={done
          ? { opacity: [1, 0, 1, 0, 0] }
          : { opacity: [1, 0.15, 1] }
        }
        transition={done
          ? { duration: 1.6, times: [0, 0.3, 0.6, 0.9, 1], ease: 'easeIn' }
          : { duration: 0.7, repeat: Infinity }
        }
      >|</motion.span>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent SVG icons — defined outside component to avoid re-mount issues
// ─────────────────────────────────────────────────────────────────────────────
const AgentIcons: ((lit: boolean) => React.ReactNode)[] = [
  // 0 — Arquiteto: compass
  (lit) => (
    <svg viewBox="0 0 56 56" fill="none" style={{ width: '100%', height: '100%' }}>
      <circle cx="28" cy="28" r="22" stroke={`rgba(197,160,89,${lit ? 0.22 : 0.07})`} strokeWidth="0.6" />
      <motion.circle cx="28" cy="28" r="16" stroke={`rgba(197,160,89,${lit ? 0.35 : 0.1})`} strokeWidth="0.6"
        strokeDasharray="3.5 3.5"
        animate={{ rotate: lit ? 360 : 0 }}
        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '28px 28px' }}
      />
      <line x1="28" y1="6" x2="28" y2="50" stroke={`rgba(197,160,89,${lit ? 0.15 : 0.05})`} strokeWidth="0.5" />
      <line x1="6" y1="28" x2="50" y2="28" stroke={`rgba(197,160,89,${lit ? 0.15 : 0.05})`} strokeWidth="0.5" />
      <motion.polygon points="28,10 26.2,22 29.8,22"
        fill={`rgba(197,160,89,${lit ? 0.9 : 0.2})`}
        animate={lit ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.2 }}
        transition={{ duration: 2.4, repeat: Infinity }}
      />
      <polygon points="28,46 26.2,34 29.8,34" fill={`rgba(197,160,89,${lit ? 0.22 : 0.07})`} />
      <motion.circle cx="28" cy="28" r="2.8"
        fill={`rgba(197,160,89,${lit ? 1 : 0.28})`}
        animate={lit ? { r: [2.8, 3.6, 2.8] } : { r: 2.8 }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>
  ),
  // 1 — Forjador: flame
  (lit) => (
    <svg viewBox="0 0 56 56" fill="none" style={{ width: '100%', height: '100%' }}>
      <motion.path
        d="M28 8 C23 14 16 20 17 30 C18 38 23 44 28 47 C33 44 38 38 39 30 C40 20 33 14 28 8Z"
        fill={`rgba(244,63,94,${lit ? 0.14 : 0.03})`}
        stroke={`rgba(244,63,94,${lit ? 0.65 : 0.15})`}
        strokeWidth="0.9" strokeLinejoin="round"
        animate={lit ? { scaleY: [1, 1.04, 1] } : { scaleY: 1 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '28px 28px' }}
      />
      <motion.path
        d="M28 22 C25.5 26 25 30 26.5 35 C27 37 28 39 28 39 C28 39 29 37 29.5 35 C31 30 30.5 26 28 22Z"
        fill={`rgba(244,63,94,${lit ? 0.55 : 0.08})`}
        animate={lit ? { opacity: [0.4, 0.85, 0.4] } : { opacity: 0.08 }}
        transition={{ duration: 1.3, repeat: Infinity }}
      />
      <motion.circle cx="28" cy="46" r="3" fill="none"
        stroke={`rgba(244,63,94,${lit ? 0.3 : 0.06})`} strokeWidth="0.6"
        animate={lit ? { r: [3, 6, 3], opacity: [0.4, 0, 0.4] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </svg>
  ),
  // 2 — Tecelão: interlocking arcs
  (lit) => (
    <svg viewBox="0 0 56 56" fill="none" style={{ width: '100%', height: '100%' }}>
      <motion.path d="M6 28 C11 16 20 12 28 18 C36 24 45 20 50 8"
        stroke={`rgba(59,130,246,${lit ? 0.7 : 0.16})`} strokeWidth="1.1" strokeLinecap="round"
        animate={lit ? { pathLength: [0.85, 1, 0.85] } : { pathLength: 1 }}
        transition={{ duration: 2.6, repeat: Infinity }}
      />
      <motion.path d="M6 28 C11 40 20 44 28 38 C36 32 45 36 50 48"
        stroke={`rgba(59,130,246,${lit ? 0.7 : 0.16})`} strokeWidth="1.1" strokeLinecap="round"
        animate={lit ? { pathLength: [0.85, 1, 0.85] } : { pathLength: 1 }}
        transition={{ duration: 2.6, delay: 0.5, repeat: Infinity }}
      />
      {[{ cx: 28, cy: 28, r: 3.2 }, { cx: 6, cy: 28, r: 1.8 }, { cx: 50, cy: 28, r: 1.8 }].map((p, i) => (
        <motion.circle key={i} cx={p.cx} cy={p.cy} r={p.r}
          fill={`rgba(59,130,246,${lit ? (i === 0 ? 1 : 0.45) : 0.16})`}
          animate={lit && i === 0 ? { r: [3.2, 4.2, 3.2] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />
      ))}
    </svg>
  ),
  // 3 — Bardo: feather/quill
  (lit) => (
    <svg viewBox="0 0 56 56" fill="none" style={{ width: '100%', height: '100%' }}>
      <motion.path
        d="M42 8 C35 12 26 21 17 32 L13 42 L22 39 C31 28 40 17 42 8Z"
        fill={`rgba(16,185,129,${lit ? 0.1 : 0.02})`}
        stroke={`rgba(16,185,129,${lit ? 0.65 : 0.15})`}
        strokeWidth="0.9" strokeLinejoin="round"
        animate={lit ? { rotate: [-1.2, 1.2, -1.2] } : {}}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '27px 25px' }}
      />
      {[17, 21, 25, 29, 33].map((y, i) => (
        <line key={i}
          x1={17 + i * 3.2} y1={y + i * 1.4}
          x2={23 + i * 2.6} y2={y + i * 1.4 - 5}
          stroke={`rgba(16,185,129,${lit ? 0.2 : 0.06})`} strokeWidth="0.5"
        />
      ))}
      <line x1="22" y1="39" x2="10" y2="48"
        stroke={`rgba(16,185,129,${lit ? 0.5 : 0.12})`} strokeWidth="0.9" strokeLinecap="round" />
      <motion.path d="M10 49 Q15 47 20 49 Q25 51 30 49"
        stroke={`rgba(16,185,129,${lit ? 0.4 : 0})`} strokeWidth="0.7" strokeLinecap="round" fill="none"
        animate={{ pathLength: lit ? [0, 1] : [0, 0] }}
        transition={{ duration: 1.4, ease: 'easeOut', repeat: lit ? Infinity : 0, repeatDelay: 1.2 }}
      />
    </svg>
  ),
  // 4 — Cronista: open scroll
  (lit) => (
    <svg viewBox="0 0 56 56" fill="none" style={{ width: '100%', height: '100%' }}>
      <rect x="12" y="10" width="32" height="36" rx="2"
        fill={`rgba(139,92,246,${lit ? 0.09 : 0.02})`}
        stroke={`rgba(139,92,246,${lit ? 0.55 : 0.14})`} strokeWidth="0.9"
      />
      <path d="M12 10 Q7 10 7 15 Q7 20 12 20"
        stroke={`rgba(139,92,246,${lit ? 0.4 : 0.1})`} strokeWidth="0.9" fill="none" />
      <path d="M12 46 Q7 46 7 41 Q7 36 12 36"
        stroke={`rgba(139,92,246,${lit ? 0.4 : 0.1})`} strokeWidth="0.9" fill="none" />
      {[18, 24, 30, 36].map((y, i) => (
        <motion.line key={i} x1="18" y1={y} x2={i === 2 ? 30 : 38} y2={y}
          stroke={`rgba(139,92,246,${lit ? 0.5 : 0.12})`} strokeWidth="0.75"
          animate={{ pathLength: lit ? 1 : 0.25 }}
          transition={{ duration: 0.9, delay: i * 0.18 }}
        />
      ))}
    </svg>
  ),
];

// ─────────────────────────────────────────────────────────────────────────────
// Agent Thinking Strip — named agents, SVG figures, thought phrases
// ─────────────────────────────────────────────────────────────────────────────
const AgentThinkingStrip = () => {
  const { lang } = useLanguage();
  type L = 'pt' | 'en';
  const l = lang as L;
  const N = 5;
  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive(p => (p + 1) % N);
      setTick(p => p + 1);
    }, 3400);
    return () => clearInterval(id);
  }, []);

  const agents: { name: Record<L, string>; col: string; phrases: Record<L, string[]> }[] = [
    {
      name: { pt: 'Arquiteto', en: 'Architect' },
      col: '197,160,89',
      phrases: {
        pt: ['cartografando o mundo...', 'definindo as leis...', 'traçando fronteiras...'],
        en: ['charting the world...', 'defining the laws...', 'drawing the map...'],
      },
    },
    {
      name: { pt: 'Forjador', en: 'Soulforger' },
      col: '244,63,94',
      phrases: {
        pt: ['escavando o Ghost...', 'moldando a Lie...', 'forjando a alma...'],
        en: ['excavating the Ghost...', 'shaping the Lie...', 'forging the soul...'],
      },
    },
    {
      name: { pt: 'Tecelão', en: 'Weaver' },
      col: '120,80,220',
      phrases: {
        pt: ['traçando os beats...', 'conectando os fios...', 'arquitetando o arco...'],
        en: ['tracing the beats...', 'connecting the threads...', 'architecting the arc...'],
      },
    },
    {
      name: { pt: 'Bardo', en: 'Bard' },
      col: '16,185,129',
      phrases: {
        pt: ['ouvindo o ritmo...', 'escolhendo as palavras...', 'escrevendo a cena...'],
        en: ['listening to the rhythm...', 'choosing the words...', 'writing the scene...'],
      },
    },
    {
      name: { pt: 'Cronista', en: 'Chronicler' },
      col: '139,92,246',
      phrases: {
        pt: ['registrando os fatos...', 'atualizando o Codex...', 'fechando a memória...'],
        en: ['recording the facts...', 'updating the Codex...', 'sealing the memory...'],
      },
    },
  ];

  // Percentage x-positions for the spotlight
  const pct = (i: number) => 10 + (i / (N - 1)) * 80;

  return (
    <div className="relative pt-12 pb-16 px-6 overflow-hidden">
      {/* Seamless top fade — blends with section bg */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-stone-900/80 to-transparent pointer-events-none z-10" />

      {/* Moving spotlight blob behind active agent */}
      <motion.div
        className="absolute inset-y-0 pointer-events-none"
        style={{ width: '26%' }}
        animate={{ left: `${pct(active) - 13}%` }}
        transition={{ type: 'spring', stiffness: 28, damping: 16 }}
      >
        <motion.div
          className="w-full h-full"
          style={{ filter: 'blur(72px)', borderRadius: '50%' }}
          animate={{ backgroundColor: `rgba(${agents[active].col},0.09)` }}
          transition={{ duration: 1.6 }}
        />
      </motion.div>

      {/* Agent cards grid */}
      <div
        className="max-w-5xl mx-auto relative z-20"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${N}, 1fr)`, gap: 0 }}
      >
        {agents.map((ag, i) => {
          const isActive = i === active;
          const phrase = ag.phrases[l][tick % 3];
          return (
            <div
              key={ag.name.pt}
              className="flex flex-col items-center gap-2"
              style={{ padding: '0 8px' }}
            >
              {/* SVG icon */}
              <motion.div
                style={{ width: 60, height: 60 }}
                animate={{
                  scale: isActive ? 1.1 : 0.88,
                  opacity: isActive ? 1 : 0.22,
                  filter: isActive
                    ? `drop-shadow(0 0 10px rgba(${ag.col},0.55))`
                    : 'drop-shadow(0 0 0 transparent)',
                }}
                transition={{ type: 'spring', stiffness: 160, damping: 24 }}
              >
                {AgentIcons[i](isActive)}
              </motion.div>

              {/* Name */}
              <motion.div
                className="font-mono text-[9px] uppercase tracking-[0.22em] text-center whitespace-nowrap select-none"
                animate={{ color: isActive ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.18)' }}
                transition={{ duration: 0.7 }}
              >
                {ag.name[l]}
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* ── Separator with label ── */}
      <div className="max-w-3xl mx-auto mt-12 px-6 flex items-center gap-5">
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.07))' }} />
        <span
          className="font-mono text-[8px] uppercase tracking-[0.35em] select-none"
          style={{ color: 'rgba(255,255,255,0.16)' }}
        >
          {l === 'pt' ? 'em processo' : 'in process'}
        </span>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(255,255,255,0.07))' }} />
      </div>

      {/* ── Central thought display ── */}
      <div className="max-w-2xl mx-auto mt-7 px-8 text-center" style={{ minHeight: 64 }}>
        <AnimatePresence mode="wait">
          <motion.p
            key={`thought-${active}-${tick}`}
            className="font-mono leading-loose"
            style={{ fontSize: 15, letterSpacing: '0.02em' }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5, transition: { duration: 0.35 } }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <TypewriterText
              text={agents[active].phrases[l][tick % 3]}
              col={agents[active].col}
            />
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Features Grid — What you get
// ─────────────────────────────────────────────────────────────────────────────
const FeaturesGrid = () => {
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
            {/* Subtle top accent on hover */}
            <div
              className="absolute top-0 left-6 right-6 h-[2px] rounded-b opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ background: `rgba(${feat.accent},0.6)` }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// --- Main Page ---

export default function LandingPage({ onStart, onConfigureApiKeys, hasApiKeys }: LandingPageProps) {
  const { t, lang, toggleLang } = useLanguage();
  const handlePrimaryAction = () => {
    if (hasApiKeys) {
      onStart();
      return;
    }
    onConfigureApiKeys();
  };

  return (
    <div className="min-h-screen bg-paper font-sans text-stone selection:bg-nobel selection:text-white overflow-x-hidden">
      
      {/* Sticky Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 backdrop-blur-md bg-paper/80 border-b border-stone-200/50 transition-all duration-300">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full border border-nobel flex items-center justify-center text-nobel">
                    <Feather className="w-4 h-4" />
                </div>
                <span className="font-serif font-bold text-lg tracking-tight">MYTHOS ENGINE</span>
            </div>
            <div className="hidden md:flex items-center space-x-8 text-sm uppercase tracking-widest font-medium text-stone-light">
                <a href="#manifesto" className="hover:text-nobel transition-colors">{t('landing.nav.manifesto')}</a>
                <a href="#codex" className="hover:text-nobel transition-colors">{t('landing.nav.codex')}</a>
                <a href="#features" className="hover:text-nobel transition-colors">{t('landing.nav.agents')}</a>
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={toggleLang}
                    className="text-[10px] font-bold uppercase tracking-widest text-stone-400 hover:text-white border border-stone-700 hover:border-stone-400 px-2.5 py-1.5 rounded transition-colors"
                >
                    {lang === 'pt' ? 'EN' : 'PT'}
                </button>
                <button 
                    onClick={handlePrimaryAction}
                    className="bg-stone-dark text-white px-6 py-2 text-sm uppercase tracking-widest hover:bg-nobel transition-colors duration-300 shadow-lg shadow-stone-900/20"
                >
                    {hasApiKeys ? t('landing.nav.cta') : (lang === 'pt' ? 'Salvar API Keys' : 'Save API Keys')}
                </button>
            </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-20 bg-stone-dark overflow-hidden">
        <CosmicParticles />
        {/* Abstract Background Art */}
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none mix-blend-screen">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] border-[0.5px] border-nobel/20 rounded-full animate-[spin_120s_linear_infinite]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border-[0.5px] border-nobel/40 rounded-full animate-[spin_90s_linear_infinite_reverse]" />
             {/* Golden Ray */}
            <div className="absolute top-0 left-1/2 w-[1px] h-1/2 bg-gradient-to-b from-transparent via-nobel to-transparent opacity-50" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
            >
                <Badge>{t('landing.hero.badge')}</Badge>
                <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-medium leading-tight mb-6 text-paper">
                    {t('landing.hero.title')}<br/><span className="italic text-nobel drop-shadow-[0_0_15px_rgba(197,160,89,0.5)]">{t('landing.hero.titleAccent')}</span>
                </h1>
            </motion.div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="max-w-xl mx-auto text-stone-300 font-sans text-lg leading-relaxed mb-12"
            >
                {t('landing.hero.desc')}
            </motion.div>

            <motion.div
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ delay: 0.8 }}
                 className="flex flex-col items-center gap-4"
            >
                 <button onClick={handlePrimaryAction} className="group relative inline-flex items-center justify-center px-8 py-4 bg-nobel text-white uppercase tracking-widest text-sm font-bold transition-all hover:bg-yellow-600 overflow-hidden rounded-sm shadow-[0_0_20px_rgba(197,160,89,0.4)] hover:shadow-[0_0_40px_rgba(197,160,89,0.6)]">
                    <span className="relative z-10 flex items-center">
                        {hasApiKeys ? t('landing.hero.cta') : (lang === 'pt' ? 'Salvar API Keys para Iniciar' : 'Save API Keys to Start')}
                        <ArrowRight className="w-4 h-4 ml-3 group-hover:translate-x-1 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                 </button>
                 {!hasApiKeys && (
                  <button
                    onClick={onConfigureApiKeys}
                    className="inline-flex items-center gap-2 text-sm text-stone-300 hover:text-nobel transition-colors"
                  >
                    <KeyRound className="w-4 h-4" />
                    {lang === 'pt'
                      ? 'As chaves do usu&aacute;rio precisam ser salvas localmente antes de iniciar.'
                      : 'User API keys must be saved locally before starting.'}
                  </button>
                 )}
            </motion.div>
        </div>

        <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 text-nobel/50"
        >
            <ChevronDown className="w-6 h-6" />
        </motion.div>
      </header>

      {/* Introduction Section - Editorial Layout */}
      <Section id="manifesto" className="border-t border-stone-200 bg-stone-50">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-16 items-center">
            <div className="md:col-span-5 relative">
                <div className="absolute -inset-4 border border-nobel/20 rounded-2xl transform -rotate-3 bg-white shadow-xl" />
                <div className="relative bg-stone-900 text-white p-10 rounded-2xl shadow-2xl transform rotate-1">
                    <Crown className="w-8 h-8 text-nobel mb-6" />
                    <h2 className="font-serif text-3xl md:text-4xl leading-tight mb-6">{t('landing.manifesto.quote')}</h2>
                    <p className="text-stone-400 text-sm uppercase tracking-widest">{t('landing.manifesto.quoteAttr')}</p>
                </div>
            </div>
            <div className="md:col-span-7 prose prose-lg prose-stone text-stone-600 leading-relaxed font-serif">
                <p className="text-xl">
                    {t('landing.manifesto.p1')}
                </p>
                <p>
                    <strong className="text-stone-900">Mythos Engine</strong> {t('landing.manifesto.p2')}
                </p>
                <div className="mt-8 flex items-center gap-4">
                    <div className="w-12 h-[1px] bg-nobel" />
                    <span className="text-xs uppercase tracking-widest text-nobel font-bold">{t('landing.manifesto.tagline')}</span>
                </div>
                {/* Manifesto stats */}
                <div className="mt-8 grid grid-cols-3 gap-4 pt-6 border-t border-stone-200">
                  {[
                    { value: '8', label: lang === 'pt' ? 'Agentes' : 'Agents' },
                    { value: '∞', label: 'Codex' },
                    { value: '1', label: lang === 'pt' ? 'Cap. por Execução' : 'Chapter per Run' },
                  ].map((stat, i) => (
                    <div key={i} className="text-center">
                      <div className="font-serif text-3xl text-stone-900 mb-1">{stat.value}</div>
                      <div className="text-[10px] uppercase tracking-widest text-stone-400">{stat.label}</div>
                    </div>
                  ))}
                </div>
            </div>
        </div>
      </Section>

      {/* Forge — merged pipeline relay */}
      <Section id="codex" className="bg-stone-dark border-b border-stone-800" dark>
        <PipelineShowcase />
      </Section>

      {/* Features Grid — What you get */}
      <Section id="features" className="border-t border-stone-200 bg-stone-50">
        <FeaturesGrid />
      </Section>

      {/* ── Final CTA Section ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-stone-dark text-paper py-40 px-6 flex flex-col items-center justify-center text-center">
        {/* Orbital rings (mirroring Hero) */}
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[680px] border-[0.5px] border-nobel/30 rounded-full animate-[spin_120s_linear_infinite]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] border-[0.5px] border-nobel/50 rounded-full animate-[spin_90s_linear_infinite_reverse]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] h-[260px] border-[0.5px] border-nobel/25 rounded-full animate-[spin_60s_linear_infinite]" />
          <div className="absolute top-0 left-1/2 w-[1px] h-1/2 bg-gradient-to-b from-transparent via-nobel to-transparent opacity-40" />
        </div>

        {/* Soft gold glow behind quote */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div style={{ width: 600, height: 300, background: 'radial-gradient(ellipse, rgba(197,160,89,0.07) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        </div>

        <motion.div
          className="relative z-10 max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Opening guillemet */}
          <div className="font-serif text-6xl text-nobel/20 leading-none mb-2 select-none">"</div>

          {/* Famous quote */}
          <blockquote
            className="font-serif italic leading-relaxed text-paper/80"
            style={{ fontSize: 'clamp(1.35rem, 3vw, 2.1rem)' }}
          >
            {lang === 'pt'
              ? 'Não existe uma agonia maior do que carregar dentro de si uma história não contada.'
              : 'There is no greater agony than bearing an untold story inside you.'}
          </blockquote>

          {/* Attribution */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <div style={{ width: 32, height: 1, background: 'rgba(197,160,89,0.45)' }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.35em]" style={{ color: 'rgba(197,160,89,0.6)' }}>
              Maya Angelou
            </span>
            <div style={{ width: 32, height: 1, background: 'rgba(197,160,89,0.45)' }} />
          </div>

          {/* CTA */}
          <div className="mt-16">
            <p className="font-serif text-paper/40 text-sm mb-8 tracking-wide">
              {lang === 'pt' ? 'A sua história está esperando.' : 'Your story is waiting.'}
            </p>
            <button
              onClick={handlePrimaryAction}
              className="group relative inline-flex items-center justify-center px-10 py-5 bg-nobel text-white uppercase tracking-widest text-sm font-bold transition-all hover:bg-yellow-600 rounded-sm shadow-[0_0_28px_rgba(197,160,89,0.35)] hover:shadow-[0_0_52px_rgba(197,160,89,0.6)] overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-3">
                {lang === 'pt' ? 'Forjar Minha História' : 'Forge My Story'}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
            </button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="bg-stone-dark text-stone-400 py-12 px-6 border-t border-stone-800">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center">
              <div className="flex items-center space-x-2 mb-4 md:mb-0">
                 <div className="w-6 h-6 rounded-full border border-stone-600 flex items-center justify-center text-stone-600 font-serif italic text-xs">M</div>
                 <span className="font-serif text-lg text-stone-200">Mythos Engine</span>
              </div>
              <div className="flex space-x-8 text-sm">
                  <a href="#" className="hover:text-nobel transition-colors">{t('landing.footer.docs')}</a>
                  <a href="#" className="hover:text-nobel transition-colors">{t('landing.footer.pricing')}</a>
                  <a href="#" className="hover:text-nobel transition-colors">{t('landing.footer.login')}</a>
              </div>
              <div className="mt-8 md:mt-0 text-xs text-stone-600">
                  {t('landing.footer.copy')}
              </div>
          </div>
      </footer>
    </div>
  );
}
