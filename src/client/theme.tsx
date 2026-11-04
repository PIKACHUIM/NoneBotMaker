import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nonebotmaker.theme';
export const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#11171a', light: '#f4f7f6' };

export function readThemeMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage can be unavailable in private or sandboxed contexts.
  }
  return 'system';
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode, system: ResolvedTheme): ResolvedTheme {
  return mode === 'system' ? system : mode;
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  system: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readThemeMode());
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme());
  const resolved = resolveTheme(mode, system);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_MODE_QUERY);
    const update = () => setSystem(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => { applyTheme(resolved); }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch {
      // Persisting the preference is best-effort.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, system, setMode }), [mode, resolved, system, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
