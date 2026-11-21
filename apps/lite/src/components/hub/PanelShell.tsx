import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function PanelShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-start gap-2 p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar painel" className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="w-4 h-4" /></button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
    </div>
  );
}
