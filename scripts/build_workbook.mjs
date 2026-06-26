import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const datasetPath = path.resolve("data", "bfmr_records.json");
const addonsPath = path.resolve("data", "profit_addons.json");
const amazonOrdersPath = path.resolve("data", "amazon_orders.json");
const settingsPath = path.resolve("data", "settings.json");
const outputDir = path.resolve("outputs");
const outputPath = path.join(outputDir, "Toopas_BFMR_Tracking.xlsx");
let dataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
let addons = [];
try {
  const parsedAddons = JSON.parse(await fs.readFile(addonsPath, "utf8"));
  addons = Array.isArray(parsedAddons) ? parsedAddons : [];
} catch {
  addons = [];
}
let amazonOrders = [];
try {
  const parsedAmazonOrders = JSON.parse(await fs.readFile(amazonOrdersPath, "utf8"));
  amazonOrders = Array.isArray(parsedAmazonOrders) ? parsedAmazonOrders : [];
} catch {
  amazonOrders = [];
}

const DEFAULT_CASHBACK_RATE = 0.06;
const ORDER_NUMBER_PATTERN = /\b\d{3}-\d{7}-\d{7}\b/;
const DEFAULT_SETTINGS = {
  assumptions: {
    default_cashback_rate: DEFAULT_CASHBACK_RATE,
    no_order_account: "Personal",
    no_order_cashback_rate: DEFAULT_CASHBACK_RATE,
    manual_assumed_orders: [
      {
        order_number: "111-1403104-8336261",
        account: "Personal",
        cashback_rate: DEFAULT_CASHBACK_RATE,
        note: "Manual 6% assumption per user",
      },
    ],
  },
};
let settings = DEFAULT_SETTINGS;
try {
  const parsedSettings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  settings = {
    ...DEFAULT_SETTINGS,
    ...parsedSettings,
    assumptions: {
      ...DEFAULT_SETTINGS.assumptions,
      ...(parsedSettings.assumptions || {}),
    },
  };
} catch {
  settings = DEFAULT_SETTINGS;
}
const settingsAssumptions = settings.assumptions || DEFAULT_SETTINGS.assumptions;
const defaultCashbackRate = Number(settingsAssumptions.default_cashback_rate || DEFAULT_CASHBACK_RATE);
const noOrderCashbackRate = Number(settingsAssumptions.no_order_cashback_rate || defaultCashbackRate);
const noOrderAccount = settingsAssumptions.no_order_account || "Personal";
const manualAssumedOrders = new Map(
  (settingsAssumptions.manual_assumed_orders || [])
    .map((row) => [
      normalizeOrderNumber(row.order_number),
      {
        account: row.account || "Personal",
        cashback_rate: Number(row.cashback_rate || defaultCashbackRate),
        note: row.note || `Manual ${Math.round(Number(row.cashback_rate || defaultCashbackRate) * 100)}% assumption`,
      },
    ])
    .filter(([order]) => Boolean(order)),
);

function normalizeOrderNumber(value) {
  const text = String(value ?? "").trim();
  const match = text.match(ORDER_NUMBER_PATTERN);
  return match ? match[0] : text;
}

function calculateProfit(record) {
  if (String(record.status || "").toLowerCase() === "cancelled") return 0;
  const payout = Number(record.payout_total || 0);
  const purchase = Number(record.purchase_total || 0);
  const cashback = Number(record.cashback_rate || defaultCashbackRate);
  return payout - purchase + purchase * cashback;
}

function isReferralBonus(record) {
  return String(record.item_name || "").trim().toLowerCase() === "referral bonus";
}

