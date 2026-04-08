const STORAGE_KEY = "prestamo_data_v1";
const BACKUP_VERSION = 1;
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;
const MAX_IMPORT_PAYMENTS = 5000;

const state = {
  settings: {
    monthlyDue: 120,
    secretaryPercent: 16.6667,
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

function parseStrictAmount(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("El monto debe ser un numero valido mayor o igual a 0.");
    }
    return value;
  }

  const text = String(value ?? "").trim();
  if (text === "") {
    throw new Error("El monto es obligatorio.");
  }

  const normalized = text.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("El monto debe ser un numero valido mayor o igual a 0.");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("El monto debe ser un numero valido mayor o igual a 0.");
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

function validateImportData(parsed) {
  if (!isObject(parsed)) {
    throw new Error("El respaldo debe ser un objeto JSON valido.");
  }

  if (!isObject(parsed.settings)) {
    throw new Error("El respaldo no incluye configuracion valida.");
  }

  if (!Array.isArray(parsed.payments)) {
    throw new Error("El respaldo no incluye la lista de pagos.");
  }

  if (parsed.payments.length > MAX_IMPORT_PAYMENTS) {
    throw new Error(`El respaldo supera el limite de ${MAX_IMPORT_PAYMENTS} pagos.`);
  }

  if (!Number.isFinite(Number(parsed.settings.monthlyDue))) {
    throw new Error("La cuota mensual del respaldo no es valida.");
  }

  if (!Number.isFinite(Number(parsed.settings.secretaryPercent))) {
    throw new Error("La comision de secretaria del respaldo no es valida.");
  }

  for (const payment of parsed.payments) {
    if (!isObject(payment)) {
      throw new Error("El respaldo contiene pagos con formato invalido.");
    }

    if (!isValidMonthString(payment.month)) {
      throw new Error("El respaldo contiene meses de pago invalidos.");
    }

    try {
      parseStrictAmount(payment.amount);
    } catch {
      throw new Error("El respaldo contiene montos de pago invalidos.");
    }

    if (payment.createdAt !== undefined && !Number.isFinite(Number(payment.createdAt))) {
      throw new Error("El respaldo contiene fechas de registro invalidas.");
    }
  }
}

function normalizeStateData(parsed) {
  const normalized = {
    settings: {
      monthlyDue: 120,
      secretaryPercent: 16.6667,
    },
    payments: [],
  };

  if (parsed && typeof parsed === "object" && parsed.settings) {
    normalized.settings.monthlyDue = Math.max(0, toNumber(parsed.settings.monthlyDue));
    normalized.settings.secretaryPercent = Math.max(0, Math.min(100, toNumber(parsed.settings.secretaryPercent)));
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.payments)) {
    normalized.payments = parsed.payments
      .map((p, i) => ({
        id: normalizePaymentId(p.id, i),
        month: normalizeMonthString(p.month),
        amount: parseStrictAmount(p.amount),
        createdAt: toNumber(p.createdAt) || Date.now() + i,
      }))
      .filter((p) => isValidMonthString(p.month));
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
    id: makePaymentId(),
    month,
    amount,
    createdAt: Date.now(),
  });
}

