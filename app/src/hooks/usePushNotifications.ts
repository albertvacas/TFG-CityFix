import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { registerPushToken, unregisterPushToken } from '../api/notifications';

/**
 * Configuració global del comportament quan arriba una notificació amb l'app
 * en primer pla. Per defecte Expo no mostraria res (assumint que la pròpia
 * UI ja reflecteix el canvi); aquí forcem mostrar el banner perquè l'usuari
 * vegi el missatge encara que estigui dins l'app.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * A Android cal definir un "channel" per cada categoria de notificació
 * (Android 8+). Aquí n'hi ha prou amb un canal per defecte; si en el futur
 * volem agrupar per tipus, en podem afegir més.
 */
const ensureAndroidChannel = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notificacions',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4f46e5',
  });
};

/**
 * Demana permisos i obté l'Expo Push Token. Retorna null si l'usuari nega
 * permisos o si l'aparell no els admet (emulador iOS, etc.).
 */
const obtainPushToken = async (): Promise<string | null> => {
  // Push notifications requereixen un dispositiu físic (excepte Android amb
  // FCM al simulador). Si no és físic, sortim aviat per evitar errors.
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  // El projectId d'Expo cal per identificar l'app dins el servei de push.
  // S'agafa de `expo.extra.eas.projectId` (en standalone) o de l'app.json.
  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenResponse.data;
};

/**
 * Hook que gestiona tot el cicle de vida de les push notifications:
 *
 *   1. Quan hi ha usuari autenticat: demana permisos, obté el token Expo i
 *      el registra al backend (POST /notifications/tokens).
 *   2. Registra dos listeners:
 *        - `addNotificationResponseReceivedListener`: dispara quan l'usuari
 *          tapeja una notificació (sigui amb l'app oberta, en background o
 *          tancada). Si la dada inclou `reportId`, fem deep-link al detall.
 *        - `addNotificationReceivedListener`: dispara quan arriba una notif
 *          amb l'app oberta. Es pot fer servir per refrescar dades o mostrar
 *          un toast custom (per ara, el handler global ja mostra banner).
 *   3. Quan l'usuari fa logout (userId passa de string a null), no esborrem
 *      el token: el LogoutFlow del context ja crida `unregisterPushToken`.
 */
export const usePushNotifications = (userId: string | null): void => {
  const tokenRef = useRef<string | null>(null);

  // Registra el token quan canvia l'usuari autenticat.
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    (async () => {
      try {
        await ensureAndroidChannel();
        const token = await obtainPushToken();
        if (!token || cancelled) return;
        tokenRef.current = token;
        await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
      } catch (err) {
        console.warn('[push] No s\'ha pogut registrar el token:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Listeners — només cal una vegada, no depèn del userId.
  useEffect(() => {
    // L'usuari ha tapejat una notificació → deep-link a la incidència.
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        reportId?: string | null;
      };
      if (data?.reportId) {
        router.push(`/incident/${data.reportId}` as any);
      }
    });

    // Notificació rebuda amb l'app en primer pla. El handler global ja la
    // mostra; aquí podríem actualitzar un badge global. Per ara loguem.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[push] Notificació rebuda:', notification.request.content.title);
    });

    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, []);
};

/**
 * Cancel·la el registre del token actual al backend. Cridar al fer logout
 * perquè aquest dispositiu deixi de rebre notificacions de l'usuari que
 * acaba de tancar sessió.
 */
export const detachPushToken = async (): Promise<void> => {
  try {
    if (!Device.isDevice) return;
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (tokenResponse?.data) {
      await unregisterPushToken(tokenResponse.data);
    }
  } catch {
    // Si fallem aquí (sense xarxa, etc.), no bloquegem el logout.
  }
};