function summarizeRecords(recordsForSummary) {
  const active = recordsForSummary.filter((record) => String(record.status || "").toLowerCase() !== "cancelled");
  const monthly = new Map();
  const statusCounts = {};
  const accounts = new Map();
  const topItems = new Map();
  for (const record of recordsForSummary) {
    const status = record.status || "Unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const month = record.month_key || "Unknown";
    if (!monthly.has(month)) {
      monthly.set(month, { month, orders: 0, units: 0, spend: 0, payout: 0, profit: 0, cash_paid: 0 });
    }
    const monthRow = monthly.get(month);
    monthRow.orders += 1;
    monthRow.profit += Number(record.profit || 0);
    monthRow.cash_paid += Number(record.amount_paid || 0);
    if (String(record.status || "").toLowerCase() !== "cancelled") {
      monthRow.units += Number(record.quantity || 0);
      monthRow.spend += Number(record.purchase_total || 0);
      monthRow.payout += Number(record.payout_total || 0);
    }

    const account = record.account || "Unknown";
    if (!accounts.has(account)) accounts.set(account, { account, orders: 0, spend: 0, payout: 0, profit: 0 });
    const accountRow = accounts.get(account);
    accountRow.orders += 1;
    accountRow.profit += Number(record.profit || 0);
    if (String(record.status || "").toLowerCase() !== "cancelled") {
      accountRow.spend += Number(record.purchase_total || 0);
      accountRow.payout += Number(record.payout_total || 0);
    }

    const itemName = record.item_name || "Unknown";
    if (!topItems.has(itemName)) topItems.set(itemName, { item_name: itemName, orders: 0, units: 0, spend: 0, profit: 0 });
    const itemRow = topItems.get(itemName);
    itemRow.orders += 1;
    itemRow.units += Number(record.quantity || 0);
    itemRow.profit += Number(record.profit || 0);
    if (String(record.status || "").toLowerCase() !== "cancelled") itemRow.spend += Number(record.purchase_total || 0);
  }

  const money = (value) => Math.round(value * 100) / 100;
  return {
    orders: recordsForSummary.length,
    active_orders: active.length,
    units: money(active.reduce((sum, record) => sum + Number(record.quantity || 0), 0)),
    spend: money(active.reduce((sum, record) => sum + Number(record.purchase_total || 0), 0)),
    payout: money(active.reduce((sum, record) => sum + Number(record.payout_total || 0), 0)),
    profit: money(recordsForSummary.reduce((sum, record) => sum + Number(record.profit || 0), 0)),
    cash_paid: money(recordsForSummary.reduce((sum, record) => sum + Number(record.amount_paid || 0), 0)),
    estimated_purchase_rows: recordsForSummary.filter((record) => record.purchase_is_estimate).length,
    status_counts: statusCounts,
    monthly: Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month)),
    accounts: Array.from(accounts.values()).sort((a, b) => a.account.localeCompare(b.account)),
    top_items: Array.from(topItems.values()).sort((a, b) => b.profit - a.profit).slice(0, 10),
  };
}

