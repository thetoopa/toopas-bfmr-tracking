import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT = path.resolve(".");
const OUT_DIR = path.join(ROOT, "data", "live_extract");
const DEFAULT_USER_DATA_DIR = path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BFMR_URL = "https://www.bfmr.com/tracker/all";
const AMAZON_URL = "https://www.amazon.com/gp/css/order-history?ref_=nav_orders_first";
const ORDER_RE = /\b\d{3}-\d{7}-\d{7}\b/;
const MANUAL_ASSUMED_ORDERS = new Set(
  argValue("manual-assumed-orders", "111-1403104-8336261")
    .split(",")
    .map((value) => normalizeOrder(value))
    .filter(Boolean),
);

fs.mkdirSync(OUT_DIR, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function log(message, details = undefined) {
  const line = details === undefined ? message : `${message} ${JSON.stringify(details)}`;
  console.log(`[${new Date().toISOString()}] ${line}`);
}

async function launchProfile(profileDirectory) {
  const port = Number(argValue("port", "9222"));
  const userDataDir = argValue("user-data-dir", DEFAULT_USER_DATA_DIR);
  const endpoint = `http://127.0.0.1:${port}`;
  if (["1", "true", "yes"].includes(argValue("reuse-existing", "").toLowerCase())) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        log("Reusing existing Chrome CDP session", await response.json());
        const browser = await chromium.connectOverCDP(endpoint);
        const context = browser.contexts()[0] || await browser.newContext({ viewport: null });
        return { browser, context };
      }
    } catch {
      // No existing controllable Chrome on this port.
    }
  }

  let portInUse = false;
  try {
    const response = await fetch(`${endpoint}/json/version`);
    portInUse = response.ok;
  } catch {
    portInUse = false;
  }
  if (portInUse) {
    throw new Error(`Chrome debugging port ${port} is already in use. Stop that Chrome instance or pass --reuse-existing=true.`);
  }

  log("Launching visible Chrome profile with CDP", { profileDirectory, port, userDataDir });
  spawn(CHROME_EXE, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`,
    "--no-first-run",
    "--start-maximized",
    "--new-window",
    "about:blank",
  ], {
    detached: true,
    stdio: "ignore",
  }).unref();

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        log("Chrome CDP ready", await response.json());
        const browser = await chromium.connectOverCDP(endpoint);
        const context = browser.contexts()[0] || await browser.newContext({ viewport: null });
        return { browser, context };
      }
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Chrome did not open a debugging port at ${endpoint}.`);
}

async function waitForUsefulPage(page, kind) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const tableRows = document.querySelectorAll("table tbody tr, table tr, [role='row']").length;
      return {
        url: location.href,
        title: document.title,
        tableRows,
        text: text.slice(0, 1200),
        needsLogin: /sign in|login|password|verification|captcha|two-step|otp/i.test(text),
      };
    }).catch((error) => ({ error: error.message, tableRows: 0, text: "" }));

    log("Page state", { kind, url: state.url, title: state.title, tableRows: state.tableRows, needsLogin: state.needsLogin });
    if (kind === "bfmr" && state.tableRows > 2 && /order|tracking|payout|retail|status|item/i.test(state.text)) return state;
    if (kind === "amazon" && (/your orders|orders|order placed|order details/i.test(state.text) || state.tableRows > 2)) return state;
    await page.waitForTimeout(5000);
  }
  throw new Error(`Timed out waiting for ${kind} content. If a login or verification page is visible, complete it and rerun.`);
}

async function waitForBfmrGridReady(page) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const orderCount = (text.match(/\b\d{3}-\d{7}-\d{7}\b/g) || []).length;
      const hasTrackerHeaders = /\bStatus\b/i.test(text)
        && /\bItems?\b/i.test(text)
        && /Order\s*(No\.?|#|Number)/i.test(text)
        && /Retail\s*Price/i.test(text);
      const holders = [...document.querySelectorAll(".wtHolder, [class*='wtHolder']")].map((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        text: String(el.innerText || el.textContent || "").slice(0, 2000),
      }));
      const holderOrderCount = holders.reduce((sum, holder) => sum + ((holder.text.match(/\b\d{3}-\d{7}-\d{7}\b/g) || []).length), 0);
      return {
        url: location.href,
        title: document.title,
        orderCount,
        holderOrderCount,
        hasTrackerHeaders,
        holderCount: holders.length,
        loadingText: /loading|please wait/i.test(text),
      };
    }).catch((error) => ({ error: error.message, orderCount: 0, holderOrderCount: 0, hasTrackerHeaders: false }));
    log("BFMR grid readiness", state);
    if (state.hasTrackerHeaders && (state.orderCount >= 5 || state.holderOrderCount >= 5)) return state;
    await page.waitForTimeout(3000);
  }
  throw new Error("Timed out waiting for BFMR tracker rows to load.");
}

