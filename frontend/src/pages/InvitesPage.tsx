import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getInvites, createInvite, revokeInvite } from '../api/invites';
import { getPrivilegedUsers, searchUsers, setUserActive, deleteUser } from '../api/users';
import Avatar from '../components/Avatar';
import Pagination from '../components/Pagination';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Invite, User, InviteStatus, UserSearchResult } from '../types';

const PAGE_SIZE = 10;

const statusConfig: Record<InviteStatus, { labelKey: string; className: string }> = {
  PENDING: { labelKey: 'invites.statusPending', className: 'bg-green-100 text-green-700' },
  USED: { labelKey: 'invites.statusUsed', className: 'bg-gray-100 text-gray-600' },
  REVOKED: { labelKey: 'invites.statusRevoked', className: 'bg-red-100 text-red-700' },
};

const expiredConfig = { labelKey: 'invites.statusExpired', className: 'bg-amber-100 text-amber-700' };

const isExpired = (inv: Invite): boolean =>
  inv.status === 'PENDING' && new Date(inv.expiresAt).getTime() < Date.now();

type TFunc = ReturnType<typeof useTranslation>['t'];

const formatExpiresIn = (iso: string, t: TFunc): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return t('invites.statusExpired');
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return t('invites.expiresInDays', { count: days });
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return t('invites.expiresInHours', { count: hours });
  const mins = Math.max(1, Math.floor(ms / 60000));
  return t('invites.expiresInMin', { count: mins });
};

