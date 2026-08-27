import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const datasetPath = path.resolve(process.env.BFMR_WORKBOOK_DATASET || path.join("data", "bfmr_records.json"));
const addonsPath = path.resolve(process.env.BFMR_WORKBOOK_ADDONS || path.join("data", "profit_addons.json"));
const amazonOrdersPath = path.resolve(process.env.BFMR_WORKBOOK_AMAZON || path.join("data", "amazon_orders.json"));
const fullAmazonAuditPath = process.env.BFMR_FULL_AMAZON_AUDIT_PATH
  ? path.resolve(process.env.BFMR_FULL_AMAZON_AUDIT_PATH)
  : amazonOrdersPath;
const outputPath = path.resolve(
  process.env.BFMR_WORKBOOK_OUTPUT || path.join("outputs", "Toopas_BFMR_Tracking.xlsx"),
);

const dataset = await readJson(datasetPath, { records: [], summary: {}, metadata: {} });
const addons = await readJson(addonsPath, []);
const amazonOrders = await readJson(amazonOrdersPath, []);
const fullAmazonPayload = await readJson(fullAmazonAuditPath, amazonOrders);
const records = Array.isArray(dataset.records) ? dataset.records : [];
const summary = dataset.summary || {};
const metadata = dataset.metadata || {};
const sourceWorkbookPath = process.env.BFMR_SOURCE_XLSX
  ? path.resolve(process.env.BFMR_SOURCE_XLSX)
  : metadata.tracker_export && (await fileExists(metadata.tracker_export))
    ? path.resolve(metadata.tracker_export)
    : null;

const trackingCapacity = Math.max(500, records.length + 100);
const amazonHistory = normalizeAmazonHistory(fullAmazonPayload);
const amazonCapacity = Math.max(600, amazonHistory.length + 100);
const returnRecords = records.filter(returnRelevant);
const returnsCapacity = Math.max(200, returnRecords.length + 50);
const addonRows = Array.isArray(addons) ? addons : [];
const addonCapacity = Math.max(200, addonRows.length + 50);
const coverageStart = minRecordDate(records) || new Date(2026, 4, 1);
const generatedAt = new Date();

const correctionRows = [
  {
    amazonOrder: "114-2500321-9637052",
    bfmrOrder: "114-2500321-963705",
    note: "BFMR order ID is missing its final 2; the reservation and Amazon order are the same MacBook Pro.",
  },
  {
    amazonOrder: "113-1672775-4217862",
    bfmrOrder: "114-5957551-1546653",
    note: "Historical BFMR data confirms the business iMac reservation; the latest export duplicated the personal order ID after partial fulfillment.",
  },
];
const correctionByAmazon = new Map(correctionRows.map((row) => [row.amazonOrder, row]));
const directBfmrOrders = new Set(records.map((record) => clean(record.order_number)).filter(Boolean));

const theme = {
  ink: "#17212B",
  navy: "#243B53",
  teal: "#0F766E",
  blue: "#2563EB",
  green: "#16835B",
  amber: "#C47F17",
  red: "#B42318",
  purple: "#6857A6",
  line: "#D8E0E8",
  soft: "#F3F6F8",
  greenSoft: "#EAF7F0",
  blueSoft: "#EAF2FF",
  amberSoft: "#FFF5DD",
  redSoft: "#FDECEA",
  muted: "#5F6B78",
  white: "#FFFFFF",
};
const currencyFormat = '$#,##0.00;[Red]($#,##0.00);-';
const integerFormat = '#,##0;[Red](#,##0);-';
const percentFormat = '0.0%;[Red](0.0%);-';
const dateFormat = "yyyy-mm-dd";

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("Dashboard");
const tracking = workbook.worksheets.add("Tracking");
const returns = workbook.worksheets.add("Returns");
const amazonAudit = workbook.worksheets.add("Amazon Audit");
const reconciliation = workbook.worksheets.add("Reconciliation");
const extraProfit = workbook.worksheets.add("Extra Profit");
const monthly = workbook.worksheets.add("Monthly");
const checks = workbook.worksheets.add("Checks");
const settings = workbook.worksheets.add("Settings");
const bfmrSource = workbook.worksheets.add("BFMR Source");

for (const sheet of [dashboard, tracking, returns, amazonAudit, reconciliation, extraProfit, monthly, checks, settings, bfmrSource]) {
  sheet.showGridLines = false;
}

buildSettings();
buildTracking();
buildExtraProfit();
buildReturns();
buildAmazonAudit();
buildMonthly();
buildReconciliation();
buildChecks();
buildDashboard();
await buildBfmrSource();

const outputDir = path.dirname(outputPath);
const previewDir = path.join(outputDir, "previews");
await fs.mkdir(previewDir, { recursive: true });

const previewRanges = {
  Dashboard: "A1:P48",
  Tracking: "A1:AE25",
  Returns: "A1:S25",
  "Amazon Audit": "A1:L25",
  Reconciliation: "A1:H31",
  "Extra Profit": "A1:I20",
  Monthly: "A1:I25",
  Checks: "A1:G15",
  Settings: "A1:H36",
  "BFMR Source": "A1:P25",
};
for (const [sheetName, range] of Object.entries(previewRanges)) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  const safeName = sheetName.toLowerCase().replaceAll(" ", "-");
  await fs.writeFile(path.join(previewDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

const dashboardCheck = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:P12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 16,
});
console.log(dashboardCheck.ndjson);

const checksCheck = await workbook.inspect({
  kind: "table",
  range: "Checks!A1:G13",
  include: "values,formulas",
  tableMaxRows: 13,
  tableMaxCols: 7,
});
console.log(checksCheck.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);