async function extractRowsFromCurrentPage(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const orderRe = /\b\d{3}-\d{7}-\d{7}\b/;
    const normalizeHeader = (value, index) => clean(value) || `Column ${index + 1}`;

    const headersFromTable = (table) => {
      const explicit = table.tHead
        ? [...table.tHead.rows[0]?.cells || []].map((cell, index) => normalizeHeader(cell.innerText || cell.textContent, index))
        : [];
      if (explicit.length) return explicit;
      const first = table.rows[0];
      return [...(first?.cells || [])].map((cell, index) => normalizeHeader(cell.innerText || cell.textContent, index));
    };

    const rowFromCells = (headers, cells, rawText, source) => {
      const values = {};
      cells.forEach((cell, index) => {
        values[headers[index] || `Column ${index + 1}`] = clean(cell.innerText || cell.textContent);
      });
      values.__raw_cells = cells.map((cell) => clean(cell.innerText || cell.textContent));
      values.__raw_text = clean(rawText);
      values.__source = source;
      return values;
    };

    const validScore = (row) => {
      const status = clean(row.Status || row.State);
      const item = clean(row.Items || row.Item || row["Item Name"] || row.Product || row.Name);
      const order = clean(row["Order No."] || row["Order #"] || row.Order || row["Order Number"]);
      return status && item && orderRe.test(order) ? 1 : 0;
    };

    for (const table of document.querySelectorAll("table")) {
      const directRows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
      const headerIndex = directRows.findIndex((tr) => {
        const text = [...tr.children].map((cell) => clean(cell.innerText || cell.textContent)).join(" | ");
        return /\bStatus\b/i.test(text)
          && /\bItems?\b/i.test(text)
          && /Order\s*(No\.?|#|Number)/i.test(text)
          && /Retail\s*Price/i.test(text);
      });
      if (headerIndex < 0) continue;

      const headers = [...directRows[headerIndex].children].map((cell, index) => normalizeHeader(cell.innerText || cell.textContent, index));
      const rows = [];
      for (const tr of directRows.slice(headerIndex + 1)) {
        const cells = [...tr.children];
        if (cells.length < headers.length - 2) continue;
        rows.push(rowFromCells(headers, cells, tr.innerText || tr.textContent, "bfmr-table"));
      }
      if (rows.reduce((sum, row) => sum + validScore(row), 0) >= 10) return rows;
    }

    let bestRows = [];
    let bestScore = -1;
    for (const table of document.querySelectorAll("table")) {
      const directRows = [...table.querySelectorAll("tr")];
      const headers = headersFromTable(table);
      const bodyRows = directRows.slice(headers.length ? 1 : 0);
      const tableRows = [];
      for (const tr of bodyRows) {
        const cells = [...tr.querySelectorAll("td,th")];
        if (cells.length) tableRows.push(rowFromCells(headers, cells, tr.innerText || tr.textContent, "table"));
      }
      const score = tableRows.reduce((sum, row) => sum + validScore(row), 0);
      if (score > bestScore) {
        bestScore = score;
        bestRows = tableRows;
      }
    }

    if (!bestRows.length) {
      const gridHeaders = [...document.querySelectorAll("[role='columnheader']")].map((cell, index) => normalizeHeader(cell.innerText || cell.textContent, index));
      const rows = [];
      for (const row of document.querySelectorAll("[role='row']")) {
        const cells = [...row.querySelectorAll("[role='cell'], [role='gridcell']")];
        if (cells.length) rows.push(rowFromCells(gridHeaders, cells, row.innerText || row.textContent, "aria-grid"));
      }
      bestRows = rows;
    }

    return bestRows;
  });
}

