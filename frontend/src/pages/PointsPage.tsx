import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trophy, Sparkles } from 'lucide-react';
import { getLeaderboard, getAllPointsTransactions } from '../api/gamification';
import { searchUsers } from '../api/users';
import PriorityBadge from '../components/PriorityBadge';
import Avatar from '../components/Avatar';
import Pagination from '../components/Pagination';
import type { LeaderboardEntry, PointsTransaction, UserSearchResult } from '../types';
import { POINTS_BY_PRIORITY } from '../types';
import { useLiveEvent } from '../hooks/liveEvents';

const TX_PAGE_SIZE = 25;

export default function PointsPage() {
  const { t } = useTranslation();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState({ totalAwarded: 0, totalTransactions: 0, uniqueUsers: 0 });
  const [loading, setLoading] = useState(true);

  // Cercador d'usuaris per filtrar les transaccions. A diferència del desplegable
  // anterior (limitat al top-20 del rànquing), consulta el backend i permet
  // filtrar per qualsevol usuari encara que n'hi hagi milers.
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<UserSearchResult[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [selectedUserLabel, setSelectedUserLabel] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [lb, tx] = await Promise.all([
        getLeaderboard(20),
        getAllPointsTransactions({
          userId: filterUserId || undefined,
          page,
          pageSize: TX_PAGE_SIZE,
        }),
      ]);
      setLeaderboard(lb);
      setTransactions(tx.items);
      setStats({
        totalAwarded: tx.totalAmount,
        totalTransactions: tx.total,
        uniqueUsers: tx.uniqueUsers,
      });
    } finally {
      setLoading(false);
    }
  }, [filterUserId, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // En canviar el filtre d'usuari, tornem a la primera pàgina.
  useEffect(() => {
    setPage(1);
  }, [filterUserId]);

  // Cerca d'usuaris amb debounce (300ms). Només estudiants/tècnics actius.
  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    setUserSearching(true);
    const handle = setTimeout(() => {
      searchUsers(q, false, 1, 8)
        .then((res) => setUserResults(res.items))
        .catch(() => setUserResults([]))
        .finally(() => setUserSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [userQuery]);

  // Tanca el desplegable de resultats si es clica fora.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pickUser = (u: UserSearchResult) => {
    setFilterUserId(u.user_id);
    setSelectedUserLabel(`${u.name} ${u.surname}`);
    setUserQuery('');
    setUserResults([]);
    setShowResults(false);
  };

  const clearUserFilter = () => {
    setFilterUserId('');
    setSelectedUserLabel('');
    setUserQuery('');
    setUserResults([]);
  };

  // Refresc en temps real quan algun report es tanca i s'atorguen punts.
  useLiveEvent('points.awarded', fetchData);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('points.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('points.subtitle')}
        </p>
      </div>

      {/* Targetes resum */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label={t('points.totalAwarded')}
          value={`${stats.totalAwarded} ${t('points.pts')}`}
          color="indigo"
        />
        <StatCard
          label={t('points.transactions')}
          value={String(stats.totalTransactions)}
          color="emerald"
        />
        <StatCard
          label={t('points.rewardedStudents')}
          value={String(stats.uniqueUsers)}
          color="amber"
        />
      </div>

      {/* Escala explicativa */}
      <div className="mb-6 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('points.scaleTitle')}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <PriorityBadge priority={p} />
              <span className="text-base font-bold text-gray-900">
                +{POINTS_BY_PRIORITY[p]}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {t('points.scaleNote')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Leaderboard */}
        <section className="rounded-xl bg-white p-5 ring-1 ring-gray-200 lg:col-span-1">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Trophy size={18} className="text-amber-500" />
            {t('points.ranking')}
          </h2>
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">{t('common.loading')}</div>
          ) : leaderboard.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {t('points.noStudents')}
            </div>
          ) : (
            <ol className="space-y-1">
              {leaderboard.map((u, idx) => (
                <li
                  key={u.user_id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                    idx < 3 ? 'bg-amber-50 dark:bg-amber-400/10' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        idx === 0
                          ? 'bg-amber-500 text-white'
                          : idx === 1
                          ? 'bg-gray-400 text-white'
                          : idx === 2
                          ? 'bg-amber-700 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <Avatar name={u.name} surname={u.surname} url={u.avatarUrl} size={36} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {u.name} {u.surname}
                      </p>
                      <p className="text-xs text-gray-500">@{u.nickname}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-indigo-600">
                    {u.points} {t('points.pts')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Historial de transaccions */}
        <section className="rounded-xl bg-white p-5 ring-1 ring-gray-200 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Sparkles size={18} className="text-indigo-500" />
              {t('points.txHistory')}
            </h2>
            <div className="relative w-64" ref={searchBoxRef}>
              {filterUserId ? (
                // Filtre actiu: mostrem l'usuari seleccionat amb un botó per treure'l.
                <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm">
                  <span className="truncate font-medium text-indigo-800">{selectedUserLabel}</span>
                  <button
                    type="button"
                    onClick={clearUserFilter}
                    title={t('points.clearFilter')}
                    className="shrink-0 text-indigo-500 hover:text-indigo-700"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={userQuery}
                    onChange={(e) => { setUserQuery(e.target.value); setShowResults(true); }}
                    onFocus={() => setShowResults(true)}
                    placeholder={t('points.searchUserPlaceholder')}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  {showResults && userQuery.trim().length >= 2 && (
                    <div className="absolute right-0 z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-gray-200">
                      {userSearching ? (
                        <p className="px-3 py-2 text-xs text-gray-400">{t('points.searching')}</p>
                      ) : userResults.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">{t('points.noUserFound')}</p>
                      ) : (
                        userResults.map((u) => (
                          <button
                            key={u.user_id}
                            type="button"
                            onClick={() => pickUser(u)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                          >
                            <Avatar name={u.name} surname={u.surname} url={u.avatarUrl} size={28} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-gray-900">{u.name} {u.surname}</span>
                              <span className="block truncate text-xs text-gray-400">@{u.nickname}</span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">{t('common.loading')}</div>
          ) : transactions.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {t('points.noTransactions')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="py-2 pr-3">{t('points.colDate')}</th>
                    <th className="py-2 pr-3">{t('points.colUser')}</th>
                    <th className="py-2 pr-3">{t('points.colIncident')}</th>
                    <th className="py-2 pr-3">{t('points.colCategory')}</th>
                    <th className="py-2 pr-3">{t('points.colPriority')}</th>
                    <th className="py-2 pr-3 text-right">{t('points.colPoints')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-3 text-xs text-gray-500">
                        {new Date(tx.createdAt).toLocaleString('ca-ES', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-gray-900">
                          {tx.user?.name} {tx.user?.surname}
                        </p>
                        <p className="text-xs text-gray-500">@{tx.user?.nickname}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <Link
                          to={`/reports/${tx.report.report_id}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {tx.report.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-600">
                        {tx.report.category ? t(`categories.${tx.report.category}`) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <PriorityBadge priority={tx.priority} />
                      </td>
                      <td className="py-2 pr-3 text-right text-base font-bold text-indigo-600">
                        +{tx.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && (
            <Pagination
              page={page}
              pageSize={TX_PAGE_SIZE}
              total={stats.totalTransactions}
              onPageChange={setPage}
              label="transactions"
            />
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'indigo' | 'emerald' | 'amber';
}) {
  const palette = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }[color];
  return (
    <div className={`rounded-xl border p-4 ${palette}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
