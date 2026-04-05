
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Universe, Character } from '../types';
import Button from './ui/Button';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { markUniverseDirty } from '../services/geminiService';
import CharacterPortrait from './ui/CharacterPortrait';
import { Minus, Plus, Image as ImageIcon, LocateFixed, Users, Share2, LayoutGrid, Save } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

// ── Role visual config ────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { size: number; color: string; mass: number; ring: boolean }> = {
  Protagonista: { size: 82, color: '#C5A059', mass: 8,  ring: true  },
  Antagonista:  { size: 64, color: '#ef4444', mass: 5,  ring: true  },
  Mentor:       { size: 58, color: '#7c8fa8', mass: 3,  ring: false },
  Coadjuvante:  { size: 50, color: '#a8a29e', mass: 2,  ring: false },
  Figurante:    { size: 36, color: '#57534e', mass: 1,  ring: false },
};

const getEffectiveRole = (c: Character): string => {
  if (c.role === 'Protagonista') return 'Protagonista';
  if ((c.chapters ?? []).length === 0 && (c.relationships ?? []).length === 0) return 'Figurante';
  return c.role;
};

const getRelDesc = (a: Character, b: Character): string | undefined =>
  (a.relationships ?? []).find(r => r.characterId === b.id)?.description ||
  (b.relationships ?? []).find(r => r.characterId === a.id)?.description;

const getEdgeColor = (desc?: string): string => {
  if (!desc) return '#78716c';
  const l = desc.toLowerCase();
  if (/aliado|amigo|parceiro|confian|ally|friend|partner|trust|lealdade/.test(l)) return '#C5A059';
  if (/inim|rival|advers|enemy|hate|oppos|traição|traicao/.test(l)) return '#ef4444';
  return '#78716c';
};

// ── Force simulation (Verlet, no external deps) ────────────────────────────────

const hashPair = (a: string, b: string): number => {
  const value = `${a}|${b}`;
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const buildThreadPath = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bendSeed: number,
  strength: number,
): string => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const nx = -dy / distance;
  const ny = dx / distance;
  const direction = bendSeed % 2 === 0 ? 1 : -1;
  const bend = Math.min(distance * (0.09 + strength * 0.012), 54) * direction;
  const sway = ((bendSeed % 17) - 8) * 0.9;
  const ctrlX = midX + nx * bend + (dx / distance) * sway;
  const ctrlY = midY + ny * bend + (dy / distance) * sway;
  return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
};

const getEdgeAnchors = (
  a: { x: number; y: number; sz: number },
  b: { x: number; y: number; sz: number },
) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const ux = dx / distance;
  const uy = dy / distance;
  const aRadius = Math.max(a.sz / 2 - 4, 10);
  const bRadius = Math.max(b.sz / 2 - 4, 10);
  return {
    x1: a.x + ux * aRadius,
    y1: a.y + uy * aRadius,
    x2: b.x - ux * bRadius,
    y2: b.y - uy * bRadius,
  };
};

interface SimNode {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  pinned: boolean;
  mass: number;
}

