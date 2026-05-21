const STORAGE_KEY = "prestamo_data_v1";
const BACKUP_VERSION = 2;
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;
const MAX_IMPORT_PAYMENTS = 5000;

const state = {
  settings: {
    monthlyDue: 120,
    secretaryPercent: 16.6667,
    startMonth: getCurrentMonthValue(),
  },
  payments: [],
  showFullHistory: false,
};

const settingsForm = document.getElementById("settings-form");
const paymentForm = document.getElementById("payment-form");
const paymentsBody = document.getElementById("paymentsBody");
const summary = document.getElementById("summary");
const topStatus = document.getElementById("topStatus");
const clearDataBtn = document.getElementById("clearData");
const historyToggleBtn = document.getElementById("historyToggle");

const monthlyDueInput = document.getElementById("monthlyDue");
const secretaryPercentInput = document.getElementById("secretaryPercent");
const startMonthInput = document.getElementById("startMonth");
const paymentMonthInput = document.getElementById("paymentMonth");
const paymentAmountInput = document.getElementById("paymentAmount");

const exportJsonBtn = document.getElementById("exportJson");
const exportCsvBtn = document.getElementById("exportCsv");
const importDataBtn = document.getElementById("importData");
const importFileInput = document.getElementById("importFile");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isValidMonthString(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return false;

  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function normalizeMonthString(value) {
  return String(value || "").trim();
}

function isFutureMonth(value, referenceMonth = getCurrentMonthValue()) {
  return normalizeMonthString(value) > normalizeMonthString(referenceMonth);
}

function getDefaultSettings() {
  return {
    monthlyDue: 120,
    secretaryPercent: 16.6667,
    startMonth: getCurrentMonthValue(),
  };
}

function getEarliestPaymentMonth(payments) {
  return payments.reduce((earliest, payment) => {
    if (!isValidMonthString(payment.month)) return earliest;
    if (!earliest || payment.month < earliest) return payment.month;
    return earliest;
  }, null);
}

function getEffectiveStartMonth() {
  return isValidMonthString(state.settings.startMonth)
    ? state.settings.startMonth
    : getEarliestPaymentMonth(state.payments) || getCurrentMonthValue();
}

function isBeforeStartMonth(value, startMonth = getEffectiveStartMonth()) {
  return isValidMonthString(value) && isValidMonthString(startMonth) && value < startMonth;
}

function parseStrictAmount(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("El monto debe ser un número válido mayor o igual a 0.");
    }
    return value;
  }

  const text = String(value ?? "").trim();
  if (text === "") {
    throw new Error("El monto es obligatorio.");
  }

  const normalized = text.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("El monto debe ser un número válido mayor o igual a 0.");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("El monto debe ser un número válido mayor o igual a 0.");
  }

  return amount;
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makePaymentId(prefix = "payment") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePaymentId(value, fallbackIndex) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : makePaymentId(`imported-${fallbackIndex}`);
}

function normalizeUniquePaymentId(value, fallbackIndex, usedIds) {
  let id = normalizePaymentId(value, fallbackIndex);
  if (!usedIds.has(id)) {
    usedIds.add(id);
    return id;
  }

  do {
    id = makePaymentId(`imported-${fallbackIndex}`);
  } while (usedIds.has(id));

  usedIds.add(id);
  return id;
}

function parseSecretaryPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error("La comisión de secretaría debe estar entre 0 y 100.");
  }
  return percent;
}

