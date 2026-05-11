'use client';

import { useSearchParams } from 'next/navigation';
import { IconDownload } from './Icons';

export default function ExportButton({ endpoint, label = 'Экспорт CSV' }: { endpoint: string; label?: string }) {
  const sp = useSearchParams();
  const href = endpoint + (sp.toString() ? '?' + sp.toString() : '');

  return (
    <a
      href={href}
      className="btn btn-secondary"
      title="Скачать таблицу за выбранный период (CSV для Excel)"
    >
      <IconDownload width={14} height={14} />
      {label}
    </a>
  );
}