const runForceSimulation = (
  characters: Character[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> => {
  if (characters.length === 0) return new Map();

  const protagonist = characters.find(c => c.role === 'Protagonista') || characters[0];

  // Build adjacency for attraction strength
  const edgeWeight = new Map<string, number>();
  const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  for (const c of characters) {
    for (const rel of (c.relationships ?? [])) {
      const key = edgeKey(c.id, rel.characterId);
      edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 2);
    }
    // Shared chapters also attract
    for (const other of characters) {
      if (other.id === c.id) continue;
      const shared = (c.chapters ?? []).filter(ch => (other.chapters ?? []).includes(ch)).length;
      if (shared > 0) {
        const key = edgeKey(c.id, other.id);
        edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + shared);
      }
    }
  }

  // Initial positions: concentric spread to avoid cold start symmetry
  const nodes: SimNode[] = characters.map((c, i) => {
    const isProto = c.id === protagonist.id;
    if (isProto) {
      return { id: c.id, x: width / 2, y: height / 2, vx: 0, vy: 0, pinned: true, mass: 8 };
    }
    const angle = (i / (characters.length - 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.38;
    const cfg = ROLE_CONFIG[getEffectiveRole(c)] ?? ROLE_CONFIG['Coadjuvante'];
    // Offset initial radius by role — figurantes start further out
    const roleRMultiplier: Record<string, number> = {
      Antagonista: 0.85, Mentor: 1.0, Coadjuvante: 1.15, Figurante: 1.45,
    };
    const rMult = roleRMultiplier[getEffectiveRole(c)] ?? 1.0;
    return {
      id: c.id,
      x: width / 2 + Math.cos(angle) * r * rMult + (Math.random() - 0.5) * 40,
      y: height / 2 + Math.sin(angle) * r * rMult + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
      pinned: false,
      mass: cfg.mass,
    };
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const REPULSION  = 26000;
  const ATTRACTION = 0.018;
  const DAMPING    = 0.78;
  const CENTER_G   = 0.0008;
  const ITERATIONS = 420;

  // Role-based base rest distance — Figurante stays far, Antagonista drawn in
  const roleBaseRest: Record<string, number> = {
    Protagonista: 0,
    Antagonista: 140,
    Mentor: 160,
    Coadjuvante: 200,
    Figurante: 270,
  };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = Math.max(dx * dx + dy * dy, 100);
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.pinned) { a.vx -= fx / a.mass; a.vy -= fy / a.mass; }
        if (!b.pinned) { b.vx += fx / b.mass; b.vy += fy / b.mass; }
      }
    }

    // Spring attraction along edges — rest length role-aware
    for (const [key, weight] of edgeWeight) {
      const [idA, idB] = key.split('|');
      const a = nodeMap.get(idA), b = nodeMap.get(idB);
      if (!a || !b) continue;
      const ca = characters.find(c => c.id === idA);
      const cb = characters.find(c => c.id === idB);
      const roleRestA = roleBaseRest[getEffectiveRole(ca!)] ?? 220;
      const roleRestB = roleBaseRest[getEffectiveRole(cb!)] ?? 220;
      const baseRest = (roleRestA + roleRestB) / 2;
      const rest = Math.max(baseRest - weight * 14, 55); // stronger rel → shorter rest
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const stretch = dist - rest;
      const force = ATTRACTION * stretch * Math.sqrt(weight);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx += fx / a.mass; a.vy += fy / a.mass; }
      if (!b.pinned) { b.vx -= fx / b.mass; b.vy -= fy / b.mass; }
    }

    // Weak gravity toward center
    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx += (width / 2 - n.x) * CENTER_G;
      n.vy += (height / 2 - n.y) * CENTER_G;
    }

    // Integrate + damp + clamp to bounds
    const pad = 80;
    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x = Math.max(pad, Math.min(width - pad, n.x + n.vx));
      n.y = Math.max(pad, Math.min(height - pad, n.y + n.vy));
    }
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const n of nodes) result.set(n.id, { x: n.x, y: n.y });
  return result;
};

interface CharactersViewProps {
  universe: Universe;
  onGenerateCharacter: () => void;
  onGenerateImage: (prompt: string) => void;
  onUpdateCharacterImage?: (characterId: string, prompt: string) => void;
  onUpdateUniverse?: (universe: Universe) => void;
  isLoading: boolean;
}

const CharacterCard: React.FC<{ character: Character; onSelect: () => void }> = ({ character, onSelect }) => (
  <Card withAstrolabe className="overflow-hidden cursor-pointer group transition-all duration-300 hover:shadow-lg hover:shadow-nobel/20 hover:-translate-y-1 p-0" onClick={onSelect}>
    <div className="relative h-64 overflow-hidden">
      <CharacterPortrait name={character.name} imageUrl={character.imageUrl} role={character.role} faction={character.faction} size={512} className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-110" />
      <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent opacity-80" />
      <div className="absolute bottom-4 left-4 right-4">
        <h3 className="text-xl font-serif font-bold text-white mb-1">{character.name}</h3>
        <p className="text-stone-300 text-xs uppercase tracking-widest">{character.role}</p>
      </div>
    </div>
  </Card>
);

// ── Relationship Web ─────────────────────────────────────────────────────────

