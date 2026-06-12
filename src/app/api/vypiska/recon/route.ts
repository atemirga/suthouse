import { NextRequest, NextResponse } from 'next/server';
import { reconcileVypiska } from '@/lib/reports/vypiska-recon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // нужен child_process (pdftotext) для PDF

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
    if (!/\.(xlsx|xls|csv|pdf)$/.test(name)) {
      return NextResponse.json({ error: 'Нужен файл Excel (.xlsx/.xls), CSV или PDF' }, { status: 400 });
    }

    // Необязательный выбор счёта 1С для сверки (иначе определяется по формату выписки).
    const accountRaw = form.get('account');
    const account = typeof accountRaw === 'string' && accountRaw ? accountRaw : undefined;

    const buf = Buffer.from(await f.arrayBuffer());
    const result = await reconcileVypiska(buf, f.name, account);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