async function collectPaginatedRows(page) {
  const seen = new Set();
  const allRows = [];
  for (let pageIndex = 1; pageIndex <= 100; pageIndex += 1) {
    await page.waitForTimeout(1500);

    const virtualScroll = await page.evaluate(() => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const holders = [...document.querySelectorAll(".wtHolder, [class*='wtHolder']")]
        .map((el, index) => ({
          index,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          text: clean(el.innerText || el.textContent),
        }))
        .filter((item) => item.scrollHeight > item.clientHeight + 50 && /\b\d{3}-\d{7}-\d{7}\b/.test(item.text));
      holders.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      return holders[0] || null;
    }).catch(() => null);

    const positions = [];
    if (virtualScroll) {
      const step = Math.max(250, Math.floor(virtualScroll.clientHeight * 0.65));
      for (let y = 0; y <= virtualScroll.scrollHeight - virtualScroll.clientHeight; y += step) positions.push(y);
      positions.push(virtualScroll.scrollHeight);
    } else {
      positions.push(null);
    }

    let visibleRows = 0;
    for (const y of positions) {
      if (y === null) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
      } else {
        await page.evaluate((top) => {
          const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
          const holders = [...document.querySelectorAll(".wtHolder, [class*='wtHolder']")]
            .filter((el) => el.scrollHeight > el.clientHeight + 50 && /\b\d{3}-\d{7}-\d{7}\b/.test(clean(el.innerText || el.textContent)));
          holders.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
          if (holders[0]) holders[0].scrollTop = top;
        }, y).catch(() => undefined);
      }
      await page.waitForTimeout(500);
      const rows = await extractRowsFromCurrentPage(page);
      visibleRows += rows.length;
      for (const row of rows) {
        const key = JSON.stringify(row.__raw_cells || row);
        if (!seen.has(key)) {
          seen.add(key);
          allRows.push({ ...row, __page: pageIndex, __scroll_top: y });
        }
      }
    }
    log("Collected page rows", { pageIndex, visibleRows, total: allRows.length });

    const clickedNext = await page.evaluate(() => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const candidates = [...document.querySelectorAll("a,button,[role='button']")].filter((el) => {
        const text = clean(el.innerText || el.textContent || el.getAttribute("aria-label"));
        const disabled = el.disabled || el.getAttribute("aria-disabled") === "true" || /\bdisabled\b/i.test(el.className || "");
        return !disabled && (text === "next" || text === ">" || text === "›" || text.includes("next page"));
      });
      const next = candidates.at(-1);
      if (!next) return false;
      next.scrollIntoView({ block: "center", inline: "center" });
      next.click();
      return true;
    });
    if (!clickedNext) break;
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
  }
  return allRows;
}

