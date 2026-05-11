// Middleware: гейт всех страниц и API кроме /login и /api/auth/*.
// Проверяет cookie suthouse_auth (HMAC). Если нет/протухла — редирект на /login.
//
// Edge runtime ограничен — нельзя использовать crypto.scryptSync.
// Поэтому здесь только верификация HMAC-подписи (это же делает src/lib/auth.ts,
// но дублируем тут чтобы не тащить node:crypto из middleware).
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'suthouse_auth';
const SECRET = process.env.AUTH_SECRET || '';

const PUBLIC_PATHS = [/^\/login$/, /^\/api\/auth(\/|$)/];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((rx) => rx.test(path));
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

function b64urlToBytes(s: string): Uint8Array {
  // base64url → base64
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

async function isValidToken(token: string | undefined): Promise<boolean> {
  if (!token || !SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [data, sig] = parts;
  const expected = await hmacSha256(SECRET, data);
  let provided: Uint8Array;
  try {
    provided = b64urlToBytes(sig);
  } catch {
    return false;
  }
  if (!bytesEqual(provided, expected)) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(data)));
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = await isValidToken(token);
  if (ok) return NextResponse.next();

  // API → 401, страницы → редирект
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
