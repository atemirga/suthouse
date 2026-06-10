// Открыть Google-таблицу амортизации и показать все листы + структуру.
import { google } from 'googleapis';

async function main() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const sheetId = process.env.AMORTIZATION_SHEET_ID;
  if (!keyPath || !sheetId) {
    console.error('Не заданы GOOGLE_SERVICE_ACCOUNT_KEY_PATH или AMORTIZATION_SHEET_ID');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  console.log(`Таблица: «${meta.data.properties?.title}»`);

  // Фокус только на «Ведомость» — нам нужна именно она
  const vedomost = meta.data.sheets?.find(s => s.properties?.title === 'Ведомость');
  if (!vedomost) { console.error('Лист «Ведомость» не найден'); process.exit(1); }
  const props = vedomost.properties!;
  console.log(`«Ведомость»: ${props.gridProperties?.rowCount}×${props.gridProperties?.columnCount}\n`);

  // 1) Header rows: первые 5 строк × все 91 колонка — чтобы понять что в шапке
  const headerRange = `Ведомость!A1:CM6`;
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: headerRange });
  const headerRows = headerRes.data.values || [];
  console.log('═══ Шапка (первые 6 строк × все колонки) ═══');
  for (let i = 0; i < headerRows.length; i++) {
    const r = headerRows[i];
    console.log(`Row${i+1} (${r.length} cells):`);
    for (let j = 0; j < r.length; j++) {
      const v = String(r[j] ?? '').trim();
      if (v) console.log(`  ${colLetter(j)}${i+1}: ${v.slice(0, 60)}`);
    }
    console.log();
  }

  // 2) Несколько строк данных (5-8) — все колонки
  console.log('═══ Пример строк данных (строки 5..8, все колонки) ═══');
  const sampleRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Ведомость!A5:CM8',
  });
  const sampleRows = sampleRes.data.values || [];
  for (let i = 0; i < sampleRows.length; i++) {
    const r = sampleRows[i];
    console.log(`Data row ${i+5} (${r.length} непустых):`);
    for (let j = 0; j < r.length; j++) {
      const v = String(r[j] ?? '').trim();
      if (v) console.log(`  ${colLetter(j)}: ${v.slice(0, 40)}`);
    }
    console.log();
  }

  // 3) Сколько строк данных вообще (по A колонке) + итоги внизу
  const allA = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Ведомость!A1:A300',
  });
  const aRows = allA.data.values || [];
  let lastDataRow = 0;
  for (let i = 0; i < aRows.length; i++) {
    if ((aRows[i]?.[0] ?? '').toString().trim()) lastDataRow = i + 1;
  }
  console.log(`Последняя непустая строка в колонке A: ${lastDataRow}`);

  // 4) Итоговая строка (если есть) — скан вниз после данных
  if (lastDataRow > 0) {
    const tailRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `Ведомость!A${Math.max(1, lastDataRow - 2)}:CM${lastDataRow + 5}`,
    });
    console.log('═══ Хвост ═══');
    const tail = tailRes.data.values || [];
    for (let i = 0; i < tail.length; i++) {
      const r = tail[i];
      const filled = r.filter((c: any) => String(c ?? '').trim()).length;
      console.log(`Row ${Math.max(1, lastDataRow - 2) + i} (${filled} cells filled):`);
      for (let j = 0; j < r.length; j++) {
        const v = String(r[j] ?? '').trim();
        if (v) console.log(`  ${colLetter(j)}: ${v.slice(0, 40)}`);
      }
      console.log();
    }
  }
}

function colLetter(i: number): string {
  let s = '';
  let n = i;
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

main().catch((e) => { console.error(e); process.exit(1); });