function buildTracking() {
  const headers = [
    "Include", "Status", "Lifecycle", "Item", "Qty", "Order #", "Tracking #", "Retail / Unit", "Subtotal",
    "Payout / Unit", "Payout Total", "Qty Received", "Amount Paid", "Date Reserved", "Date Processed", "Date Paid",
    "Cashback %", "Cashback $", "Profit", "Pending Profit", "Open Payout", "Account", "Amazon Matched", "Delivery ETA",
    "Return / Adjustment", "BFMR Notes", "Price Source", "Source Row", "Month", "Record ID", "Data Quality",
  ];
  tracking.getRange("A1:AE1").values = [headers];
  styleHeader(tracking.getRange("A1:AE1"), theme.navy);

  const values = Array.from({ length: trackingCapacity }, (_, index) => {
    const record = records[index];
    if (!record) return Array(headers.length).fill(null);
    const included = clean(record.status).toLowerCase() !== "cancelled" && !record.accounting_excluded;
    const quantity = included ? numeric(record.accounting_quantity, record.quantity) : numeric(record.quantity, 0);
    const purchase = included ? numeric(record.accounting_purchase_total, record.purchase_total) : numeric(record.purchase_total, 0);
    const payout = included ? numeric(record.accounting_payout_total, record.payout_total) : numeric(record.payout_total, 0);
    const paid = included ? numeric(record.accounting_amount_paid, record.amount_paid) : numeric(record.amount_paid, 0);
    const adjustment = [record.accounting_reason, record.return_context, record.split_review_reason]
      .map(clean).filter(Boolean).filter((value, valueIndex, rows) => rows.indexOf(value) === valueIndex).join(" | ");
    return [
      included ? "Yes" : "No", clean(record.status) || "Reserved", null, clean(record.item_name), quantity,
      clean(record.order_number), clean(record.tracking), null, purchase, null, payout, numeric(record.received, 0), paid,
      toDate(record.date), toDate(record.date_processed), toDate(record.date_paid), numeric(record.cashback_rate, 0.06),
      null, null, null, null, clean(record.account) || "Personal", record.amazon_order_matched ? "Yes" : "No",
      toDate(record.amazon_delivery_eta_date) || clean(record.amazon_delivery_eta), adjustment, clean(record.notes),
      clean(record.price_source), numeric(record.source_row, null), null, numeric(record.id, index + 1), null,
    ];
  });
  const lastRow = trackingCapacity + 1;
  tracking.getRange(`A2:AE${lastRow}`).values = values;
  styleBody(tracking.getRange(`A2:AE${lastRow}`));

  const formulas = Array.from({ length: trackingCapacity }, (_, index) => {
    const row = index + 2;
    return {
      lifecycle: `=IF(D${row}="","",IF(A${row}<>"Yes","Excluded",IF(B${row}="Paid","Paid",IF(OR(B${row}="Processed",B${row}="Return",B${row}="Returned",O${row}<>""),"Processed",IF(OR(B${row}="Package Received",B${row}="Pkg Received",AND(E${row}>0,L${row}>=E${row})),"Package Received",IF(OR(B${row}="Shipped",G${row}<>""),"Shipped",IF(OR(B${row}="Purchased",B${row}="Ordered",F${row}<>""),"Ordered","Reserved")))))))`,
      retail: `=IF(D${row}="","",IF(OR(E${row}="",E${row}=0,I${row}=""),0,I${row}/E${row}))`,
      payoutUnit: `=IF(D${row}="","",IF(OR(E${row}="",E${row}=0,K${row}=""),0,K${row}/E${row}))`,
      cashback: `=IF(D${row}="","",IF(OR(A${row}<>"Yes",I${row}="",Q${row}=""),0,ROUND(I${row}*Q${row},2)))`,
      profit: `=IF(D${row}="","",IF(OR(A${row}<>"Yes",B${row}="Cancelled"),0,ROUND(K${row}-I${row}+R${row},2)))`,
      pending: `=IF(D${row}="","",IF(AND(A${row}="Yes",B${row}<>"Paid"),S${row},0))`,
      open: `=IF(D${row}="","",IF(A${row}<>"Yes",0,MAX(K${row}-M${row},0)))`,
      month: `=IF(N${row}="","",TEXT(N${row},"yyyy-mm"))`,
      quality: `=IF(D${row}="","",IF(A${row}<>"Yes","Excluded",IF(LOWER(D${row})="referral bonus","OK",IF(E${row}<=0,"Missing qty",IF(N${row}="","Missing date",IF(AND(OR(C${row}="Ordered",C${row}="Shipped",C${row}="Package Received",C${row}="Processed",C${row}="Paid"),F${row}=""),"Missing order #",IF(AND(OR(C${row}="Shipped",C${row}="Package Received",C${row}="Processed",C${row}="Paid"),G${row}=""),"Missing tracking","OK")))))))`,
    };
  });
  tracking.getRange(`C2:C${lastRow}`).formulas = formulas.map((row) => [row.lifecycle]);
  tracking.getRange(`H2:H${lastRow}`).formulas = formulas.map((row) => [row.retail]);
  tracking.getRange(`J2:J${lastRow}`).formulas = formulas.map((row) => [row.payoutUnit]);
  tracking.getRange(`R2:R${lastRow}`).formulas = formulas.map((row) => [row.cashback]);
  tracking.getRange(`S2:S${lastRow}`).formulas = formulas.map((row) => [row.profit]);
  tracking.getRange(`T2:T${lastRow}`).formulas = formulas.map((row) => [row.pending]);
  tracking.getRange(`U2:U${lastRow}`).formulas = formulas.map((row) => [row.open]);
  tracking.getRange(`AC2:AC${lastRow}`).formulas = formulas.map((row) => [row.month]);
  tracking.getRange(`AE2:AE${lastRow}`).formulas = formulas.map((row) => [row.quality]);

  const inputColumns = ["A", "B", "D", "E", "F", "G", "I", "K", "L", "M", "N", "O", "P", "Q", "V", "W", "X", "Y", "Z", "AA", "AB", "AD"];
  for (const column of inputColumns) tracking.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#0000FF" };
  for (const column of ["C", "H", "J", "R", "S", "T", "U", "AC", "AE"]) {
    tracking.getRange(`${column}2:${column}${lastRow}`).format.fill = theme.soft;
    tracking.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#000000" };
  }

  tracking.getRange(`A2:A${lastRow}`).dataValidation = { rule: { type: "list", values: ["Yes", "No"] } };
  tracking.getRange(`B2:B${lastRow}`).dataValidation = { rule: { type: "list", values: ["Reserved", "Purchased", "Ordered", "Shipped", "Package Received", "Processed", "Paid", "Deadline", "Closed", "Return", "Returned", "Cancelled"] } };
  tracking.getRange(`V2:V${lastRow}`).dataValidation = { rule: { type: "list", values: ["Personal", "Business", "BFMR Referral", "Other"] } };
  tracking.getRange(`W2:W${lastRow}`).dataValidation = { rule: { type: "list", values: ["Yes", "No", "Corrected"] } };

  tracking.getRange(`E2:E${lastRow}`).format.numberFormat = "0.00";
  tracking.getRange(`H2:K${lastRow}`).format.numberFormat = currencyFormat;
  tracking.getRange(`M2:M${lastRow}`).format.numberFormat = currencyFormat;
  tracking.getRange(`N2:P${lastRow}`).format.numberFormat = dateFormat;
  tracking.getRange(`Q2:Q${lastRow}`).format.numberFormat = percentFormat;
  tracking.getRange(`R2:U${lastRow}`).format.numberFormat = currencyFormat;
  tracking.getRange(`X2:X${lastRow}`).format.numberFormat = dateFormat;
  tracking.getRange(`F2:G${lastRow}`).format.numberFormat = "@";

  tracking.getRange(`B2:B${lastRow}`).conditionalFormats.addCustom('=$B2="Paid"', { fill: theme.greenSoft, font: { color: theme.green } });
  tracking.getRange(`B2:B${lastRow}`).conditionalFormats.addCustom('=OR($B2="Return",$B2="Returned",$B2="Closed")', { fill: theme.amberSoft, font: { color: theme.amber } });
  tracking.getRange(`B2:B${lastRow}`).conditionalFormats.addCustom('=$B2="Cancelled"', { fill: theme.redSoft, font: { color: theme.red } });
  tracking.getRange(`AE2:AE${lastRow}`).conditionalFormats.addCustom('=$AE2="OK"', { fill: theme.greenSoft, font: { color: theme.green } });
  tracking.getRange(`AE2:AE${lastRow}`).conditionalFormats.addCustom('=AND($AE2<>"",$AE2<>"OK",$AE2<>"Excluded")', { fill: theme.amberSoft, font: { color: theme.amber } });

  const table = tracking.tables.add(`A1:AE${lastRow}`, true, "TrackingTable");
  table.showFilterButton = true;
  tracking.freezePanes.freezeRows(1);
  tracking.freezePanes.freezeColumns(4);
  setWidths(tracking, {
    A: 70, B: 120, C: 126, D: 390, E: 62, F: 165, G: 210, H: 105, I: 108, J: 110, K: 110,
    L: 90, M: 108, N: 105, O: 105, P: 105, Q: 92, R: 105, S: 105, T: 112, U: 108, V: 105,
    W: 108, X: 112, Y: 330, Z: 300, AA: 175, AB: 80, AC: 90, AD: 82, AE: 145,
  }, lastRow);
}

