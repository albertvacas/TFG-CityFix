import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import type { User } from '../types';

// useAuth retorna un valor mutable que cada test configura abans de renderitzar.
let authValue: { user: User | null; loading: boolean };
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => authValue,
}));

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>PANELL ADMIN</div>} />
        </Route>
        <Route path="/login" element={<div>PANTALLA LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const adminUser = { role: 'ADMIN' } as User;
const studentUser = { role: 'STUDENT' } as User;

describe('ProtectedRoute', () => {
  it('mentre carrega no mostra ni el panell ni el login (spinner)', () => {
    authValue = { user: null, loading: true };
    renderWithRouter();
    expect(screen.queryByText('PANELL ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByText('PANTALLA LOGIN')).not.toBeInTheDocument();
  });

  it('redirigeix a /login si no hi ha usuari', () => {
    authValue = { user: null, loading: false };
    renderWithRouter();
    expect(screen.getByText('PANTALLA LOGIN')).toBeInTheDocument();
  });

  it('redirigeix a /login si l\'usuari no és ADMIN', () => {
    authValue = { user: studentUser, loading: false };
    renderWithRouter();
    expect(screen.getByText('PANTALLA LOGIN')).toBeInTheDocument();
  });

  it('mostra el contingut protegit si l\'usuari és ADMIN', () => {
    authValue = { user: adminUser, loading: false };
    renderWithRouter();
    expect(screen.getByText('PANELL ADMIN')).toBeInTheDocument();
  });
});
