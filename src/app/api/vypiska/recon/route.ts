import { NextRequest, NextResponse } from 'next/server';
import { reconcileVypiska } from '@/lib/reports/vypiska-recon';

export const dynamic = 'force-dynamic';

// Лимит размера файла — выписки маленькие (десятки КБ), ставим с запасом.
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }
    const f = file as File;
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой (>10 МБ)' }, { status: 400 });
    }
    const name = f.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      return NextResponse.json({ error: 'Нужен файл Excel (.xlsx/.xls) или CSV' }, { status: 400 });
    }

    const buf = Buffer.from(await f.arrayBuffer());
    const result = await reconcileVypiska(buf, f.name);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
