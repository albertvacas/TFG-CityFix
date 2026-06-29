import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import CreateScreen from '../app/(app)/(tabs)/create';
import { CATEGORY_LABELS } from '../src/mocks/reports';

const mockCreateReport = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 41.51, longitude: 2.11 } }),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../src/components/LocationPicker', () => ({ LocationPicker: 'LocationPicker' }));
jest.mock('../src/api/reports', () => ({
  createReport: (...args: unknown[]) => mockCreateReport(...args),
  uploadReportImage: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockCreateReport.mockResolvedValue({ report_id: 'new1' });
});

describe('CreateScreen (reportar una incidència — alumne)', () => {
  it('renderitza el formulari amb els camps obligatoris', () => {
    render(<CreateScreen />);
    expect(screen.getByText('Nova incidència')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Ex: Fanal trencat a la plaça')).toBeOnTheScreen();
    expect(screen.getByText('Enviar incidència')).toBeOnTheScreen();
  });

  it('envia la incidència amb el títol, la descripció i la categoria escollits', async () => {
    render(<CreateScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Ex: Fanal trencat a la plaça'),
      'Fanal trencat',
    );
    fireEvent.changeText(
      screen.getByPlaceholderText('Explica amb detall què passa...'),
      'La llum no funciona des de fa dies',
    );
    fireEvent.press(screen.getByText(CATEGORY_LABELS.LIGHTING));
    fireEvent.press(screen.getByText('Enviar incidència'));

    await waitFor(() =>
      expect(mockCreateReport).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fanal trencat',
          description: 'La llum no funciona des de fa dies',
          category: 'LIGHTING',
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        }),
      ),
    );
  });
});