function buildExtraProfit() {
  const headers = ["Date", "Month", "Category", "Description", "Amount", "Notes", "Created At"];
  extraProfit.getRange("A1:G1").values = [headers];
  styleHeader(extraProfit.getRange("A1:G1"), theme.amber);
  const rows = Array.from({ length: addonCapacity }, (_, index) => {
    const addon = addonRows[index];
    if (!addon) return Array(headers.length).fill(null);
    return [toDate(addon.date), null, addonCategoryLabel(addon.category), clean(addon.description), numeric(addon.amount, 0), clean(addon.notes), toDate(addon.created_at)];
  });
  const lastRow = addonCapacity + 1;
  extraProfit.getRange(`A2:G${lastRow}`).values = rows;
  styleBody(extraProfit.getRange(`A2:G${lastRow}`));
  extraProfit.getRange(`B2:B${lastRow}`).formulas = Array.from({ length: addonCapacity }, (_, index) => {
    const row = index + 2;
    return [`=IF(A${row}="","",TEXT(A${row},"yyyy-mm"))`];
  });
  for (const column of ["A", "C", "D", "E", "F", "G"]) extraProfit.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#0000FF" };
  extraProfit.getRange(`B2:B${lastRow}`).format.fill = theme.soft;
  extraProfit.getRange(`A2:A${lastRow}`).format.numberFormat = dateFormat;
  extraProfit.getRange(`E2:E${lastRow}`).format.numberFormat = currencyFormat;
  extraProfit.getRange(`G2:G${lastRow}`).format.numberFormat = dateFormat;
  extraProfit.getRange(`C2:C${lastRow}`).dataValidation = { rule: { type: "list", values: ["Checking Bonus", "BFMR Referral", "Amazon Young Adult Cashback", "Extra Profit"] } };
  extraProfit.getRange("I1:I2").values = [["Extra Profit Total"], [null]];
  styleHeader(extraProfit.getRange("I1"), theme.amber);
  extraProfit.getRange("I2").formulas = [[`=SUM(E2:E${lastRow})`]];
  extraProfit.getRange("I2").format = { fill: theme.amberSoft, font: { bold: true }, numberFormat: currencyFormat };
  const table = extraProfit.tables.add(`A1:G${lastRow}`, true, "ExtraProfitTable");
  table.showFilterButton = true;
  extraProfit.freezePanes.freezeRows(1);
  setWidths(extraProfit, { A: 105, B: 90, C: 290, D: 310, E: 110, F: 340, G: 112, H: 26, I: 145 }, lastRow);
}

function buildReturns() {
  const headers = ["Return Date", "Return Status", "Item", "Original Qty", "Counted Qty", "Excluded Qty", "Order #", "Original Purchase", "Counted Purchase", "Suggested Refund Basis", "Refund Expected", "Refund Received", "Refund Progress", "Refund Date", "Tracking Record ID", "Return Group", "Accounting Treatment", "Context / Notes", "Review Needed"];
  returns.getRange("A1:S1").values = [headers];
  styleHeader(returns.getRange("A1:S1"), theme.purple);
  const rows = Array.from({ length: returnsCapacity }, (_, index) => {
    const record = returnRecords[index];
    if (!record) return Array(headers.length).fill(null);
    const originalQty = numeric(record.quantity, 0);
    const countedQty = numeric(record.accounting_quantity, originalQty);
    const originalPurchase = numeric(record.purchase_total, 0);
    const countedPurchase = numeric(record.accounting_purchase_total, originalPurchase);
    const needsReview = Boolean(record.split_review_needed);
    const status = clean(record.status).toLowerCase();
    const returnStatus = needsReview ? "Needs Review" : status === "return" || status === "returned" ? "Refund Pending" : record.accounting_excluded ? "Excluded from Profit" : countedPurchase < originalPurchase ? "Refund Verification" : "Resolved / Counted";
    return [toDate(record.date), returnStatus, clean(record.item_name), originalQty, countedQty, Math.max(originalQty - countedQty, 0), clean(record.order_number), originalPurchase, countedPurchase, null, null, null, null, null, numeric(record.id, index + 1), clean(record.return_group_key), clean(record.accounting_reason), [record.return_context, record.split_review_reason].map(clean).filter(Boolean).join(" | "), needsReview ? "Yes" : "No"];
  });
  const lastRow = returnsCapacity + 1;
  returns.getRange(`A2:S${lastRow}`).values = rows;
  styleBody(returns.getRange(`A2:S${lastRow}`));
  returns.getRange(`J2:J${lastRow}`).formulas = Array.from({ length: returnsCapacity }, (_, index) => {
    const row = index + 2;
    return [`=IF(C${row}="","",IF(OR(B${row}="Refund Verification",B${row}="Needs Review"),MAX(H${row}-I${row},0),0))`];
  });
  returns.getRange(`M2:M${lastRow}`).formulas = Array.from({ length: returnsCapacity }, (_, index) => {
    const row = index + 2;
    return [`=IF(C${row}="","",IF(K${row}="","Not entered",IF(L${row}>=K${row},"Refunded",IF(L${row}>0,"Partial refund","Refund pending"))))`];
  });
  for (const column of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "N", "O", "P", "Q", "R", "S"]) returns.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#0000FF" };
  for (const column of ["J", "M"]) {
    returns.getRange(`${column}2:${column}${lastRow}`).format.fill = theme.soft;
    returns.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#000000" };
  }
  returns.getRange(`B2:B${lastRow}`).dataValidation = { rule: { type: "list", values: ["Needs Review", "Refund Pending", "Refund Verification", "Refunded", "Excluded from Profit", "Resolved / Counted"] } };
  returns.getRange(`S2:S${lastRow}`).dataValidation = { rule: { type: "list", values: ["Yes", "No"] } };
  returns.getRange(`A2:A${lastRow}`).format.numberFormat = dateFormat;
  returns.getRange(`D2:F${lastRow}`).format.numberFormat = "0.00";
  returns.getRange(`G2:G${lastRow}`).format.numberFormat = "@";
  returns.getRange(`H2:L${lastRow}`).format.numberFormat = currencyFormat;
  returns.getRange(`N2:N${lastRow}`).format.numberFormat = dateFormat;
  returns.getRange(`S2:S${lastRow}`).conditionalFormats.addCustom('=$S2="Yes"', { fill: theme.amberSoft, font: { color: theme.amber } });
  returns.getRange("U1:V4").values = [["Returns Summary", "Value"], ["Rows needing review", null], ["Suggested refund basis", null], ["Refund still open", null]];
  styleHeader(returns.getRange("U1:V1"), theme.purple);
  styleBody(returns.getRange("U2:V4"));
  returns.getRange("V2").formulas = [[`=COUNTIF(S2:S${lastRow},"Yes")`]];
  returns.getRange("V3").formulas = [[`=SUM(J2:J${lastRow})`]];
  returns.getRange("V4").formulas = [[`=MAX(SUM(K2:K${lastRow})-SUM(L2:L${lastRow}),0)`]];
  returns.getRange("V3:V4").format.numberFormat = currencyFormat;
  const table = returns.tables.add(`A1:S${lastRow}`, true, "ReturnsTable");
  table.showFilterButton = true;
  returns.freezePanes.freezeRows(1);
  returns.freezePanes.freezeColumns(3);
  setWidths(returns, { A: 105, B: 145, C: 360, D: 92, E: 92, F: 92, G: 165, H: 120, I: 120, J: 140, K: 120, L: 120, M: 125, N: 105, O: 100, P: 170, Q: 280, R: 330, S: 105, T: 24, U: 185, V: 120 }, lastRow);
}

