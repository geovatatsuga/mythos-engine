export const API_KEYS_STORAGE_KEY = 'mythos_api_keys';

export type LlmProvider = 'auto' | 'groq' | 'gemini' | 'cerebras' | 'openrouter';

export type ApiKeys = {
  groq: string;
  gemini: string;
  cerebras: string;
  openrouter: string;
  preferredProvider: LlmProvider;
};

export const EMPTY_API_KEYS: ApiKeys = {
  groq: '',
  gemini: '',
  cerebras: '',
  openrouter: '',
  preferredProvider: 'auto',
};

const ENV_API_KEYS: Partial<ApiKeys> = {
  groq: typeof process !== 'undefined' ? process.env.GROQ_API_KEY ?? '' : '',
  gemini: typeof process !== 'undefined' ? process.env.GEMINI_API_KEY ?? '' : '',
  cerebras: typeof process !== 'undefined' ? process.env.CEREBRAS_API_KEY ?? '' : '',
  openrouter: typeof process !== 'undefined' ? process.env.OPENROUTER_API_KEY ?? '' : '',
};

export function hasAllApiKeys(keys: ApiKeys | null | undefined): keys is ApiKeys {
  return Boolean(
    keys &&
    (
      keys.groq.trim() ||
      keys.gemini.trim() ||
      keys.cerebras.trim() ||
      keys.openrouter.trim()
    )
  );
}

export function saveApiKeys(keys: ApiKeys) {
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

export function loadApiKeys(): ApiKeys | null {
  const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
  if (!raw) {
    const mergedFromEnv = {
      ...EMPTY_API_KEYS,
      ...ENV_API_KEYS,
    };
    return hasAllApiKeys(mergedFromEnv) ? mergedFromEnv : null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return {
      ...EMPTY_API_KEYS,
      ...ENV_API_KEYS,
      ...parsed,
      preferredProvider: parsed.preferredProvider ?? 'auto',
    };
  } catch {
    const mergedFromEnv = {
      ...EMPTY_API_KEYS,
      ...ENV_API_KEYS,
    };
    return hasAllApiKeys(mergedFromEnv) ? mergedFromEnv : null;
  }
}

export function clearApiKeys() {
  localStorage.removeItem(API_KEYS_STORAGE_KEY);
}
