import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import logo from '../assets/logo.png';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Credencials incorrectes o no tens permisos d\'administrador.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src={logo} alt="CampusFix" className="mx-auto mb-4 h-20 w-20 rounded-2xl shadow-sm" />
          <h1 className="text-3xl font-bold text-indigo-600">CampusFix</h1>
          <p className="mt-2 text-gray-600 dark:text-slate-400">{t('app.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
          <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-slate-100">{t('login.title')}</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
              {t('login.email')}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
              placeholder="admin@exemple.com"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
              {t('login.password')}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? t('login.loading') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
