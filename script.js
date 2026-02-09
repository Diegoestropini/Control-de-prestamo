const STORAGE_KEY = "prestamo_data_v1";

const state = {
  settings: {
    monthlyDue: 120,
    secretaryPercent: 16.6667,
  },
  payments: [],
};

const settingsForm = document.getElementById("settings-form");
const paymentForm = document.getElementById("payment-form");
const paymentsBody = document.getElementById("paymentsBody");
const summary = document.getElementById("summary");
const topStatus = document.getElementById("topStatus");
const clearDataBtn = document.getElementById("clearData");

const monthlyDueInput = document.getElementById("monthlyDue");
const secretaryPercentInput = document.getElementById("secretaryPercent");
const paymentMonthInput = document.getElementById("paymentMonth");
const paymentAmountInput = document.getElementById("paymentAmount");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function monthDiff(fromMonth, toMonth) {
  const [fromY, fromM] = fromMonth.split("-").map(Number);
  const [toY, toM] = toMonth.split("-").map(Number);
  return (toY - fromY) * 12 + (toM - fromM);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.settings) {
      state.settings.monthlyDue = Math.max(0, toNumber(parsed.settings.monthlyDue));
      state.settings.secretaryPercent = Math.max(0, Math.min(100, toNumber(parsed.settings.secretaryPercent)));
    }

    if (Array.isArray(parsed.payments)) {
      state.payments = parsed.payments
        .map((p, i) => ({
          id: String(p.id || `legacy-${i}`),
          month: String(p.month || ""),
          amount: Math.max(0, toNumber(p.amount)),
          createdAt: toNumber(p.createdAt) || i,
        }))
        .filter((p) => /^\d{4}-\d{2}$/.test(p.month));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function sortPayments() {
  state.payments.sort((a, b) => {
    const monthCmp = a.month.localeCompare(b.month);
    if (monthCmp !== 0) return monthCmp;

    const createdCmp = toNumber(a.createdAt) - toNumber(b.createdAt);
    if (createdCmp !== 0) return createdCmp;

    return String(a.id).localeCompare(String(b.id));
  });
}

function addPayment(month, amount) {
  state.payments.push({
    id: String(Date.now()) + Math.random().toString(16).slice(2),
    month,
    amount,
    createdAt: Date.now(),
  });
}

function monthLabel(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(date);
}

function calculateRows() {
  sortPayments();
  const rows = [];

  let balance = 0;
  let previousMonth = null;
  const monthlyDue = state.settings.monthlyDue;
  const percent = state.settings.secretaryPercent / 100;

  for (const payment of state.payments) {
    if (previousMonth && payment.month !== previousMonth) {
      const skippedMonths = Math.max(0, monthDiff(previousMonth, payment.month) - 1);
      balance += skippedMonths * monthlyDue;
    }

    const balanceAtStart = balance;
    const monthlyDueApplied = payment.month !== previousMonth ? monthlyDue : 0;
    const expectedThisMonth = Math.max(0, balanceAtStart + monthlyDueApplied);

    const secretaryCommission = payment.amount * percent;
    const netForUser = payment.amount - secretaryCommission;

    balance = balanceAtStart + monthlyDueApplied - payment.amount;

    rows.push({
      id: payment.id,
      month: payment.month,
      balanceAtStart,
      monthlyDueApplied,
      expectedThisMonth,
      paid: payment.amount,
      secretaryCommission,
      netForUser,
      balanceNext: balance,
    });

    previousMonth = payment.month;
  }

  return { rows, finalBalance: balance };
}

function renderSummary(finalBalance) {
  const monthlyDue = state.settings.monthlyDue;
  const secretaryPercent = state.settings.secretaryPercent;
  const secretaryMonthly = monthlyDue * (secretaryPercent / 100);
  const userMonthly = monthlyDue - secretaryMonthly;

  const nextRequired = Math.max(0, finalBalance + monthlyDue);
  const statusText = finalBalance > 0
    ? `Tiene atraso acumulado de ${money(finalBalance)}.`
    : finalBalance < 0
      ? `Tiene saldo a favor de ${money(Math.abs(finalBalance))}.`
      : "Esta al dia sin saldo pendiente ni saldo a favor.";

  topStatus.innerHTML = `
    <div><strong>Estado actual:</strong> ${statusText}</div>
    <div><strong>Total exigido para el proximo mes:</strong> <span class="amount-general">${money(nextRequired)}</span></div>
  `;

  summary.innerHTML = `
    <div><strong>Cuota mensual:</strong> <span class="amount-general">${money(monthlyDue)}</span></div>
    <div><strong>Comision secretaria:</strong> <span class="amount-commission">${secretaryPercent.toFixed(4)}% (${money(secretaryMonthly)} por cuota base)</span></div>
    <div><strong>Neto para usuaria por cuota base:</strong> <span class="amount-net">${money(userMonthly)}</span></div>
  `;
}

function renderTable(rows) {
  if (rows.length === 0) {
    paymentsBody.innerHTML = `<tr><td colspan="9" class="muted">No hay pagos registrados todavia.</td></tr>`;
    return;
  }

  paymentsBody.innerHTML = rows
    .map((row) => {
      const balanceClass = row.balanceNext > 0 ? "positive" : row.balanceNext < 0 ? "negative" : "";
      return `
        <tr>
          <td>${monthLabel(row.month)}</td>
          <td>${money(row.balanceAtStart)}</td>
          <td><span class="amount-general">${money(row.monthlyDueApplied)}</span></td>
          <td><span class="amount-general">${money(row.expectedThisMonth)}</span></td>
          <td><span class="amount-paid">${money(row.paid)}</span></td>
          <td><span class="amount-commission">${money(row.secretaryCommission)}</span></td>
          <td><span class="amount-net">${money(row.netForUser)}</span></td>
          <td class="${balanceClass}">${money(row.balanceNext)}</td>
          <td class="actions-cell">
            <button type="button" data-month="${row.month}" class="add-more-btn">Agregar abono</button>
            <button type="button" data-id="${row.id}" class="danger remove-btn">Eliminar</button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".add-more-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const month = String(btn.dataset.month || "");
      if (!/^\d{4}-\d{2}$/.test(month)) return;

      const entered = prompt(`Monto adicional para ${monthLabel(month)} (USD):`, "0");
      if (entered === null) return;

      const amount = Math.max(0, toNumber(entered));
      addPayment(month, amount);
      saveState();
      render();
    });
  });

  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const confirmed = confirm("¿Estas seguro de que quieres eliminar este registro?");
      if (!confirmed) return;

      const id = String(btn.dataset.id || "");
      state.payments = state.payments.filter((p) => String(p.id) !== id);
      saveState();
      render();
    });
  });
}

function render() {
  monthlyDueInput.value = state.settings.monthlyDue;
  secretaryPercentInput.value = state.settings.secretaryPercent;

  const { rows, finalBalance } = calculateRows();
  renderSummary(finalBalance);
  renderTable(rows);
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings.monthlyDue = Math.max(0, toNumber(monthlyDueInput.value));
  state.settings.secretaryPercent = Math.max(0, Math.min(100, toNumber(secretaryPercentInput.value)));
  saveState();
  render();
});

paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const month = paymentMonthInput.value;
  const amount = Math.max(0, toNumber(paymentAmountInput.value));

  if (!/^\d{4}-\d{2}$/.test(month)) {
    alert("Selecciona un mes valido.");
    return;
  }

  addPayment(month, amount);
  saveState();
  render();

  paymentAmountInput.value = "";
});

clearDataBtn.addEventListener("click", () => {
  const ok = confirm("Esto borrara toda la informacion guardada localmente. Desea continuar?");
  if (!ok) return;

  state.settings = { monthlyDue: 120, secretaryPercent: 16.6667 };
  state.payments = [];
  saveState();
  render();
});

loadState();
render();
