export const repairMojibakeText = (value?: string | null): string => {
  if (!value) return '';

  let next = value;
  const suspicious = /Ã|Â|â|�/;

  for (let i = 0; i < 2; i += 1) {
    if (!suspicious.test(next)) break;
    try {
      const bytes = Uint8Array.from(Array.from(next).map(char => char.charCodeAt(0) & 0xff));
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (!decoded || decoded === next) break;
      next = decoded;
    } catch {
      break;
    }
  }

  return next
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

