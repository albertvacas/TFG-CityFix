import { useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Wrench,
  CheckCircle2,
  Map as MapIcon,
  KeyRound,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useEventStream, type DashboardEvent } from '../hooks/useEventStream';
import { emitLiveEvent } from '../hooks/liveEvents';

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Incidències', icon: ClipboardList },
  { to: '/assignments', label: 'Assignacions', icon: Wrench },
  { to: '/validations', label: 'Validacions', icon: CheckCircle2 },
  { to: '/map', label: 'Mapa', icon: MapIcon },
  { to: '/invites', label: 'Invitacions', icon: KeyRound },
];

export default function Layout() {
  const { user, logout } = useAuth();

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
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-5">
          <h1 className="text-xl font-bold text-indigo-600">CityFix</h1>
          <p className="text-xs text-gray-500">Panel d'Administració</p>
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
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <Icon size={18} strokeWidth={2} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="mb-3 text-sm">
            <p className="font-medium text-gray-900">{user?.name} {user?.surname}</p>
            <p className="text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
          >
            <LogOut size={16} strokeWidth={2} />
            Tancar sessió
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
