import { render, screen, waitFor } from '@testing-library/react-native';
import LeaderboardScreen from '../app/(app)/(tabs)/leaderboard';

// --- Mocks de dependències externes ---
// Els noms han de començar per "mock" perquè jest permeti referenciar-los dins
// de la factory de jest.mock (es fa hoisting per sobre dels imports).
const mockGetLeaderboard = jest.fn();
const mockGetMyPoints = jest.fn();
const mockGetProfile = jest.fn();

jest.mock('../src/api/gamification', () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
  getMyPoints: (...args: unknown[]) => mockGetMyPoints(...args),
}));
jest.mock('../src/api/auth', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { user_id: 'me', role: 'STUDENT', nickname: 'me' },
    setUser: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/components/Avatar', () => ({ __esModule: true, default: 'Avatar' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfile.mockResolvedValue({ user_id: 'me', role: 'STUDENT', points: 99 });
  mockGetLeaderboard.mockResolvedValue([
    { user_id: 'u1', name: 'Anna', surname: 'Soler', nickname: 'anna', points: 42, avatarUrl: null },
    { user_id: 'u2', name: 'Bru', surname: 'Coll', nickname: 'bru', points: 30, avatarUrl: null },
  ]);
  mockGetMyPoints.mockResolvedValue({ history: [], rank: { rank: 3, total: 10, points: 99 } });
});

describe('LeaderboardScreen (punts de l\'alumne)', () => {
  it('carrega i mostra el rànquing retornat per l\'API', async () => {
    render(<LeaderboardScreen />);

    // El contingut apareix quan es resol la petició → verifica "es carrega
    // el contingut adequat segons la sol·licitud". Esperem que l'arbre s'estabilitzi
    // (la pantalla fa diverses peticions en paral·lel) i re-consultem.
    await waitFor(() => {
      expect(screen.getByText('@anna')).toBeOnTheScreen();
      expect(screen.getByText('@bru')).toBeOnTheScreen();
      expect(screen.getByText('42')).toBeOnTheScreen();
      expect(screen.getByText('30')).toBeOnTheScreen();
    });
  });

  it('mostra la posició personal de l\'estudiant (rank i punts totals)', async () => {
    render(<LeaderboardScreen />);

    expect(await screen.findByText('#3')).toBeOnTheScreen();
    expect(screen.getByText('de 10 estudiants')).toBeOnTheScreen();
    // Punts totals dins la card "La teva posició".
    expect(screen.getByText('99')).toBeOnTheScreen();
  });
});
