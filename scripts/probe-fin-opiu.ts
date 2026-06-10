import { google } from 'googleapis';
async function main() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const sheetId = process.env.PROBE_SHEET_ID;
  const auth = new google.auth.GoogleAuth({ keyFile: keyPath!, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  // 1) Поиск 'тамож' / '1.05' по всему ОПиУ (A:C, 1-200)
  const opiu = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId!, range: 'ОПиУ!A1:R200', valueRenderOption: 'FORMATTED_VALUE' });
  const rows = opiu.data.values || [];
  console.log('=== Поиск таможни/1.05/1.04 в ОПиУ ===');
  for (let i=0;i<rows.length;i++){ const line=(rows[i]||[]).join(' ').toLowerCase(); if(line.includes('тамож')||line.includes('1.05')||line.includes('1.04')||line.includes('1.03')) console.log(`R${i+1}:`, (rows[i]||[]).filter(Boolean).slice(0,8).join(' | ')); }
  console.log('\n=== Строки ОПиУ ниже EBITDA (R70-110) ===');
  for (let i=70;i<Math.min(110,rows.length);i++){ const r=rows[i]||[]; const c=r.map((x:any,j:number)=>{const v=String(x??'').trim();return v?`${String.fromCharCode(65+j)}=${v.slice(0,16)}`:'';}).filter(Boolean); if(c.length) console.log(`R${i+1}: ${c.slice(0,10).join(' | ')}`); }
  // 2) Лист «В /С» — как строится себестоимость (шапка)
  console.log('\n=== Лист «В /С» (себестоимость) первые строки ===');
  const vc = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId!, range: "'В /С'!A1:R12", valueRenderOption: 'FORMATTED_VALUE' });
  for (const r of (vc.data.values||[])){ const c=(r||[]).map((x:any,j:number)=>{const v=String(x??'').trim();return v?`${String.fromCharCode(65+j)}=${v.slice(0,16)}`:'';}).filter(Boolean); if(c.length) console.log(c.slice(0,12).join(' | ')); }
}
main().catch(e => { console.error('ОШИБКА:', e?.message || e); process.exit(1); });
