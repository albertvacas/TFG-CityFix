import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import IncidentDetailScreen from '../app/(app)/incident/[id]';
import type { Report } from '../src/types';

// El report el controla cada test (varia segons l'estat). Prefix "mock" perquè
// jest permeti referenciar-lo dins la factory de jest.mock (hoisting).
let mockReport: Report;
const mockTransitionReport = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('../src/components/IncidentMiniMap', () => ({ IncidentMiniMap: 'IncidentMiniMap' }));
jest.mock('../src/hooks/useReports', () => ({
  useReport: () => ({
    report: mockReport,
    loading: false,
    error: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    setReport: jest.fn(),
  }),
}));
jest.mock('../src/api/reports', () => ({
  transitionReport: (...args: unknown[]) => mockTransitionReport(...args),
  addComment: jest.fn(),
  uploadReportImage: jest.fn(),
}));
// El tècnic 'tec1' és qui té assignada la incidència.
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { user_id: 't1', role: 'TECHNICAL', nickname: 'tec1' } }),
}));

const baseReport = {
  report_id: 'r1',
  title: 'Fanal trencat',
  description: 'La llum no funciona',
  priority: 'HIGH',
  category: 'LIGHTING',
  latitude: 41.5,
  longitude: 2.1,
  createdAt: new Date().toISOString(),
  createdBy: { nickname: 'anna', email: null },
  assignedTo: { nickname: 'tec1' },
  images: [],
  comments: [],
} as unknown as Report;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('IncidentDetailScreen — accions del tècnic', () => {
  it('en estat ASSIGNED, el tècnic assignat pot iniciar-la i s\'envia l\'event START', async () => {
    mockReport = { ...baseReport, state: 'ASSIGNED' } as Report;
    mockTransitionReport.mockResolvedValue({ ...baseReport, state: 'IN_PROGRESS' });

    render(<IncidentDetailScreen />);

    const startButton = screen.getByText('Començar');
    expect(startButton).toBeOnTheScreen();

    fireEvent.press(startButton);

    await waitFor(() =>
      expect(mockTransitionReport).toHaveBeenCalledWith('r1', expect.objectContaining({ event: 'START' })),
    );
  });

  it('en estat IN_PROGRESS, es mostra l\'acció per marcar-la com a resolta', () => {
    mockReport = { ...baseReport, state: 'IN_PROGRESS' } as Report;

    render(<IncidentDetailScreen />);

    // El tècnic veu l'entrada al flux de resolució (RESOLVE).
    expect(screen.getByText('Marcar resolta')).toBeOnTheScreen();
    expect(screen.getByText('Foto de progrés')).toBeOnTheScreen();
  });

  it('obre el modal de resolució en prémer "Marcar resolta"', () => {
    mockReport = { ...baseReport, state: 'IN_PROGRESS' } as Report;

    render(<IncidentDetailScreen />);
    fireEvent.press(screen.getByText('Marcar resolta'));

    expect(screen.getByText('Marcar com a resolta')).toBeOnTheScreen();
    expect(screen.getByText('Foto de resolució *')).toBeOnTheScreen();
  });
});