function buildAmazonAudit() {
  const headers = ["Account", "Order Date", "Order #", "Order Total", "Amazon Status", "Cancelled?", "Products", "Purpose", "Direct BFMR Match", "Reservation Classification", "Needs Review", "Notes"];
  amazonAudit.getRange("A1:L1").values = [headers];
  styleHeader(amazonAudit.getRange("A1:L1"), theme.green);
  const rows = Array.from({ length: amazonCapacity }, (_, index) => {
    const order = amazonHistory[index];
    if (!order) return Array(headers.length).fill(null);
    const orderNumber = clean(order.order_number);
    const orderDate = toDate(order.order_date);
    const cancelled = Boolean(order.cancelled) || clean(order.status).toLowerCase().includes("cancel");
    const directMatch = directBfmrOrders.has(orderNumber);
    const correctedMatch = correctionByAmazon.has(orderNumber);
    const beforeCoverage = orderDate instanceof Date && orderDate < coverageStart;
    const purpose = directMatch || correctedMatch ? "BFMR Inventory" : cancelled ? "Cancelled" : beforeCoverage ? "Outside Coverage" : clean(order.account) === "Personal" ? "Personal/Household" : "Unknown";
    return [clean(order.account), orderDate, orderNumber, numeric(order.order_total, null), clean(order.status), cancelled ? "Yes" : "No", clean(order.products_text), purpose, null, null, null, correctionByAmazon.get(orderNumber)?.note || ""];
  });
  const lastRow = amazonCapacity + 1;
  amazonAudit.getRange(`A2:L${lastRow}`).values = rows;
  styleBody(amazonAudit.getRange(`A2:L${lastRow}`));
  const formulaRows = Array.from({ length: amazonCapacity }, (_, index) => {
    const row = index + 2;
    return {
      direct: `=IF(C${row}="","",IF(COUNTIF('Tracking'!$F$2:$F$${trackingCapacity + 1},C${row})>0,"Yes","No"))`,
      classification: `=IF(C${row}="","",IF(I${row}="Yes","BFMR reservation matched",IF(COUNTIF('Settings'!$F$4:$F$20,C${row})>0,"BFMR match via correction",IF(B${row}<'Settings'!$B$3,"Outside BFMR export coverage",IF(F${row}="Yes","Cancelled, no reservation required",IF(H${row}="Personal/Household","Personal purchase, no reservation expected",IF(H${row}="BFMR Inventory","Needs BFMR review","Needs classification")))))))`,
      review: `=IF(C${row}="","",IF(OR(J${row}="Needs BFMR review",J${row}="Needs classification"),"Yes","No"))`,
    };
  });
  amazonAudit.getRange(`I2:I${lastRow}`).formulas = formulaRows.map((row) => [row.direct]);
  amazonAudit.getRange(`J2:J${lastRow}`).formulas = formulaRows.map((row) => [row.classification]);
  amazonAudit.getRange(`K2:K${lastRow}`).formulas = formulaRows.map((row) => [row.review]);
  for (const column of ["A", "B", "C", "D", "E", "F", "G", "H", "L"]) amazonAudit.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#0000FF" };
  for (const column of ["I", "J", "K"]) {
    amazonAudit.getRange(`${column}2:${column}${lastRow}`).format.fill = theme.soft;
    amazonAudit.getRange(`${column}2:${column}${lastRow}`).format.font = { color: "#000000" };
  }
  amazonAudit.getRange(`A2:A${lastRow}`).dataValidation = { rule: { type: "list", values: ["Personal", "Business"] } };
  amazonAudit.getRange(`F2:F${lastRow}`).dataValidation = { rule: { type: "list", values: ["Yes", "No"] } };
  amazonAudit.getRange(`H2:H${lastRow}`).dataValidation = { rule: { type: "list", values: ["BFMR Inventory", "Personal/Household", "Cancelled", "Outside Coverage", "Unknown"] } };
  amazonAudit.getRange(`B2:B${lastRow}`).format.numberFormat = dateFormat;
  amazonAudit.getRange(`C2:C${lastRow}`).format.numberFormat = "@";
  amazonAudit.getRange(`D2:D${lastRow}`).format.numberFormat = currencyFormat;
  amazonAudit.getRange(`K2:K${lastRow}`).conditionalFormats.addCustom('=$K2="Yes"', { fill: theme.redSoft, font: { bold: true, color: theme.red } });
  amazonAudit.getRange(`J2:J${lastRow}`).conditionalFormats.addCustom('=OR($J2="BFMR reservation matched",$J2="BFMR match via correction")', { fill: theme.greenSoft, font: { color: theme.green } });
  amazonAudit.getRange(`J2:J${lastRow}`).conditionalFormats.addCustom('=OR($J2="Needs BFMR review",$J2="Needs classification")', { fill: theme.redSoft, font: { color: theme.red } });
  const table = amazonAudit.tables.add(`A1:L${lastRow}`, true, "AmazonAuditTable");
  table.showFilterButton = true;
  amazonAudit.freezePanes.freezeRows(1);
  amazonAudit.freezePanes.freezeColumns(3);
  setWidths(amazonAudit, { A: 100, B: 105, C: 165, D: 110, E: 170, F: 90, G: 430, H: 145, I: 125, J: 250, K: 105, L: 340 }, lastRow);
}

function buildMonthly() {
  const headers = ["Month", "Active Rows", "Units", "Spend", "Payout", "Product Profit", "Extra Profit", "Total Profit", "Pending Profit"];
  monthly.getRange("A1:I1").values = [headers];
  styleHeader(monthly.getRange("A1:I1"), theme.teal);
  const months = monthKeys(coverageStart, 36);
  monthly.getRange(`A2:I${months.length + 1}`).values = months.map((month) => [month, null, null, null, null, null, null, null, null]);
  styleBody(monthly.getRange(`A2:I${months.length + 1}`));
  monthly.getRange(`B2:I${months.length + 1}`).formulas = months.map((_, index) => {
    const row = index + 2;
    const trackingLast = trackingCapacity + 1;
    const addonLast = addonCapacity + 1;
    return [
      `=COUNTIFS('Tracking'!$AC$2:$AC$${trackingLast},A${row},'Tracking'!$A$2:$A$${trackingLast},"Yes")`,
      `=SUMIFS('Tracking'!$E$2:$E$${trackingLast},'Tracking'!$AC$2:$AC$${trackingLast},A${row},'Tracking'!$A$2:$A$${trackingLast},"Yes")`,
      `=SUMIFS('Tracking'!$I$2:$I$${trackingLast},'Tracking'!$AC$2:$AC$${trackingLast},A${row},'Tracking'!$A$2:$A$${trackingLast},"Yes")`,
      `=SUMIFS('Tracking'!$K$2:$K$${trackingLast},'Tracking'!$AC$2:$AC$${trackingLast},A${row},'Tracking'!$A$2:$A$${trackingLast},"Yes")`,
      `=SUMIFS('Tracking'!$S$2:$S$${trackingLast},'Tracking'!$AC$2:$AC$${trackingLast},A${row})`,
      `=SUMIFS('Extra Profit'!$E$2:$E$${addonLast},'Extra Profit'!$B$2:$B$${addonLast},A${row})`,
      `=F${row}+G${row}`,
      `=SUMIFS('Tracking'!$T$2:$T$${trackingLast},'Tracking'!$AC$2:$AC$${trackingLast},A${row})`,
    ];
  });
  monthly.getRange(`C2:C${months.length + 1}`).format.numberFormat = "0.00";
  monthly.getRange(`D2:I${months.length + 1}`).format.numberFormat = currencyFormat;
  monthly.freezePanes.freezeRows(1);
  setWidths(monthly, { A: 100, B: 95, C: 80, D: 115, E: 115, F: 125, G: 115, H: 115, I: 120 }, months.length + 1);
}

