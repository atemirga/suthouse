import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';

function publicUrl(req: NextRequest, path: string): string {
  const host =
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    new URL(req.url).host;
  const proto =
    (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() ||
    new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}${path.startsWith('/') ? path : '/' + path}`;
}

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(publicUrl(req, '/login'), 303);
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    expires: new Date(0),
  });
  return res;
}

export async function GET(req: NextRequest) {
  return POST(req);
}
