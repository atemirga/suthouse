import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, signSession, COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';

// Строим публичный URL из заголовков прокси (nginx передаёт Host и X-Forwarded-Proto).
// req.url у Next.js за обратным прокси отражает внутренний адрес 127.0.0.1:3007 —
// если редиректить на него, браузер уходит на localhost.
function publicUrl(req: NextRequest, path: string): string {
  const host =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    new URL(req.url).host;
  const proto =
    (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() ||
    new URL(req.url).protocol.replace(':', '');
  const safePath = path.startsWith('/') ? path : '/' + path;
  return `${proto}://${host}${safePath}`;
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') || '';
  let username = '';
  let password = '';
  let next = '/';

  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    username = String(body.username || '');
    password = String(body.password || '');
    next = String(body.next || '/');
  } else {
    const form = await req.formData();
    username = String(form.get('username') || '');
    password = String(form.get('password') || '');
    next = String(form.get('next') || '/');
  }

  if (!verifyPassword(username, password)) {
    if (ct.includes('application/json')) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    const params = new URLSearchParams({ error: '1' });
    if (next && next !== '/') params.set('next', next);
    return NextResponse.redirect(publicUrl(req, '/login?' + params.toString()), 303);
  }

  const { token, expires } = signSession(username);
  const target = next.startsWith('/') ? next : '/';
  const isHttps = (req.headers.get('x-forwarded-proto') || '').includes('https');

  const res = ct.includes('application/json')
    ? NextResponse.json({ ok: true, next: target })
    : NextResponse.redirect(publicUrl(req, target), 303);

  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return res;
}