function updatePayment(id, month, amount) {
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
  const closings = getMonthlyClosings(rows);

  if (closings.length === 0) {
    return monthlyDue;
  }

  const firstRecordedMonth = closings[0].month;
  if (targetMonth < firstRecordedMonth) {
    return monthlyDue;
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
  if (rows.length === 0) {
    return null;
  }

  const monthlyDue = state.settings.monthlyDue;
  if (monthlyDue <= 0) {
    return getCurrentMonthValue();
  }

  const closings = getMonthlyClosings(rows);
  let lastCoveredMonth = null;
  let previousMonth = null;
  let previousBalance = 0;

  for (const closing of closings) {
    if (previousMonth) {
      let cursor = addOneMonth(previousMonth);
      while (cursor < closing.month) {
        previousBalance += monthlyDue;
        if (previousBalance <= 0) {
          lastCoveredMonth = cursor;
        }
        previousMonth = cursor;
        cursor = addOneMonth(cursor);
      }
    }

    previousBalance = closing.balanceNext;
    if (previousBalance <= 0) {
      lastCoveredMonth = closing.month;
    }
    previousMonth = closing.month;
  }

  if (!previousMonth) {
    return null;
  }

  let cursor = addOneMonth(previousMonth);
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

function renderSummary(finalBalance, rows) {
  const monthlyDue = state.settings.monthlyDue;
  const secretaryPercent = state.settings.secretaryPercent;
  const secretaryMonthly = monthlyDue * (secretaryPercent / 100);
  const userMonthly = monthlyDue - secretaryMonthly;
  const currentMonth = getCurrentMonthValue();
  const currentMonthInfo = monthParts(currentMonth);
  const currentDueLabel = `Total exigido para <span class="next-due-month">${currentMonthInfo.name}</span> de ${currentMonthInfo.year}`;
  const currentBalance = Math.max(0, getBalanceAtMonth(rows, currentMonth));
  const lastCoveredMonthValue = getLastCoveredMonth(rows);
  const lastCoveredMonth = lastCoveredMonthValue ? monthLabel(lastCoveredMonthValue) : "Ningun mes totalmente cubierto";
  const lastCoveredMonthClass = lastCoveredMonthValue ? "month-value" : "month-value-empty";

  const statusText = currentBalance > 0
    ? `Tiene atraso acumulado de ${money(currentBalance)} al mes actual.`
    : finalBalance < 0
      ? `Tiene saldo a favor de ${money(Math.abs(finalBalance))}.`
      : "Esta al dia sin saldo pendiente ni saldo a favor.";
  const statusTone = currentBalance > 0 ? "is-warning" : finalBalance < 0 ? "is-ok" : "is-neutral";
  const statusValueTone = currentBalance > 0 ? "status-value-due" : finalBalance < 0 ? "status-value-advance" : "status-value-ontrack";

  topStatus.innerHTML = `
    <div class="status-line ${statusTone}">
      <span class="status-label">Estado actual</span>
      <span class="status-value ${statusValueTone}">${statusText}</span>
    </div>
    <div class="status-line is-highlight">
      <span class="status-label">${currentDueLabel}</span>
      <span class="status-value amount-general">${money(currentBalance)}</span>
    </div>
    <div class="status-line is-month">
      <span class="status-label">Ultimo mes totalmente cubierto</span>
      <span class="status-value ${lastCoveredMonthClass}">${lastCoveredMonth}</span>
    </div>
  `;

  summary.innerHTML = `
    <div><strong>Cuota mensual:</strong> <span class="amount-general">${money(monthlyDue)}</span></div>
    <div><strong>Comision secretaria:</strong> <span class="amount-commission">${secretaryPercent.toFixed(4)}% (${money(secretaryMonthly)} por cuota base)</span></div>
    <div><strong>Neto para usuaria por cuota base:</strong> <span class="amount-net">${money(userMonthly)}</span></div>
  `;
}

function renderTable(rows) {
  if (rows.length === 0) {
    historyToggleBtn.hidden = true;
    paymentsBody.innerHTML = `<tr><td colspan="9" class="muted">No hay pagos registrados todavia.</td></tr>`;
    return;
  }

  const reversedRows = [...rows].reverse();
  const hasHiddenRows = reversedRows.length > 3;
  const visibleRows = state.showFullHistory ? reversedRows : reversedRows.slice(0, 3);

  historyToggleBtn.hidden = !hasHiddenRows;
  historyToggleBtn.textContent = state.showFullHistory ? "Ver menos" : "Ver mas";

  paymentsBody.innerHTML = visibleRows
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
            <button type="button" data-id="${row.id}" class="edit-btn">Editar pago</button>
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
        const message = error instanceof Error ? error.message : "Monto invalido.";
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
        alert("Mes invalido. Usa el formato AAAA-MM.");
        return;
      }

      const enteredAmount = prompt(`Monto para ${monthLabel(month)} (USD):`, String(payment.amount));
      if (enteredAmount === null) return;
      let amount;
      try {
        amount = parseStrictAmount(enteredAmount);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Monto invalido.";
        alert(message);
        return;
      }

      const updated = updatePayment(id, month, amount);
      if (!updated) return;
      saveState();
      render();
    });
  });
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const confirmed = confirm("Estas seguro de que quieres eliminar este registro?");
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
    "rowType,version,exportedAt,monthlyDue,secretaryPercent,id,month,amount,createdAt",
    [
      "settings",
      payload.version,
      payload.exportedAt,
      payload.settings.monthlyDue,
      payload.settings.secretaryPercent,
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

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === ',') {
      cells.push(cell);
      cell = "";
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    cell += ch;
  }

  cells.push(cell);
  return cells;
}

function csvToBackupObject(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("El CSV esta vacio o incompleto.");
  }

  const header = parseCsvLine(lines[0]);
  const expectedHeader = ["rowType", "version", "exportedAt", "monthlyDue", "secretaryPercent", "id", "month", "amount", "createdAt"];
  if (header.join("|") !== expectedHeader.join("|")) {
    throw new Error("Formato CSV no compatible.");
  }

  let settings = null;
  const payments = [];

  for (let i = 1; i < lines.length; i += 1) {
    const [rowType, version, exportedAt, monthlyDue, secretaryPercent, id, month, amount, createdAt] = parseCsvLine(lines[i]);

    if (rowType === "settings") {
      settings = {
        monthlyDue: toNumber(monthlyDue),
        secretaryPercent: toNumber(secretaryPercent),
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

    if (rowType || version || exportedAt || monthlyDue || secretaryPercent || id || month || amount || createdAt) {
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

  const { rows, finalBalance } = calculateRows();
  renderSummary(finalBalance, rows);
  renderTable(rows);
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    state.settings.monthlyDue = parseStrictAmount(monthlyDueInput.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cuota mensual invalida.";
    alert(message);
    return;
  }

  state.settings.secretaryPercent = Math.max(0, Math.min(100, toNumber(secretaryPercentInput.value)));
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
    const message = error instanceof Error ? error.message : "Monto invalido.";
    alert(message);
    return;
  }

  if (!isValidMonthString(month)) {
    alert("Selecciona un mes valido.");
    return;
  }

  addPayment(month, amount);
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

  state.settings = { monthlyDue: 120, secretaryPercent: 16.6667 };
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