export const RelationshipConstellation: React.FC<{
  characters: Character[];
  universe: Universe;
  onSelect: (c: Character) => void;
  t: (key: string) => string;
}> = ({ characters, universe, onSelect, t }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 900, height: 680 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const safeCharacters = useMemo(
    () => characters.map(character => ({
      ...character,
      aliases: character.aliases ?? [],
      relationships: character.relationships ?? [],
      chapters: character.chapters ?? [],
    })),
    [characters]
  );

  // Measure container on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDims({ width: Math.max(width, 400), height: Math.max(height, 400) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setViewport(prev => {
      const nextScale = Math.max(0.72, Math.min(1.9, prev.scale - event.deltaY * 0.0012));
      const worldX = (pointerX - prev.x) / prev.scale;
      const worldY = (pointerY - prev.y) / prev.scale;
      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      };
    });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-node="true"]') || target.closest('[data-constellation-ui="true"]')) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [viewport.x, viewport.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setViewport(prev => ({ ...prev, x: dragRef.current!.originX + dx, y: dragRef.current!.originY + dy }));
  }, []);

  const endDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current && event) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    }
    dragRef.current = null;
  }, []);

  const protagonist = safeCharacters.find(c => c.role === 'Protagonista') || safeCharacters[0];
  const aliveCount = useMemo(() => safeCharacters.filter(character => character.status !== 'Morto').length, [safeCharacters]);
  const deadCount = useMemo(() => safeCharacters.filter(character => character.status === 'Morto').length, [safeCharacters]);
  const activeCount = useMemo(() => safeCharacters.filter(character => character.chapters.length > 0).length, [safeCharacters]);

  // Run force simulation whenever characters or dims change
  const positions = useMemo(
    () => runForceSimulation(safeCharacters, dims.width, dims.height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [safeCharacters.map(c => c.id).join(','), dims.width, dims.height],
  );

  // Build node list with absolute pixel positions
  const nodes = useMemo(() => safeCharacters.map(c => {
    const pos = positions.get(c.id) ?? { x: dims.width / 2, y: dims.height / 2 };
    const erole = getEffectiveRole(c);
    const cfg = ROLE_CONFIG[erole] ?? ROLE_CONFIG['Coadjuvante'];
    const connCount = c.relationships.length +
      safeCharacters.filter(o => o.id !== c.id && o.relationships.some(r => r.characterId === c.id)).length;
    return { ...c, x: pos.x, y: pos.y, sz: cfg.size, erole, color: cfg.color, ring: cfg.ring, connCount };
  }), [safeCharacters, positions, dims]);

  // Ambient particles (fixed seed)
  const particles = useMemo(() => Array.from({ length: 32 }, (_, i) => ({
    x: ((i * 137.508) % dims.width),
    y: ((i * 89.311) % dims.height),
    r: 0.8 + (i % 3) * 0.6,
    op: 0.08 + (i % 5) * 0.05,
  })), [dims.width, dims.height]);

  // Build edges with richer visual weight
  const edges = useMemo(() => {
    if (nodes.length < 2) return [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const result: Array<{
      id: string;
      path: string;
      filamentPath: string;
      coreColor: string;
      glowColor: string;
      strokeWidth: number;
      opacity: number;
      underOpacity: number;
      dashed: boolean;
      strength: number;
      shimmerSpeed: number;
    }> = [];

    const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const connectionMap = new Map<string, {
      a: string;
      b: string;
      explicitCount: number;
      sharedChapters: number;
      sameFaction: boolean;
      description?: string;
      involvesProtagonist: boolean;
    }>();

    const ensureConnection = (a: string, b: string) => {
      const key = edgeKey(a, b);
      const current = connectionMap.get(key);
      if (current) return current;
      const created = {
        a,
        b,
        explicitCount: 0,
        sharedChapters: 0,
        sameFaction: false,
        description: undefined as string | undefined,
        involvesProtagonist: protagonist ? a === protagonist.id || b === protagonist.id : false,
      };
      connectionMap.set(key, created);
      return created;
    };

    for (const c of safeCharacters) {
      for (const rel of c.relationships) {
        const target = safeCharacters.find(other => other.id === rel.characterId);
        if (!target) continue;
        const connection = ensureConnection(c.id, rel.characterId);
        connection.explicitCount += 1;
        connection.sameFaction = connection.sameFaction || Boolean(c.faction && target.faction && c.faction === target.faction);
        connection.description = connection.description ?? rel.description ?? getRelDesc(c, target);
      }
    }

    for (let i = 0; i < safeCharacters.length; i++) {
      for (let j = i + 1; j < safeCharacters.length; j++) {
        const a = safeCharacters[i];
        const b = safeCharacters[j];
        const sharedChapters = a.chapters.filter(ch => b.chapters.includes(ch)).length;
        const sameFaction = Boolean(a.faction && b.faction && a.faction === b.faction);
        if (sharedChapters === 0) continue;
        const connection = ensureConnection(a.id, b.id);
        connection.sharedChapters = Math.max(connection.sharedChapters, sharedChapters);
        connection.sameFaction = connection.sameFaction || sameFaction;
      }
    }

    for (const [key, connection] of connectionMap) {
      const na = nodeMap.get(connection.a);
      const nb = nodeMap.get(connection.b);
      if (!na || !nb) continue;

      const strength =
        connection.explicitCount * 2.2 +
        connection.sharedChapters * 0.75 +
        (connection.sameFaction ? 1.1 : 0) +
        (connection.involvesProtagonist ? 0.55 : 0);

      if (strength <= 0) continue;

      const baseColor = getEdgeColor(connection.description);
      const coreColor =
        connection.sameFaction && baseColor === '#78716c'
          ? '#8b7d63'
          : baseColor;
      const glowColor =
        coreColor === '#ef4444'
          ? 'rgba(239, 68, 68, 0.28)'
          : coreColor === '#C5A059'
          ? 'rgba(197, 160, 89, 0.32)'
          : 'rgba(168, 162, 158, 0.18)';

      const anchors = getEdgeAnchors(na, nb);
      const path = buildThreadPath(
        anchors.x1,
        anchors.y1,
        anchors.x2,
        anchors.y2,
        hashPair(connection.a, connection.b),
        strength,
      );
      const filamentPath = buildThreadPath(
        anchors.x1,
        anchors.y1,
        anchors.x2,
        anchors.y2,
        hashPair(connection.a, connection.b) + 11,
        Math.max(strength - 0.8, 0.6),
      );

      result.push({
        id: key,
        path,
        filamentPath,
        coreColor,
        glowColor,
        strokeWidth: Math.min(1.2 + strength * 0.42, 4.6),
        opacity: Math.min(0.26 + strength * 0.08, 0.9),
        underOpacity: Math.min(0.1 + strength * 0.04, 0.32),
        dashed: connection.explicitCount === 0,
        strength,
        shimmerSpeed: Math.max(6.5 - Math.min(strength, 4), 2.8),
      });
    }

    result.sort((a, b) => a.strength - b.strength);

    return result;
  }, [nodes, safeCharacters, protagonist]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-xl border border-stone-800 bg-stone-dark overflow-hidden shadow-2xl select-none ${dragRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ height: 680 }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={() => dragRef.current && endDrag()}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none opacity-25 bg-[radial-gradient(ellipse_at_center,rgba(197,160,89,0.2)_0%,transparent_70%)]" />

        {/* Ambient star particles */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
          {particles.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#C5A059" opacity={p.op} />
          ))}
        </svg>

        {/* Orbit guide rings around protagonist */}
        {protagonist && (() => {
          const pp = positions.get(protagonist.id);
          if (!pp) return null;
          return (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
              {[130, 210, 300].map((r, i) => (
                <circle key={i} cx={pp.x} cy={pp.y} r={r}
                  fill="none" stroke="#C5A059"
                  strokeWidth={0.5} strokeDasharray={i === 0 ? '4 8' : i === 1 ? '2 10' : '1 14'}
                  opacity={0.10 - i * 0.02}
                />
              ))}
            </svg>
          );
        })()}

        {/* SVG layer: edges only */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
        <defs>
          <marker id="arrow-gold" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#C5A05966" />
          </marker>
          <filter id="edge-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="proto-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="edge-soft-glow">
            <feGaussianBlur stdDeviation="5.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {edges.map((e, i) => (
          <g key={e.id ?? i}>
            <path
              d={e.filamentPath}
              fill="none"
              stroke={e.glowColor}
              strokeWidth={Math.max(0.8, e.strokeWidth * 0.42)}
              strokeOpacity={Math.min(e.underOpacity * 0.9, 0.24)}
              strokeLinecap="round"
              strokeDasharray={e.dashed ? '2 10' : undefined}
            />
            <path
              d={e.path}
              fill="none"
              stroke={e.glowColor}
              strokeWidth={e.strokeWidth + 4.4}
              strokeOpacity={e.underOpacity}
              strokeLinecap="round"
              filter="url(#edge-soft-glow)"
            />
            <path
              d={e.path}
              fill="none"
              stroke={e.coreColor}
              strokeWidth={e.strokeWidth + 1.15}
              strokeOpacity={Math.min(e.opacity * 0.5, 0.42)}
              strokeLinecap="round"
              filter={!e.dashed && e.coreColor !== '#78716c' ? 'url(#edge-glow)' : undefined}
            />
            <path
              d={e.path}
              fill="none"
              stroke={e.coreColor}
              strokeWidth={e.strokeWidth}
              strokeOpacity={e.opacity}
              strokeDasharray={e.dashed ? '4 10' : undefined}
              strokeLinecap="round"
            />
            {e.strength >= 2.6 && (
              <motion.path
                d={e.path}
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={Math.max(0.8, e.strokeWidth * 0.34)}
                strokeLinecap="round"
                strokeDasharray="10 56"
                initial={{ strokeDashoffset: 0, opacity: 0.12 }}
                animate={{ strokeDashoffset: [-66, 0], opacity: [0.12, 0.28, 0.12] }}
                transition={{ duration: e.shimmerSpeed, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </g>
        ))}
        </svg>

        {/* Character nodes */}
        {nodes.map((node, i) => {
        const isProto = node.erole === 'Protagonista';
        const isAntag = node.erole === 'Antagonista';
        const isHov = hovered === node.id;
        const charState = universe.narrativeMemory?.characterStates?.find(
          s => s.characterId === node.id,
        );
        const lastChapterId = node.chapters[node.chapters.length - 1];
        const lastChapter = lastChapterId
          ? universe.chapters.find(chapter => chapter.id === lastChapterId)
          : undefined;
        const relWithProt = protagonist && node.id !== protagonist.id
          ? getRelDesc(protagonist, node as Character)
          : undefined;
        const isDead = charState?.status === 'Morto' || node.status === 'Morto';
        const showRole = isProto || isAntag || node.erole === 'Mentor';
        const statusLabel = isDead ? 'Morto' : charState?.status || node.status || 'Ativo';
        const statusTone = isDead ? 'bg-red-950/80 text-red-200 border-red-500/40' : 'bg-emerald-950/75 text-emerald-200 border-emerald-500/30';

          return (
            <motion.div
              key={node.id}
            data-node="true"
            className="absolute cursor-pointer flex flex-col items-center"
            style={{
              left: node.x,
              top: node.y,
              transform: 'translate(-50%, -50%)',
              zIndex: isProto ? 20 : isHov ? 15 : 10,
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: 1,
              opacity: node.erole === 'Figurante' ? 0.55 : isDead ? 0.45 : 1,
            }}
            transition={{ duration: 0.5, delay: i * 0.06, type: 'spring', stiffness: 180, damping: 22 }}
            onMouseEnter={() => setHovered(node.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(node as Character)}
          >
            {/* Protagonist pulse ring — CSS animation */}
            {isProto && (
              <div
                className="absolute rounded-full animate-ping"
                style={{
                  width: node.sz + 24,
                  height: node.sz + 24,
                  top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  border: '1.5px solid #C5A05944',
                  animationDuration: '3s',
                  animationTimingFunction: 'ease-out',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Portrait circle */}
            <div
              className="rounded-full transition-all duration-200 overflow-hidden flex-shrink-0 relative"
              style={{
                width: node.sz + (isHov ? 6 : 0),
                height: node.sz + (isHov ? 6 : 0),
                filter: isDead ? 'grayscale(80%)' : undefined,
                boxShadow: isProto
                  ? `0 0 0 2.5px #C5A059, 0 0 0 6px rgba(197,160,89,0.15), 0 0 36px rgba(197,160,89,0.28)`
                  : isAntag
                  ? `0 0 0 2px #ef4444bb, 0 0 0 4px rgba(239,68,68,0.12), 0 0 18px rgba(239,68,68,0.20)`
                  : isHov
                  ? `0 0 0 2px ${node.color}99, 0 0 14px ${node.color}55`
                  : `0 0 0 1.5px ${node.color}44`,
              }}
            >
              <CharacterPortrait
                name={node.name}
                imageUrl={node.imageUrl}
                role={node.role}
                faction={node.faction}
                size={node.sz}
                className="w-full h-full object-cover object-top"
              />
              {/* Dead overlay */}
              {isDead && (
                <div className="absolute inset-0 flex items-center justify-center bg-stone-950/50 rounded-full">
                  <span className="text-stone-400" style={{ fontSize: node.sz * 0.28 }}>✝</span>
                </div>
              )}
            </div>

            {/* Connection count badge */}
            {node.connCount > 0 && (
              <div
                className="absolute rounded-full flex items-center justify-center"
                style={{
                  width: 16, height: 16,
                  top: 0, right: -2,
                  background: node.color,
                  fontSize: 8,
                  color: '#0c0a09',
                  fontWeight: 700,
                  boxShadow: `0 0 6px ${node.color}88`,
                  pointerEvents: 'none',
                }}
              >
                {node.connCount}
              </div>
            )}

            {/* Name label */}
            <div className={`mt-1.5 text-center pointer-events-none ${isProto ? 'max-w-[120px]' : 'max-w-[84px]'}`}>
              <p
                className={`font-serif leading-tight truncate ${
                  isProto ? 'text-[13px] font-bold' : isAntag ? 'text-[11px] font-semibold' : 'text-[10px]'
                }`}
                style={{ color: isProto ? '#C5A059' : isHov ? node.color : node.color + 'cc' }}
              >
                {node.name.split(' ')[0]}
              </p>
              {showRole && (
                <p className="text-[8px] uppercase tracking-widest mt-0.5" style={{ color: node.color, opacity: isProto ? 0.55 : 0.45 }}>
                  {isProto ? t('chars.constellation.protagonist') : node.erole}
                </p>
              )}
              <div className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.22em] ${statusTone}`}>
                {statusLabel}
              </div>
            </div>

            {/* Hover tooltip */}
            {isHov && !isProto && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30 bg-stone-900/95 border border-stone-700 rounded-xl px-3 py-2.5 shadow-2xl w-52 text-center pointer-events-none backdrop-blur-sm">
                <p className="font-serif font-bold text-white text-xs mb-0.5 truncate">{node.name}</p>
                <p className="text-[9px] uppercase tracking-widest mb-2" style={{ color: node.color }}>
                  {node.erole}{node.faction ? ` · ${node.faction}` : ''}
                </p>
                {charState?.location && (
                  <p className="text-stone-400 text-[9px] mb-0.5">📍 {charState.location}</p>
                )}
                {charState?.emotionalState && (
                  <p className="text-stone-400 text-[9px] mb-1 italic">{charState.emotionalState}</p>
                )}
                {lastChapter && (
                  <p className="text-stone-400 text-[9px] mb-1">{t('chars.constellation.lastAppearance')}: {lastChapter.title}</p>
                )}
                {relWithProt && (
                  <div className="border-t border-stone-700 pt-1.5 mt-1.5">
                    <p className="text-[8px] uppercase tracking-widest text-stone-600 mb-0.5">{t('chars.constellation.relation')}</p>
                    <p className="text-stone-300 text-[9px] leading-relaxed line-clamp-3">{relWithProt}</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        );
        })}
      </div>

      {/* Legend */}
      <div data-constellation-ui="true" className="absolute bottom-4 left-4 bg-stone-900/80 backdrop-blur-sm border border-stone-800 rounded-xl px-3 py-2.5 space-y-1.5">
        <p className="text-[8px] uppercase tracking-widest text-stone-600 mb-1">{t('chars.constellation.legend')}</p>
        {(
          [
            ['Protagonista', '#C5A059'],
            ['Antagonista',  '#ef4444'],
            ['Mentor',       '#7c8fa8'],
            ['Coadjuvante',  '#a8a29e'],
            ['Figurante',    '#57534e'],
          ] as const
        ).map(([label, color]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-[9px] text-stone-400">{label}</span>
          </div>
        ))}
        <div className="border-t border-stone-800 pt-1.5 mt-1 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-[2px] rounded" style={{ background: '#C5A059' }} />
            <span className="text-[9px] text-stone-500">{t('chars.constellation.strongAlliance')}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="2"><line x1="0" y1="1" x2="20" y2="1" stroke="#78716c" strokeWidth="1" strokeDasharray="3 3" /></svg>
            <span className="text-[9px] text-stone-500">{t('chars.constellation.weakConn')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-[2px] rounded" style={{ background: '#ef4444' }} />
            <span className="text-[9px] text-stone-500">{t('chars.constellation.antagonism')}</span>
          </div>
        </div>
      </div>

      <div data-constellation-ui="true" className="absolute left-4 top-4 grid gap-2 sm:grid-cols-3">
        {[
          { label: t('chars.constellation.active'), value: activeCount, tone: 'border-nobel/30 bg-stone-900/70 text-nobel' },
          { label: t('chars.constellation.alive'), value: aliveCount, tone: 'border-emerald-500/20 bg-emerald-950/45 text-emerald-200' },
          { label: t('chars.constellation.dead'), value: deadCount, tone: 'border-red-500/20 bg-red-950/45 text-red-200' },
        ].map(item => (
          <div key={item.label} className={`rounded-xl border px-3 py-2 backdrop-blur-sm ${item.tone}`}>
            <p className="text-[8px] uppercase tracking-[0.25em] opacity-70">{item.label}</p>
            <p className="mt-1 font-serif text-lg font-bold">{item.value}</p>
          </div>
        ))}
      </div>

      <div data-constellation-ui="true" className="absolute right-4 bottom-4 flex items-center gap-2 rounded-2xl border border-stone-700/80 bg-stone-950/80 px-3 py-2 shadow-2xl backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setViewport(prev => ({ ...prev, scale: Math.max(0.72, prev.scale - 0.12) }))}
          className="rounded-lg border border-stone-700 bg-stone-900/80 p-2 text-stone-200 transition hover:border-stone-500 hover:text-white"
          aria-label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setViewport(prev => ({ ...prev, scale: Math.min(1.9, prev.scale + 0.12) }))}
          className="rounded-lg border border-stone-700 bg-stone-900/80 p-2 text-stone-200 transition hover:border-stone-500 hover:text-white"
          aria-label="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
          className="rounded-lg border border-stone-700 bg-stone-900/80 p-2 text-stone-200 transition hover:border-stone-500 hover:text-white"
          aria-label="Reset view"
        >
          <LocateFixed className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Counter */}
      <div data-constellation-ui="true" className="absolute right-4 top-4 rounded-2xl border border-stone-700/80 bg-stone-950/80 px-4 py-3 text-right shadow-2xl backdrop-blur-sm">
        <p className="text-[8px] uppercase tracking-[0.28em] text-stone-500">{t('chars.constellation.liveWeb')}</p>
        <p className="mt-1 font-serif text-sm font-bold text-stone-100">
          {characters.length} {characters.length === 1 ? t('chars.constellation.entity') : t('chars.constellation.entities')}
        </p>
        <p className="mt-1 text-[9px] text-stone-400">{t('chars.constellation.clickDetails')}</p>
        <p className="mt-1 text-[9px] text-stone-500">{Math.round(viewport.scale * 100)}%</p>
      </div>
    </div>
  );
};

const CharacterDetailModal: React.FC<{ 
    character: Character | null; 
    onClose: () => void; 
    onGenerateImage: (prompt: string) => void;
    onUpdateCharacterImage?: (characterId: string, prompt: string) => void;
    onSaveCharacter?: (character: Character) => void;
    isLoading: boolean;
}> = ({ character, onClose, onGenerateImage, onUpdateCharacterImage, onSaveCharacter, isLoading }) => {
    const { t } = useLanguage();
    const [draft, setDraft] = useState<Character | null>(character);
    useEffect(() => {
        setDraft(character);
    }, [character]);
    if (!character) return null;
    const current = draft ?? character;

    return (
        <Modal isOpen={!!character} onClose={onClose} title={character.name}>
            <div className="flex flex-col md:flex-row gap-6">
                <div className="md:w-1/3 flex-shrink-0">
              <CharacterPortrait name={current.name} imageUrl={current.imageUrl} role={current.role} faction={current.faction} size={768} className="w-full h-auto object-cover rounded-lg shadow-md border border-stone-200 aspect-[4/5]" />
                     <Button 
                        onClick={() => {
                            const prompt = `${t('chars.genImagePrompt')} ${current.name}, ${current.bio.substring(0, 100)}...`;
                            if (onUpdateCharacterImage) {
                                onUpdateCharacterImage(current.id, prompt);
                            } else {
                                onGenerateImage(prompt);
                            }
                        }}
                        className="w-full mt-4"
                        variant="secondary"
                        isLoading={isLoading}
                    >
                        <ImageIcon className="mr-2 h-4 w-4" />
                        {isLoading ? t('chars.generating') : t('chars.generateImage')}
                    </Button>
                </div>
                <div className="md:w-2/3 space-y-4">
                    <Card className="p-6 bg-stone-50">
                        <h4 className="font-serif font-bold text-lg mb-4 text-stone-dark border-b border-stone-200 pb-2">{t('chars.basicSheet')}</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.field.name')}</p>
                                <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.name} onChange={e => setDraft(prev => prev ? { ...prev, name: e.target.value } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.field.aliases')}</p>
                                <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.aliases.join(', ')} onChange={e => setDraft(prev => prev ? { ...prev, aliases: e.target.value.split(',').map(alias => alias.trim()).filter(Boolean) } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.age')}</p>
                                <input type="number" className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.age} onChange={e => setDraft(prev => prev ? { ...prev, age: Number(e.target.value) } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.role')}</p>
                                <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.role} onChange={e => setDraft(prev => prev ? { ...prev, role: e.target.value as Character['role'] } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.alignment')}</p>
                                <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.alignment} onChange={e => setDraft(prev => prev ? { ...prev, alignment: e.target.value } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.status')}</p>
                                <select className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.status} onChange={e => setDraft(prev => prev ? { ...prev, status: e.target.value as Character['status'] } : prev)}>
                                    <option value="Vivo">{t('chars.status.alive')}</option>
                                    <option value="Morto">{t('chars.status.dead')}</option>
                                    <option value="Desconhecido">{t('chars.status.unknown')}</option>
                                </select>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Facção</p>
                                <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.faction} onChange={e => setDraft(prev => prev ? { ...prev, faction: e.target.value } : prev)} />
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.field.aiVisibility')}</p>
                                <select className="w-full rounded-lg border border-stone-300 px-2 py-1.5" value={current.aiVisibility} onChange={e => setDraft(prev => prev ? { ...prev, aiVisibility: e.target.value as Character['aiVisibility'] } : prev)}>
                                    <option value="global">{t('chars.visibility.global')}</option>
                                    <option value="tracked">{t('chars.visibility.tracked')}</option>
                                    <option value="hidden">{t('chars.visibility.hidden')}</option>
                                </select>
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6">
                        <h4 className="font-serif font-bold text-lg mb-4 text-stone-dark border-b border-stone-200 pb-2">{t('chars.bio')}</h4>
                        <textarea className="w-full h-32 rounded-xl border border-stone-300 px-3 py-2 resize-none text-stone-700" value={current.bio} onChange={e => setDraft(prev => prev ? { ...prev, bio: e.target.value } : prev)} />
                        <div className="mt-4">
                            <label className="block text-xs uppercase tracking-widest text-stone-400 mb-1">{t('chars.field.authorNotes')}</label>
                            <textarea className="w-full h-24 rounded-xl border border-stone-300 px-3 py-2 resize-none text-stone-700" value={current.notesPrivate ?? ''} onChange={e => setDraft(prev => prev ? { ...prev, notesPrivate: e.target.value } : prev)} />
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex justify-end">
                            <Button size="sm" onClick={() => draft && onSaveCharacter?.(draft)}>
                                <Save className="mr-2 h-4 w-4" />
                                {t('common.save')}
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </Modal>
    );
};


export default function CharactersView({ universe, onGenerateCharacter, onGenerateImage, onUpdateCharacterImage, onUpdateUniverse, isLoading }: CharactersViewProps) {
  const { t } = useLanguage();
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'constellation'>('grid');
  const handleSaveCharacter = useCallback((character: Character) => {
      const updatedUniverse = markUniverseDirty({
          ...universe,
          characters: universe.characters.map(existing => existing.id === character.id ? character : existing),
      }, ['characters']);
      onUpdateUniverse?.(updatedUniverse);
      setSelectedCharacter(character);
  }, [onUpdateUniverse, universe]);

  // Update selected character if universe changes (e.g., image updated)
  React.useEffect(() => {
      if (selectedCharacter) {
          const updatedChar = universe.characters.find(c => c.id === selectedCharacter.id);
          if (updatedChar && updatedChar.imageUrl !== selectedCharacter.imageUrl) {
              setSelectedCharacter(updatedChar);
          }
      }
  }, [universe.characters, selectedCharacter]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4 border-b border-stone-200 pb-6">
        <div>
            <h1 className="text-4xl font-serif font-bold text-stone-dark mb-2">{t('chars.title')}</h1>
            <p className="text-stone-500">{t('chars.subtitle')}</p>
        </div>
        <div className="flex items-center space-x-4">
            <div className="flex bg-stone-100 p-1 rounded-lg border border-stone-200">
                <button 
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-nobel' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
                <button 
                    onClick={() => setViewMode('constellation')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'constellation' ? 'bg-white shadow-sm text-nobel' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    <Share2 className="w-4 h-4" />
                </button>
            </div>
            <Button onClick={onGenerateCharacter} isLoading={isLoading} className="bg-nobel hover:bg-yellow-600 text-white">
            <Plus className="mr-2 h-4 w-4" />
            {isLoading ? t('chars.generating') : t('chars.newChar')}
            </Button>
        </div>
      </div>

      {universe.characters.length > 0 ? (
        viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {universe.characters.map(char => (
                <CharacterCard key={char.id} character={char} onSelect={() => setSelectedCharacter(char)} />
            ))}
            </div>
        ) : (
            <RelationshipConstellation characters={universe.characters} universe={universe} onSelect={setSelectedCharacter} t={t} />
        )
      ) : (
        <div className="text-center py-24 bg-stone-50 rounded-xl border border-stone-200 border-dashed">
          <Users className="w-12 h-12 text-stone-300 mx-auto mb-4" />
          <p className="text-stone-500 font-serif text-lg mb-2">{t('chars.emptyTitle')}</p>
          <p className="text-stone-400 text-sm">{t('chars.emptyHint')}</p>
        </div>
      )}

      <CharacterDetailModal 
        character={selectedCharacter} 
        onClose={() => setSelectedCharacter(null)}
        onGenerateImage={onGenerateImage}
        onUpdateCharacterImage={onUpdateCharacterImage}
        onSaveCharacter={handleSaveCharacter}
        isLoading={isLoading}
      />
    </div>
  );
}