function applyAmazonEnrichment(baseDataset, ordersFromAmazon) {
  const enriched = JSON.parse(JSON.stringify(baseDataset));
  const byOrderNumber = new Map();
  for (const order of ordersFromAmazon) {
    const orderNumber = normalizeOrderNumber(order.order_number);
    if (orderNumber) byOrderNumber.set(orderNumber, order);
  }
  let matched = 0;
  let personal = 0;
  let business = 0;
  let preciseCashback = 0;
  enriched.records = (enriched.records || []).map((record) => {
    const next = { ...record };
    const amazonOrder = byOrderNumber.get(normalizeOrderNumber(next.order_number));
    if (isReferralBonus(next)) {
      next.account = "BFMR Referral";
      next.account_source = "BFMR payment history referral bonus";
      next.amazon_order_matched = false;
      next.amazon_profile = "";
      next.amazon_payment_method = "";
      next.amazon_reward_text = "";
      next.amazon_delivery_status = "";
      next.amazon_delivery_eta = "";
      next.amazon_delivery_eta_date = "";
      next.amazon_delivery_scraped_at = "";
      next.cashback_rate = 0;
      next.cashback_rate_source = "No cashback on BFMR referral bonus";
      next.profit = Math.round(Number(next.payout_total || 0) * 100) / 100;
      return next;
    }
    const manual = manualAssumedOrders.get(normalizeOrderNumber(next.order_number));
    if (manual) {
      next.account = manual.account;
      next.account_source = manual.note;
      next.amazon_order_matched = true;
      next.amazon_profile = "";
      next.amazon_payment_method = "";
      next.amazon_reward_text = "";
      next.amazon_delivery_status = "";
      next.amazon_delivery_eta = "";
      next.amazon_delivery_eta_date = "";
      next.amazon_delivery_scraped_at = "";
      next.cashback_rate = manual.cashback_rate;
      next.cashback_rate_source = manual.note;
      next.profit = Math.round(calculateProfit(next) * 100) / 100;
      matched += 1;
      if (next.account === "Personal") personal += 1;
      if (next.account === "Business") business += 1;
      return next;
    }
    if (amazonOrder) {
      matched += 1;
      next.account = amazonOrder.account || "Amazon matched";
      if (next.account === "Personal") personal += 1;
      if (next.account === "Business") business += 1;
      next.account_source = `Amazon ${next.account} order history`;
      next.amazon_order_matched = true;
      next.amazon_profile = amazonOrder.profile || "";
      next.amazon_payment_method = amazonOrder.payment_method || "";
      next.amazon_reward_text = amazonOrder.reward_text || "";
      next.amazon_delivery_status = amazonOrder.delivery_status || "";
      next.amazon_delivery_eta = amazonOrder.delivery_eta || "";
      next.amazon_delivery_eta_date = amazonOrder.delivery_eta_date || "";
      next.amazon_delivery_scraped_at = amazonOrder.delivery_scraped_at || "";
      next.cashback_rate = Number(amazonOrder.cashback_rate || defaultCashbackRate);
      next.cashback_rate_source = amazonOrder.cashback_rate_source || "Amazon order history";
      if (!String(next.cashback_rate_source).toLowerCase().includes("default")) preciseCashback += 1;
    } else {
      next.account = next.order_number ? "Amazon unmatched" : noOrderAccount;
      next.account_source = next.order_number
        ? "Waiting for Amazon order history match"
        : `No Amazon order number; assumed ${noOrderAccount} at ${Math.round(noOrderCashbackRate * 100)}%`;
      next.amazon_order_matched = false;
      next.amazon_profile = "";
      next.amazon_payment_method = "";
      next.amazon_reward_text = "";
      next.amazon_delivery_status = "";
      next.amazon_delivery_eta = "";
      next.amazon_delivery_eta_date = "";
      next.amazon_delivery_scraped_at = "";
      next.cashback_rate = next.order_number ? defaultCashbackRate : noOrderCashbackRate;
      next.cashback_rate_source = next.order_number
        ? `Default ${Math.round(defaultCashbackRate * 100)}% pending Amazon match`
        : `No-order default ${Math.round(noOrderCashbackRate * 100)}%`;
    }
    next.profit = Math.round(calculateProfit(next) * 100) / 100;
    return next;
  });
  enriched.metadata = {
    ...(enriched.metadata || {}),
    amazon_order_count: ordersFromAmazon.length,
    amazon_matched_orders: matched,
    amazon_unmatched_orders: Math.max((enriched.records || []).length - matched, 0),
    amazon_personal_matches: personal,
    amazon_business_matches: business,
    amazon_precise_cashback_matches: preciseCashback,
  };
  enriched.summary = summarizeRecords(enriched.records || []);
  return enriched;
}

dataset = applyAmazonEnrichment(dataset, amazonOrders);
const records = dataset.records;
const summary = dataset.summary;

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("Dashboard");
const orders = workbook.worksheets.add("Orders");
const monthly = workbook.worksheets.add("Monthly");
const status = workbook.worksheets.add("Status");
const amazon = workbook.worksheets.add("Amazon Orders");
const addOns = workbook.worksheets.add("Add-ons");
const assumptions = workbook.worksheets.add("Assumptions");

const theme = {
  ink: "#18222F",
  muted: "#687385",
  line: "#D7DDE8",
  surface: "#FFFFFF",
  soft: "#EEF4F2",
  teal: "#047D78",
  indigo: "#4655A7",
  amber: "#B7791F",
  green: "#13795B",
  red: "#B42318",
};

const addonLabels = {
  checking_bonus: "Checking Bonus",
  bfmr_referral: "BFMR Referral",
  amazon_young_adult_cashback: "Amazon Young Adult Cashback",
  extra_profit: "Extra Profit",
};

