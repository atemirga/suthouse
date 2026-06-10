import '@/lib/presentation'; // режим презентации: маскировка цифр (SSR), см. файл
import './globals.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySession, COOKIE_NAME } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'SUT HOUSE — Финансовая отчётность',
  description: 'ОПиУ, ДДС по данным из 1С:УНФ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const session = verifySession(cookies().get(COOKIE_NAME)?.value);

  if (!session) {
    // Без сайдбара — middleware редиректит на /login, но обеспечим корректный рендер.
    return (
      <html lang="ru">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="ru">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <div className="min-h-screen flex bg-gray-50">
          <Sidebar user={session.user} />
          <main className="flex-1 min-w-0 max-w-full p-3 md:p-6 overflow-auto md:max-w-[calc(100vw-16rem)] pt-14 md:pt-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
