import { prisma } from '@/lib/db';
import SyncClient from '@/components/SyncClient';
import { format } from 'date-fns';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IconCheck, IconX, IconClock, IconInfo } from '@/components/Icons';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

async function getCronStatus() {
  try {
    const r = await execAsync('systemctl is-active suthouse-cron.service');
    const active = r.stdout.trim() === 'active';
    const sh = await execAsync(
      'systemctl show suthouse-cron.service --property=ActiveEnterTimestamp,MainPID --no-pager',
    ).catch(() => ({ stdout: '' }));
    const props: Record<string, string> = {};
    for (const line of sh.stdout.split('\n')) {
      const [k, v] = line.split('=');
      if (k && v) props[k] = v;
    }
    return {
      active,
      since: props.ActiveEnterTimestamp || null,
      pid: props.MainPID && props.MainPID !== '0' ? props.MainPID : null,
    };
  } catch {
    return { active: false, since: null, pid: null };
  }
}

export default async function SyncPage() {
  const cronStatus = await getCronStatus();
  const [logs, counts] = await Promise.all([
    prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    Promise.all([
      prisma.kontragent.count(),
      prisma.ddsArticle.count(),
      prisma.nomenclature.count(),
      prisma.kassa.count(),
      prisma.bankAccount.count(),
      prisma.user1C.count(),
      prisma.ddsDocument.count(),
      prisma.realizacia.count(),
      prisma.zakupka.count(),
      prisma.orderBuyer.count(),
      prisma.writeOff.count(),
      prisma.capitalization.count(),
    ]),
  ]);
  const [kontragenty, articles, nomenclature, kassy, banks, users, dds, realizacii, zakupki, orders, writeOffs, capitalizations] = counts;
  const labels: Array<{ k: string; n: number }> = [
    { k: 'Контрагенты', n: kontragenty },
    { k: 'Статьи ДДС', n: articles },
    { k: 'Номенклатура', n: nomenclature },
    { k: 'Кассы', n: kassy },
    { k: 'Банковские счета', n: banks },
    { k: 'Пользователи 1С', n: users },
    { k: 'ДДС документы', n: dds },
    { k: 'Реализации', n: realizacii },
    { k: 'Закупки', n: zakupki },
    { k: 'Заказы покупателей', n: orders },
    { k: 'Списания', n: writeOffs },
    { k: 'Оприходования', n: capitalizations },
  ];

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Синхронизация с 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Статус автосинхронизации, лог запусков и ручной запуск.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Автосинхронизация</div>
          <div className="kpi-value text-xl flex items-center gap-2">
            {cronStatus.active
              ? <><IconCheck className="text-green-600" /> <span className="text-green-700">Включена</span></>
              : <><IconX className="text-red-600" /> <span className="text-red-700">Выключена</span></>}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {cronStatus.active
              ? <>Каждые {process.env.SYNC_INTERVAL_MINUTES || 15} мин · PID {cronStatus.pid}</>
              : <>systemctl start suthouse-cron — для запуска</>}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Окно инкрементального синка</div>
          <div className="kpi-value text-xl">{process.env.SYNC_DAYS_BACK || 60} <span className="text-sm text-gray-500">дн.</span></div>
          <div className="text-xs text-gray-500 mt-1">все документы с датой ≥ now − {process.env.SYNC_DAYS_BACK || 60}д</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Запуск воркера</div>
          <div className="kpi-value text-xs font-normal text-gray-700 leading-relaxed">
            {cronStatus.since
              ? format(new Date(cronStatus.since), 'dd.MM.yyyy HH:mm:ss')
              : 'не запущен'}
          </div>
        </div>
      </div>

      <div className="hint">
        <IconInfo className="hint-icon" />
        <div className="text-sm">
          <b>Как работает синхронизация.</b> Каждые {process.env.SYNC_INTERVAL_MINUTES || 15} минут автоматически:
          (1) обновляются справочники (контрагенты, статьи ДДС, номенклатура);
          (2) загружаются все документы из 1С с датой за последние {process.env.SYNC_DAYS_BACK || 60} дней
          через OData API; (3) для каждого документа делается upsert по Ref_Key — новые создаются,
          существующие обновляются. Поэтому если документ в 1С изменили (например, поменяли сумму
          или статью), при следующем синке изменения подтянутся в БД.
        </div>
      </div>

      <SyncClient />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {labels.map((l) => (
          <div key={l.k} className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500">{l.k}</div>
            <div className="text-xl font-semibold">{l.n.toLocaleString('ru-RU')}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
        <table className="report">
          <thead>
            <tr><th>Начало</th><th>Окончание</th><th>Статус</th><th>Длительность</th><th>Детали</th></tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={5} className="text-center text-gray-500 py-6">Лог пуст</td></tr>}
            {logs.map((l) => {
              const dur = l.finishedAt ? Math.round((l.finishedAt.getTime() - l.startedAt.getTime()) / 1000) : null;
              return (
                <tr key={l.id}>
                  <td>{format(l.startedAt, 'dd.MM.yyyy HH:mm:ss')}</td>
                  <td>{l.finishedAt ? format(l.finishedAt, 'HH:mm:ss') : '—'}</td>
                  <td>
                    <span className={
                      l.status === 'success' ? 'inline-block px-2 py-0.5 text-xs rounded bg-green-100 text-green-800' :
                      l.status === 'error' ? 'inline-block px-2 py-0.5 text-xs rounded bg-red-100 text-red-800' :
                      'inline-block px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800'
                    }>{l.status}</span>
                  </td>
                  <td className="text-xs">{dur !== null ? `${dur}s` : '—'}</td>
                  <td className="text-xs text-gray-600 max-w-md truncate font-mono">
                    {l.error ? <span className="text-red-700">{l.error.slice(0, 200)}</span> : (l.details || '').slice(0, 200)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
