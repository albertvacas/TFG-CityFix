import { createContext, useState, useEffect, type ReactNode } from 'react';
import { login as apiLogin, getProfile } from '../api/auth';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

export const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    getProfile()
      .then((u) => {
        if (u.role !== 'ADMIN') {
          localStorage.removeItem('token');
          setUser(null);
        } else {
          setUser(u);
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user: u } = await apiLogin(email, password);
    if (u.role !== 'ADMIN') {
      throw new Error('Només els administradors poden accedir a aquest panell.');
    }
    localStorage.setItem('token', token);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
