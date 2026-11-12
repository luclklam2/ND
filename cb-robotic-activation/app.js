"use strict";

const brands = ["Dermes", "Elyze", "Reenex"];
const metrics = ["acb", "icb"];
const numeratorKeys = ["acb_with_robotic", "segment_c_with_robotic", "other_icb_with_robotic"];
const denominatorKeys = ["acb", "segment_c", "other_icb"];
const storageKey = "nd.cb-robotic-activation.v1";
const format = new Intl.NumberFormat("en-HK");
const slots = { early: null, late: null };
const requestId = { early: 0, late: 0 };

function headerKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toCount(value, address) {
  const numericText = typeof value === "string" && /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim());
  const count = numericText ? Number(value.trim().replaceAll(",", "")) : value;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(address + " 需要填寫有效嘅非負整數。");
  }
  return count;
}

function sumCounts(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("加總數字超出支援範圍。");
  return result;
}

function aggregateWorkbook(bytes, slot) {
  const workbook = XLSX.read(bytes, { type: "array" });
  const required = ["brand", ...numeratorKeys, ...(slot === "early" ? denominatorKeys : [])];
  const matches = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const previewRange = { s: range.s, e: { r: Math.min(range.s.r + 29, range.e.r), c: range.e.c } };
    const preview = XLSX.utils.sheet_to_json(sheet, { header: 1, range: previewRange, blankrows: true });
    const header = preview.findIndex(row => required.every(key => row.some(cell => headerKey(cell) === key)));
    if (header >= 0) matches.push({ name, sheet, range, header, columns: preview[header].map(headerKey) });
  }
  if (matches.length === 0) throw new Error("搵唔到所需 Excel 欄位（" + required.join(", ") + "）。");
  if (matches.length > 1) throw new Error("有多個分頁符合格式。請上載只包含一個數據分頁嘅 Excel。");
  const { name, sheet, range, header, columns } = matches[0];
  if (required.some(key => columns.indexOf(key) !== columns.lastIndexOf(key))) {
    throw new Error("Excel 有重複欄名，請核對後再上載。");
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1, blankrows: true,
    range: { s: { r: range.s.r + header + 1, c: range.s.c }, e: range.e },
  });
  const values = Object.fromEntries(brands.map(brand => [brand, {
    acb: 0, icb: 0, ...(slot === "early" ? { acbBase: 0, icbBase: 0 } : {}),
  }]));
  const seen = new Set();
  const column = Object.fromEntries(required.map(key => [key, columns.indexOf(key)]));
  for (const [i, row] of rows.entries()) {
    if (!row.some(value => String(value ?? "").trim() !== "")) continue;
    const rowNumber = range.s.r + header + i + 2;
    const rawBrand = String(row[column.brand] ?? "").trim().toLowerCase();
    if (rawBrand === "total" || rawBrand === "grand total") continue;
    const brand = brands.find(item => item.toLowerCase() === rawBrand);
    if (!brand) throw new Error(name + " 第 " + rowNumber + " 行嘅品牌無法識別。");
    seen.add(brand);
    const count = key => toCount(row[column[key]], name + " 第 " + rowNumber + " 行 " + key);
    const item = values[brand];
    item.acb = sumCounts(item.acb, count("acb_with_robotic"));
    item.icb = sumCounts(item.icb, sumCounts(count("segment_c_with_robotic"), count("other_icb_with_robotic")));
    if (slot === "early") {
      item.acbBase = sumCounts(item.acbBase, count("acb"));
      item.icbBase = sumCounts(item.icbBase, sumCounts(count("segment_c"), count("other_icb")));
    }
  }
  if (!seen.size) throw new Error("Excel 未有可用嘅品牌數據。");
  const keys = Object.keys(values.Dermes);
  const absent = brands.filter(brand => !seen.has(brand));
  values.Total = absent.length ? null : Object.fromEntries(keys.map(key => [
    key, brands.reduce((sum, brand) => sumCounts(sum, values[brand][key]), 0),
  ]));
  for (const brand of absent) values[brand] = null;
  if (values.Total) sumCounts(values.Total.acb, values.Total.icb);
  return { values, absent };
}

function ratio(cell, actual, base, difference) {
  cell.replaceChildren();
  const count = document.createElement("span");
  count.className = "ratio";
  count.textContent = actual == null ? "—" : format.format(actual);
  if (actual != null && base != null) {
    const denominator = document.createElement("span");
    denominator.className = "denominator";
    denominator.textContent = "/" + format.format(base);
    count.append(denominator);
  }
  cell.append(count);
  if (difference != null) {
    const delta = document.createElement("span");
    delta.className = "delta";
    delta.textContent = (difference > 0 ? "+" : "") + format.format(difference);
    delta.setAttribute("aria-label", "較 18:00 " + delta.textContent);
    cell.append(delta);
  }
}

const body = document.querySelector("#results-body");
const resultRows = [...brands, "Total"].map(brand => {
  const row = body.insertRow();
  row.className = brand.toLowerCase();
  const label = document.createElement("th");
  label.scope = "row";
  label.textContent = brand;
  row.append(label);
  return { brand, cells: Array.from({ length: 4 }, () => row.insertCell()) };
});

function renderResults() {
  for (const { brand, cells } of resultRows) {
    const early = slots.early?.values[brand];
    const late = slots.late?.values[brand];
    for (const [i, metric] of metrics.entries()) {
      const base = early?.[metric + "Base"];
      ratio(cells[i], early?.[metric], base);
      const difference = early && late ? late[metric] - early[metric] : null;
      ratio(cells[i + 2], late?.[metric], base, difference);
    }
  }
  const total = slots.late?.values.Total;
  document.querySelector("#combined-value").textContent = total ? format.format(total.acb + total.icb) : "—";
}

function save() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(slots)); } catch { /* Data remains available on this page. */ }
}
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  for (const slot of Object.keys(slots)) slots[slot] = saved?.[slot] ?? null;
} catch { /* The page can still accept files. */ }

for (const panel of document.querySelectorAll(".upload")) {
  const { slot } = panel.dataset;
  const input = panel.querySelector("input");
  const status = panel.querySelector(".file-status");
  const error = panel.querySelector(".file-error");
  const clear = panel.querySelector(".clear");
  const showStatus = () => {
    const current = slots[slot];
    status.textContent = current ? "已讀取 " + current.name : "未上載";
    if (current?.absent.length) status.textContent += " · 缺少 " + current.absent.join("、") + "，總數暫留空";
    clear.hidden = !current;
  };
  showStatus();
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const id = ++requestId[slot];
    input.value = "";
    error.hidden = true;
    status.textContent = "讀取緊 " + file.name;
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error("請選擇 .xlsx 或 .xls 檔案。");
      const bytes = await file.arrayBuffer();
      if (id !== requestId[slot]) return;
      const result = aggregateWorkbook(bytes, slot);
      slots[slot] = { name: file.name, ...result };
      save();
      renderResults();
    } catch (problem) {
      if (id !== requestId[slot]) return;
      error.textContent = (problem.message || "讀取 Excel 失敗。") + (slots[slot] ? " 繼續顯示上一份數據。" : "");
      error.hidden = false;
    } finally {
      if (id === requestId[slot]) showStatus();
    }
  });
  clear.addEventListener("click", () => {
    requestId[slot]++;
    slots[slot] = null;
    error.hidden = true;
    save();
    showStatus();
    renderResults();
    input.focus();
  });
}
renderResults();
