import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './LoginPage';

// Mock de dependències externes a la pàgina.
const loginMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock }),
}));
// i18n: retornem la clau tal qual perquè els tests siguin independents de l'idioma.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renderitza el formulari amb els camps d\'email i contrasenya', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('login.email')).toBeInTheDocument();
    expect(screen.getByLabelText('login.password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'login.submit' })).toBeInTheDocument();
  });

  it('crida login() amb les credencials i navega a "/" si l\'accés és correcte', async () => {
    loginMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('login.email'), 'admin@uab.cat');
    await user.type(screen.getByLabelText('login.password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'login.submit' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('admin@uab.cat', 'secret123'));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('mostra el missatge d\'error i no navega si login() falla', async () => {
    loginMock.mockRejectedValueOnce(new Error('Només els administradors poden accedir a aquest panell.'));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('login.email'), 'student@uab.cat');
    await user.type(screen.getByLabelText('login.password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'login.submit' }));

    expect(
      await screen.findByText('Només els administradors poden accedir a aquest panell.'),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