function validBfmrRows(rows) {
  return rows.filter((row) => {
    const status = String(row.Status || row.State || "").trim();
    const item = String(row.Items || row.Item || row["Item Name"] || row.Product || "").trim();
    const order = normalizeOrder(row["Order No."] || row["Order #"] || row.Order || row["Order Number"]);
    return status && item && order;
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `POST ${url} failed`);
  return result;
}

async function extractBfmr(profileDirectory) {
  const { browser, context } = await launchProfile(profileDirectory);
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => undefined);
    log("Navigating BFMR", { url: BFMR_URL });
    await page.goto(BFMR_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("BFMR navigation warning", { error: error.message }));
    await waitForUsefulPage(page, "bfmr");
    let rows = [];
    let validRows = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await waitForBfmrGridReady(page);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (const holder of document.querySelectorAll(".wtHolder, [class*='wtHolder']")) holder.scrollTop = 0;
      }).catch(() => undefined);
      rows = await collectPaginatedRows(page);
      validRows = validBfmrRows(rows);
      log("BFMR extraction validation", { attempt, rows: rows.length, validRows: validRows.length });
      if (validRows.length >= 10) break;
      if (attempt === 4) {
        log("Reloading BFMR after incomplete grid extract", { rows: rows.length, validRows: validRows.length });
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("BFMR reload warning", { error: error.message }));
      }
      await page.waitForTimeout(4000);
    }
    if (validRows.length < 10) {
      throw new Error(`BFMR extraction looked invalid: only ${validRows.length} valid data rows out of ${rows.length} extracted rows. Refusing to overwrite local data.`);
    }
    const payload = {
      type: "bfmr_tracker_rows_live",
      source_url: page.url(),
      extracted_at: new Date().toISOString(),
      rows,
    };
    const file = path.join(OUT_DIR, `bfmr-live-${stamp()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    log("Saved BFMR raw extract", { file, rows: rows.length });
    const result = await postJson("http://127.0.0.1:8765/api/site-sync", payload);
    log("Updated local BFMR dataset", {
      rows: result.records?.length,
      estimated_purchase_rows: result.summary?.estimated_purchase_rows,
    });
    return { file, rows: rows.length };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function normalizeOrder(value) {
  const match = String(value ?? "").match(ORDER_RE);
  return match ? match[0] : "";
}

function loadAmazonTargets(accountLabel) {
  const dataset = readJsonFile(path.join(ROOT, "data", "bfmr_records.json"), { records: [] });
  const existing = readJsonFile(path.join(ROOT, "data", "amazon_orders.json"), []);
  const skipPaid = ["1", "true", "yes"].includes(argValue("skip-paid", "").toLowerCase());
  const refreshAll = ["1", "true", "yes"].includes(argValue("refresh-all", "").toLowerCase());
  const now = Date.now();
  const staleEtaMs = 12 * 60 * 60 * 1000;
  const needsEtaRefresh = (order) => {
    const status = String(order.delivery_status || "").toLowerCase();
    if (status.includes("delivered")) return false;
    const scrapedAt = Date.parse(order.delivery_scraped_at || order.detail_scraped_at || "");
    return !scrapedAt || now - scrapedAt > staleEtaMs;
  };
  const personalFound = new Set(
    existing
      .filter((order) => String(order.account || "").toLowerCase() === "personal" && order.detail_scraped_at)
      .map((order) => normalizeOrder(order.order_number))
      .filter(Boolean),
  );
  const alreadyFound = new Set(
    existing
      .filter((order) => order.detail_scraped_at && !needsEtaRefresh(order))
      .map((order) => normalizeOrder(order.order_number))
      .filter(Boolean),
  );
  const existingByOrder = new Map(
    existing
      .map((order) => [normalizeOrder(order.order_number), order])
      .filter(([order]) => Boolean(order)),
  );
  const targets = [];
  const seen = new Set();
  for (const record of dataset.records || []) {
    const order = normalizeOrder(record.order_number);
    if (!order || seen.has(order)) continue;
    const status = String(record.status || "").trim().toLowerCase();
    if (status === "cancelled") continue;
    if (!refreshAll && skipPaid && status === "paid" && !needsEtaRefresh(existingByOrder.get(order) || {})) continue;
    if (MANUAL_ASSUMED_ORDERS.has(order)) continue;
    if (!refreshAll && (!skipPaid || status === "paid") && alreadyFound.has(order)) continue;
    seen.add(order);
    if (String(accountLabel || "").toLowerCase() === "business" && personalFound.has(order)) continue;
    targets.push({
      order_number: order,
      status: record.status || "",
      item_name: record.item_name || "",
      date: record.date || "",
    });
  }
  return targets;
}

async function waitForAmazonReady(page) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        url: location.href,
        title: document.title,
        text: text.slice(0, 1600),
        needsLogin: /sign in|password|two-step|verification|captcha|otp|approve/i.test(text),
      };
    }).catch((error) => ({ error: error.message, text: "", needsLogin: false }));
    log("Amazon page state", { url: state.url, title: state.title, needsLogin: state.needsLogin });
    if (/your orders|order placed|order details|ordered on|payment method|buy again/i.test(state.text)) return state;
    await page.waitForTimeout(5000);
  }
  throw new Error("Timed out waiting for Amazon account/order content.");
}

async function extractAmazonOrderDetail(page, orderNumber) {
  const detailUrl = `https://www.amazon.com/gp/your-account/order-details?orderID=${encodeURIComponent(orderNumber)}`;
  log("Opening Amazon order detail", { orderNumber, detailUrl });
  await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("Amazon navigation warning", { orderNumber, error: error.message }));
  await waitForAmazonReady(page);
  await page.waitForTimeout(1500);
  return page.evaluate((expectedOrder) => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const text = clean(document.body?.innerText || "");
    const orderMatch = text.match(/\b\d{3}-\d{7}-\d{7}\b/);
    const reward =
      text.match(/Earns\s+\d+(?:\.\d+)?%\s+back(?:[^.\n]*?(?:extra|additional|No-Rush)[^.\n]*?\d+(?:\.\d+)?%[^.\n]*)?/i) ||
      text.match(/\d+(?:\.\d+)?%\s+(?:back|cash\s*back)(?:[^.\n]*?(?:extra|additional|No-Rush)[^.\n]*)?/i);
    const payment =
      text.match(/Payment method\s+(.{0,240}?)(?:Earns|Billing address|Order Summary|Transactions|$)/i) ||
      text.match(/Payment Method\s+(.{0,240}?)(?:Earns|Billing address|Order Summary|Transactions|$)/i);
    const total =
      text.match(/Order total\s*:?\s*(\$[\d,]+(?:\.\d{2})?)/i) ||
      text.match(/Grand Total\s*:?\s*(\$[\d,]+(?:\.\d{2})?)/i) ||
      text.match(/Total\s*:?\s*(\$[\d,]+(?:\.\d{2})?)/i);
    const date =
      text.match(/Order placed\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i) ||
      text.match(/Ordered on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
    const deliveryPatterns = [
      /\b(?:Arriving|Expected|Estimated delivery|Delivery estimate|Now arriving)\s+([^.\n]{3,120})/i,
      /\b(?:Out for delivery|Shipped|Preparing for shipment|Not yet shipped|Running late|Delayed)\b[^.\n]{0,120}/i,
      /\bDelivered\s+([^.\n]{0,120})/i,
    ];
    const deliveryMatch = deliveryPatterns.map((pattern) => text.match(pattern)).find(Boolean);
    const deliveryText = clean(deliveryMatch?.[0] || "");
    const delivered = /\bdelivered\b/i.test(deliveryText) || /\bdelivered\b/i.test(text.slice(0, 2000));
    const weekday = "\\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\b";
    const monthName = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
    const etaDate =
      deliveryText.match(new RegExp(`${weekday},?\\s+${monthName}\\s+\\d{1,2}`, "i")) ||
      deliveryText.match(new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:\\s*-\\s*\\d{1,2})?\\b`, "i")) ||
      deliveryText.match(/\bToday\b|\bTomorrow\b/i) ||
      deliveryText.match(new RegExp(weekday, "i"));
    const lineItems = [...document.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']")]
      .map((link) => clean(link.innerText || link.getAttribute("aria-label") || ""))
      .filter((value) => value.length > 8)
      .slice(0, 20);
    return {
      order_number: orderMatch?.[0] || expectedOrder,
      order_date: date?.[1] || "",
      order_total: total?.[1] || "",
      payment_method: payment?.[1] || "",
      reward_text: reward?.[0] || "",
      delivery_status: delivered ? "Delivered" : deliveryText || "",
      delivery_eta: delivered ? "" : clean(etaDate?.[0] || ""),
      delivery_scraped_at: new Date().toISOString(),
      detail_url: location.href,
      detail_scraped_at: new Date().toISOString(),
      line_items: [...new Set(lineItems)],
      raw_text: text.slice(0, 8000),
      found_expected_order: text.includes(expectedOrder),
    };
  }, orderNumber);
}

async function extractAmazon(profileDirectory, accountLabel) {
  const { browser, context } = await launchProfile(profileDirectory);
  const page = context.pages()[0] || await context.newPage();
  try {
    log("Navigating Amazon orders", { url: AMAZON_URL, accountLabel });
    await page.goto(AMAZON_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("Amazon orders navigation warning", { error: error.message }));
    await waitForAmazonReady(page);
    const targets = loadAmazonTargets(accountLabel);
    log("Loaded Amazon targets", { count: targets.length, accountLabel });
    const rows = [];
    for (const target of targets) {
      const row = await extractAmazonOrderDetail(page, target.order_number);
      if (row.found_expected_order) {
        rows.push(row);
        log("Captured Amazon order detail", {
          order_number: row.order_number,
          reward_text: row.reward_text,
          payment_method: row.payment_method,
          order_total: row.order_total,
          delivery_status: row.delivery_status,
          delivery_eta: row.delivery_eta,
        });
      } else {
        log("Amazon detail did not expose expected order", { order_number: target.order_number, url: row.detail_url });
      }
    }
    const payload = {
      type: "amazon_order_details_live",
      source_url: page.url(),
      extracted_at: new Date().toISOString(),
      account: accountLabel,
      profile: profileDirectory,
      rows,
    };
    const file = path.join(OUT_DIR, `amazon-${accountLabel.toLowerCase()}-${stamp()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    log("Saved Amazon raw extract", { file, rows: rows.length, accountLabel });
    if (rows.length) {
      const result = await postJson("http://127.0.0.1:8765/api/amazon-orders", {
        rows,
        account: accountLabel,
        profile: profileDirectory,
        source_url: page.url(),
      });
      log("Updated local Amazon orders", {
        imported: result.imported,
        matched: result.metadata?.amazon_matched_orders,
        precise: result.metadata?.amazon_precise_cashback_matches,
      });
    }
    return { file, rows: rows.length };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  const stage = argValue("stage", "bfmr");
  const rawProfile = argValue("profile", "Default");
  const profile = rawProfile === "Profile9" ? "Profile 9" : rawProfile;
  if (stage === "bfmr") {
    await extractBfmr(profile);
    return;
  }
  if (stage === "amazon") {
    await extractAmazon(profile, argValue("account", "personal"));
    return;
  }
  throw new Error(`Unknown stage: ${stage}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
