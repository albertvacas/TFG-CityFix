import { useEffect, useState, type FormEvent } from 'react';
import { getInvites, createInvite, revokeInvite } from '../api/invites';
import { getPrivilegedUsers, revokeUser } from '../api/users';
import type { Invite, User, InviteStatus } from '../types';

const statusConfig: Record<InviteStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendent', className: 'bg-green-100 text-green-700' },
  USED: { label: 'Utilitzada', className: 'bg-gray-100 text-gray-600' },
  REVOKED: { label: 'Revocada', className: 'bg-red-100 text-red-700' },
};

const expiredConfig = { label: 'Caducada', className: 'bg-amber-100 text-amber-700' };

const isExpired = (inv: Invite): boolean =>
  inv.status === 'PENDING' && new Date(inv.expiresAt).getTime() < Date.now();

const formatExpiresIn = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'Caducada';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `En ${days} ${days === 1 ? 'dia' : 'dies'}`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `En ${hours} h`;
  const mins = Math.max(1, Math.floor(ms / 60000));
  return `En ${mins} min`;
};

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'TECHNICAL'>('TECHNICAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdToken, setCreatedToken] = useState('');

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState('');

  // Revoke invite state
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);
  const [revokeInviteError, setRevokeInviteError] = useState('');

  const fetchData = () => {
    setLoading(true);
    Promise.all([getInvites(), getPrivilegedUsers()])
      .then(([inv, usr]) => { setInvites(inv); setUsers(usr); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setCreatedToken('');
    setSubmitting(true);
    try {
      const invite = await createInvite(email, role);
      setCreatedToken(invite.token);
      setEmail('');
      fetchData();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error creant la invitació.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (userId: string) => {
    if (!confirm('Estàs segur que vols revocar l\'accés d\'aquest usuari?')) return;
    setRevokeError('');
    setRevoking(userId);
    try {
      await revokeUser(userId);
      fetchData();
    } catch (err: unknown) {
      if (err instanceof Error) setRevokeError(err.message);
      else setRevokeError('Error revocant l\'usuari.');
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeInvite = async (inviteId: string, email: string) => {
    if (!confirm(`Vols anul·lar la invitació pendent per a ${email}?\n\nEl token deixarà de funcionar immediatament.`)) return;
    setRevokeInviteError('');
    setRevokingInvite(inviteId);
    try {
      await revokeInvite(inviteId);
      fetchData();
    } catch (err: unknown) {
      if (err instanceof Error) setRevokeInviteError(err.message);
      else setRevokeInviteError('Error revocant la invitació.');
    } finally {
      setRevokingInvite(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Gestió d'Accessos</h1>

      {/* ---- USUARIS PRIVILEGIATS ---- */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Usuaris Administradors i Tècnics</h2>

        {revokeError && (
          <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{revokeError}</div>
        )}

        {users.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
            <p className="text-gray-500">No hi ha usuaris privilegiats.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Nom</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Rol</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Estat</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Data</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Accions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.name} {u.surname}
                      <span className="ml-1 text-gray-400">@{u.nickname}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {u.role === 'ADMIN' ? 'Administrador' : 'Tècnic'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.active ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                          Actiu
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          Revocat
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString('ca-ES')}
                    </td>
                    <td className="px-4 py-3">
                      {u.active && (
                        <button
                          onClick={() => handleRevoke(u.user_id)}
                          disabled={revoking === u.user_id}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {revoking === u.user_id ? '...' : 'Revocar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- CREAR INVITACIÓ ---- */}
      <section className="mb-10">
        <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Crear nova invitació</h2>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Correu electrònic
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="persona@exemple.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Rol</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'ADMIN' | 'TECHNICAL')}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="TECHNICAL">Tècnic</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creant...' : 'Crear invitació'}
            </button>
          </form>

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {createdToken && (
            <div className="mt-4 rounded-lg bg-green-50 px-4 py-4 ring-1 ring-green-200">
              <p className="mb-2 text-sm font-semibold text-green-800">Invitació creada correctament!</p>
              <p className="mb-1 text-sm text-green-700">
                Envia aquest token a la persona perquè pugui registrar-se:
              </p>
              <code className="block break-all rounded bg-white px-3 py-2 text-xs text-gray-800 ring-1 ring-green-300">
                {createdToken}
              </code>
            </div>
          )}
        </div>
      </section>

      {/* ---- LLISTAT D'INVITACIONS ---- */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Historial d'invitacions</h2>

        {revokeInviteError && (
          <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{revokeInviteError}</div>
        )}

        {invites.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
            <p className="text-gray-500">No hi ha invitacions creades.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Rol</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Token</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Estat</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Caducitat</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Data</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Accions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {invites.map((inv) => {
                  const expired = isExpired(inv);
                  const statusBadge = expired ? expiredConfig : statusConfig[inv.status];
                  const canRevoke = inv.status === 'PENDING' && !expired;
                  return (
                    <tr key={inv.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          inv.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {inv.role === 'ADMIN' ? 'Administrador' : 'Tècnic'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-gray-500">{inv.token.slice(0, 12)}...</code>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge.className}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {inv.status === 'PENDING' ? formatExpiresIn(inv.expiresAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(inv.createdAt).toLocaleDateString('ca-ES')}
                      </td>
                      <td className="px-4 py-3">
                        {canRevoke ? (
                          <button
                            onClick={() => handleRevokeInvite(inv.id, inv.email)}
                            disabled={revokingInvite === inv.id}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                          >
                            {revokingInvite === inv.id ? '...' : 'Revocar'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
