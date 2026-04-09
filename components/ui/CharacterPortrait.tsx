import React, { useEffect, useMemo, useState } from 'react';
import { resolvePortraitUrl } from '../../utils/portraits';

interface CharacterPortraitProps {
  name: string;
  imageUrl?: string;
  role?: string;
  faction?: string;
  className?: string;
  alt?: string;
  seed?: string;
  size?: number;
  style?: React.CSSProperties;
}

const CharacterPortrait: React.FC<CharacterPortraitProps> = ({
  name,
  imageUrl,
  role,
  faction,
  className,
  alt,
  seed,
  size,
  style,
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl, name, role, faction, seed]);

  const src = useMemo(() => {
    if (!failed) {
      return resolvePortraitUrl({ name, imageUrl, role, faction, seed, size });
    }

    return resolvePortraitUrl({ name, role, faction, seed, size });
  }, [failed, faction, imageUrl, name, role, seed, size]);

  return (
    <img
      src={src}
      alt={alt || name}
      className={className}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
};

export default CharacterPortrait;