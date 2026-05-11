import './globals.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySession, COOKIE_NAME } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'SUT HOUSE — Финансовая отчётность',
  description: 'ОПиУ, ДДС, РНП по данным из 1С:УНФ',
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
      <body>
        <div className="min-h-screen flex bg-gray-50">
          <Sidebar user={session.user} />
          <main className="flex-1 p-6 overflow-auto max-w-[calc(100vw-15rem)]">{children}</main>
        </div>
      </body>
    </html>
  );
}
