import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { updateMyProfile } from '../api/users';
import { LANGUAGES } from '../i18n';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const { preference, setPreference } = useTheme();

  const [name, setName] = useState(user?.name ?? '');
  const [surname, setSurname] = useState(user?.surname ?? '');
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await updateMyProfile({
        name: name.trim(),
        surname: surname.trim(),
        nickname: nickname.trim(),
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t('common.error');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
        {t('settings.title')}
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{t('settings.subtitle')}</p>

      {/* Perfil */}
      <form
        onSubmit={onSubmit}
        className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700"
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
          {t('settings.profile')}
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {saved && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            <Check size={16} /> {t('settings.saved')}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.name')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
            />
          </Field>
          <Field label={t('settings.surname')}>
            <input
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              className="input"
              required
            />
          </Field>
          <Field label={t('settings.nickname')}>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="input"
            />
          </Field>
          <Field label={t('settings.email')}>
            <input
              value={user?.email ?? ''}
              disabled
              className="input cursor-not-allowed opacity-60"
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </form>

      {/* Aparença */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-slate-100">
          {t('settings.appearance')}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">{t('settings.theme')}</p>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            const active = preference === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreference(opt.value)}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-sm font-medium transition-colors ${
                  active
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50'
                }`}
              >
                <Icon size={22} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Idioma */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-slate-100">
          {t('settings.language')}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">
          {t('settings.languageDesc')}
        </p>
        <div className="flex flex-wrap gap-3">
          {LANGUAGES.map((lang) => {
            const active = i18n.language.startsWith(lang.code);
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => i18n.changeLanguage(lang.code)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/50'
                }`}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  );
}
