import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { View } from 'react-native';
import { useColorScheme, vars } from 'nativewind';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** Preferència triada per l'usuari. */
  preference: ThemePreference;
  /** Tema efectiu ('light' | 'dark') un cop resolt 'system'. */
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'campusfix_theme';

// Valors RGB (separats per espais) de l'escala de grisos + superfície.
// La config de Tailwind referencia aquestes variables a `rgb(var(--x) / a)`,
// de manera que canviar-les reasigna tots els colors neutres de cop.
const LIGHT_VARS = {
  '--surface': '255 255 255',
  '--gray-50': '249 250 251',
  '--gray-100': '243 244 246',
  '--gray-200': '229 231 235',
  '--gray-300': '209 213 219',
  '--gray-400': '156 163 175',
  '--gray-500': '107 114 128',
  '--gray-600': '75 85 99',
  '--gray-700': '55 65 81',
  '--gray-800': '31 41 55',
  '--gray-900': '17 24 39',
};

const DARK_VARS = {
  '--surface': '30 41 59', // slate-800
  '--gray-50': '15 23 42', // slate-900
  '--gray-100': '30 41 59',
  '--gray-200': '51 65 85',
  '--gray-300': '71 85 105',
  '--gray-400': '100 116 139',
  '--gray-500': '148 163 184',
  '--gray-600': '203 213 225',
  '--gray-700': '226 232 240',
  '--gray-800': '241 245 249',
  '--gray-900': '248 250 252',
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Recupera la preferència desada en muntar i la aplica a NativeWind.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setPreferenceState(saved);
        setColorScheme(saved);
      }
    });
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    setColorScheme(p);
    AsyncStorage.setItem(STORAGE_KEY, p);
  };

  const resolved = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {/* `vars()` aplica les variables de tema a tot l'arbre (les usen `bg-surface`,
          etc.). El `backgroundColor` literal pinta el fons base de l'app segons el
          tema: així, encara que el contenidor d'una pantalla no apliqui el seu fons,
          mai es veu el blanc del root. */}
      <View
        style={[
          { flex: 1, backgroundColor: resolved === 'dark' ? '#0f172a' : '#f9fafb' },
          vars(resolved === 'dark' ? DARK_VARS : LIGHT_VARS),
        ]}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme ha d'usar-se dins de ThemeProvider");
  return ctx;
}