function toDate(iso) {
  if (!iso) return null;
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function setWidths(sheet, widths, rows = 100) {
  Object.entries(widths).forEach(([col, width]) => {
    sheet.getRange(`${col}1:${col}${rows}`).format.columnWidthPx = width;
  });
}

function styleHeader(range, fill = theme.teal) {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF" },
    borders: { preset: "all", style: "thin", color: theme.line },
  };
}

function styleBody(range) {
  range.format = {
    fill: theme.surface,
    borders: { preset: "all", style: "thin", color: theme.line },
  };
}

for (const sheet of [dashboard, orders, monthly, status, amazon, addOns, assumptions]) {
  sheet.showGridLines = false;
}

const orderHeaders = [
  "Item Name",
  "Qty",
  "Order #",
  "Tracking #",
  "Purchase $",
  "Payout $",
  "Date",
  "Cashback %",
  "Profit",
  "Account",
  "Status",
  "Month",
  "Price Source",
  "Amount Paid",
  "Received",
  "Date Processed",
  "Date Paid",
  "Source Row",
  "Cashback Source",
  "Account Source",
  "Amazon Matched",
  "Amazon Profile",
  "Amazon Payment Method",
  "Amazon Reward Text",
  "Amazon Delivery Status",
  "Amazon ETA",
  "Amazon ETA Date",
  "Amazon Delivery Checked",
];

orders.getRange("A1:AB1").values = [orderHeaders];
styleHeader(orders.getRange("A1:AB1"), theme.indigo);
const orderRows = records.map((record) => [
  record.item_name,
  record.quantity,
  record.order_number,
  record.tracking,
  record.purchase_total,
  record.payout_total,
  toDate(record.date),
  record.cashback_rate,
  null,
  record.account,
  record.status,
  null,
  record.price_source,
  record.amount_paid,
  record.received,
  toDate(record.date_processed),
  toDate(record.date_paid),
  record.source_row,
  record.cashback_rate_source || "",
  record.account_source || "",
  record.amazon_order_matched ? "Yes" : "No",
  record.amazon_profile || "",
  record.amazon_payment_method || "",
  record.amazon_reward_text || "",
  record.amazon_delivery_status || "",
  record.amazon_delivery_eta || "",
  toDate(record.amazon_delivery_eta_date),
  record.amazon_delivery_scraped_at || "",
]);

const lastOrderRow = Math.max(records.length + 1, 2);
orders.getRange(`C2:D${lastOrderRow}`).format.numberFormat = "@";
if (orderRows.length) {
  orders.getRange(`A2:AB${lastOrderRow}`).values = orderRows;
  styleBody(orders.getRange(`A2:AB${lastOrderRow}`));
  orders.getRange(`I2:I${lastOrderRow}`).formulas = records.map((_, index) => {
    const row = index + 2;
    return [`=IF(K${row}="Cancelled",0,F${row}-E${row}+(E${row}*H${row}))`];
  });
  orders.getRange(`L2:L${lastOrderRow}`).formulas = records.map((_, index) => {
    const row = index + 2;
    return [`=IF(G${row}="","",TEXT(G${row},"yyyy-mm"))`];
  });
}

orders.tables.add(`A1:AB${lastOrderRow}`, true, "OrdersTable");
orders.freezePanes.freezeRows(1);
orders.getRange(`E2:F${lastOrderRow}`).format.numberFormat = "$#,##0.00";
orders.getRange(`H2:H${lastOrderRow}`).format.numberFormat = "0%";
orders.getRange(`I2:I${lastOrderRow}`).format.numberFormat = "$#,##0.00";
orders.getRange(`N2:N${lastOrderRow}`).format.numberFormat = "$#,##0.00";
orders.getRange(`G2:G${lastOrderRow}`).format.numberFormat = "yyyy-mm-dd";
orders.getRange(`P2:Q${lastOrderRow}`).format.numberFormat = "yyyy-mm-dd";
orders.getRange(`A1:AB${lastOrderRow}`).format.wrapText = false;
orders.getRange(`AA2:AA${lastOrderRow}`).format.numberFormat = "yyyy-mm-dd";
setWidths(
  orders,
  {
    A: 360,
    B: 56,
    C: 160,
    D: 230,
    E: 104,
    F: 104,
    G: 102,
    H: 92,
    I: 104,
    J: 98,
    K: 98,
    L: 90,
    M: 150,
    N: 104,
    O: 78,
    P: 110,
    Q: 110,
    R: 80,
    S: 210,
    T: 220,
    U: 112,
    V: 140,
    W: 220,
    X: 360,
    Y: 180,
    Z: 140,
    AA: 120,
    AB: 150,
  },
  lastOrderRow,
);

