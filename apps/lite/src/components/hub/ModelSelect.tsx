// Seletor de modelo em três grupos: Local (grátis), Nuvem Ollama 💲 e o atual.
interface Props {
  id?: string;
  value: string;
  local: string[];
  cloud: string[];
  onChange: (model: string) => void;
  className?: string;
}

export function ModelSelect({ id, value, local, cloud, onChange, className = '' }: Props) {
  const known = local.includes(value) || cloud.includes(value);
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`}
    >
      {value && !known ? <option value={value}>{value} (não instalado)</option> : null}
      <optgroup label="Local (grátis)">
        {local.map((m) => <option key={m} value={m}>{m}</option>)}
      </optgroup>
      {cloud.length > 0 ? (
        <optgroup label="Nuvem Ollama 💲 (pago, pede confirmação)">
          {cloud.map((m) => <option key={m} value={m}>💲 {m}</option>)}
        </optgroup>
      ) : null}
    </select>
  );
}
