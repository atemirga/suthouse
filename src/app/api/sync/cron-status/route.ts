import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

// GET /api/sync/cron-status — вернуть статус systemd сервиса suthouse-cron
export async function GET() {
  let active = false;
  let enabled = false;
  let lastStarted: string | null = null;
  let pid: string | null = null;

  try {
    const r = await execAsync('systemctl is-active suthouse-cron.service');
    active = r.stdout.trim() === 'active';
  } catch {
    active = false;
  }

  try {
    const r = await execAsync('systemctl is-enabled suthouse-cron.service');
    enabled = r.stdout.trim() === 'enabled';
  } catch {
    enabled = false;
  }

  try {
    const r = await execAsync(
      'systemctl show suthouse-cron.service --property=ActiveEnterTimestamp,MainPID --no-pager',
    );
    const lines = r.stdout.split('\n');
    for (const line of lines) {
      const [k, v] = line.split('=');
      if (k === 'ActiveEnterTimestamp' && v) lastStarted = v;
      if (k === 'MainPID' && v && v !== '0') pid = v;
    }
  } catch {}

  return NextResponse.json({
    active,
    enabled,
    lastStarted,
    pid,
    intervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES || 15),
    daysBack: Number(process.env.SYNC_DAYS_BACK || 60),
  });
}