const amazonHeaders = [
  "Order #",
  "Account",
  "Profile",
  "Cashback %",
  "Cashback Source",
  "Payment Method",
  "Reward Text",
  "Delivery Status",
  "Delivery ETA",
  "Delivery ETA Date",
  "Delivery Checked",
  "Order Date",
  "Order Total",
  "Source URL",
  "Scraped At",
];
const amazonRows = amazonOrders.length
  ? amazonOrders.map((order) => [
      order.order_number || "",
      order.account || "",
      order.profile || "",
      Number(order.cashback_rate || DEFAULT_CASHBACK_RATE),
      order.cashback_rate_source || "",
      order.payment_method || "",
      order.reward_text || "",
      order.delivery_status || "",
      order.delivery_eta || "",
      toDate(order.delivery_eta_date),
      toDate(order.delivery_scraped_at),
      toDate(order.order_date),
      order.order_total == null ? null : Number(order.order_total),
      order.source_url || "",
      toDate(order.scraped_at),
    ])
  : [["", "", "", null, "", "", "", "", "", null, null, null, null, "", null]];
const lastAmazonRow = Math.max(amazonRows.length + 1, 2);
amazon.getRange("A1:O1").values = [amazonHeaders];
styleHeader(amazon.getRange("A1:O1"), theme.green);
amazon.getRange(`A2:O${lastAmazonRow}`).values = amazonRows;
styleBody(amazon.getRange(`A2:O${lastAmazonRow}`));
amazon.tables.add(`A1:O${lastAmazonRow}`, true, "AmazonOrdersTable");
amazon.freezePanes.freezeRows(1);
amazon.getRange(`A2:A${lastAmazonRow}`).format.numberFormat = "@";
amazon.getRange(`D2:D${lastAmazonRow}`).format.numberFormat = "0%";
amazon.getRange(`K2:K${lastAmazonRow}`).format.numberFormat = "yyyy-mm-dd";
amazon.getRange(`L2:L${lastAmazonRow}`).format.numberFormat = "yyyy-mm-dd";
amazon.getRange(`M2:M${lastAmazonRow}`).format.numberFormat = "$#,##0.00";
amazon.getRange(`O2:O${lastAmazonRow}`).format.numberFormat = "yyyy-mm-dd";
setWidths(
  amazon,
  {
    A: 160,
    B: 100,
    C: 150,
    D: 104,
    E: 260,
    F: 220,
    G: 360,
    H: 180,
    I: 140,
    J: 120,
    K: 110,
    L: 110,
    M: 112,
    N: 360,
    O: 110,
  },
  lastAmazonRow,
);

const addonHeaders = ["Date", "Month", "Category", "Description", "Amount", "Notes", "Created At"];
const addonRows = addons.length
  ? addons.map((addon) => [
      toDate(addon.date),
      null,
      addonLabels[addon.category] || addon.category || "Profit Add-on",
      addon.description || "",
      Number(addon.amount) || 0,
      addon.notes || "",
      toDate(addon.created_at),
    ])
  : [[null, null, "", "", null, "", null]];
const lastAddonRow = Math.max(addonRows.length + 1, 2);
addOns.getRange("A1:G1").values = [addonHeaders];
styleHeader(addOns.getRange("A1:G1"), theme.amber);
addOns.getRange(`A2:G${lastAddonRow}`).values = addonRows;
styleBody(addOns.getRange(`A2:G${lastAddonRow}`));
addOns.getRange(`B2:B${lastAddonRow}`).formulas = addonRows.map((_, index) => {
  const row = index + 2;
  return [`=IF(A${row}="","",TEXT(A${row},"yyyy-mm"))`];
});
addOns.tables.add(`A1:G${lastAddonRow}`, true, "AddOnsTable");
addOns.freezePanes.freezeRows(1);
addOns.getRange(`A2:A${lastAddonRow}`).format.numberFormat = "yyyy-mm-dd";
addOns.getRange(`E2:E${lastAddonRow}`).format.numberFormat = "$#,##0.00";
addOns.getRange(`G2:G${lastAddonRow}`).format.numberFormat = "yyyy-mm-dd";
setWidths(addOns, { A: 108, B: 90, C: 210, D: 280, E: 112, F: 340, G: 108 }, lastAddonRow);