function buildReconciliation() {
  reconciliation.getRange("A1:H1").merge();
  reconciliation.getRange("A1").values = [["Amazon to BFMR Reconciliation"]];
  styleTitle(reconciliation.getRange("A1:H1"), theme.ink);
  reconciliation.getRange("A3:C3").values = [["Current Audit", "Count", "Value"]];
  styleHeader(reconciliation.getRange("A3:C3"), theme.green);
  const labels = ["Amazon orders in BFMR coverage", "Non-cancelled Amazon orders in coverage", "Direct BFMR reservation matches", "BFMR matches via correction", "Personal/household orders without BFMR reservation", "Unmatched cancelled orders excluded", "Amazon orders needing BFMR review", "Amazon orders needing purpose classification"];
  reconciliation.getRange("A4:C11").values = labels.map((label) => [label, null, null]);
  styleBody(reconciliation.getRange("A4:C11"));
  const auditLast = amazonCapacity + 1;
  reconciliation.getRange("B4").formulas = [[`=COUNTIFS('Amazon Audit'!$B$2:$B$${auditLast},">="&'Settings'!$B$3,'Amazon Audit'!$C$2:$C$${auditLast},"<>")`]];
  reconciliation.getRange("B5").formulas = [[`=COUNTIFS('Amazon Audit'!$B$2:$B$${auditLast},">="&'Settings'!$B$3,'Amazon Audit'!$F$2:$F$${auditLast},"No")`]];
  reconciliation.getRange("B6").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"BFMR reservation matched")`]];
  reconciliation.getRange("B7").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"BFMR match via correction")`]];
  reconciliation.getRange("B8").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"Personal purchase, no reservation expected")`]];
  reconciliation.getRange("B9").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"Cancelled, no reservation required")`]];
  reconciliation.getRange("B10").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"Needs BFMR review")`]];
  reconciliation.getRange("B11").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${auditLast},"Needs classification")`]];
  reconciliation.getRange("C4").formulas = [[`=SUMIFS('Amazon Audit'!$D$2:$D$${auditLast},'Amazon Audit'!$B$2:$B$${auditLast},">="&'Settings'!$B$3)`]];
  reconciliation.getRange("C5").formulas = [[`=SUMIFS('Amazon Audit'!$D$2:$D$${auditLast},'Amazon Audit'!$B$2:$B$${auditLast},">="&'Settings'!$B$3,'Amazon Audit'!$F$2:$F$${auditLast},"No")`]];
  for (const [row, category] of [[6, "BFMR reservation matched"], [7, "BFMR match via correction"], [8, "Personal purchase, no reservation expected"], [9, "Cancelled, no reservation required"], [10, "Needs BFMR review"], [11, "Needs classification"]]) {
    reconciliation.getRange(`C${row}`).formulas = [[`=SUMIFS('Amazon Audit'!$D$2:$D$${auditLast},'Amazon Audit'!$J$2:$J$${auditLast},"${category}")`]];
  }
  reconciliation.getRange("C4:C11").format.numberFormat = currencyFormat;
  reconciliation.getRange("A14:H15").merge();
  reconciliation.getRange("A14").formulas = [[`=IF(SUM(B10:B11)=0,"PASS: Current Amazon audit shows no BFMR inventory purchase without a reservation.","REVIEW: Filter Amazon Audit to Needs Review and classify the flagged orders.")`]];
  reconciliation.getRange("A14:H15").format = { fill: theme.greenSoft, font: { bold: true, color: theme.green, size: 12 }, borders: { preset: "outside", style: "medium", color: theme.green }, verticalAlignment: "center", wrapText: true };
  reconciliation.getRange("A18:D18").values = [["Amazon Order #", "BFMR Recorded Order #", "Resolution", "Accounting Effect"]];
  styleHeader(reconciliation.getRange("A18:D18"), theme.amber);
  reconciliation.getRange("A19:D20").values = correctionRows.map((row) => [row.amazonOrder, row.bfmrOrder, row.note, "Reservation confirmed; no new spend added"]);
  styleBody(reconciliation.getRange("A19:D20"));
  reconciliation.getRange("C19:D20").format.wrapText = true;
  reconciliation.getRange("A19:D20").format.rowHeightPx = 44;
  reconciliation.getRange("A23:D23").values = [["BFMR Order #", "BFMR Status", "Amazon Result", "Resolution"]];
  styleHeader(reconciliation.getRange("A23:D23"), theme.purple);
  reconciliation.getRange("A24:D26").values = [["111-1403104-8336261", "Paid", "Not found in current Amazon history", "Keep BFMR retail/payout and assume 6%, per manual instruction"], ["111-7887095-4385837", "Cancelled", "Not found", "Ignore, cancelled BFMR row"], ["111-8912364-6035466", "Cancelled", "Not found", "Ignore, cancelled BFMR row"]];
  styleBody(reconciliation.getRange("A24:D26"));
  reconciliation.getRange("A19:B26").format.numberFormat = "@";
  reconciliation.freezePanes.freezeRows(3);
  setWidths(reconciliation, { A: 360, B: 175, C: 500, D: 270, E: 105, F: 105, G: 105, H: 105 }, 31);
}

function buildChecks() {
  checks.getRange("A1:G1").merge();
  checks.getRange("A1").values = [["Workbook Checks"]];
  styleTitle(checks.getRange("A1:G1"), theme.ink);
  checks.getRange("A3:G3").values = [["Check", "Actual", "Expected", "Difference", "Tolerance", "Status", "Where to Fix"]];
  styleHeader(checks.getRange("A3:G3"), theme.navy);
  const rows = [["Active accounting rows", null, null, null, 0, null, "Tracking, Include column"], ["Spend ties to normalized source", null, null, null, 0.02, null, "Tracking, Subtotal column"], ["Payout ties to normalized source", null, null, null, 0.02, null, "Tracking, Payout Total column"], ["Product profit ties to normalized source", null, null, null, 0.02, null, "Tracking, Profit inputs"], ["Pending profit ties to normalized source", null, null, null, 0.02, null, "Tracking, Status and Include"], ["Cash paid ties to normalized source", null, null, null, 0.02, null, "Tracking, Amount Paid"], ["Open payout ties to normalized source", null, null, null, 0.02, null, "Tracking, Payout and Amount Paid"], ["Amazon orders needing BFMR review", null, 0, null, 0, null, "Amazon Audit, Purpose and correction map"]];
  checks.getRange("A4:G11").values = rows;
  styleBody(checks.getRange("A4:G11"));
  const trackingLast = trackingCapacity + 1;
  checks.getRange("B4:B11").formulas = [
    [`=COUNTIFS('Tracking'!$A$2:$A$${trackingLast},"Yes",'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$I$2:$I$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes",'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$K$2:$K$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes",'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$S$2:$S$${trackingLast},'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$T$2:$T$${trackingLast},'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$M$2:$M$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes",'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=SUMIFS('Tracking'!$U$2:$U$${trackingLast},'Tracking'!$AB$2:$AB$${trackingLast},"<>")`],
    [`=COUNTIF('Amazon Audit'!$K$2:$K$${amazonCapacity + 1},"Yes")`],
  ];
  checks.getRange("C4:C10").formulas = [["='Settings'!$B$13"], ["='Settings'!$B$14"], ["='Settings'!$B$15"], ["='Settings'!$B$16"], ["='Settings'!$B$17"], ["='Settings'!$B$18"], ["='Settings'!$B$19"]];
  checks.getRange("D4:D11").formulas = Array.from({ length: 8 }, (_, index) => { const row = index + 4; return [`=ROUND(B${row}-C${row},2)`]; });
  checks.getRange("F4:F11").formulas = Array.from({ length: 8 }, (_, index) => { const row = index + 4; return [`=IF(ABS(D${row})<=E${row},"OK","FAIL")`]; });
  checks.getRange("B5:E10").format.numberFormat = currencyFormat;
  checks.getRange("B4:E4").format.numberFormat = integerFormat;
  checks.getRange("B11:E11").format.numberFormat = integerFormat;
  checks.getRange("F4:F11").conditionalFormats.addCustom('=$F4="OK"', { fill: theme.greenSoft, font: { bold: true, color: theme.green } });
  checks.getRange("F4:F11").conditionalFormats.addCustom('=$F4="FAIL"', { fill: theme.redSoft, font: { bold: true, color: theme.red } });
  checks.getRange("A13:E13").merge();
  checks.getRange("A13").values = [["MODEL STATUS"]];
  checks.getRange("F13:G13").merge();
  checks.getRange("F13").formulas = [[`=IF(COUNTIF(F4:F11,"FAIL")=0,"PASS","FAIL")`]];
  checks.getRange("A13:G13").format = { fill: theme.soft, font: { bold: true, size: 12 }, borders: { preset: "outside", style: "medium", color: theme.line } };
  checks.getRange("F13:G13").conditionalFormats.addCustom('=$F$13="PASS"', { fill: theme.greenSoft, font: { bold: true, color: theme.green } });
  checks.getRange("F13:G13").conditionalFormats.addCustom('=$F$13="FAIL"', { fill: theme.redSoft, font: { bold: true, color: theme.red } });
  setWidths(checks, { A: 285, B: 120, C: 120, D: 110, E: 95, F: 90, G: 320 }, 15);
}

