// Agenda das rotinas: cron de 5 campos ou atalhos em português.
//   "diário 07:00" (ou "diario 7:00", "daily 07:00")
//   "a cada 15 min" (ou "every 15m") — mínimo 5 min
//   "*/10 * * * *" — cron: minuto hora dia-do-mês mês dia-da-semana (0/7 = domingo)
// Tudo calculado no fuso do Jean (America/Rio_Branco, UTC-5 fixo, sem horário de verão).

export const ROUTINE_TIMEZONE = 'America/Rio_Branco';
export const MIN_INTERVAL_MINUTES = 5;

export type Schedule =
  | { kind: 'interval'; minutes: number; label: string }
  | { kind: 'cron'; expr: string; label: string; fields: CronFields };

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function parseField(raw: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Campo "${name}" inválido: "${part}".`);
    const step = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Passo inválido em "${name}".`);
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a);
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Valor fora do intervalo em "${name}" (${min}-${max}).`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron precisa de 5 campos: minuto hora dia mês dia-da-semana.');
  const [mi, h, dom, mon, dow] = parts;
  const dowSet = parseField(dow, 0, 7, 'dia-da-semana');
  if (dowSet.has(7)) { dowSet.delete(7); dowSet.add(0); }
  return {
    minute: parseField(mi, 0, 59, 'minuto'),
    hour: parseField(h, 0, 23, 'hora'),
    dom: parseField(dom, 1, 31, 'dia do mês'),
    month: parseField(mon, 1, 12, 'mês'),
    dow: dowSet,
    domAny: dom === '*',
    dowAny: dow === '*',
  };
}

// Deslocamento do fuso (ms) em um instante. Rio Branco é UTC-5 fixo, mas lemos do Intl.
export function tzOffsetMs(at: Date, timeZone = ROUTINE_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function cronNext(f: CronFields, after: Date): Date | null {
  const off = tzOffsetMs(after);
  // L = horário "local" representado em ms UTC; avança por dia/hora/minuto pulando o que não casa.
  let L = Math.floor((after.getTime() + off) / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = L + 400 * DAY_MS;
  while (L < limit) {
    const d = new Date(L);
    if (!f.month.has(d.getUTCMonth() + 1)) { L = Math.floor(L / DAY_MS) * DAY_MS + DAY_MS; continue; }
    const domOk = f.dom.has(d.getUTCDate());
    const dowOk = f.dow.has(d.getUTCDay());
    // Regra do cron: se dia-do-mês E dia-da-semana forem restritos, basta um casar.
    const dayOk = f.domAny && f.dowAny ? true : f.domAny ? dowOk : f.dowAny ? domOk : domOk || dowOk;
    if (!dayOk) { L = Math.floor(L / DAY_MS) * DAY_MS + DAY_MS; continue; }
    if (!f.hour.has(d.getUTCHours())) { L = Math.floor(L / 3_600_000) * 3_600_000 + 3_600_000; continue; }
    if (!f.minute.has(d.getUTCMinutes())) { L += MINUTE_MS; continue; }
    return new Date(L - off);
  }
  return null;
}

export function parseSchedule(raw: unknown): Schedule {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('Agenda vazia.');
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const daily = lower.match(/^(?:diario|todo dia|daily)\s+(?:as\s+)?(\d{1,2}):(\d{2})$/);
  if (daily) {
    const h = Number(daily[1]);
    const m = Number(daily[2]);
    if (h > 23 || m > 59) throw new Error('Horário inválido (use HH:MM, 00:00 a 23:59).');
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return { kind: 'cron', expr: `${m} ${h} * * *`, label: `diário ${hh}:${mm}`, fields: parseCron(`${m} ${h} * * *`) };
  }

  const every = lower.match(/^(?:a cada|every)\s+(\d+)\s*(?:min|mins|minutos?|m)$/);
  if (every) {
    const minutes = Number(every[1]);
    if (minutes < MIN_INTERVAL_MINUTES) throw new Error(`Intervalo mínimo é ${MIN_INTERVAL_MINUTES} min.`);
    if (minutes > 7 * 24 * 60) throw new Error('Intervalo máximo é 7 dias.');
    return { kind: 'interval', minutes, label: `a cada ${minutes} min` };
  }

  const fields = parseCron(text);
  // Rejeita cron que dispara com menos de 5 min de intervalo.
  let prev = cronNext(fields, new Date(Date.UTC(2026, 0, 1)));
  if (!prev) throw new Error('Esse cron nunca dispara.');
  for (let i = 0; i < 48; i++) {
    const next = cronNext(fields, prev);
    if (!next) break;
    if (next.getTime() - prev.getTime() < MIN_INTERVAL_MINUTES * MINUTE_MS) {
      throw new Error(`Esse cron dispara com menos de ${MIN_INTERVAL_MINUTES} min de intervalo.`);
    }
    prev = next;
  }
  return { kind: 'cron', expr: text.replace(/\s+/g, ' '), label: `cron ${text.replace(/\s+/g, ' ')}`, fields };
}

/** Próximo disparo estritamente depois de `after`. */
export function nextRunAt(schedule: Schedule, after: Date): Date | null {
  if (schedule.kind === 'interval') return new Date(after.getTime() + schedule.minutes * MINUTE_MS);
  return cronNext(schedule.fields, after);
}

export function formatLocal(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: ROUTINE_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}