const addonMonths = addons
  .map((addon) => (addon.date ? String(addon.date).slice(0, 7) : "Unknown"))
  .filter(Boolean);
const monthRows = [...new Set([...summary.monthly.map((row) => row.month), ...addonMonths])].sort();
monthly.getRange("A1:I1").values = [
  ["Month", "Orders", "Units", "Spend", "Payout", "Product Profit", "Add-on Profit", "Total Profit", "Cash Paid"],
];
styleHeader(monthly.getRange("A1:I1"), theme.teal);
if (monthRows.length) {
  const monthlyValues = monthRows.map((month) => [month, null, null, null, null, null, null, null, null]);
  monthly.getRange(`A2:I${monthRows.length + 1}`).values = monthlyValues;
  styleBody(monthly.getRange(`A2:I${monthRows.length + 1}`));
  monthly.getRange(`B2:I${monthRows.length + 1}`).formulas = monthRows.map((_, index) => {
    const row = index + 2;
    return [
      `=COUNTIFS(Orders!$L$2:$L$${lastOrderRow},A${row})`,
      `=SUMIFS(Orders!$B$2:$B$${lastOrderRow},Orders!$L$2:$L$${lastOrderRow},A${row},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`,
      `=SUMIFS(Orders!$E$2:$E$${lastOrderRow},Orders!$L$2:$L$${lastOrderRow},A${row},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`,
      `=SUMIFS(Orders!$F$2:$F$${lastOrderRow},Orders!$L$2:$L$${lastOrderRow},A${row},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`,
      `=SUMIFS(Orders!$I$2:$I$${lastOrderRow},Orders!$L$2:$L$${lastOrderRow},A${row})`,
      `=SUMIFS('Add-ons'!$E$2:$E$${lastAddonRow},'Add-ons'!$B$2:$B$${lastAddonRow},A${row})`,
      `=F${row}+G${row}`,
      `=SUMIFS(Orders!$N$2:$N$${lastOrderRow},Orders!$L$2:$L$${lastOrderRow},A${row})`,
    ];
  });
}
monthly.getRange(`D2:I${Math.max(monthRows.length + 1, 2)}`).format.numberFormat = "$#,##0.00";
monthly.freezePanes.freezeRows(1);
setWidths(
  monthly,
  { A: 110, B: 82, C: 82, D: 112, E: 112, F: 126, G: 126, H: 118, I: 112 },
  Math.max(monthRows.length + 1, 2),
);

const statuses = Object.keys(summary.status_counts).sort();
status.getRange("A1:C1").values = [["Status", "Rows", "Profit"]];
styleHeader(status.getRange("A1:C1"), theme.indigo);
if (statuses.length) {
  status.getRange(`A2:C${statuses.length + 1}`).values = statuses.map((name) => [name, null, null]);
  styleBody(status.getRange(`A2:C${statuses.length + 1}`));
  status.getRange(`B2:C${statuses.length + 1}`).formulas = statuses.map((_, index) => {
    const row = index + 2;
    return [
      `=COUNTIF(Orders!$K$2:$K$${lastOrderRow},A${row})`,
      `=SUMIFS(Orders!$I$2:$I$${lastOrderRow},Orders!$K$2:$K$${lastOrderRow},A${row})`,
    ];
  });
}
status.getRange(`C2:C${Math.max(statuses.length + 1, 2)}`).format.numberFormat = "$#,##0.00";