function buildSettings() {
  settings.getRange("A1:H1").merge();
  settings.getRange("A1").values = [["Settings, Assumptions, and Audit Trail"]];
  styleTitle(settings.getRange("A1:H1"), theme.ink);
  settings.getRange("A2:B2").values = [["Assumption", "Value"]];
  styleHeader(settings.getRange("A2:B2"), theme.teal);
  settings.getRange("A3:B9").values = [["BFMR export start date", coverageStart], ["Default cashback rate", numeric(metadata.cashback_rate, 0.06)], ["Personal fallback cashback", 0.06], ["Business fallback cashback", 0.06], ["Workbook generated at", generatedAt], ["Tracking row capacity", trackingCapacity], ["Amazon audit row capacity", amazonCapacity]];
  styleBody(settings.getRange("A3:B9"));
  settings.getRange("B3").format.numberFormat = dateFormat;
  settings.getRange("B4:B6").format.numberFormat = percentFormat;
  settings.getRange("B7").format.numberFormat = "yyyy-mm-dd hh:mm";
  settings.getRange("B3:B9").format.font = { color: "#0000FF" };
  settings.getRange("A11:B11").values = [["Source Snapshot Check", "Expected Value"]];
  styleHeader(settings.getRange("A11:B11"), theme.navy);
  const extraProfitTotal = addonRows.reduce((total, addon) => total + numeric(addon.amount, 0), 0);
  settings.getRange("A12:B21").values = [["Definition", "Expected values from the normalized BFMR export before workbook edits"], ["Active accounting rows", numeric(summary.active_orders, 0)], ["Spend", numeric(summary.spend, 0)], ["Payout", numeric(summary.payout, 0)], ["Product profit", numeric(summary.profit, 0)], ["Pending profit", numeric(summary.pending_profit, 0)], ["Cash paid", numeric(summary.cash_paid, 0)], ["Open payout", numeric(summary.open_payout, 0)], ["Extra profit", extraProfitTotal], ["Total profit including extras", numeric(summary.profit, 0) + extraProfitTotal]];
  styleBody(settings.getRange("A12:B21"));
  settings.getRange("B14:B21").format.numberFormat = currencyFormat;
  settings.getRange("D2:D2").values = [["Editable Cell Legend"]];
  styleHeader(settings.getRange("D2"), theme.purple);
  settings.getRange("D3:E6").values = [["Blue text", "User-editable input"], ["Black text", "Formula/calculation"], ["Green text", "Imported source data"], ["Yellow fill", "Review or classification needed"]];
  styleBody(settings.getRange("D3:E6"));
  settings.getRange("D3").format.font = { color: "#0000FF" };
  settings.getRange("D5").format.font = { color: "#008000" };
  settings.getRange("D6:E6").format.fill = theme.amberSoft;
  settings.getRange("F2:H2").values = [["Amazon Order #", "BFMR Recorded Order #", "Known Correction"]];
  styleHeader(settings.getRange("F2:H2"), theme.amber);
  settings.getRange("F4:H5").values = correctionRows.map((row) => [row.amazonOrder, row.bfmrOrder, row.note]);
  styleBody(settings.getRange("F3:H20"));
  settings.getRange("F3:H20").format.font = { color: "#0000FF" };
  settings.getRange("F3:G20").format.numberFormat = "@";
  settings.getRange("A24:B24").values = [["Source Metadata", "Value"]];
  styleHeader(settings.getRange("A24:B24"), theme.green);
  settings.getRange("A25:B29").values = [["BFMR source", sourceWorkbookPath || clean(metadata.source_url) || clean(metadata.tracker_export)], ["Normalized record count", records.length], ["Detailed Amazon rows", Array.isArray(amazonOrders) ? amazonOrders.length : 0], ["Full Amazon audit rows", amazonHistory.length], ["Accounting convention", "Cancelled and excluded return/deadline rows do not affect spend, payout, or profit"]];
  styleBody(settings.getRange("A25:B29"));
  settings.getRange("A32:H36").merge(true);
  settings.getRange("A32:A36").values = [["How to keep this workbook current"], ["1. Add or edit BFMR rows on Tracking. Blue text cells are inputs; formula columns calculate automatically."], ["2. Paste new Amazon orders into Amazon Audit and classify Purpose. Add known order-ID corrections above when needed."], ["3. Log checking bonuses, BFMR referrals not already in Tracking, Young Adult cashback, and other income on Extra Profit."], ["4. Use Checks after each update. New rows with a blank Source Row update totals without breaking the imported-snapshot tie-outs."]];
  settings.getRange("A32:H36").format = { fill: theme.blueSoft, wrapText: true, font: { color: theme.ink } };
  settings.getRange("A32:H32").format.font = { bold: true, color: theme.navy };
  settings.getRange("H4:H5").format.wrapText = true;
  settings.getRange("H4:H5").format.rowHeightPx = 44;
  setWidths(settings, { A: 260, B: 470, C: 24, D: 150, E: 210, F: 175, G: 175, H: 520 }, 40);
}

