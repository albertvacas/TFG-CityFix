import { useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ClipboardList,
  Wrench,
  CheckCircle2,
  Map as MapIcon,
  KeyRound,
  Trophy,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import logo from '../assets/logo.png';
import { useEventStream, type DashboardEvent } from '../hooks/useEventStream';
import { emitLiveEvent } from '../hooks/liveEvents';

const navItems: { to: string; key: string; icon: LucideIcon }[] = [
  { to: '/', key: 'dashboard', icon: LayoutDashboard },
  { to: '/reports', key: 'reports', icon: ClipboardList },
  { to: '/assignments', key: 'assignments', icon: Wrench },
  { to: '/validations', key: 'validations', icon: CheckCircle2 },
  { to: '/map', key: 'map', icon: MapIcon },
  { to: '/points', key: 'points', icon: Trophy },
  { to: '/invites', key: 'invites', icon: KeyRound },
  { to: '/settings', key: 'settings', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();

  // Re-emet cada esdeveniment SSE al bus intern perquè les pàgines hi puguin
  // reaccionar (refrescar la llista, actualitzar el mapa, etc.) sense
  // necessitat d'obrir-se cada una la seva connexió.
  const onEvent = useCallback((event: DashboardEvent) => {
    emitLiveEvent(event);
  }, []);

  // Només els admins arriben aquí (passen per ProtectedRoute), però per
  // precaució també condicionem per rol.
  useEventStream(user?.role === 'ADMIN', onEvent);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-900">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-5 dark:border-slate-700">
          <img src={logo} alt="CampusFix" className="h-10 w-10 rounded-lg" />
          <div>
            <h1 className="text-xl font-bold text-indigo-600">CampusFix</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('app.subtitle')}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                  }`
                }
              >
                <Icon size={18} strokeWidth={2} />
                {t(`nav.${item.key}`)}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-4 dark:border-slate-700">
          <div className="mb-3 text-sm">
            <p className="font-medium text-gray-900 dark:text-slate-100">{user?.name} {user?.surname}</p>
            <p className="text-gray-500 dark:text-slate-400">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <LogOut size={16} strokeWidth={2} />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