function validateImportData(parsed) {
  if (!isObject(parsed)) {
    throw new Error("El respaldo debe ser un objeto JSON válido.");
  }

  if (!isObject(parsed.settings)) {
    throw new Error("El respaldo no incluye configuración válida.");
  }

  if (!Array.isArray(parsed.payments)) {
    throw new Error("El respaldo no incluye la lista de pagos.");
  }

  if (parsed.payments.length > MAX_IMPORT_PAYMENTS) {
    throw new Error(`El respaldo supera el limite de ${MAX_IMPORT_PAYMENTS} pagos.`);
  }

  try {
    parseStrictAmount(parsed.settings.monthlyDue);
  } catch {
    throw new Error("La cuota mensual del respaldo no es válida.");
  }

  try {
    parseSecretaryPercent(parsed.settings.secretaryPercent);
  } catch {
    throw new Error("La comisión de secretaría del respaldo no es válida.");
  }

  const providedStartMonth = normalizeMonthString(parsed.settings.startMonth);
  if (providedStartMonth) {
    if (!isValidMonthString(providedStartMonth)) {
      throw new Error("El mes de inicio del respaldo no es válido.");
    }

    if (isFutureMonth(providedStartMonth)) {
      throw new Error("El mes de inicio no puede ser futuro.");
    }
  }

  const seenIds = new Set();
  for (const payment of parsed.payments) {
    if (!isObject(payment)) {
      throw new Error("El respaldo contiene pagos con formato inválido.");
    }

    const providedId = String(payment.id || "").trim();
    if (providedId) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(providedId)) {
        throw new Error("El respaldo contiene identificadores de pago inválidos.");
      }

      if (seenIds.has(providedId)) {
        throw new Error("El respaldo contiene pagos con identificadores duplicados.");
      }

      seenIds.add(providedId);
    }

    if (!isValidMonthString(payment.month)) {
      throw new Error("El respaldo contiene meses de pago inválidos.");
    }

    if (isFutureMonth(payment.month)) {
      throw new Error("El respaldo contiene pagos con meses futuros.");
    }

    try {
      parseStrictAmount(payment.amount);
    } catch {
      throw new Error("El respaldo contiene montos de pago inválidos.");
    }

    if (payment.createdAt !== undefined && !Number.isFinite(Number(payment.createdAt))) {
      throw new Error("El respaldo contiene fechas de registro inválidas.");
    }
  }

  if (providedStartMonth && parsed.payments.some((payment) => payment.month < providedStartMonth)) {
    throw new Error("El respaldo contiene pagos anteriores al mes de inicio.");
  }
}

function normalizeStateData(parsed) {
  const normalized = {
    settings: getDefaultSettings(),
    payments: [],
  };

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.payments)) {
    const usedIds = new Set();
    normalized.payments = parsed.payments.reduce((payments, p, i) => {
      if (!isObject(p)) return payments;

      const month = normalizeMonthString(p.month);
      if (!isValidMonthString(month) || isFutureMonth(month)) return payments;

      let amount;
      try {
        amount = parseStrictAmount(p.amount);
      } catch {
        return payments;
      }

      payments.push({
        id: normalizeUniquePaymentId(p.id, i, usedIds),
        month,
        amount,
        createdAt: toNumber(p.createdAt) || Date.now() + i,
      });
      return payments;
    }, []);
  }

  if (parsed && typeof parsed === "object" && parsed.settings) {
    try {
      normalized.settings.monthlyDue = parseStrictAmount(parsed.settings.monthlyDue);
    } catch {
      normalized.settings.monthlyDue = 120;
    }

    try {
      normalized.settings.secretaryPercent = parseSecretaryPercent(parsed.settings.secretaryPercent);
    } catch {
      normalized.settings.secretaryPercent = 16.6667;
    }

    const startMonth = normalizeMonthString(parsed.settings.startMonth);
    if (isValidMonthString(startMonth) && !isFutureMonth(startMonth)) {
      const earliestPaymentMonth = getEarliestPaymentMonth(normalized.payments);
      normalized.settings.startMonth = earliestPaymentMonth && startMonth > earliestPaymentMonth
        ? earliestPaymentMonth
        : startMonth;
    } else {
      normalized.settings.startMonth = getEarliestPaymentMonth(normalized.payments) || getCurrentMonthValue();
    }
  } else {
    normalized.settings.startMonth = getEarliestPaymentMonth(normalized.payments) || getCurrentMonthValue();
  }

  return normalized;
}

