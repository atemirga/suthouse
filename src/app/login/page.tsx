export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { next?: string; error?: string };
}

export default function LoginPage({ searchParams }: Props) {
  const next = searchParams.next || '/';
  const error = searchParams.error;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        method="POST"
        action="/api/auth/login"
        className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 w-full max-w-sm space-y-5"
      >
        <div>
          <div className="text-xl font-bold text-brand-700">SUT HOUSE</div>
          <div className="text-xs text-gray-500 uppercase tracking-wider">Финансы</div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            Неверный логин или пароль
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs text-gray-600">Логин</label>
          <input
            name="username"
            autoComplete="username"
            autoFocus
            required
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-gray-600">Пароль</label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
          />
        </div>

        <input type="hidden" name="next" value={next} />

        <button
          type="submit"
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm rounded px-3 py-2"
        >
          Войти
        </button>
      </form>
    </div>
  );
}
