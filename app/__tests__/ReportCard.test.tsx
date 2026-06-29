import { render, screen } from '@testing-library/react-native';
import { ReportCard } from '../src/components/ReportCard';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATE_LABELS,
} from '../src/mocks/reports';
import type { Report } from '../src/types';

// La targeta navega amb router.push en prémer-la; només cal que existeixi.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const baseReport = {
  report_id: 'r1',
  title: 'Fanal trencat a la plaça',
  description: 'La llum no funciona',
  state: 'OPEN',
  priority: 'HIGH',
  category: 'LIGHTING',
  latitude: 41.5,
  longitude: 2.1,
  createdAt: new Date().toISOString(),
  createdBy: { nickname: 'anna', name: 'Anna', surname: 'Soler' },
} as unknown as Report;

describe('ReportCard', () => {
  it('mostra el títol, la prioritat, l\'estat, la categoria i l\'autor de la incidència', () => {
    render(<ReportCard report={baseReport} />);

    expect(screen.getByText('Fanal trencat a la plaça')).toBeOnTheScreen();
    expect(screen.getByText(PRIORITY_LABELS.HIGH.toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(STATE_LABELS.OPEN.toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(CATEGORY_LABELS.LIGHTING)).toBeOnTheScreen();
    expect(screen.getByText('@anna')).toBeOnTheScreen();
  });
});