export default function InvitesPage() {
  const { t } = useTranslation();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesPage, setInvitesPage] = useState(1);
  const [invitesTotal, setInvitesTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'TECHNICAL'>('TECHNICAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdToken, setCreatedToken] = useState('');

  // Account management state (block / unblock / delete)
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [manageError, setManageError] = useState('');

  // Revoke invite state
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);
  const [revokeInviteError, setRevokeInviteError] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const fetchPrivileged = (page: number) => {
    return getPrivilegedUsers(page, PAGE_SIZE)
      .then((res) => { setUsers(res.items); setUsersTotal(res.total); })
      .catch(() => {});
  };

  const fetchInvites = (page: number) => {
    return getInvites(page, PAGE_SIZE)
      .then((res) => { setInvites(res.items); setInvitesTotal(res.total); })
      .catch(() => {});
  };

  // Cerca d'usuaris. includeInactive=true perquè l'admin pugui gestionar
  // (reactivar) també els comptes bloquejats.
  const runSearch = (page: number) => {
    setSearchLoading(true);
    return searchUsers(searchQuery.trim(), true, page, PAGE_SIZE)
      .then((res) => { setSearchResults(res.items); setSearchTotal(res.total); setSearched(true); })
      .catch(() => { setSearchResults([]); setSearchTotal(0); })
      .finally(() => setSearchLoading(false));
  };

  // Càrrega inicial dels admins/tècnics i les invitacions.
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchPrivileged(usersPage), fetchInvites(invitesPage)]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recàrrega quan canvia la pàgina de cada taula.
  useEffect(() => { fetchPrivileged(usersPage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [usersPage]);
  useEffect(() => { fetchInvites(invitesPage); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [invitesPage]);

  // Cerca amb debounce quan canvia el text o la pàgina de resultats.
  useEffect(() => {
    const handle = setTimeout(() => runSearch(searchPage), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchPage]);

  // En canviar el text de cerca, tornem a la primera pàgina de resultats.
  useEffect(() => { setSearchPage(1); }, [searchQuery]);

  // Refresc en viu via SSE: quan algú crea, revoca o —sobretot— consumeix una
  // invitació en registrar-se amb el token, el panell s'actualitza a l'instant.
  // En el cas `invite.used` també recarreguem els usuaris privilegiats perquè
  // el nou ADMIN/TECHNICAL hi aparegui sense recarregar la pàgina.
  useLiveEvent('invite.created', () => { fetchInvites(invitesPage); });
  useLiveEvent('invite.revoked', () => { fetchInvites(invitesPage); });
  useLiveEvent('invite.used', () => { fetchInvites(invitesPage); fetchPrivileged(usersPage); });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setCreatedToken('');
    setSubmitting(true);
    try {
      const invite = await createInvite(email, role);
      setCreatedToken(invite.token);
      setEmail('');
      fetchInvites(invitesPage);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error creant la invitació.');
    } finally {
      setSubmitting(false);
    }
  };

  // Refresca usuaris privilegiats i resultats de cerca després d'una acció.
  const refreshAfterAction = () => {
    fetchPrivileged(usersPage);
    runSearch(searchPage);
  };

  const handleToggleActive = async (userId: string, currentlyActive: boolean) => {
    if (!confirm(currentlyActive ? t('invites.confirmBlock') : t('invites.confirmReactivate'))) return;
    setManageError('');
    setBusyUserId(userId);
    try {
      await setUserActive(userId, !currentlyActive);
      refreshAfterAction();
    } catch (err: any) {
      setManageError(err?.response?.data?.error ?? err?.message ?? t('common.error'));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDelete = async (userId: string, label: string) => {
    if (!confirm(t('invites.confirmDelete', { label }))) return;
    setManageError('');
    setBusyUserId(userId);
    try {
      await deleteUser(userId);
      refreshAfterAction();
    } catch (err: any) {
      setManageError(err?.response?.data?.error ?? err?.message ?? t('common.error'));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevokeInvite = async (inviteId: string, email: string) => {
    if (!confirm(t('invites.confirmRevoke', { email }))) return;
    setRevokeInviteError('');
    setRevokingInvite(inviteId);
    try {
      await revokeInvite(inviteId);
      fetchInvites(invitesPage);
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
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t('invites.title')}</h1>

      {manageError && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{manageError}</div>
      )}

      {/* ---- CERCA D'USUARIS ---- */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('invites.userSearch')}</h2>

        <div className="mb-4 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('invites.searchPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {searchLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">{t('invites.searching')}</div>
        ) : searchResults.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center ring-1 ring-gray-200">
            <p className="text-gray-500">{searched ? t('invites.noUserFound') : t('invites.typeToSearch')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colUser')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colEmail')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colRole')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colPoints')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colTechData')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colResolved')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colStatus')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {searchResults.map((u) => (
                  <tr key={u.user_id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} surname={u.surname} url={u.avatarUrl} size={36} />
                        <div>
                          <p className="font-medium text-gray-900">{u.name} {u.surname}</p>
                          <p className="text-xs text-gray-400">@{u.nickname}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        u.role === 'TECHNICAL' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-700'
                      }`}>
                        {u.role === 'TECHNICAL' ? t('invites.technician') : t('invites.student')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.role === 'STUDENT' ? `${u.points} pts` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {u.role === 'TECHNICAL' ? (
                        <>
                          {u.position && <div>{u.position}</div>}
                          {u.company && <div className="text-gray-400">{u.company}</div>}
                          {u.workCategory && <div className="text-gray-400">{t(`categories.${u.workCategory}`)}</div>}
                          {!u.position && !u.company && !u.workCategory && '—'}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.solvedCount}</td>
                    <td className="px-4 py-3">
                      {u.active ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('invites.active')}</span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{t('invites.blocked')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <UserActions
                        userId={u.user_id}
                        active={u.active}
                        isRoot={u.isRoot}
                        busy={busyUserId === u.user_id}
                        onToggle={() => handleToggleActive(u.user_id, u.active)}
                        onDelete={() => handleDelete(u.user_id, `${u.name} ${u.surname}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!searchLoading && (
          <Pagination
            page={searchPage}
            pageSize={PAGE_SIZE}
            total={searchTotal}
            onPageChange={setSearchPage}
            label="users"
          />
        )}
      </section>

      {/* ---- USUARIS PRIVILEGIATS ---- */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('invites.privilegedTitle')}</h2>

        {users.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
            <p className="text-gray-500">{t('invites.noPrivileged')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colName')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colEmail')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colRole')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colStatus')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colDate')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} surname={u.surname} url={u.avatarUrl} size={36} />
                        <div>
                          <p className="font-medium text-gray-900">{u.name} {u.surname}</p>
                          <p className="text-xs text-gray-400">@{u.nickname}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {u.role === 'ADMIN' ? t('invites.administrator') : t('invites.technician')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.active ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">{t('invites.active')}</span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{t('invites.blocked')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString('ca-ES')}
                    </td>
                    <td className="px-4 py-3">
                      <UserActions
                        userId={u.user_id}
                        active={u.active}
                        isRoot={u.isRoot}
                        busy={busyUserId === u.user_id}
                        onToggle={() => handleToggleActive(u.user_id, u.active)}
                        onDelete={() => handleDelete(u.user_id, `${u.name} ${u.surname}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <Pagination
            page={usersPage}
            pageSize={PAGE_SIZE}
            total={usersTotal}
            onPageChange={setUsersPage}
            label="users"
          />
        )}
      </section>

      {/* ---- CREAR INVITACIÓ ---- */}
      <section className="mb-10">
        <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('invites.createInvite')}</h2>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('invites.emailLabel')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder={t('invites.emailPlaceholder')}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('invites.role')}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'ADMIN' | 'TECHNICAL')}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="TECHNICAL">{t('invites.technician')}</option>
                <option value="ADMIN">{t('invites.administrator')}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? t('invites.creating') : t('invites.createBtn')}
            </button>
          </form>

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {createdToken && (
            <div className="mt-4 rounded-lg bg-green-50 px-4 py-4 ring-1 ring-green-200">
              <p className="mb-2 text-sm font-semibold text-green-800">{t('invites.inviteCreated')}</p>
              <p className="mb-1 text-sm text-green-700">
                {t('invites.sendToken')}
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
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('invites.invitesHistory')}</h2>

        {revokeInviteError && (
          <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{revokeInviteError}</div>
        )}

        {invites.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
            <p className="text-gray-500">{t('invites.noInvites')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colEmail')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colRole')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colToken')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colStatus')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colExpiry')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colDate')}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t('invites.colActions')}</th>
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
                          {inv.role === 'ADMIN' ? t('invites.administrator') : t('invites.technician')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-gray-500">{inv.token.slice(0, 12)}...</code>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge.className}`}>
                          {t(statusBadge.labelKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {inv.status === 'PENDING' ? formatExpiresIn(inv.expiresAt, t) : '—'}
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
                            {revokingInvite === inv.id ? '...' : t('invites.revoke')}
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

        {!loading && (
          <Pagination
            page={invitesPage}
            pageSize={PAGE_SIZE}
            total={invitesTotal}
            onPageChange={setInvitesPage}
            label="invites"
          />
        )}
      </section>
    </div>
  );
}

function UserActions({
  active,
  busy,
  isRoot,
  onToggle,
  onDelete,
}: {
  userId: string;
  active: boolean;
  busy: boolean;
  isRoot?: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  // L'admin master no es pot bloquejar ni eliminar mai: en lloc dels botons
  // mostrem un indicador de compte protegit (coherent amb el guard del backend).
  if (isRoot) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {t('invites.protectedAccount')}
      </span>
    );
  }
  return (
    <div className="flex gap-2">
      <button
        onClick={onToggle}
        disabled={busy}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
          active ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {busy ? '...' : active ? t('invites.block') : t('invites.reactivate')}
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? '...' : t('invites.delete')}
      </button>
    </div>
  );
}