const accountStart = statuses.length + 4;
status.getRange(`A${accountStart}:D${accountStart}`).values = [["Account", "Rows", "Spend", "Profit"]];
styleHeader(status.getRange(`A${accountStart}:D${accountStart}`), theme.teal);
const accounts = summary.accounts.map((row) => row.account).sort();
if (accounts.length) {
  status.getRange(`A${accountStart + 1}:D${accountStart + accounts.length}`).values = accounts.map((account) => [
    account,
    null,
    null,
    null,
  ]);
  styleBody(status.getRange(`A${accountStart + 1}:D${accountStart + accounts.length}`));
  status.getRange(`B${accountStart + 1}:D${accountStart + accounts.length}`).formulas = accounts.map((_, index) => {
    const row = accountStart + 1 + index;
    return [
      `=COUNTIF(Orders!$J$2:$J$${lastOrderRow},A${row})`,
      `=SUMIFS(Orders!$E$2:$E$${lastOrderRow},Orders!$J$2:$J$${lastOrderRow},A${row},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`,
      `=SUMIFS(Orders!$I$2:$I$${lastOrderRow},Orders!$J$2:$J$${lastOrderRow},A${row})`,
    ];
  });
  status.getRange(`C${accountStart + 1}:D${accountStart + accounts.length}`).format.numberFormat = "$#,##0.00";
}
setWidths(status, { A: 130, B: 80, C: 112, D: 112 }, accountStart + accounts.length);

dashboard.getRange("A1:P1").merge();
dashboard.getRange("A1").values = [["Toopa's BFMR Tracking"]];
dashboard.getRange("A1:P1").format = {
  fill: theme.ink,
  font: { bold: true, color: "#FFFFFF", size: 18 },
  horizontalAlignment: "center",
};

const kpiBlocks = [
  ["A3:B3", "A4:B4", "Total Spend", `=SUMIFS(Orders!$E$2:$E$${lastOrderRow},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`, "$#,##0.00"],
  ["C3:D3", "C4:D4", "Total Profit", "=E4+G4", "$#,##0.00"],
  ["E3:F3", "E4:F4", "Product Profit", `=SUM(Orders!$I$2:$I$${lastOrderRow})`, "$#,##0.00"],
  ["G3:H3", "G4:H4", "Add-on Profit", `=SUM('Add-ons'!$E$2:$E$${lastAddonRow})`, "$#,##0.00"],
  ["A6:B6", "A7:B7", "Payout Value", `=SUMIFS(Orders!$F$2:$F$${lastOrderRow},Orders!$K$2:$K$${lastOrderRow},"<>Cancelled")`, "$#,##0.00"],
  ["C6:D6", "C7:D7", "Cash Paid", `=SUM(Orders!$N$2:$N$${lastOrderRow})`, "$#,##0.00"],
  ["E6:F6", "E7:F7", "Open Payout", "=A7-C7", "$#,##0.00"],
  ["G6:H6", "G7:H7", "Amazon Matched", `=COUNTIF(Orders!$U$2:$U$${lastOrderRow},"Yes")`, "0"],
];

for (const [labelRange, valueRange, label, formula, format] of kpiBlocks) {
  dashboard.getRange(labelRange).merge();
  dashboard.getRange(valueRange).merge();
  dashboard.getRange(labelRange.split(":")[0]).values = [[label]];
  dashboard.getRange(valueRange.split(":")[0]).formulas = [[formula]];
  dashboard.getRange(valueRange).format.numberFormat = format;
}
dashboard.getRange("A3:H7").format = {
  fill: theme.surface,
  borders: { preset: "all", style: "thin", color: theme.line },
};
dashboard.getRange("A3:H3").format = { fill: theme.soft, font: { bold: true, color: theme.ink } };
dashboard.getRange("A6:H6").format = { fill: theme.soft, font: { bold: true, color: theme.ink } };

dashboard.getRange("A10:E10").values = [["Month", "Spend", "Payout", "Product Profit", "Total Profit"]];
styleHeader(dashboard.getRange("A10:E10"), theme.teal);
if (monthRows.length) {
  dashboard.getRange(`A11:E${monthRows.length + 10}`).formulas = monthRows.map((_, index) => {
    const sourceRow = index + 2;
    return [
      `=Monthly!A${sourceRow}`,
      `=Monthly!D${sourceRow}`,
      `=Monthly!E${sourceRow}`,
      `=Monthly!F${sourceRow}`,
      `=Monthly!H${sourceRow}`,
    ];
  });
  styleBody(dashboard.getRange(`A11:E${monthRows.length + 10}`));
  dashboard.getRange(`B11:E${monthRows.length + 10}`).format.numberFormat = "$#,##0.00";
}

