import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** Preferència triada per l'usuari. */
  preference: ThemePreference;
  /** Tema efectiu un cop resolt 'system'. */
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'campusfix_theme';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system',
  );
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    preference === 'system' ? getSystemTheme() : preference,
  );

  // Recalcula i aplica el tema cada cop que canvia la preferència.
  useEffect(() => {
    const next = preference === 'system' ? getSystemTheme() : preference;
    setResolved(next);
    applyTheme(next);
  }, [preference]);

  // Si la preferència és 'system', reacciona als canvis del SO en temps real.
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = getSystemTheme();
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = (p: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, p);
    setPreferenceState(p);
  };

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme ha d\'usar-se dins de ThemeProvider');
  return ctx;
}
