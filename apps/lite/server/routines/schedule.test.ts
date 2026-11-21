// Testes do parser de agenda das rotinas
// Executar: pnpm --filter @mch/lite exec tsx server/routines/schedule.test.ts
import assert from 'node:assert/strict';
import { nextRunAt, parseSchedule, tzOffsetMs } from './schedule.js';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`[PASS] ${name}`);
}

// 14/11/2026 08:30 em Rio Branco = 13:30 UTC
const at = new Date('2026-11-14T13:30:00Z');

test('Rio Branco é UTC-5', () => {
  assert.equal(tzOffsetMs(at), -5 * 3600_000);
});

test('diário 07:00 → amanhã 07:00 local (12:00 UTC)', () => {
  const s = parseSchedule('diário 07:00');
  assert.equal(s.label, 'diário 07:00');
  assert.equal(nextRunAt(s, at)?.toISOString(), '2026-11-15T12:00:00.000Z');
});

test('diario 9:05 sem acento → hoje 09:05 local', () => {
  assert.equal(nextRunAt(parseSchedule('diario 9:05'), at)?.toISOString(), '2026-11-14T14:05:00.000Z');
});

test('a cada 15 min', () => {
  const s = parseSchedule('a cada 15 min');
  assert.equal(s.kind, 'interval');
  assert.equal(nextRunAt(s, at)?.toISOString(), '2026-11-14T13:45:00.000Z');
});

test('intervalo abaixo de 5 min é recusado', () => {
  assert.throws(() => parseSchedule('a cada 2 min'), /mínimo/);
  assert.throws(() => parseSchedule('* * * * *'), /menos de 5 min/);
  assert.throws(() => parseSchedule('0,1 * * * *'), /menos de 5 min/);
});

test('cron */10 e dia útil', () => {
  assert.equal(nextRunAt(parseSchedule('*/10 * * * *'), at)?.toISOString(), '2026-11-14T13:40:00.000Z');
  // 14/11/2026 é sábado → próximo dia útil 08:00 é segunda 16/11
  assert.equal(nextRunAt(parseSchedule('0 8 * * 1-5'), at)?.toISOString(), '2026-11-16T13:00:00.000Z');
  // domingo como 7
  assert.equal(nextRunAt(parseSchedule('0 8 * * 7'), at)?.toISOString(), '2026-11-15T13:00:00.000Z');
});

test('cron com dia do mês e mês', () => {
  assert.equal(nextRunAt(parseSchedule('30 6 1 1 *'), at)?.toISOString(), '2027-01-01T11:30:00.000Z');
});

test('entradas inválidas', () => {
  assert.throws(() => parseSchedule(''), /vazia/);
  assert.throws(() => parseSchedule('diário 25:00'), /inválido/);
  assert.throws(() => parseSchedule('0 8 * *'), /5 campos/);
  assert.throws(() => parseSchedule('61 * * * *'), /intervalo/);
  assert.throws(() => parseSchedule('0 0 31 2 *'), /nunca/);
});

console.log(`\n${passed} testes de agenda passaram.`);
