'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => require('./load-app.cjs')('script.js', true);
const backup = () => ({ version: 2, exportedAt: '2024-04-01T12:00:00Z', settings: { monthlyDue: 120, secretaryPercent: 16.6667, startMonth: '2024-01' }, payments: [{ id: 'synthetic-1', month: '2024-01', amount: 50.25, createdAt: 1704110400000 }] });

test('JSON and CSV backups round-trip actual production parsers and validation', () => {
  const { put, run, json } = load();
  put('sample', backup());
  put('jsonText', JSON.stringify(backup()));
  run('validateImportData(parseBackupText(jsonText, "fixture.example.json", "application/json"))');
  run('globalThis.csv = backupToCsv(sample); globalThis.parsed = parseBackupText(csv, "fixture.example.csv", "text/csv"); validateImportData(parsed)');
  run('globalThis.normalized = normalizeStateData(parsed)');
  assert.deepEqual(json('normalized.settings'), backup().settings);
  assert.deepEqual(json('normalized.payments'), backup().payments);
});
test('invalid imports are rejected before replacing existing state', () => {
  const { put, run, json } = load();
  const previous = json('state');
  const mutations = [
    x => { x.settings.monthlyDue = -1; },
    x => { x.settings.secretaryPercent = 101; },
    x => { x.settings.startMonth = '9999-12'; },
    x => { x.payments[0].month = '2024-13'; },
    x => { x.payments[0].amount = -10; },
    x => { x.payments.push({ ...x.payments[0] }); },
    x => { x.payments = Array.from({ length: 5001 }, (_, i) => ({ ...x.payments[0], id: `synthetic-${i}` })); },
    x => { x.settings.startMonth = '2024-02'; },
  ];
  for (const change of mutations) {
    const invalid = backup(); change(invalid); put('invalid', invalid);
    assert.throws(() => run('validateImportData(invalid)'));
    assert.deepEqual(json('state'), previous);
  }
});
test('malformed JSON and unknown formats fail instead of importing empty data', () => {
  const { run } = load();
  assert.throws(() => run('parseBackupText("{broken", "fixture.example.json", "application/json")'));
  assert.throws(() => run('parseBackupText("unrecognized", "file.txt", "text/plain")'));
});
test('money parser rejects malformed, non-finite, exponent notation and negative values', () => {
  const { put, run } = load();
  for (const value of ['1e3', '-1', 'not-a-number', Infinity, NaN, -1]) {
    put('value', value); assert.throws(() => run('parseStrictAmount(value)'));
  }
  assert.equal(run('parseStrictAmount("0.01")'), 0.01);
  assert.equal(run('parseStrictAmount("120,25")'), 120.25);
  assert.equal(run('parseSecretaryPercent(16.6667)'), 16.6667);
});
