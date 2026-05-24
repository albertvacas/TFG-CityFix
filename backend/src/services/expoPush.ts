/**
 * Client mínim per a l'API HTTP de Expo Push Notifications.
 *
 * Per què no fem servir el SDK oficial `expo-server-sdk`: aquí només calen
 * dos endpoints (`/send` i `/getReceipts`) i evitem una dependència extra.
 *
 * Documentació: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export interface ExpoPushMessage {
  to: string; // ExponentPushToken[xxx]
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
  channelId?: string; // Android 8+
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string; // Receipt id (només si status='ok')
  message?: string;
  details?: { error?: string; expoPushToken?: string };
}

export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Envia un lot de missatges a Expo. La API admet fins a 100 missatges per crida,
 * però aquí mantenim els lots curts (≤ 100) per simplicitat — el TFG no
 * envia ràfegues massives.
 *
 * Important: la resposta ets *tickets* (encolat acceptat), no rebuts (entregat).
 * Per saber si realment s'ha entregat cal consultar `getReceipts` minuts després.
 */
export const sendPushBatch = async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> => {
  if (messages.length === 0) return [];

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo Push HTTP ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown };
  if (!json.data) {
    throw new Error(`Expo Push resposta inesperada: ${JSON.stringify(json)}`);
  }
  return json.data;
};

/**
 * Consulta els receipts d'un conjunt de ticket-ids retornats per `sendPushBatch`.
 * Aquí veurem `DeviceNotRegistered` i altres errors definitius que ens diuen
 * que cal desactivar el token a la nostra BD.
 */
export const fetchReceipts = async (
  ids: string[],
): Promise<Record<string, ExpoPushReceipt>> => {
  if (ids.length === 0) return {};

  const response = await fetch(EXPO_RECEIPTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    throw new Error(`Expo Receipts HTTP ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as { data?: Record<string, ExpoPushReceipt> };
  return json.data ?? {};
};

/**
 * Heurística senzilla per validar un Expo Push Token. Així evitem fer una
 * crida HTTP si el client envia escombraries.
 */
export const isValidExpoPushToken = (token: string): boolean => {
  return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token) || /^ExpoPushToken\[[A-Za-z0-9_-]+\]$/.test(token);
};
