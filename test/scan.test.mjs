import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/ai-model-sunset.mjs', import.meta.url));
const app = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [bin, app, '--json', '--today', '2026-10-19', ...args], { encoding: 'utf8' }));

test('finds the models with a shutdown date, soonest first', () => {
  const r = run();
  assert.deepEqual(r.models.map((m) => m.id), ['gpt-3.5-turbo', 'gpt-4-turbo', 'o3-mini', 'claude-sonnet-4-5', 'gpt-4o-mini', 'whisper-1']);
  const g = r.models[0];
  assert.equal(g.off, '2026-10-23');
  assert.equal(g.daysLeft, 4);
  assert.deepEqual(g.replacement, ['gpt-5.6-terra']);
  assert.deepEqual(g.refs, [{ file: 'src/bot.py', line: 3, matched: 'gpt-3.5-turbo' }]);
});

test('models with no date are listed apart; node_modules, docs and unquoted «o1» are skipped', () => {
  const r = run();
  assert.deepEqual(r.noShutdownDate, ['claude-sonnet-5-5']);
  assert.ok(!r.models.some((m) => m.id === 'gpt-4o' || m.id === 'gpt-4' || m.id === 'o1'));
});

test('--include-docs reads the README too', () => {
  assert.ok(run('--include-docs').models.some((m) => m.id === 'gpt-4'));
});

test('--fail-within exits 1 when a model shuts down within those days', () => {
  assert.throws(() => execFileSync(process.execPath, [bin, app, '--today', '2026-10-19', '--fail-within', '7'], { stdio: 'pipe' }), (e) => e.status === 1);
  execFileSync(process.execPath, [bin, app, '--today', '2026-10-19', '--fail-within', '3'], { stdio: 'pipe' });
});