function buildDashboard() {
  dashboard.getRange("A1:P1").merge();
  dashboard.getRange("A1").values = [["Toopa's BFMR Tracking"]];
  styleTitle(dashboard.getRange("A1:P1"), theme.ink);
  dashboard.getRange("A2:P2").merge();
  dashboard.getRange("A2").values = [[`Standalone Excel tracker | BFMR source through ${formatIsoDate(maxRecordDate(records))} | Blue cells are editable`]];
  dashboard.getRange("A2:P2").format = { fill: theme.soft, font: { color: theme.muted }, horizontalAlignment: "center" };
  const trackingLast = trackingCapacity + 1;
  const addonLast = addonCapacity + 1;
  const kpis = [["A4:D4", "A5:D6", "Total Spend", `=SUMIFS('Tracking'!$I$2:$I$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes")`, currencyFormat, theme.blueSoft], ["E4:H4", "E5:H6", "Expected Payout", `=SUMIFS('Tracking'!$K$2:$K$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes")`, currencyFormat, theme.greenSoft], ["I4:L4", "I5:L6", "Product Profit", `=SUM('Tracking'!$S$2:$S$${trackingLast})`, currencyFormat, theme.greenSoft], ["M4:P4", "M5:P6", "Total Profit + Extras", `=SUM('Tracking'!$S$2:$S$${trackingLast})+SUM('Extra Profit'!$E$2:$E$${addonLast})`, currencyFormat, theme.amberSoft], ["A8:D8", "A9:D10", "Pending Profit", `=SUM('Tracking'!$T$2:$T$${trackingLast})`, currencyFormat, theme.amberSoft], ["E8:H8", "E9:H10", "Open Payout", `=SUM('Tracking'!$U$2:$U$${trackingLast})`, currencyFormat, theme.blueSoft], ["I8:L8", "I9:L10", "Cash Paid", `=SUMIFS('Tracking'!$M$2:$M$${trackingLast},'Tracking'!$A$2:$A$${trackingLast},"Yes")`, currencyFormat, theme.greenSoft], ["M8:P8", "M9:P10", "BFMR Orders Without Reservation", `=COUNTIF('Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"Needs BFMR review")`, integerFormat, theme.greenSoft]];
  for (const [labelRange, valueRange, label, formula, numberFormat, fill] of kpis) {
    dashboard.getRange(labelRange).merge(); dashboard.getRange(valueRange).merge();
    dashboard.getRange(labelRange.split(":")[0]).values = [[label]]; dashboard.getRange(valueRange.split(":")[0]).formulas = [[formula]];
    dashboard.getRange(labelRange).format = { fill, font: { bold: true, color: theme.ink }, borders: { preset: "outside", style: "thin", color: theme.line }, horizontalAlignment: "center" };
    dashboard.getRange(valueRange).format = { fill, font: { bold: true, color: theme.ink, size: 16 }, numberFormat, borders: { preset: "outside", style: "thin", color: theme.line }, horizontalAlignment: "center", verticalAlignment: "center" };
  }
  dashboard.getRange("A13:I13").values = [["Month", "Rows", "Units", "Spend", "Payout", "Product Profit", "Extra Profit", "Total Profit", "Pending Profit"]];
  styleHeader(dashboard.getRange("A13:I13"), theme.teal);
  const dashboardMonths = 12;
  dashboard.getRange(`A14:I${13 + dashboardMonths}`).formulas = Array.from({ length: dashboardMonths }, (_, index) => { const sourceRow = index + 2; return [`='Monthly'!A${sourceRow}`, `='Monthly'!B${sourceRow}`, `='Monthly'!C${sourceRow}`, `='Monthly'!D${sourceRow}`, `='Monthly'!E${sourceRow}`, `='Monthly'!F${sourceRow}`, `='Monthly'!G${sourceRow}`, `='Monthly'!H${sourceRow}`, `='Monthly'!I${sourceRow}`]; });
  styleBody(dashboard.getRange(`A14:I${13 + dashboardMonths}`));
  dashboard.getRange(`D14:I${13 + dashboardMonths}`).format.numberFormat = currencyFormat;
  const spendChart = dashboard.charts.add("line", { chartType: "line", title: "Monthly Spend and Expected Payout ($)", hasLegend: true });
  const spendSeries = spendChart.series.add("Spend"); spendSeries.categoryFormula = `'Dashboard'!$A$14:$A$${13 + dashboardMonths}`; spendSeries.formula = `'Dashboard'!$D$14:$D$${13 + dashboardMonths}`; spendSeries.fill = theme.blue;
  const payoutSeries = spendChart.series.add("Expected Payout"); payoutSeries.categoryFormula = `'Dashboard'!$A$14:$A$${13 + dashboardMonths}`; payoutSeries.formula = `'Dashboard'!$E$14:$E$${13 + dashboardMonths}`; payoutSeries.fill = theme.green;
  spendChart.title = "Monthly Spend and Expected Payout ($)"; spendChart.hasLegend = true; spendChart.yAxis = { numberFormatCode: "$#,##0" }; spendChart.setPosition("K13", "P28");
  const profitChart = dashboard.charts.add("bar", { chartType: "bar", title: "Monthly Profit ($)", hasLegend: true });
  const productSeries = profitChart.series.add("Product Profit"); productSeries.categoryFormula = `'Dashboard'!$A$14:$A$${13 + dashboardMonths}`; productSeries.formula = `'Dashboard'!$F$14:$F$${13 + dashboardMonths}`; productSeries.fill = theme.teal;
  const totalSeries = profitChart.series.add("Total Profit"); totalSeries.categoryFormula = `'Dashboard'!$A$14:$A$${13 + dashboardMonths}`; totalSeries.formula = `'Dashboard'!$H$14:$H$${13 + dashboardMonths}`; totalSeries.fill = theme.amber;
  profitChart.title = "Monthly Profit ($)"; profitChart.hasLegend = true; profitChart.yAxis = { numberFormatCode: "$#,##0" }; profitChart.setPosition("K30", "P45");
  dashboard.getRange("A34:D34").values = [["Lifecycle", "Rows", "Spend", "Open Payout"]]; styleHeader(dashboard.getRange("A34:D34"), theme.purple);
  const lifecycleStages = ["Reserved", "Ordered", "Shipped", "Package Received", "Processed", "Paid"];
  dashboard.getRange("A35:D40").values = lifecycleStages.map((stage) => [stage, null, null, null]); styleBody(dashboard.getRange("A35:D40"));
  dashboard.getRange("B35:D40").formulas = lifecycleStages.map((_, index) => { const row = index + 35; return [`=COUNTIF('Tracking'!$C$2:$C$${trackingLast},A${row})`, `=SUMIFS('Tracking'!$I$2:$I$${trackingLast},'Tracking'!$C$2:$C$${trackingLast},A${row},'Tracking'!$A$2:$A$${trackingLast},"Yes")`, `=SUMIFS('Tracking'!$U$2:$U$${trackingLast},'Tracking'!$C$2:$C$${trackingLast},A${row})`]; });
  dashboard.getRange("C35:D40").format.numberFormat = currencyFormat;
  dashboard.getRange("F34:I34").values = [["Audit Item", "Count", "Value", "Action"]]; styleHeader(dashboard.getRange("F34:I34"), theme.green);
  dashboard.getRange("F35:I39").values = [["Personal/household Amazon orders", null, null, "No BFMR reservation expected"], ["Cancelled Amazon orders", null, null, "Excluded"], ["Known BFMR order-ID corrections", null, null, "Already reconciled"], ["Returns needing review", null, null, "Open Returns tab"], ["Tracking data-quality flags", null, null, "Filter Tracking, Data Quality"]]; styleBody(dashboard.getRange("F35:I39"));
  dashboard.getRange("G35:H39").formulas = [[`=COUNTIF('Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"Personal purchase, no reservation expected")`, `=SUMIFS('Amazon Audit'!$D$2:$D$${amazonCapacity + 1},'Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"Personal purchase, no reservation expected")`], [`=COUNTIF('Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"Cancelled, no reservation required")`, `=SUMIFS('Amazon Audit'!$D$2:$D$${amazonCapacity + 1},'Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"Cancelled, no reservation required")`], [`=COUNTIF('Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"BFMR match via correction")`, `=SUMIFS('Amazon Audit'!$D$2:$D$${amazonCapacity + 1},'Amazon Audit'!$J$2:$J$${amazonCapacity + 1},"BFMR match via correction")`], [`=COUNTIF('Returns'!$S$2:$S$${returnsCapacity + 1},"Yes")`, `=SUM('Returns'!$K$2:$K$${returnsCapacity + 1})`], [`=COUNTIF('Tracking'!$AE$2:$AE$${trackingLast},"Missing*")`, `=0`]];
  dashboard.getRange("H35:H39").format.numberFormat = currencyFormat;
  dashboard.getRange("A43:I44").merge();
  dashboard.getRange("A43").formulas = [[`=IF(COUNTIF('Amazon Audit'!$K$2:$K$${amazonCapacity + 1},"Yes")=0,"Current conclusion: every identified BFMR inventory order has a reservation. Unmatched Amazon orders are personal/household purchases or cancelled orders.","Review needed: Amazon Audit contains orders that still need a BFMR reservation decision.")`]];
  dashboard.getRange("A43:I44").format = { fill: theme.greenSoft, font: { bold: true, color: theme.green }, wrapText: true, verticalAlignment: "center" };
  dashboard.freezePanes.freezeRows(2);
  dashboard.getRange("F35:I39").format.wrapText = true;
  dashboard.getRange("F35:I39").format.rowHeightPx = 30;
  setWidths(dashboard, { A: 110, B: 100, C: 90, D: 115, E: 115, F: 260, G: 90, H: 120, I: 230, J: 24, K: 105, L: 105, M: 105, N: 105, O: 105, P: 105 }, 48);
}