function applyStateData(parsed) {
  const normalized = normalizeStateData(parsed);
  state.settings = normalized.settings;
  state.payments = normalized.payments;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    applyStateData(JSON.parse(raw));
  } catch (error) {
    console.warn("No se pudo cargar el estado guardado.", error);
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
  if (isFutureMonth(month)) {
    throw new Error("No se pueden registrar pagos en meses futuros.");
  }

  if (isBeforeStartMonth(month)) {
    throw new Error("No se pueden registrar pagos anteriores al mes de inicio.");
  }

  state.payments.push({
    id: makePaymentId(),
    month,
    amount,
    createdAt: Date.now(),
  });
}

function updatePayment(id, month, amount) {
  if (isFutureMonth(month)) {
    throw new Error("No se pueden registrar pagos en meses futuros.");
  }

  if (isBeforeStartMonth(month)) {
    throw new Error("No se pueden registrar pagos anteriores al mes de inicio.");
  }

  const payment = state.payments.find((p) => String(p.id) === String(id));
  if (!payment) return false;
  payment.month = month;
  payment.amount = amount;
  return true;
}
function monthLabel(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(date);
}

function monthParts(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return {
    name: new Intl.DateTimeFormat("es", { month: "long" }).format(date),
    year: date.getFullYear(),
  };
}

function addOneMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyClosings(rows) {
  const closings = [];

  for (const row of rows) {
    const lastClosing = closings[closings.length - 1];
    if (lastClosing && lastClosing.month === row.month) {
      lastClosing.balanceNext = row.balanceNext;
      continue;
    }

    closings.push({
      month: row.month,
      balanceNext: row.balanceNext,
    });
  }

  return closings;
}

function getBalanceAtMonth(rows, targetMonth) {
  const monthlyDue = state.settings.monthlyDue;
  const startMonth = getEffectiveStartMonth();
  if (targetMonth < startMonth) {
    return 0;
  }

  const closings = getMonthlyClosings(rows);

  if (closings.length === 0) {
    return (monthDiff(startMonth, targetMonth) + 1) * monthlyDue;
  }

  const firstRecordedMonth = closings[0].month;
  if (targetMonth < firstRecordedMonth) {
    return (monthDiff(startMonth, targetMonth) + 1) * monthlyDue;
  }

  let lastClosingBeforeTarget = null;
  for (const closing of closings) {
    if (closing.month > targetMonth) {
      break;
    }
    lastClosingBeforeTarget = closing;
  }

  if (!lastClosingBeforeTarget) {
    return monthlyDue;
  }

  if (lastClosingBeforeTarget.month === targetMonth) {
    return lastClosingBeforeTarget.balanceNext;
  }

  return lastClosingBeforeTarget.balanceNext + (monthDiff(lastClosingBeforeTarget.month, targetMonth) * monthlyDue);
}

function getLastCoveredMonth(rows) {
  const monthlyDue = state.settings.monthlyDue;
  if (monthlyDue <= 0) {
    return getCurrentMonthValue();
  }

  if (rows.length === 0) {
    return null;
  }

  const startMonth = getEffectiveStartMonth();
  const closings = getMonthlyClosings(rows);
  let lastCoveredMonth = null;
  let previousMonth = startMonth;
  let previousBalance = 0;

  for (const closing of closings) {
    let cursor = previousMonth;
    while (cursor < closing.month) {
      previousBalance += monthlyDue;
      if (previousBalance <= 0) {
        lastCoveredMonth = cursor;
      }
      cursor = addOneMonth(cursor);
    }

    previousBalance = closing.balanceNext;
    if (previousBalance <= 0) {
      lastCoveredMonth = closing.month;
    }
    previousMonth = addOneMonth(closing.month);
  }

  if (!previousMonth) {
    return null;
  }

  let cursor = previousMonth;
  while (previousBalance + monthlyDue <= 0) {
    previousBalance += monthlyDue;
    lastCoveredMonth = cursor;
    cursor = addOneMonth(cursor);
  }

  return lastCoveredMonth;
}

