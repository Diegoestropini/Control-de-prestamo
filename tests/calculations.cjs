const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = {};
const context = vm.createContext({
  console,
  document: {
    getElementById(id) {
      return elements[id] ||= { value: '', innerHTML: '', addEventListener() {} };
    },
    querySelectorAll() { return []; },
  },
  // Isolated stub: no browser storage is accessed or changed.
  localStorage: {
    getItem() { return null; },
    setItem() { throw new Error('Tests must not write storage'); },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8'), context);
const run = (code) => vm.runInContext(code, context);
function setup(due, start, payments) {
  run(`state.settings = ${JSON.stringify({ monthlyDue: due, secretaryPercent: 16.6667, startMonth: start })};
    state.payments = ${JSON.stringify(payments.map(([month, amount], i) => ({ id: `p${i}`, month, amount, createdAt: i + 1 })))};`);
}

setup(120, '2026-01', [['2026-01', 119.99], ['2026-01', 0.01]]);
assert.equal(run('calculateRows().finalBalance'), 0);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), '2026-01');
setup(120, '2026-01', [['2026-03', 240]]);
assert.equal(run("getBalanceAtMonth(calculateRows().rows, '2026-03')"), 120);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), '2026-02');
assert.equal(run("getBalanceAtMonth(calculateRows().rows, '2026-02')"), 240);
setup(120, '2026-11', [['2026-11', 360]]);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), '2027-01');
setup(120, '2026-01', [['2026-03', 119.99]]);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), null);
setup(120, '2026-01', []);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), null);
assert.equal(run("getBalanceAtMonth(calculateRows().rows, '2026-03')"), 360);
setup(0, '2026-01', []);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), run('getCurrentMonthValue()'));
setup(0.10, '2026-01', [['2026-01', 0.30], ['2026-03', 0.10]]);
assert.equal(run('calculateRows().finalBalance'), -0.10);
assert.equal(run("getBalanceAtMonth(calculateRows().rows, '2026-04')"), 0);
assert.equal(run('getLastCoveredMonth(calculateRows().rows)'), '2026-04');

const current = run('getCurrentMonthValue()');
setup(120, current, [[current, 119.99], [current, 0.01]]);
run('render()');
assert.match(elements.topStatus.innerHTML, /Está al día/);
assert.doesNotMatch(elements.topStatus.innerHTML, /Tiene atraso/);

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const field = html.match(/<input[^>]*id="secretaryPercent"[^>]*>/)[0];
const step = Number(field.match(/step="([^"]+)"/)[1]);
const defaultPercent = run('getDefaultSettings().secretaryPercent');
assert.ok(Math.abs(defaultPercent / step - Math.round(defaultPercent / step)) < 1e-8);
console.log('OK: balances, arrears, advances, coverage, summary and commission step');