async function buildBfmrSource() {
  let sourceValues = null;
  if (sourceWorkbookPath) {
    try {
      const sourceBlob = await FileBlob.load(sourceWorkbookPath);
      const imported = await SpreadsheetFile.importXlsx(sourceBlob);
      const importedSheet = imported.worksheets.getItemAt(0);
      const used = importedSheet.getUsedRange(true);
      sourceValues = used?.values || null;
    } catch (error) {
      console.warn(`Could not import BFMR source workbook: ${error.message}`);
    }
  }
  if (!Array.isArray(sourceValues) || !sourceValues.length) {
    sourceValues = [["Status", "Items", "Quantity", "Order ID", "Tracking ID", "Payout", "Sub Total", "Quantity Received", "Amount Paid", "Date Reserved", "Note", "Retail Price"], ...records.map((record) => [record.status_raw || record.status, record.item_name, record.quantity, record.order_number, record.tracking, record.payout_per_unit, record.purchase_total, record.received, record.amount_paid, toDate(record.date), record.notes, numeric(record.purchase_total, 0) / Math.max(numeric(record.quantity, 1), 1)])];
  }
  const rowCount = sourceValues.length;
  const colCount = Math.max(...sourceValues.map((row) => row.length));
  const normalizedRows = sourceValues.map((row) => Array.from({ length: colCount }, (_, index) => row[index] ?? null));
  const sourceRange = bfmrSource.getRangeByIndexes(0, 0, rowCount, colCount);
  sourceRange.values = normalizedRows;
  styleBody(sourceRange);
  const headerRange = bfmrSource.getRangeByIndexes(0, 0, 1, colCount);
  styleHeader(headerRange, theme.green);
  if (rowCount > 1) bfmrSource.getRangeByIndexes(1, 0, rowCount - 1, colCount).format.font = { color: "#008000" };
  if (rowCount > 1) { const table = bfmrSource.tables.add(sourceRange, true, "BfmrSourceTable"); table.showFilterButton = true; }
  const headers = normalizedRows[0].map((value) => clean(value).toLowerCase());
  headers.forEach((header, index) => {
    const columnRange = bfmrSource.getRangeByIndexes(1, index, Math.max(rowCount - 1, 1), 1);
    if (header.includes("date") || header.includes("deadline")) columnRange.format.numberFormat = dateFormat;
    if (header.includes("payout") || header.includes("sub total") || header.includes("subtotal") || header.includes("retail price") || header.includes("amount paid")) columnRange.format.numberFormat = currencyFormat;
    if (header.includes("order") || header.includes("tracking")) columnRange.format.numberFormat = "@";
  });
  bfmrSource.freezePanes.freezeRows(1); bfmrSource.freezePanes.freezeColumns(3); sourceRange.format.wrapText = false;
  for (let index = 0; index < colCount; index += 1) {
    const header = headers[index] || "";
    const width = header.includes("items") ? 390 : header.includes("note") ? 320 : header.includes("tracking") ? 210 : 120;
    bfmrSource.getRangeByIndexes(0, index, rowCount, 1).format.columnWidthPx = width;
  }
}

function styleTitle(range, fill) {
  range.format = { fill, font: { bold: true, color: theme.white, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "medium", color: fill } };
  range.format.rowHeightPx = 34;
}
function styleHeader(range, fill = theme.teal) {
  range.format = { fill, font: { bold: true, color: theme.white }, borders: { preset: "all", style: "thin", color: theme.line }, verticalAlignment: "center", wrapText: true };
  range.format.rowHeightPx = 30;
}
function styleBody(range) {
  range.format = { fill: theme.white, font: { color: theme.ink }, borders: { insideHorizontal: { style: "thin", color: theme.line }, bottom: { style: "thin", color: theme.line } }, verticalAlignment: "center" };
}
function setWidths(sheet, widths, lastRow) {
  for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}1:${column}${lastRow}`).format.columnWidthPx = width;
}
function returnRelevant(record) {
  const status = clean(record.status).toLowerCase();
  return Boolean(record.return_context || record.return_group_key || record.split_review_needed || status === "return" || status === "returned");
}
function normalizeAmazonHistory(payload) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && (Array.isArray(payload.personal) || Array.isArray(payload.business))) rows = [...(payload.personal || []).map((row) => ({ ...row, account: "Personal" })), ...(payload.business || []).map((row) => ({ ...row, account: "Business" }))];
  const byKey = new Map();
  for (const row of rows) {
    const orderNumber = clean(row.order_number); if (!orderNumber) continue;
    const account = clean(row.account) || "Personal";
    const products = Array.isArray(row.products) ? row.products.map((product) => clean(product?.title || product)).filter(Boolean).join(" | ") : clean(row.products_text || row.item_name || row.title);
    const normalized = { account, order_date: row.order_date || row.date || "", order_number: orderNumber, order_total: numeric(row.order_total, 0), status: clean(row.status || row.delivery_status), cancelled: Boolean(row.cancelled) || clean(row.status || row.delivery_status).toLowerCase().includes("cancel"), products_text: products };
    byKey.set(`${account}|${orderNumber}`, normalized);
  }
  return Array.from(byKey.values()).sort((left, right) => (toDate(right.order_date)?.getTime() || 0) - (toDate(left.order_date)?.getTime() || 0) || left.order_number.localeCompare(right.order_number));
}
function addonCategoryLabel(value) {
  const labels = { checking_bonus: "Checking Bonus", bfmr_referral: "BFMR Referral", amazon_young_adult_cashback: "Amazon Young Adult Cashback", extra_profit: "Extra Profit" };
  return labels[clean(value)] || clean(value) || "Extra Profit";
}
function minRecordDate(rows) {
  const dates = rows.map((row) => toDate(row.date)).filter((value) => value instanceof Date);
  return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : null;
}
function maxRecordDate(rows) {
  const dates = rows.map((row) => toDate(row.date)).filter((value) => value instanceof Date);
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}
function monthKeys(startDate, count) {
  return Array.from({ length: count }, (_, index) => { const date = new Date(startDate.getFullYear(), startDate.getMonth() + index, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; });
}
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = clean(value); const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}
function formatIsoDate(value) {
  if (!(value instanceof Date)) return "unknown date";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function numeric(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback;
}
function clean(value) { return String(value ?? "").trim(); }
async function readJson(filePath, fallback) { try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return fallback; } }
async function fileExists(filePath) { try { await fs.access(filePath); return true; } catch { return false; } }
