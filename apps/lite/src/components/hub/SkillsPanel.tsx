import { useEffect, useMemo, useState } from 'react';
import { hubApi } from '../../lib/hubApi';
import { PanelShell } from './PanelShell';

export default function SkillsPanel({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<{ name: string; description: string; dir: string }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { hubApi.skills().then((r) => setSkills(r.skills)).catch(() => {}); }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? skills.filter((k) => k.name.toLowerCase().includes(s) || k.description.toLowerCase().includes(s)) : skills;
  }, [skills, q]);
  return (
    <PanelShell title="🧩 Skills" subtitle="Biblioteca compartilhada. Cada agente escolhe quais ligar (aba Skills do perfil)." onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar skill…" aria-label="Buscar skill" className="w-full h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 text-sm" />
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={`${s.dir}-${s.name}`} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <p className="text-sm font-medium">{s.name}</p>
            <p className="text-xs text-zinc-500 line-clamp-3">{s.description}</p>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
