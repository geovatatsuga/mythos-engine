const hashString = (s: string): number => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
};

const PORTRAIT_PALETTES = [
    { bg: '#141311', panel: '#1f1b17', line: '#d4b483', accent: '#efe4cf', shadow: '#0d0c0b' },
    { bg: '#181614', panel: '#24201c', line: '#c5a059', accent: '#f2e7d4', shadow: '#100f0d' },
    { bg: '#111214', panel: '#1a1d21', line: '#c0a77a', accent: '#ece4d8', shadow: '#0a0b0d' },
    { bg: '#161312', panel: '#221d1a', line: '#bda07a', accent: '#f0e5d5', shadow: '#0d0b0a' },
];

const encodeSvg = (svg: string): string => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

export const isMythosPlaceholderImage = (url?: string): boolean => {
    if (!url || !url.startsWith('data:image/svg+xml;base64,')) {
        return false;
    }

    try {
        const payload = url.split(',')[1] || '';
        const decoded = atob(payload);
        return decoded.includes('Mythos Engine Placeholder') || decoded.includes('Image generation is temporarily in placeholder mode.');
    } catch {
        return false;
    }
};

const createEditorialPortraitSvg = ({
    name,
    role,
    faction,
    seed,
    size,
}: {
    name: string;
    role?: string;
    faction?: string;
    seed: string;
    size: number;
}): string => {
    const hash = hashString(seed);
    const palette = PORTRAIT_PALETTES[hash % PORTRAIT_PALETTES.length];
    const initials = getInitials(name);
    const shoulderWidth = 210 + (hash % 60);
    const headRadius = 62 + (hash % 12);
    const frameInset = 30;
    const arcOffset = 12 + (hash % 28);
    const lineOffset = 70 + (hash % 40);
    const roleLabel = (role || 'Figura Central').toUpperCase();
    const factionLabel = faction || 'Sem Facção';

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 800 960" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="100%" stop-color="${palette.panel}" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="${palette.line}" stop-opacity="0.16" />
      <stop offset="100%" stop-color="${palette.line}" stop-opacity="0" />
    </radialGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0 0.06 0"/>
      </feComponentTransfer>
    </filter>
  </defs>

  <rect width="800" height="960" fill="url(#bg)" rx="40" />
  <rect width="800" height="960" fill="url(#glow)" rx="40" />
  <rect x="${frameInset}" y="${frameInset}" width="${800 - frameInset * 2}" height="${960 - frameInset * 2}" rx="28" stroke="${palette.line}" stroke-opacity="0.55" />
  <rect x="${frameInset + 14}" y="${frameInset + 14}" width="${800 - (frameInset + 14) * 2}" height="${960 - (frameInset + 14) * 2}" rx="22" stroke="${palette.line}" stroke-opacity="0.18" />

  <path d="M130 ${180 + arcOffset}C210 ${120 + arcOffset},590 ${120 + arcOffset},670 ${180 + arcOffset}" stroke="${palette.line}" stroke-opacity="0.18" />
  <path d="M170 ${740 - arcOffset}C250 ${800 - arcOffset},550 ${800 - arcOffset},630 ${740 - arcOffset}" stroke="${palette.line}" stroke-opacity="0.14" />
  <line x1="${lineOffset}" y1="150" x2="${lineOffset}" y2="810" stroke="${palette.line}" stroke-opacity="0.08" />
  <line x1="${800 - lineOffset}" y1="150" x2="${800 - lineOffset}" y2="810" stroke="${palette.line}" stroke-opacity="0.08" />

  <circle cx="400" cy="360" r="${headRadius + 58}" stroke="${palette.line}" stroke-opacity="0.14" />
  <circle cx="400" cy="360" r="${headRadius + 28}" stroke="${palette.line}" stroke-opacity="0.24" />
  <circle cx="400" cy="360" r="${headRadius}" fill="${palette.shadow}" stroke="${palette.accent}" stroke-opacity="0.55" />

  <path d="M${400 - shoulderWidth / 2} 620C${400 - shoulderWidth / 2} 540 ${400 - 130} 500 400 500C${400 + 130} 500 ${400 + shoulderWidth / 2} 540 ${400 + shoulderWidth / 2} 620V710H${400 - shoulderWidth / 2}V620Z" fill="${palette.shadow}" stroke="${palette.accent}" stroke-opacity="0.45" />
  <path d="M285 520C320 585 480 585 515 520" stroke="${palette.line}" stroke-opacity="0.14" />

  <text x="400" y="152" text-anchor="middle" fill="${palette.line}" fill-opacity="0.9" font-size="20" font-family="Georgia, serif" letter-spacing="6">${roleLabel}</text>
  <text x="400" y="830" text-anchor="middle" fill="${palette.accent}" font-size="54" font-weight="700" font-family="Georgia, serif">${name}</text>
  <text x="400" y="868" text-anchor="middle" fill="${palette.line}" fill-opacity="0.78" font-size="18" font-family="Georgia, serif" letter-spacing="4">${factionLabel}</text>
  <text x="400" y="430" text-anchor="middle" fill="${palette.accent}" fill-opacity="0.9" font-size="42" font-weight="700" font-family="Georgia, serif" letter-spacing="4">${initials}</text>

  <rect width="800" height="960" rx="40" filter="url(#grain)" opacity="0.55" />
</svg>`;
};

const createConstellationAvatarSvg = ({
    name,
    role,
    seed,
    size,
}: {
    name: string;
    role?: string;
    seed: string;
    size: number;
}): string => {
    const hash = hashString(seed);
    const palette = PORTRAIT_PALETTES[hash % PORTRAIT_PALETTES.length];
    const initials = getInitials(name);
    const roleLabel = (role || 'Figura').toUpperCase();

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 320 320" fill="none">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="${palette.panel}" />
      <stop offset="100%" stop-color="${palette.bg}" />
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="25%" r="60%">
      <stop offset="0%" stop-color="${palette.line}" stop-opacity="0.3" />
      <stop offset="100%" stop-color="${palette.line}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="320" height="320" rx="160" fill="url(#bg)" />
  <rect width="320" height="320" rx="160" fill="url(#halo)" />
  <circle cx="160" cy="108" r="44" fill="${palette.shadow}" stroke="${palette.accent}" stroke-opacity="0.55" />
  <path d="M92 246C92 184 122 156 160 156C198 156 228 184 228 246V264H92V246Z" fill="${palette.shadow}" stroke="${palette.accent}" stroke-opacity="0.38" />
  <circle cx="160" cy="160" r="122" stroke="${palette.line}" stroke-opacity="0.24" />
  <text x="160" y="126" text-anchor="middle" fill="${palette.accent}" font-size="18" font-family="Georgia, serif" letter-spacing="2">${initials}</text>
  <text x="160" y="292" text-anchor="middle" fill="${palette.line}" fill-opacity="0.78" font-size="14" font-family="Georgia, serif" letter-spacing="3">${roleLabel}</text>
</svg>`;
};

export const createPortraitUrl = ({
    name,
    role,
    faction,
    seed,
    size = 256,
}: {
    name: string;
    role?: string;
    faction?: string;
    seed?: string;
    size?: number;
}): string => {
    const portraitSeed = seed || [name, role, faction].filter(Boolean).join('|');
    const svg = (size ?? 256) <= 128
        ? createConstellationAvatarSvg({ name, role, seed: portraitSeed, size: size ?? 256 })
        : createEditorialPortraitSvg({ name, role, faction, seed: portraitSeed, size: size ?? 256 });
    return encodeSvg(svg);
};

export const resolvePortraitUrl = ({
    name,
    imageUrl,
    role,
    faction,
    seed,
    size,
}: {
    name: string;
    imageUrl?: string;
    role?: string;
    faction?: string;
    seed?: string;
    size?: number;
}): string => {
    if (imageUrl && !isMythosPlaceholderImage(imageUrl)) {
        return imageUrl;
    }

    return createPortraitUrl({ name, role, faction, seed, size });
};