function calculateRows() {
  sortPayments();
  const rows = [];

  let balance = 0;
  let previousMonth = null;
  const startMonth = getEffectiveStartMonth();
  const monthlyDue = state.settings.monthlyDue;
  const percent = state.settings.secretaryPercent / 100;

  for (const payment of state.payments) {
    if (!previousMonth) {
      balance += Math.max(0, monthDiff(startMonth, payment.month)) * monthlyDue;
    } else if (payment.month !== previousMonth) {
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

function renderSummary(rows) {
  const monthlyDue = state.settings.monthlyDue;
  const secretaryPercent = state.settings.secretaryPercent;
  const startMonth = getEffectiveStartMonth();
  const secretaryMonthly = monthlyDue * (secretaryPercent / 100);
  const userMonthly = monthlyDue - secretaryMonthly;
  const currentMonth = getCurrentMonthValue();
  const currentMonthInfo = monthParts(currentMonth);
  const balanceAtCurrentMonth = getBalanceAtMonth(rows, currentMonth);
  const currentBalance = Math.max(0, balanceAtCurrentMonth);
  const currentAdvance = Math.max(0, -balanceAtCurrentMonth);
  const lastCoveredMonthValue = getLastCoveredMonth(rows);
  const lastCoveredMonth = lastCoveredMonthValue ? monthLabel(lastCoveredMonthValue) : "Ningún mes totalmente cubierto";
  const lastCoveredMonthClass = lastCoveredMonthValue ? "month-value" : "month-value-empty";
  const totalPaid = rows.reduce((sum, row) => sum + row.paid, 0);
  const totalCommission = rows.reduce((sum, row) => sum + row.secretaryCommission, 0);

  const statusText = currentBalance > 0
    ? `Tiene atraso acumulado de ${money(currentBalance)} al mes actual.`
    : currentAdvance > 0
      ? `Tiene saldo a favor de ${money(currentAdvance)}.`
      : "Está al día sin saldo pendiente ni saldo a favor.";
  const statusTone = currentBalance > 0 ? "is-warning" : currentAdvance > 0 ? "is-ok" : "is-neutral";
  const statusValueTone = currentBalance > 0 ? "status-value-due" : currentAdvance > 0 ? "status-value-advance" : "status-value-ontrack";

  topStatus.innerHTML = `
    <div class="status-line status-line-primary ${statusTone}">
      <span class="status-label">Estado actual</span>
      <span class="status-value ${statusValueTone}">${statusText}</span>
    </div>
    <div class="status-line is-highlight">
      <span class="status-label">Exigido al mes actual</span>
      <span class="status-meta"><span class="next-due-month">${currentMonthInfo.name}</span> ${currentMonthInfo.year}</span>
      <span class="status-value amount-general">${money(currentBalance)}</span>
    </div>
    <div class="status-line is-month">
      <span class="status-label">Último mes totalmente cubierto</span>
      <span class="status-value ${lastCoveredMonthClass}">${lastCoveredMonth}</span>
    </div>
  `;

  summary.innerHTML = `
    <article class="metric-card metric-card-balance">
      <span class="metric-label">Saldo actual</span>
      <strong class="metric-value ${currentBalance > 0 ? "positive" : currentAdvance > 0 ? "negative" : ""}">
        ${currentBalance > 0 ? money(currentBalance) : currentAdvance > 0 ? money(currentAdvance) : money(0)}
      </strong>
      <span class="metric-note">${currentBalance > 0 ? "Pendiente acumulado" : currentAdvance > 0 ? "Saldo a favor" : "Sin diferencia pendiente"}</span>
    </article>
    <article class="metric-card metric-card-month">
      <span class="metric-label">Mes de referencia</span>
      <strong class="metric-value">${currentMonthInfo.name} ${currentMonthInfo.year}</strong>
      <span class="metric-note">Último cubierto: <span class="${lastCoveredMonthClass}">${lastCoveredMonth}</span></span>
    </article>
    <article class="metric-card metric-card-paid">
      <span class="metric-label">Total pagado</span>
      <strong class="metric-value amount-paid">${money(totalPaid)}</strong>
      <span class="metric-note">Cuota base: <span class="amount-general">${money(monthlyDue)}</span>, inicio ${monthLabel(startMonth)}</span>
    </article>
    <article class="metric-card metric-card-commission">
      <span class="metric-label">Comisión acumulada</span>
      <strong class="metric-value amount-commission">${money(totalCommission)}</strong>
      <span class="metric-note">${secretaryPercent.toFixed(4)}% por cuota, neto base <span class="amount-net">${money(userMonthly)}</span></span>
    </article>
  `;
}

function renderTable(rows) {
  if (rows.length === 0) {
    historyToggleBtn.hidden = true;
    paymentsBody.innerHTML = `<tr><td colspan="9" class="muted">No hay pagos registrados todavía.</td></tr>`;
    return;
  }

  const reversedRows = [...rows].reverse();
  const hasHiddenRows = reversedRows.length > 3;
  const visibleRows = state.showFullHistory ? reversedRows : reversedRows.slice(0, 3);

  historyToggleBtn.hidden = !hasHiddenRows;
  historyToggleBtn.textContent = state.showFullHistory ? "Ver menos" : "Ver más";

  paymentsBody.innerHTML = visibleRows
    .map((row) => {
      const balanceClass = row.balanceNext > 0 ? "positive" : row.balanceNext < 0 ? "negative" : "";
      return `
        <tr>
          <td class="cell-month" data-label="Mes">${monthLabel(row.month)}</td>
          <td class="cell-amount" data-label="Saldo inicio">${money(row.balanceAtStart)}</td>
          <td class="cell-amount" data-label="Cuota mes"><span class="amount-general">${money(row.monthlyDueApplied)}</span></td>
          <td class="cell-amount" data-label="Total exigido"><span class="amount-general">${money(row.expectedThisMonth)}</span></td>
          <td class="cell-amount" data-label="Pago"><span class="amount-paid">${money(row.paid)}</span></td>
          <td class="cell-amount" data-label="Comisión de secretaría"><span class="amount-commission">${money(row.secretaryCommission)}</span></td>
          <td class="cell-amount" data-label="Neto usuaria"><span class="amount-net">${money(row.netForUser)}</span></td>
          <td class="cell-amount ${balanceClass}" data-label="Saldo próximo mes">${money(row.balanceNext)}</td>
          <td class="actions-cell" data-label="Acción">
            <button type="button" data-month="${row.month}" class="add-more-btn">Abono</button>
            <button type="button" data-id="${row.id}" class="edit-btn">Editar</button>
            <button type="button" data-id="${row.id}" class="danger remove-btn">Eliminar</button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".add-more-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const month = String(btn.dataset.month || "");
      if (!isValidMonthString(month)) return;

      const entered = prompt(`Monto adicional para ${monthLabel(month)} (USD):`, "0");
      if (entered === null) return;

      let amount;
      try {
        amount = parseStrictAmount(entered);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Monto inválido.";
        alert(message);
        return;
      }

      addPayment(month, amount);
      saveState();
      render();
    });
  });

  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = String(btn.dataset.id || "");
      const payment = state.payments.find((p) => String(p.id) === id);
      if (!payment) return;

      const enteredMonth = prompt("Mes del pago (AAAA-MM):", payment.month);
      if (enteredMonth === null) return;
      const month = normalizeMonthString(enteredMonth);
      if (!isValidMonthString(month)) {
        alert("Mes inválido. Usa el formato AAAA-MM.");
        return;
      }
      if (isFutureMonth(month)) {
        alert("No se pueden registrar pagos en meses futuros.");
        return;
      }
      if (isBeforeStartMonth(month)) {
        alert("No se pueden registrar pagos anteriores al mes de inicio.");
        return;
      }

      const enteredAmount = prompt(`Monto para ${monthLabel(month)} (USD):`, String(payment.amount));
      if (enteredAmount === null) return;
      let amount;
      try {
        amount = parseStrictAmount(enteredAmount);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Monto inválido.";
        alert(message);
        return;
      }

      try {
        const updated = updatePayment(id, month, amount);
        if (!updated) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo actualizar el pago.";
        alert(message);
        return;
      }
      saveState();
      render();
    });
  });
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const confirmed = confirm("¿Estás seguro de que quieres eliminar este registro?");
      if (!confirmed) return;

      const id = String(btn.dataset.id || "");
      state.payments = state.payments.filter((p) => String(p.id) !== id);
      saveState();
      render();
    });
  });
}

function getBackupPayload() {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      monthlyDue: state.settings.monthlyDue,
      secretaryPercent: state.settings.secretaryPercent,
      startMonth: getEffectiveStartMonth(),
    },
    payments: state.payments.map((p) => ({
      id: String(p.id),
      month: String(p.month),
      amount: toNumber(p.amount),
      createdAt: toNumber(p.createdAt) || Date.now(),
    })),
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function backupToCsv(payload) {
  const lines = [
    "rowType,version,exportedAt,monthlyDue,secretaryPercent,startMonth,id,month,amount,createdAt",
    [
      "settings",
      payload.version,
      payload.exportedAt,
      payload.settings.monthlyDue,
      payload.settings.secretaryPercent,
      payload.settings.startMonth,
      "",
      "",
      "",
      "",
    ].map(csvEscape).join(","),
  ];

  for (const payment of payload.payments) {
    lines.push([
      "payment",
      payload.version,
      payload.exportedAt,
      "",
      "",
      "",
      payment.id,
      payment.month,
      payment.amount,
      payment.createdAt,
    ].map(csvEscape).join(","));
  }

  return lines.join("\n");
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  let quoteClosed = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
        quoteClosed = true;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === ',') {
      cells.push(cell);
      cell = "";
      quoteClosed = false;
      continue;
    }

    if (ch === '"') {
      if (cell.length > 0 || quoteClosed) {
        throw new Error("El CSV contiene comillas en una posición inválida.");
      }
      inQuotes = true;
      continue;
    }

    if (quoteClosed) {
      throw new Error("El CSV contiene texto después de cerrar una celda entre comillas.");
    }

    cell += ch;
  }

  cells.push(cell);
  if (inQuotes) {
    throw new Error("El CSV contiene comillas sin cerrar.");
  }

  return cells;
}

function csvToBackupObject(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("El CSV está vacío o incompleto.");
  }

  const header = parseCsvLine(lines[0]);
  const legacyHeader = ["rowType", "version", "exportedAt", "monthlyDue", "secretaryPercent", "id", "month", "amount", "createdAt"];
  const expectedHeader = ["rowType", "version", "exportedAt", "monthlyDue", "secretaryPercent", "startMonth", "id", "month", "amount", "createdAt"];
  if (header.join("|") !== expectedHeader.join("|")) {
    if (header.join("|") !== legacyHeader.join("|")) {
      throw new Error("Formato CSV no compatible.");
    }
  }

  const hasStartMonthColumn = header.length === expectedHeader.length;
  let settings = null;
  const payments = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length !== header.length) {
      throw new Error("El CSV contiene filas con cantidad de columnas inválida.");
    }

    const [
      rowType,
      version,
      exportedAt,
      monthlyDue,
      secretaryPercent,
      startMonth,
      id,
      month,
      amount,
      createdAt,
    ] = hasStartMonthColumn
      ? cells
      : [cells[0], cells[1], cells[2], cells[3], cells[4], "", cells[5], cells[6], cells[7], cells[8]];

    if (rowType === "settings") {
      settings = {
        monthlyDue,
        secretaryPercent,
        startMonth: normalizeMonthString(startMonth),
      };
      continue;
    }

    if (rowType === "payment") {
      payments.push({
        id: id || `imported-${i}`,
        month: normalizeMonthString(month),
        amount: parseStrictAmount(amount),
        createdAt: toNumber(createdAt) || Date.now() + i,
      });
      continue;
    }

    if (rowType || version || exportedAt || monthlyDue || secretaryPercent || startMonth || id || month || amount || createdAt) {
      throw new Error("El CSV contiene filas no reconocidas.");
    }
  }

  return {
    settings,
    payments,
  };
}

function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleImportFile(file) {
  const fileName = String(file.name || "");
  const lowerName = fileName.toLowerCase();

  if (file.size > MAX_IMPORT_FILE_BYTES) {
    alert("El respaldo es demasiado grande. El limite es 1 MB.");
    return;
  }

  const text = await file.text();

  let parsed;
  try {
    if (lowerName.endsWith(".csv")) {
      parsed = csvToBackupObject(text);
    } else {
      parsed = JSON.parse(text);
    }

    validateImportData(parsed);

    const ok = confirm("Se reemplazaran los datos actuales con el respaldo importado. Desea continuar?");
    if (!ok) return;

    applyStateData(parsed);
    saveState();
    render();
    alert("Respaldo importado correctamente.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo importar el archivo.";
    alert(`Error al importar: ${message}`);
  }
}

function render() {
  monthlyDueInput.value = state.settings.monthlyDue;
  secretaryPercentInput.value = state.settings.secretaryPercent;
  startMonthInput.value = getEffectiveStartMonth();
  startMonthInput.max = getCurrentMonthValue();
  paymentMonthInput.min = getEffectiveStartMonth();
  paymentMonthInput.max = getCurrentMonthValue();

  const { rows } = calculateRows();
  renderSummary(rows);
  renderTable(rows);
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let monthlyDue;
  try {
    monthlyDue = parseStrictAmount(monthlyDueInput.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cuota mensual inválida.";
    alert(message);
    return;
  }

  let secretaryPercent;
  try {
    secretaryPercent = parseSecretaryPercent(secretaryPercentInput.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comisión de secretaría inválida.";
    alert(message);
    return;
  }

  const startMonth = normalizeMonthString(startMonthInput.value);
  if (!isValidMonthString(startMonth)) {
    alert("Selecciona un mes de inicio válido.");
    return;
  }

  if (isFutureMonth(startMonth)) {
    alert("El mes de inicio no puede ser futuro.");
    return;
  }

  const earliestPaymentMonth = getEarliestPaymentMonth(state.payments);
  if (earliestPaymentMonth && startMonth > earliestPaymentMonth) {
    alert("El mes de inicio no puede ser posterior al primer pago registrado.");
    return;
  }

  state.settings.monthlyDue = monthlyDue;
  state.settings.secretaryPercent = secretaryPercent;
  state.settings.startMonth = startMonth;
  saveState();
  render();
});

paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const month = normalizeMonthString(paymentMonthInput.value);
  let amount;
  try {
    amount = parseStrictAmount(paymentAmountInput.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monto inválido.";
    alert(message);
    return;
  }

  if (!isValidMonthString(month)) {
    alert("Selecciona un mes válido.");
    return;
  }
  if (isFutureMonth(month)) {
    alert("No se pueden registrar pagos en meses futuros.");
    return;
  }
  if (isBeforeStartMonth(month)) {
    alert("No se pueden registrar pagos anteriores al mes de inicio.");
    return;
  }

  try {
    addPayment(month, amount);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar el pago.";
    alert(message);
    return;
  }
  saveState();
  render();

  paymentAmountInput.value = "";
});

historyToggleBtn.addEventListener("click", () => {
  state.showFullHistory = !state.showFullHistory;
  render();
});

clearDataBtn.addEventListener("click", () => {
  const ok = confirm("Esto borrara toda la informacion guardada localmente. Desea continuar?");
  if (!ok) return;

  state.settings = getDefaultSettings();
  state.payments = [];
  state.showFullHistory = false;
  saveState();
  render();
});

exportJsonBtn.addEventListener("click", () => {
  const payload = getBackupPayload();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(JSON.stringify(payload, null, 2), `prestamo-backup-${stamp}.json`, "application/json;charset=utf-8");
});

exportCsvBtn.addEventListener("click", () => {
  const payload = getBackupPayload();
  const csv = backupToCsv(payload);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(csv, `prestamo-backup-${stamp}.csv`, "text/csv;charset=utf-8");
});

importDataBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];
  if (!file) return;

  await handleImportFile(file);
  importFileInput.value = "";
});

loadState();
render();