const monthChartRange = dashboard.getRange(`A10:E${Math.max(monthRows.length + 10, 11)}`);
const monthChart = dashboard.charts.add("line", monthChartRange);
monthChart.title = "Monthly Spend, Payout, and Profit";
monthChart.hasLegend = true;
monthChart.yAxis = { numberFormatCode: "$#,##0" };
monthChart.setPosition("J3", "P19");

dashboard.getRange("A22:C22").values = [["Status", "Rows", "Profit"]];
styleHeader(dashboard.getRange("A22:C22"), theme.indigo);
if (statuses.length) {
  dashboard.getRange(`A23:C${statuses.length + 22}`).formulas = statuses.map((_, index) => {
    const sourceRow = index + 2;
    return [`=Status!A${sourceRow}`, `=Status!B${sourceRow}`, `=Status!C${sourceRow}`];
  });
  styleBody(dashboard.getRange(`A23:C${statuses.length + 22}`));
  dashboard.getRange(`C23:C${statuses.length + 22}`).format.numberFormat = "$#,##0.00";
  const statusChart = dashboard.charts.add("bar", dashboard.getRange(`A22:C${statuses.length + 22}`));
  statusChart.title = "Rows and Profit by Status";
  statusChart.hasLegend = true;
  statusChart.setPosition("E22", "P37");
}

setWidths(
  dashboard,
  {
    A: 112,
    B: 112,
    C: 112,
    D: 112,
    E: 112,
    F: 112,
    G: 112,
    H: 112,
    I: 24,
    J: 100,
    K: 100,
    L: 100,
    M: 100,
    N: 100,
    O: 100,
    P: 100,
  },
  40,
);

assumptions.getRange("A1:B1").values = [["Assumption", "Value"]];
styleHeader(assumptions.getRange("A1:B1"), theme.teal);
assumptions.getRange("A2:B16").values = [
  ["Default cashback rate", dataset.metadata.cashback_rate || DEFAULT_CASHBACK_RATE],
  ["Profit formula", "IF Status = Cancelled, 0, Payout - Purchase + Purchase * Cashback"],
  ["Total profit formula", "Product profit plus Add-ons sheet Amount"],
  ["Account rule", "Amazon order history match controls Personal vs Business; unmatched rows are marked Amazon unmatched"],
  ["Personal cashback rule", "Use Amazon visible reward text when available, for example 5% plus extra 3% = 8%"],
  ["Business cashback rule", "Default to 6% unless Amazon Business exposes a better rate"],
  ["Amazon order rows", dataset.metadata.amazon_order_count || 0],
  ["Amazon matched BFMR rows", dataset.metadata.amazon_matched_orders || 0],
  ["Amazon precise cashback rows", dataset.metadata.amazon_precise_cashback_matches || 0],
  ["BFMR export", dataset.metadata.tracker_export],
  ["Price workbook", dataset.metadata.price_workbook],
  ["BFMR site source", dataset.metadata.source_url || ""],
  ["Generated at", dataset.metadata.generated_at],
  ["Rows using payout fallback", summary.estimated_purchase_rows],
  ["Add-on categories", "Checking Bonus, BFMR Referral, Amazon Young Adult Cashback"],
];
styleBody(assumptions.getRange("A2:B16"));
assumptions.getRange("B2").format.numberFormat = "0%";
setWidths(assumptions, { A: 240, B: 780 }, 16);

const previewSheets = ["Dashboard", "Orders", "Monthly", "Status", "Amazon Orders", "Add-ons", "Assumptions"];
for (const sheetName of previewSheets) {
  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(path.join(outputDir, `${sheetName.toLowerCase()}_preview.png`), new Uint8Array(await preview.arrayBuffer()));
}

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 200 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

const dashboardCheck = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:H10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 8,
});
console.log(dashboardCheck.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
