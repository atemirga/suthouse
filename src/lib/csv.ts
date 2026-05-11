// Простая CSV-сериализация. UTF-8 + BOM, разделитель `;` для удобства открытия в Excel.
const SEP = ';';
const NL = '\r\n';
const BOM = '﻿';

function escape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: any[][]): string {
  const head = headers.map(escape).join(SEP);
  const body = rows.map((r) => r.map(escape).join(SEP)).join(NL);
  return BOM + head + NL + body + NL;
}

export function csvResponse(filename: string, content: string): Response {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
