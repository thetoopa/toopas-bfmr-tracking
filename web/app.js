const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

const colors = {
  teal: "#047d78",
  indigo: "#4655a7",
  amber: "#b7791f",
  green: "#13795b",
  red: "#b42318",
  blue: "#1d6fb8",
  gray: "#687385",
  ink: "#18222f",
  line: "#d7dde8",
};

const statusColors = {
  Reserved: colors.gray,
  Ordered: colors.blue,
  "Package Received": colors.amber,
  Processed: colors.teal,
  Paid: colors.green,
  Purchased: colors.blue,
  Shipped: colors.indigo,
  Cancelled: colors.red,
  Return: "#c2410c",
  Deadline: colors.amber,
  Unknown: colors.gray,
};

const priceSourceColors = {
  "Existing tracker match": colors.green,
  "Existing tracker order match": colors.teal,
  "BFMR Retail Price": colors.indigo,
  "BFMR site retail price": colors.blue,
  "Payout fallback": colors.amber,
};

const addonLabels = {
  checking_bonus: "Checking Bonus",
  bfmr_referral: "BFMR Referral",
  amazon_young_adult_cashback: "Amazon Young Adult Cashback",
  extra_profit: "Extra Profit",
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const statusOptions = [
  "Reserved",
  "Ordered",
  "Purchased",
  "Shipped",
  "Package Received",
  "Processed",
  "Paid",
  "Cancelled",
  "Return",
  "Deadline",
  "Closed",
  "Pending",
];
const lifecycleStages = [
  { id: "reserved", label: "Reserved" },
  { id: "ordered", label: "Ordered" },
  { id: "shipped", label: "Shipped" },
  { id: "received", label: "Pkg Received" },
  { id: "processed", label: "Processed" },
  { id: "paid", label: "Paid" },
];
const defaultSettings = {
  assumptions: {
    default_cashback_rate: 0.06,
    no_order_account: "Personal",
    no_order_cashback_rate: 0.06,
    business_default_cashback_rate: 0.06,
    manual_assumed_orders: [
      {
        order_number: "111-1403104-8336261",
        account: "Personal",
        cashback_rate: 0.06,
        note: "Manual 6% assumption per user",
      },
    ],
  },
  chrome: {
    bfmr_profile_directory: "Default",
    skip_paid_orders: true,
    profiles: [
      { id: "personal-default", name: "Personal Amazon", profile_directory: "Default", account_type: "personal", enabled: true },
      { id: "business-profile-9", name: "Business Amazon", profile_directory: "Profile9", account_type: "business", enabled: true },
    ],
  },
};

let dataset = null;
let settingsState = structuredClone(defaultSettings);
let chromeProfiles = [];
let deferredInstallPrompt = null;
let tableColumnPrefs = null;
let state = {
  month: "all",
  status: "all",
  account: "all",
  priceSource: "all",
  tracking: "all",
  payment: "all",
  amazon: "all",
  sort: "date_desc",
  search: "",
  tab: "dashboard",
};

const elements = {
  metadata: document.getElementById("metadata"),
  themeToggle: document.getElementById("themeToggle"),
  monthFilter: document.getElementById("monthFilter"),
  statusFilter: document.getElementById("statusFilter"),
  accountFilter: document.getElementById("accountFilter"),
  analyticsMonthFilter: document.getElementById("analyticsMonthFilter"),
  analyticsStatusFilter: document.getElementById("analyticsStatusFilter"),
  analyticsAccountFilter: document.getElementById("analyticsAccountFilter"),
  analyticsAmazonFilter: document.getElementById("analyticsAmazonFilter"),
  analyticsSearchInput: document.getElementById("analyticsSearchInput"),
  priceSourceFilter: document.getElementById("priceSourceFilter"),
  trackingFilter: document.getElementById("trackingFilter"),
  paymentFilter: document.getElementById("paymentFilter"),
  amazonFilter: document.getElementById("amazonFilter"),
  sortFilter: document.getElementById("sortFilter"),
  searchInput: document.getElementById("searchInput"),
  installButton: document.getElementById("installButton"),
  tabButtons: [...document.querySelectorAll("[data-tab]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  quickChips: document.getElementById("quickChips"),
  kpiGrid: document.getElementById("kpiGrid"),
  lifecycleGrid: document.getElementById("lifecycleGrid"),
  insightGrid: document.getElementById("insightGrid"),
  monthNote: document.getElementById("monthNote"),
  dailyNote: document.getElementById("dailyNote"),
  statusLegend: document.getElementById("statusLegend"),
  priceLegend: document.getElementById("priceLegend"),
  topItems: document.getElementById("topItems"),
  watchlist: document.getElementById("watchlist"),
  watchlistCount: document.getElementById("watchlistCount"),
  etaTotals: document.getElementById("etaTotals"),
  etaTotalsCount: document.getElementById("etaTotalsCount"),
  topOrders: document.getElementById("topOrders"),
  topSpend: document.getElementById("topSpend"),
  returnsStatus: document.getElementById("returnsStatus"),
  returnsSummary: document.getElementById("returnsSummary"),
  returnsCount: document.getElementById("returnsCount"),
  returnsList: document.getElementById("returnsList"),
  returnReviewCount: document.getElementById("returnReviewCount"),
  returnReviewList: document.getElementById("returnReviewList"),
  addonForm: document.getElementById("addonForm"),
  addonButton: document.getElementById("addonButton"),
  addonTotal: document.getElementById("addonTotal"),
  addonList: document.getElementById("addonList"),
  chromeSyncButton: document.getElementById("chromeSyncButton"),
  syncStatus: document.getElementById("syncStatus"),
  amazonSyncButton: document.getElementById("amazonSyncButton"),
  amazonSyncStatus: document.getElementById("amazonSyncStatus"),
  manualExtractStatus: document.getElementById("manualExtractStatus"),
  rescrapeButton: document.getElementById("rescrapeButton"),
  rescrapeAllButton: document.getElementById("rescrapeAllButton"),
  rescrapeStatus: document.getElementById("rescrapeStatus"),
  copyBfmrExtractor: document.getElementById("copyBfmrExtractor"),
  copyAmazonExtractor: document.getElementById("copyAmazonExtractor"),
  bfmrJsonForm: document.getElementById("bfmrJsonForm"),
  bfmrJsonButton: document.getElementById("bfmrJsonButton"),
  amazonJsonForm: document.getElementById("amazonJsonForm"),
  amazonJsonButton: document.getElementById("amazonJsonButton"),
  ordersHead: document.getElementById("ordersHead"),
  ordersBody: document.getElementById("ordersBody"),
  orderCards: document.getElementById("orderCards"),
  rowCount: document.getElementById("rowCount"),
  columnPrefsButton: document.getElementById("columnPrefsButton"),
  columnPrefsPanel: document.getElementById("columnPrefsPanel"),
  columnPrefsList: document.getElementById("columnPrefsList"),
  resetColumnPrefs: document.getElementById("resetColumnPrefs"),
  uploadForm: document.getElementById("uploadForm"),
  uploadButton: document.getElementById("uploadButton"),
  gusImportForm: document.getElementById("gusImportForm"),
  gusImportButton: document.getElementById("gusImportButton"),
  toast: document.getElementById("toast"),
  settingsStatus: document.getElementById("settingsStatus"),
  defaultCashbackRate: document.getElementById("defaultCashbackRate"),
  noOrderAccount: document.getElementById("noOrderAccount"),
  noOrderCashbackRate: document.getElementById("noOrderCashbackRate"),
  businessDefaultCashbackRate: document.getElementById("businessDefaultCashbackRate"),
  manualAssumptionsJson: document.getElementById("manualAssumptionsJson"),
  bfmrProfileDirectory: document.getElementById("bfmrProfileDirectory"),
  skipPaidOrders: document.getElementById("skipPaidOrders"),
  settingsProfiles: document.getElementById("settingsProfiles"),
  addProfileButton: document.getElementById("addProfileButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
};

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("toopa-theme", nextTheme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", nextTheme === "dark" ? "#111827" : "#047d78");
  if (elements.themeToggle) {
    elements.themeToggle.textContent = nextTheme === "dark" ? "Light" : "Dark";
    elements.themeToggle.setAttribute("aria-label", `Switch to ${nextTheme === "dark" ? "light" : "dark"} mode`);
  }
}

function money(value) {
  return currency.format(Number(value || 0));
}

function fmtDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function deliveryEtaText(record) {
  return record.amazon_delivery_eta_date
    ? fmtDate(record.amazon_delivery_eta_date)
    : record.amazon_delivery_eta || "";
}

function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

function compareNumber(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

function compareDate(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareOptionalDate(a, b, direction = "asc") {
  const left = String(a || "");
  const right = String(b || "");
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction === "desc" ? compareDate(right, left) : compareDate(left, right);
}

function fmtMonth(value) {
  if (!value || value === "Unknown") return "Unknown";
  const [year, month] = value.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trackingMissing(record) {
  const tracking = String(record.tracking || "").trim().toLowerCase();
  return !tracking || tracking === "not submitted" || tracking === "enter tracking." || tracking === "enter tracking";
}

function activeRecord(record) {
  return record.status !== "Cancelled";
}

function openPayout(record) {
  if (!activeRecord(record)) return 0;
  return Math.max((record.payout_total || 0) - (record.amount_paid || 0), 0);
}

function hasAmazonOrderNumber(value) {
  return /^\d{3}-\d{7}-\d{7}$/.test(String(value || "").trim());
}

function returnRelevant(record) {
  const status = String(record.status || "").toLowerCase();
  return Boolean(
    activeRecord(record) &&
      !String(record.item_name || "").trim().toLowerCase().includes("referral bonus") &&
      (status === "return" ||
        status === "deadline" ||
        record.order_number_inferred ||
        record.return_context ||
        record.split_review_needed ||
        (!hasAmazonOrderNumber(record.order_number) && Number(record.purchase_total || 0) > 0)),
  );
}

function returnReviewNeeded(record) {
  return Boolean(
    activeRecord(record) &&
      !String(record.item_name || "").trim().toLowerCase().includes("referral bonus") &&
      (record.split_review_needed || (!hasAmazonOrderNumber(record.order_number) && Number(record.purchase_total || 0) > 0)),
  );
}

function returnGroups(records) {
  const groups = new Map();
  for (const record of records.filter(returnRelevant)) {
    const key = record.return_group_key || record.order_number || `review-${record.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rows: [],
        spend: 0,
        payout: 0,
        profit: 0,
        open: 0,
      });
    }
    const group = groups.get(key);
    group.rows.push(record);
    group.spend += Number(record.purchase_total || 0);
    group.payout += Number(record.payout_total || 0);
    group.profit += Number(record.profit || 0);
    group.open += openPayout(record);
  }
  return [...groups.values()].sort((a, b) => compareDate(b.rows[0]?.date, a.rows[0]?.date) || compareText(a.key, b.key));
}

function lifecycleStage(record) {
  if (!activeRecord(record)) return "cancelled";
  const status = String(record.status || "").toLowerCase();
  const hasRealTracking = !trackingMissing(record);
  const quantity = Number(record.quantity || 0);
  const received = Number(record.received || 0);
  const payout = Number(record.payout_total || 0);
  const paid = Number(record.amount_paid || 0);

  if (status === "paid" || record.date_paid || (payout > 0 && paid >= payout)) return "paid";
  if (status === "processed" || status === "return" || record.date_processed) return "processed";
  if (status === "package received" || status === "pkg received" || received > 0 || (quantity > 0 && received >= quantity)) return "received";
  if (status === "shipped" || hasRealTracking) return "shipped";
  if (status === "ordered" || status === "purchased" || record.order_number) return "ordered";
  return "reserved";
}

function lifecycleStageLabel(record) {
  const stage = lifecycleStages.find((item) => item.id === lifecycleStage(record));
  return stage ? stage.label : "Cancelled";
}

function preciseCashback(record) {
  const source = String(record.cashback_rate_source || "").toLowerCase();
  return Boolean(record.amazon_order_matched && source && !source.includes("default") && !source.includes("pending"));
}

function profitRate(summary) {
  return summary.spend ? summary.profit / summary.spend : 0;
}

function recordSearchText(record) {
  return [
    record.item_name,
    record.order_number,
    record.tracking,
    record.status,
    record.account,
    record.price_source,
    record.cashback_rate,
    record.cashback_rate_source,
    record.account_source,
    record.return_context,
    record.split_review_reason,
    Array.isArray(record.split_candidate_orders) ? record.split_candidate_orders.join(" ") : "",
    record.amazon_profile,
    record.amazon_payment_method,
    record.amazon_reward_text,
    record.date,
    record.month_key,
  ]
    .join(" ")
    .toLowerCase();
}

function addonMonth(addon) {
  return addon.date ? addon.date.slice(0, 7) : "Unknown";
}

function addonSearchText(addon) {
  return [
    addon.description,
    addonLabels[addon.category] || addon.category,
    addon.notes,
    addon.date,
    addon.amount,
  ]
    .join(" ")
    .toLowerCase();
}

function filteredAddons() {
  if (!dataset) return [];
  const query = state.search.trim().toLowerCase();
  return (dataset.addons || []).filter((addon) => {
    const monthOk = state.month === "all" || addonMonth(addon) === state.month;
    const searchOk = !query || addonSearchText(addon).includes(query);
    return monthOk && searchOk;
  });
}

function categoryTotals(addons) {
  return addons.reduce((totals, addon) => {
    const category = addon.category || "unknown";
    totals[category] = (totals[category] || 0) + (Number(addon.amount) || 0);
    return totals;
  }, {});
}

function mergeSettings(settings) {
  return {
    ...structuredClone(defaultSettings),
    ...(settings || {}),
    assumptions: {
      ...defaultSettings.assumptions,
      ...((settings || {}).assumptions || {}),
    },
    chrome: {
      ...defaultSettings.chrome,
      ...((settings || {}).chrome || {}),
      profiles: Array.isArray(settings?.chrome?.profiles) ? settings.chrome.profiles : defaultSettings.chrome.profiles,
    },
  };
}

function rateToPercentInput(value) {
  return Number(((Number(value) || 0) * 100).toFixed(2));
}

function percentInputToRate(value, fallback = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number((parsed / 100).toFixed(4)) : fallback / 100;
}

function profileOptionsHtml(selected) {
  const selectedValue = String(selected || "Default");
  const profiles = chromeProfiles.length
    ? chromeProfiles
    : [{ directory: "Default", label: "Default (Default)" }];
  const hasSelected = profiles.some((profile) => profile.directory === selectedValue);
  const options = hasSelected
    ? profiles
    : [{ directory: selectedValue, label: `${selectedValue} (saved profile)` }, ...profiles];
  return options
    .map(
      (profile) =>
        `<option value="${escapeHtml(profile.directory)}" ${profile.directory === selectedValue ? "selected" : ""}>${escapeHtml(
          profile.label || profile.directory,
        )}</option>`,
    )
    .join("");
}

function normalizeLoadedDataset(payload) {
  dataset = payload;
  if (!Array.isArray(dataset.records)) dataset.records = [];
  if (!Array.isArray(dataset.addons)) dataset.addons = [];
  if (!Array.isArray(dataset.amazon_orders)) dataset.amazon_orders = [];
  settingsState = mergeSettings(dataset.settings);
}

function filteredRecords() {
  if (!dataset) return [];
  const query = state.search.trim().toLowerCase();
  const filtered = dataset.records.filter((record) => {
    const cancelledOk = state.status === "Cancelled" || activeRecord(record);
    const monthOk = state.month === "all" || record.month_key === state.month;
    const statusOk = state.status === "all" || record.status === state.status;
    const accountOk = state.account === "all" || record.account === state.account;
    const priceOk = state.priceSource === "all" || record.price_source === state.priceSource;
    const trackingOk =
      state.tracking === "all" ||
      (state.tracking === "missing" && trackingMissing(record)) ||
      (state.tracking === "submitted" && !trackingMissing(record));
    const paymentOk =
      state.payment === "all" ||
      (state.payment === "open" && openPayout(record) > 0) ||
      (state.payment === "paid" && activeRecord(record) && record.payout_total > 0 && openPayout(record) <= 0) ||
      (state.payment === "unpaid" && activeRecord(record) && (record.amount_paid || 0) <= 0);
    const amazonOk =
      state.amazon === "all" ||
      (state.amazon === "matched" && record.amazon_order_matched) ||
      (state.amazon === "unmatched" && !record.amazon_order_matched) ||
      (state.amazon === "precise" && preciseCashback(record));
    const searchOk = !query || recordSearchText(record).includes(query);
    return cancelledOk && monthOk && statusOk && accountOk && priceOk && trackingOk && paymentOk && amazonOk && searchOk;
  });

  const defaultSort = (a, b) => compareDate(b.date, a.date) || compareNumber(b.source_row, a.source_row);
  return filtered.sort((a, b) => {
    let result = 0;
    if (state.sort === "date_asc") result = compareDate(a.date, b.date) || compareNumber(a.source_row, b.source_row);
    if (state.sort === "source_row_asc") result = compareNumber(a.source_row, b.source_row);
    if (state.sort === "source_row_desc") result = compareNumber(b.source_row, a.source_row);
    if (state.sort === "status_asc") result = compareText(a.status, b.status);
    if (state.sort === "item_asc") result = compareText(a.item_name, b.item_name);
    if (state.sort === "order_asc") result = compareText(a.order_number, b.order_number);
    if (state.sort === "tracking_asc") result = compareText(a.tracking, b.tracking);
    if (state.sort === "eta_asc") result = compareOptionalDate(a.amazon_delivery_eta_date, b.amazon_delivery_eta_date);
    if (state.sort === "eta_desc") result = compareOptionalDate(a.amazon_delivery_eta_date, b.amazon_delivery_eta_date, "desc");
    if (state.sort === "account_asc") result = compareText(a.account, b.account);
    if (state.sort === "amazon_asc") result = Number(a.amazon_order_matched) - Number(b.amazon_order_matched);
    if (state.sort === "profit_desc") result = compareNumber(b.profit, a.profit);
    if (state.sort === "profit_asc") result = compareNumber(a.profit, b.profit);
    if (state.sort === "spend_desc") result = compareNumber(b.purchase_total, a.purchase_total);
    if (state.sort === "spend_asc") result = compareNumber(a.purchase_total, b.purchase_total);
    if (state.sort === "payout_desc") result = compareNumber(b.payout_total, a.payout_total);
    if (state.sort === "payout_asc") result = compareNumber(a.payout_total, b.payout_total);
    if (state.sort === "cashback_desc") result = compareNumber(b.cashback_rate, a.cashback_rate);
    if (state.sort === "open_desc") result = compareNumber(openPayout(b), openPayout(a));
    if (state.sort === "paid_amount_desc") result = compareNumber(b.amount_paid, a.amount_paid);
    if (state.sort === "processed_desc") result = compareDate(b.date_processed, a.date_processed);
    if (state.sort === "paid_desc") result = compareDate(b.date_paid, a.date_paid);
    return result || defaultSort(a, b);
  });
}

function summarize(records, addons = []) {
  const active = records.filter(activeRecord);
  const monthly = new Map();
  const daily = new Map();
  const etaDays = new Map();
  const statuses = new Map();
  const lifecycle = new Map();
  const accounts = new Map();
  const items = new Map();
  const priceSources = new Map();
  const visibleAddons = Array.isArray(addons) ? addons : [];

  const createMonthlyRow = (month) => ({
    month,
    orders: 0,
    units: 0,
    spend: 0,
    payout: 0,
    profit: 0,
    product_profit: 0,
    addon_profit: 0,
    cash_paid: 0,
  });

  const createDailyRow = (day) => ({
    day,
    orders: 0,
    spend: 0,
    payout: 0,
    profit: 0,
    product_profit: 0,
    addon_profit: 0,
  });

  for (const record of records) {
    statuses.set(record.status, (statuses.get(record.status) || 0) + 1);
    const stage = lifecycleStage(record);
    if (stage !== "cancelled") {
      if (!lifecycle.has(stage)) lifecycle.set(stage, { stage, rows: 0, units: 0, spend: 0, payout: 0, open_payout: 0 });
      const stageRow = lifecycle.get(stage);
      stageRow.rows += 1;
      stageRow.units += Number(record.quantity || 0);
      stageRow.spend += Number(record.purchase_total || 0);
      stageRow.payout += Number(record.payout_total || 0);
      stageRow.open_payout += openPayout(record);
    }
    priceSources.set(record.price_source, (priceSources.get(record.price_source) || 0) + 1);

    const month = record.month_key || "Unknown";
    if (!monthly.has(month)) {
      monthly.set(month, createMonthlyRow(month));
    }
    const monthRow = monthly.get(month);
    monthRow.orders += 1;
    monthRow.profit += record.profit || 0;
    monthRow.product_profit += record.profit || 0;
    monthRow.cash_paid += record.amount_paid || 0;
    if (activeRecord(record)) {
      monthRow.units += record.quantity || 0;
      monthRow.spend += record.purchase_total || 0;
      monthRow.payout += record.payout_total || 0;
    }

    const day = record.date || "Unknown";
    if (!daily.has(day)) {
      daily.set(day, createDailyRow(day));
    }
    const dayRow = daily.get(day);
    dayRow.orders += 1;
    dayRow.profit += record.profit || 0;
    dayRow.product_profit += record.profit || 0;
    if (activeRecord(record)) {
      dayRow.spend += record.purchase_total || 0;
      dayRow.payout += record.payout_total || 0;
    }

    if (activeRecord(record) && record.amazon_delivery_eta_date) {
      const etaDate = record.amazon_delivery_eta_date;
      if (!etaDays.has(etaDate)) {
        etaDays.set(etaDate, { date: etaDate, rows: 0, units: 0, spend: 0, payout: 0, profit: 0, open_payout: 0 });
      }
      const etaRow = etaDays.get(etaDate);
      etaRow.rows += 1;
      etaRow.units += record.quantity || 0;
      etaRow.spend += record.purchase_total || 0;
      etaRow.payout += record.payout_total || 0;
      etaRow.profit += record.profit || 0;
      etaRow.open_payout += openPayout(record);
    }

    if (!accounts.has(record.account)) {
      accounts.set(record.account, { account: record.account, orders: 0, spend: 0, payout: 0, profit: 0 });
    }
    const accountRow = accounts.get(record.account);
    accountRow.orders += 1;
    accountRow.profit += record.profit || 0;
    if (activeRecord(record)) {
      accountRow.spend += record.purchase_total || 0;
      accountRow.payout += record.payout_total || 0;
    }

    if (!items.has(record.item_name)) {
      items.set(record.item_name, { item_name: record.item_name, orders: 0, units: 0, spend: 0, profit: 0 });
    }
    const itemRow = items.get(record.item_name);
    itemRow.orders += 1;
    itemRow.units += record.quantity || 0;
    itemRow.profit += record.profit || 0;
    if (activeRecord(record)) {
      itemRow.spend += record.purchase_total || 0;
    }
  }

  for (const addon of visibleAddons) {
    const amount = Number(addon.amount) || 0;
    const month = addonMonth(addon);
    if (!monthly.has(month)) {
      monthly.set(month, createMonthlyRow(month));
    }
    const monthRow = monthly.get(month);
    monthRow.profit += amount;
    monthRow.addon_profit += amount;

    const day = addon.date || "Unknown";
    if (!daily.has(day)) {
      daily.set(day, createDailyRow(day));
    }
    const dayRow = daily.get(day);
    dayRow.profit += amount;
    dayRow.addon_profit += amount;
  }

  const payout = active.reduce((sum, record) => sum + (record.payout_total || 0), 0);
  const cashPaid = records.reduce((sum, record) => sum + (record.amount_paid || 0), 0);
  const spend = active.reduce((sum, record) => sum + (record.purchase_total || 0), 0);
  const productProfit = records.reduce((sum, record) => sum + (record.profit || 0), 0);
  const addonProfit = visibleAddons.reduce((sum, addon) => sum + (Number(addon.amount) || 0), 0);
  const addonCategoryTotals = categoryTotals(visibleAddons);
  const bfmrReferralProfit = records
    .filter((record) => String(record.item_name || "").trim().toLowerCase() === "referral bonus")
    .reduce((sum, record) => sum + (Number(record.profit) || 0), 0);
  const profit = productProfit + addonProfit;
  const returnRows = records.filter(returnRelevant);
  const returnReviewRows = records.filter(returnReviewNeeded);
  const inferredSplitRows = records.filter((record) => record.order_number_inferred);
  const amazonRelevant = active.filter((record) => record.order_number && String(record.order_number).split("-").length === 3);
  const amazonMatched = amazonRelevant.filter((record) => record.amazon_order_matched).length;
  const amazonUnmatched = amazonRelevant.filter((record) => !record.amazon_order_matched).length;
  const uniqueBfmrAmazonOrders = new Set(
    active
      .map((record) => record.order_number)
      .filter((order) => order && String(order).split("-").length === 3),
  ).size;
  const uniqueCapturedAmazonOrders = new Set(
    (dataset?.amazon_orders || [])
      .map((order) => order.order_number)
      .filter(Boolean),
  ).size;
  const preciseCashbackRows = active.filter(preciseCashback).length;
  const weightedCashback = spend
    ? active.reduce(
        (sum, record) => sum + (Number(record.purchase_total || 0) * Number(record.cashback_rate || 0)),
        0,
      ) / spend
    : 0;
  const monthlyRows = Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
  const lastMonth = monthlyRows.at(-1);
  const previousMonth = monthlyRows.at(-2);
  const monthProfitDelta = lastMonth && previousMonth ? lastMonth.profit - previousMonth.profit : null;

  const watchlist = records
    .filter(
      (record) =>
        activeRecord(record) &&
        (record.status === "Deadline" ||
          record.status === "Return" ||
          trackingMissing(record) ||
          openPayout(record) > 0 ||
          record.purchase_is_estimate),
    )
    .sort((a, b) => attentionScore(a) - attentionScore(b) || openPayout(b) - openPayout(a));

  return {
    orders: records.length,
    active_orders: active.length,
    paid_orders: active.filter((record) => record.status === "Paid").length,
    units: active.reduce((sum, record) => sum + (record.quantity || 0), 0),
    spend,
    payout,
    profit,
    product_profit: productProfit,
    addon_profit: addonProfit,
    bfmr_referral_profit: bfmrReferralProfit + (addonCategoryTotals.bfmr_referral || 0),
    return_rows: returnRows.length,
    return_review_rows: returnReviewRows.length,
    inferred_split_rows: inferredSplitRows.length,
    return_spend: returnRows.reduce((sum, record) => sum + (Number(record.purchase_total) || 0), 0),
    return_payout: returnRows.reduce((sum, record) => sum + (Number(record.payout_total) || 0), 0),
    return_profit: returnRows.reduce((sum, record) => sum + (Number(record.profit) || 0), 0),
    addons: visibleAddons,
    addon_category_totals: addonCategoryTotals,
    amazon_orders: dataset?.amazon_orders || [],
    unique_bfmr_amazon_orders: uniqueBfmrAmazonOrders,
    unique_captured_amazon_orders: uniqueCapturedAmazonOrders,
    amazon_relevant_rows: amazonRelevant.length,
    amazon_matched: amazonMatched,
    amazon_unmatched: amazonUnmatched,
    precise_cashback: preciseCashbackRows,
    weighted_cashback: weightedCashback,
    cash_paid: cashPaid,
    open_payout: payout - cashPaid,
    open_rows: active.filter((record) => openPayout(record) > 0).length,
    missing_tracking: active.filter(trackingMissing).length,
    estimated_purchase_rows: records.filter((record) => record.purchase_is_estimate).length,
    avg_profit: active.length ? productProfit / active.length : 0,
    monthly: monthlyRows,
    daily: Array.from(daily.values()).sort((a, b) => a.day.localeCompare(b.day)),
    eta_days: Array.from(etaDays.values()).sort((a, b) => a.date.localeCompare(b.date)),
    status_counts: Object.fromEntries(statuses),
    lifecycle: lifecycleStages.map((stage) => lifecycle.get(stage.id) || { stage: stage.id, rows: 0, units: 0, spend: 0, payout: 0, open_payout: 0 }),
    price_source_counts: Object.fromEntries(priceSources),
    accounts: Array.from(accounts.values()).sort((a, b) => a.account.localeCompare(b.account)),
    top_items: Array.from(items.values())
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 8),
    watchlist: watchlist.slice(0, 10),
    top_orders: [...records].sort((a, b) => (b.profit || 0) - (a.profit || 0)).slice(0, 8),
    top_spend: [...active].sort((a, b) => (b.purchase_total || 0) - (a.purchase_total || 0)).slice(0, 8),
    best_month: monthlyRows.length ? [...monthlyRows].sort((a, b) => b.profit - a.profit)[0] : null,
    last_month: lastMonth || null,
    previous_month: previousMonth || null,
    month_profit_delta: monthProfitDelta,
  };
}

function attentionScore(record) {
  if (record.status === "Deadline") return 1;
  if (record.status === "Return") return 2;
  if (trackingMissing(record) && record.status !== "Paid") return 3;
  if (openPayout(record) > 0) return 4;
  if (record.purchase_is_estimate) return 5;
  return 9;
}

function attentionReason(record) {
  if (record.status === "Deadline") return "Deadline";
  if (record.status === "Return") return "Return";
  if (trackingMissing(record) && record.status !== "Paid") return "Tracking";
  if (openPayout(record) > 0) return "Open payout";
  if (record.purchase_is_estimate) return "Price estimate";
  return record.status;
}

function setOptions(select, values, allLabel) {
  const current = select.value || "all";
  select.innerHTML = [
    `<option value="all">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  select.value = values.includes(current) ? current : "all";
}

function syncControlValues() {
  elements.monthFilter.value = state.month;
  elements.statusFilter.value = state.status;
  elements.accountFilter.value = state.account;
  if (elements.analyticsMonthFilter) elements.analyticsMonthFilter.value = state.month;
  if (elements.analyticsStatusFilter) elements.analyticsStatusFilter.value = state.status;
  if (elements.analyticsAccountFilter) elements.analyticsAccountFilter.value = state.account;
  if (elements.analyticsAmazonFilter) elements.analyticsAmazonFilter.value = state.amazon;
  if (elements.analyticsSearchInput) elements.analyticsSearchInput.value = state.search;
  elements.priceSourceFilter.value = state.priceSource;
  elements.trackingFilter.value = state.tracking;
  elements.paymentFilter.value = state.payment;
  elements.amazonFilter.value = state.amazon;
  elements.sortFilter.value = state.sort;
  elements.searchInput.value = state.search;
}

function renderFilters() {
  const records = dataset.records;
  setOptions(elements.monthFilter, [...new Set(records.map((record) => record.month_key))].sort(), "All Months");
  setOptions(elements.statusFilter, [...new Set(records.map((record) => record.status))].sort(), "All Statuses");
  setOptions(elements.accountFilter, [...new Set(records.map((record) => record.account))].sort(), "All Accounts");
  if (elements.analyticsMonthFilter) setOptions(elements.analyticsMonthFilter, [...new Set(records.map((record) => record.month_key))].sort(), "All Months");
  if (elements.analyticsStatusFilter) setOptions(elements.analyticsStatusFilter, [...new Set(records.map((record) => record.status))].sort(), "All Statuses");
  if (elements.analyticsAccountFilter) setOptions(elements.analyticsAccountFilter, [...new Set(records.map((record) => record.account))].sort(), "All Accounts");
  setOptions(
    elements.priceSourceFilter,
    [...new Set(records.map((record) => record.price_source))].sort(),
    "All Price Sources",
  );
  syncControlValues();
}

function renderMetadata() {
  const generated = dataset.metadata?.generated_at ? new Date(dataset.metadata.generated_at) : null;
  const generatedText = generated
    ? generated.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "now";
  const addonText = dataset.addons?.length ? ` | ${dataset.addons.length} add-ons` : "";
  const amazonMatched = dataset.metadata?.amazon_matched_orders || 0;
  const amazonTotal = dataset.records.length || 0;
  const amazonText = amazonTotal ? ` | Amazon ${amazonMatched}/${amazonTotal} matched` : "";
  elements.metadata.textContent = `${dataset.records.length} rows loaded${addonText}${amazonText} | Updated ${generatedText}`;
}

function kpi(label, value, sub = "", action = "") {
  const actionAttrs = action
    ? ` data-kpi-action="${escapeHtml(action)}" role="button" tabindex="0" title="Open ${escapeHtml(label)}"`
    : "";
  return `
    <article class="kpi-card ${action ? "clickable" : ""}"${actionAttrs}>
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(value)}</div>
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </article>
  `;
}

function renderKpis(summary) {
  elements.kpiGrid.innerHTML = [
    kpi("Total Spend", money(summary.spend), `${number.format(summary.units)} units across ${summary.active_orders} active rows`),
    kpi(
      "Total Profit",
      money(summary.profit),
      `${money(summary.product_profit)} products | ${money(summary.addon_profit)} add-ons`,
    ),
    kpi(
      "Product Profit",
      money(summary.product_profit),
      `${percent.format(summary.spend ? summary.product_profit / summary.spend : 0)} margin before add-ons`,
    ),
    kpi(
      "Amazon Line Items",
      `${wholeNumber.format(summary.amazon_matched)} / ${wholeNumber.format(summary.orders)}`,
      `${wholeNumber.format(summary.precise_cashback)} with visible cashback evidence`,
      "amazon_needed",
    ),
    kpi("Avg Cashback", percent.format(summary.weighted_cashback), "Weighted by active purchase spend"),
    kpi("Add-on Profit", money(summary.addon_profit), `${wholeNumber.format(summary.addons.length)} manual bonus rows`),
    kpi("Expected Payout", money(summary.payout), "Earned only after processing, then paid later"),
    kpi("Paid Cash", money(summary.cash_paid), `${percent.format(summary.payout ? summary.cash_paid / summary.payout : 0)} of expected payout collected`, "paid_cash"),
    kpi("Awaiting Pay", money(summary.open_payout), "Reserved through processed rows not fully paid", "awaiting_pay"),
    kpi("Returns", wholeNumber.format(summary.return_rows), `${wholeNumber.format(summary.return_review_rows)} need review`, "returns"),
    kpi("Tracking Gaps", wholeNumber.format(summary.missing_tracking), "Blank or not submitted tracking", "tracking_gaps"),
    kpi("Price Fallbacks", wholeNumber.format(summary.estimated_purchase_rows), "Rows using payout as purchase estimate", "price_fallbacks"),
  ].join("");
}

function insight(label, value, sub = "") {
  return `
    <article class="insight-card">
      <div class="insight-label">${escapeHtml(label)}</div>
      <div class="insight-value">${escapeHtml(value)}</div>
      <div class="insight-sub">${escapeHtml(sub)}</div>
    </article>
  `;
}

function renderInsights(summary) {
  const delta = summary.month_profit_delta;
  const deltaText = delta === null ? "Not enough history" : `${delta >= 0 ? "+" : ""}${money(delta)}`;
  const bestMonth = summary.best_month ? `${fmtMonth(summary.best_month.month)} ${money(summary.best_month.profit)}` : "No month";
  const fallbackShare = summary.orders ? summary.estimated_purchase_rows / summary.orders : 0;
  const activeShare = summary.orders ? summary.active_orders / summary.orders : 0;
  const addonTotals = summary.addon_category_totals || {};
  elements.insightGrid.innerHTML = [
    insight("Average Profit", money(summary.avg_profit), "Per active row"),
    insight("Month Change", deltaText, "Latest month vs previous"),
    insight("Best Month", bestMonth, "By total profit"),
    insight("Active Share", percent.format(activeShare), `${summary.active_orders} active of ${summary.orders} rows`),
    insight("Amazon Needed", wholeNumber.format(summary.amazon_unmatched), "Active rows not yet matched"),
    insight(
      "Unique Amazon Orders",
      `${wholeNumber.format(summary.unique_captured_amazon_orders)} / ${wholeNumber.format(summary.unique_bfmr_amazon_orders)}`,
      "Captured order IDs vs BFMR order IDs in view",
    ),
    insight("Open Rows", wholeNumber.format(summary.open_rows), "Rows with payout not fully paid"),
    insight("Price Risk", percent.format(fallbackShare), "Share using fallback purchase price"),
    insight("Checking Bonuses", money(addonTotals.checking_bonus || 0), "Manual bank bonus profit"),
    insight("BFMR Referrals", money(summary.bfmr_referral_profit || 0), "BFMR payment history plus manual referrals"),
    insight("Young Adult Cash", money(addonTotals.amazon_young_adult_cashback || 0), "Amazon cashback add-ons"),
    insight("Extra Profit", money(addonTotals.extra_profit || 0), "Other manual profit"),
  ].join("");
}

function renderLifecycle(summary) {
  if (!elements.lifecycleGrid) return;
  elements.lifecycleGrid.innerHTML = lifecycleStages
    .map((stage, index) => {
      const row = summary.lifecycle.find((item) => item.stage === stage.id) || {};
      const open = Number(row.open_payout || 0);
      return `
        <article class="lifecycle-card stage-${escapeHtml(stage.id)}">
          <div class="stage-index">${index + 1}</div>
          <div>
            <div class="stage-label">${escapeHtml(stage.label)}</div>
            <div class="stage-count">${wholeNumber.format(row.rows || 0)} rows</div>
          </div>
          <div class="stage-money">
            <strong>${money(row.payout || 0)}</strong>
            <span>${open > 0 ? `${money(open)} not paid` : "No open payout"}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderQuickChips(allSummary) {
  const chipDefs = [
    { id: "all", label: `All ${wholeNumber.format(allSummary.orders)}` },
    { id: "needs_tracking", label: `Needs Tracking ${wholeNumber.format(allSummary.missing_tracking)}` },
    { id: "open_payout", label: `Open Payout ${wholeNumber.format(allSummary.open_rows)}` },
    { id: "fallback", label: `Fallback Price ${wholeNumber.format(allSummary.estimated_purchase_rows)}` },
    { id: "amazon_unmatched", label: `Amazon Needed ${wholeNumber.format(allSummary.amazon_unmatched)}` },
    { id: "amazon_matched", label: `Amazon Matched ${wholeNumber.format(allSummary.amazon_matched)}` },
    { id: "paid", label: `Paid ${wholeNumber.format(allSummary.status_counts.Paid || 0)}` },
    { id: "purchased", label: `Ordered ${wholeNumber.format(allSummary.status_counts.Purchased || 0)}` },
  ];
  elements.quickChips.innerHTML = chipDefs
    .map(
      (chip) =>
        `<button class="chip ${quickChipActive(chip.id) ? "active" : ""}" type="button" data-chip="${chip.id}">${escapeHtml(chip.label)}</button>`,
    )
    .join("");
}

function quickChipActive(id) {
  if (id === "needs_tracking") return state.tracking === "missing";
  if (id === "open_payout") return state.payment === "open";
  if (id === "fallback") return state.priceSource === "Payout fallback";
  if (id === "paid") return state.status === "Paid";
  if (id === "purchased") return state.status === "Purchased";
  if (id === "amazon_unmatched") return state.amazon === "unmatched";
  if (id === "amazon_matched") return state.amazon === "matched";
  return (
    state.month === "all" &&
    state.status === "all" &&
    state.account === "all" &&
    state.priceSource === "all" &&
    state.tracking === "all" &&
    state.payment === "all" &&
    state.amazon === "all" &&
    !state.search
  );
}

function prepareCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  canvas.style.width = "100%";
  const height = Number(canvas.getAttribute("height")) || 260;
  const parentWidth = canvas.parentElement?.clientWidth || 0;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(parentWidth || rect.width || 300));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = "100%";
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;
  return { ctx, width, height };
}

function noData(ctx, width, height) {
  ctx.fillStyle = colors.gray;
  ctx.textAlign = "center";
  ctx.fillText("No matching data", width / 2, height / 2);
}

function moneyAxis(value) {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function drawMonthlyChart(rows) {
  const prepared = prepareCanvas("monthlyChart");
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  if (!rows.length) {
    noData(ctx, width, height);
    return;
  }
  const compact = width < 520;
  const pad = { top: 20, right: 16, bottom: 40, left: compact ? 54 : 72 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...rows.flatMap((row) => [row.spend, row.payout, row.profit]), 1);
  const scaleY = (value) => pad.top + chartHeight - (value / maxValue) * chartHeight;
  const groupWidth = chartWidth / rows.length;
  const barWidth = Math.min(compact ? 24 : 34, groupWidth / 5);

  ctx.strokeStyle = colors.line;
  ctx.fillStyle = colors.gray;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxValue / 4) * i;
    const y = scaleY(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(moneyAxis(value), pad.left - 8, y + 4);
  }

  rows.forEach((row, index) => {
    const center = pad.left + groupWidth * index + groupWidth / 2;
    [
      { value: row.spend, color: colors.indigo, offset: -barWidth - 2 },
      { value: row.payout, color: colors.teal, offset: 2 },
    ].forEach((bar) => {
      const y = scaleY(bar.value);
      ctx.fillStyle = bar.color;
      ctx.fillRect(center + bar.offset, y, barWidth, pad.top + chartHeight - y);
    });
    ctx.fillStyle = colors.gray;
    ctx.textAlign = "center";
    ctx.fillText(compact ? row.month.slice(5) : row.month, center, height - 14);
  });

  ctx.strokeStyle = colors.amber;
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad.left + groupWidth * index + groupWidth / 2;
    const y = scaleY(row.profit);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  rows.forEach((row, index) => {
    const x = pad.left + groupWidth * index + groupWidth / 2;
    const y = scaleY(row.profit);
    ctx.fillStyle = colors.amber;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  if (!compact) {
    ctx.textAlign = "left";
    [
      ["Spend", colors.indigo, pad.left],
      ["Payout", colors.teal, pad.left + 88],
      ["Profit", colors.amber, pad.left + 178],
    ].forEach(([label, color, x]) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, 6, 10, 10);
      ctx.fillStyle = colors.gray;
      ctx.fillText(label, x + 16, 15);
    });
  }
}

function drawDailyProfitChart(rows) {
  const prepared = prepareCanvas("dailyProfitChart");
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const data = rows.filter((row) => row.day !== "Unknown");
  if (!data.length) {
    noData(ctx, width, height);
    return;
  }
  const compact = width < 520;
  const pad = { top: 18, right: 18, bottom: 38, left: compact ? 54 : 70 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...data.map((row) => Math.abs(row.profit)), 1);
  const zeroY = pad.top + chartHeight / 2;
  const scaleY = (value) => zeroY - (value / maxValue) * (chartHeight / 2 - 8);
  const step = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;

  ctx.strokeStyle = colors.line;
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(width - pad.right, zeroY);
  ctx.stroke();
  ctx.fillStyle = colors.gray;
  ctx.textAlign = "right";
  ctx.fillText(moneyAxis(maxValue), pad.left - 8, pad.top + 8);
  ctx.fillText("$0", pad.left - 8, zeroY + 4);

  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((row, index) => {
    const x = pad.left + step * index;
    const y = scaleY(row.profit);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  data.forEach((row, index) => {
    const x = pad.left + step * index;
    const y = scaleY(row.profit);
    ctx.fillStyle = row.profit >= 0 ? colors.green : colors.red;
    ctx.beginPath();
    ctx.arc(x, y, compact ? 2.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (index % Math.ceil(data.length / (compact ? 4 : 8)) === 0 || index === data.length - 1) {
      ctx.fillStyle = colors.gray;
      ctx.textAlign = "center";
      ctx.fillText(row.day.slice(5), x, height - 12);
    }
  });
}

function drawStatusChart(statusCounts) {
  const prepared = prepareCanvas("statusChart");
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const entries = Object.entries(statusCounts).filter(([, count]) => count > 0);
  drawDonut(ctx, width, height, entries, statusColors, elements.statusLegend, "rows");
}

function drawPriceSourceChart(priceCounts) {
  const prepared = prepareCanvas("priceSourceChart");
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const entries = Object.entries(priceCounts).filter(([, count]) => count > 0);
  drawDonut(ctx, width, height, entries, priceSourceColors, elements.priceLegend, "rows");
}

function drawDonut(ctx, width, height, entries, colorMap, legendElement, centerLabel) {
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  legendElement.innerHTML = "";
  if (!entries.length) {
    noData(ctx, width, height);
    return;
  }
  const radius = Math.min(width, height) * 0.33;
  const centerX = width / 2;
  const centerY = height / 2;
  let start = -Math.PI / 2;
  entries.forEach(([label, count]) => {
    const angle = (count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.fillStyle = colorMap[label] || colors.gray;
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.closePath();
    ctx.fill();
    start += angle;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = colors.ink;
  ctx.textAlign = "center";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(total, centerX, centerY + 7);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = colors.gray;
  ctx.fillText(centerLabel, centerX, centerY + 26);

  legendElement.innerHTML = entries
    .map(
      ([label, count]) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${colorMap[label] || colors.gray}"></span>
          ${escapeHtml(label)} ${count}
        </span>
      `,
    )
    .join("");
}

function drawAccountChart(rows) {
  const prepared = prepareCanvas("accountChart");
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const data = rows.filter((row) => row.orders > 0).sort((a, b) => b.profit - a.profit);
  if (!data.length) {
    noData(ctx, width, height);
    return;
  }
  const pad = { top: 18, right: 18, bottom: 22, left: width < 420 ? 68 : 82 };
  const chartWidth = width - pad.left - pad.right;
  const rowHeight = Math.min(42, (height - pad.top - pad.bottom) / data.length);
  const maxValue = Math.max(...data.map((row) => Math.abs(row.profit)), 1);
  ctx.textAlign = "left";
  data.forEach((row, index) => {
    const y = pad.top + index * rowHeight + 8;
    const barWidth = Math.max(2, (Math.abs(row.profit) / maxValue) * chartWidth);
    ctx.fillStyle = colors.gray;
    ctx.fillText(row.account, 0, y + 17);
    ctx.fillStyle = row.profit >= 0 ? colors.green : colors.red;
    ctx.fillRect(pad.left, y, barWidth, 20);
    ctx.fillStyle = colors.ink;
    ctx.fillText(money(row.profit), Math.min(pad.left + barWidth + 8, width - 72), y + 15);
  });
}

function renderTopItems(rows) {
  if (!rows.length) {
    elements.topItems.innerHTML = `<p class="muted">No matching data</p>`;
    return;
  }
  elements.topItems.innerHTML = rows
    .map(
      (row) => `
        <div class="top-row">
          <div>
            <div class="top-name" title="${escapeHtml(row.item_name)}">${escapeHtml(row.item_name)}</div>
            <div class="top-meta">${number.format(row.units)} units | ${money(row.spend)} spend</div>
          </div>
          <div class="top-profit">${money(row.profit)}</div>
        </div>
      `,
    )
    .join("");
}

function renderAnalytics(summary) {
  elements.monthNote.textContent = state.month === "all" ? "All months" : fmtMonth(state.month);
  elements.dailyNote.textContent = `${summary.daily.length} active dates`;
  drawMonthlyChart(summary.monthly);
  drawStatusChart(summary.status_counts);
  drawAccountChart(summary.accounts);
  drawDailyProfitChart(summary.daily);
  drawPriceSourceChart(summary.price_source_counts);
  renderTopItems(summary.top_items);
}

function sourceClass(source) {
  return source === "Payout fallback" ? "fallback" : "";
}

function renderCompactList(element, rows, valueFn, metaFn, emptyText) {
  if (!rows.length) {
    element.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
    return;
  }
  element.innerHTML = rows
    .map(
      (record) => {
        const title = record.item_name || (record.date ? fmtDate(record.date) : "") || record.title || "";
        return `
        <div class="compact-row">
          <div>
            <div class="compact-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="compact-meta">${escapeHtml(metaFn(record))}</div>
          </div>
          <div class="compact-value">${escapeHtml(valueFn(record))}</div>
        </div>
      `;
      },
    )
    .join("");
}

function renderAddons(addons) {
  const sorted = [...addons].sort(
    (a, b) => (b.date || "").localeCompare(a.date || "") || String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
  const total = sorted.reduce((sum, addon) => sum + (Number(addon.amount) || 0), 0);
  elements.addonTotal.textContent = `${money(total)} in view`;

  if (!sorted.length) {
    elements.addonList.innerHTML = `<p class="muted">No add-on profits in this view</p>`;
    return;
  }

  elements.addonList.innerHTML = sorted
    .map((addon) => {
      const amount = Number(addon.amount) || 0;
      const label = addonLabels[addon.category] || addon.category || "Profit Add-on";
      const meta = [fmtDate(addon.date), label, addon.notes].filter(Boolean).join(" | ");
      return `
        <div class="compact-row">
          <div>
            <div class="compact-title" title="${escapeHtml(addon.description)}">${escapeHtml(addon.description)}</div>
            <div class="compact-meta">${escapeHtml(meta)}</div>
            <label class="inline-date">
              Date
              <input type="date" value="${escapeHtml(addon.date || "")}" data-addon-id="${escapeHtml(addon.id)}" data-addon-field="date" data-original="${escapeHtml(addon.date || "")}" />
            </label>
          </div>
          <div class="compact-value ${amount < 0 ? "negative" : ""}">${money(amount)}</div>
          <button class="delete-button" type="button" data-addon-id="${escapeHtml(addon.id)}">Remove</button>
        </div>
      `;
    })
    .join("");
}

function renderAttention(summary) {
  renderAddons(summary.addons);
  elements.watchlistCount.textContent = `${summary.watchlist.length} shown`;
  elements.etaTotalsCount.textContent = `${summary.eta_days.length} days`;
  renderCompactList(
    elements.watchlist,
    summary.watchlist,
    (record) => attentionReason(record),
    (record) => `${record.status} | ${record.order_number || "Unknown order"} | ${money(openPayout(record))} open`,
    "No attention rows in this view",
  );
  renderCompactList(
    elements.etaTotals,
    summary.eta_days,
    (row) => money(row.payout),
    (row) =>
      `${wholeNumber.format(row.rows)} rows | ${number.format(row.units)} units | ${money(row.spend)} retail | ${money(row.open_payout)} open`,
    "No ETA dates in this view",
  );
  renderCompactList(
    elements.topOrders,
    summary.top_orders,
    (record) => money(record.profit),
    (record) => `${fmtDate(record.date)} | ${record.account} | ${record.status}`,
    "No profit rows in this view",
  );
  renderCompactList(
    elements.topSpend,
    summary.top_spend,
    (record) => money(record.purchase_total),
    (record) => `${fmtDate(record.date)} | ${number.format(record.quantity)} units | ${record.account}`,
    "No spend rows in this view",
  );
}

function renderReturns(summary, records) {
  if (!elements.returnsList) return;
  const affected = records.filter(returnRelevant);
  const reviewRows = records.filter(returnReviewNeeded);
  const groups = returnGroups(records);

  elements.returnsStatus.textContent = `${wholeNumber.format(affected.length)} affected rows | ${wholeNumber.format(reviewRows.length)} need review`;
  elements.returnsCount.textContent = `${wholeNumber.format(groups.length)} groups`;
  elements.returnReviewCount.textContent = `${wholeNumber.format(reviewRows.length)} rows`;
  elements.returnsSummary.innerHTML = [
    kpi("Affected Rows", wholeNumber.format(affected.length), "Returns, inferred splits, and missing-order rows"),
    kpi("Needs Review", wholeNumber.format(reviewRows.length), "Ambiguous rows where the app refused to guess"),
    kpi("Inferred Splits", wholeNumber.format(summary.inferred_split_rows), "Original order filled from same-item evidence"),
    kpi("Return Spend", money(summary.return_spend), "Retail price tied to affected rows"),
    kpi("Return Payout", money(summary.return_payout), "BFMR subtotal tied to affected rows"),
    kpi("Return Profit", money(summary.return_profit), "Profit impact in the current filters"),
  ].join("");

  if (!groups.length) {
    elements.returnsList.innerHTML = `<p class="muted">No return or split-delivery rows in this view.</p>`;
  } else {
    elements.returnsList.innerHTML = groups
      .map((group) => {
        const first = group.rows[0] || {};
        const title = group.key.startsWith("review-") ? first.item_name || "Needs review" : group.key;
        return `
          <article class="return-group">
            <div class="return-group-head">
              <div>
                <div class="return-title">${escapeHtml(title)}</div>
                <div class="return-meta">${wholeNumber.format(group.rows.length)} rows | ${money(group.spend)} retail | ${money(group.payout)} payout | ${money(group.open)} open</div>
              </div>
              <div class="return-profit ${group.profit < 0 ? "negative" : ""}">${money(group.profit)}</div>
            </div>
            <div class="return-row-list">
              ${group.rows
                .map((record) => {
                  const candidates = Array.isArray(record.split_candidate_orders) ? ` | Candidates: ${record.split_candidate_orders.join(", ")}` : "";
                  const inferred = record.order_number_inferred ? " | Inferred original order" : "";
                  const context = record.return_context || record.split_review_reason || "";
                  return `
                    <div class="return-row">
                      <div>
                        <div class="compact-title" title="${escapeHtml(record.item_name)}">${escapeHtml(record.item_name)}</div>
                        <div class="compact-meta">${escapeHtml(`${fmtDate(record.date)} | ${record.status} | Qty ${number.format(record.quantity || 0)} | ${record.order_number || "No order"}${inferred}${candidates}`)}</div>
                        ${context ? `<div class="return-note">${escapeHtml(context)}</div>` : ""}
                      </div>
                      <div class="return-row-money">
                        <span>${money(record.purchase_total)} retail</span>
                        <strong>${money(record.profit)}</strong>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </article>
        `;
      })
      .join("");
  }

  renderCompactList(
    elements.returnReviewList,
    reviewRows,
    (record) => (record.order_number ? "Ambiguous" : "No order"),
    (record) => {
      const candidates = Array.isArray(record.split_candidate_orders) ? ` | ${record.split_candidate_orders.join(", ")}` : "";
      return `${fmtDate(record.date)} | ${record.status} | ${money(record.purchase_total)} retail${candidates}`;
    },
    "No return rows need review in this view",
  );
}

function inputValue(value) {
  return escapeHtml(value ?? "");
}

function editableCell(record, field, options = {}) {
  const value = record[field] ?? "";
  const type = options.type || "text";
  const classes = ["edit-cell", options.className || ""].filter(Boolean).join(" ");
  const attrs = `data-record-id="${escapeHtml(record.id)}" data-field="${escapeHtml(field)}" data-original="${escapeHtml(value)}"`;
  if (options.kind === "textarea") {
    return `<textarea class="${classes}" ${attrs} rows="1">${inputValue(value)}</textarea>`;
  }
  if (options.kind === "select") {
    return `
      <select class="${classes}" ${attrs}>
        ${(options.values || [])
          .map((item) => `<option value="${escapeHtml(item)}" ${String(item) === String(value) ? "selected" : ""}>${escapeHtml(item)}</option>`)
          .join("")}
      </select>
    `;
  }
  return `<input class="${classes}" ${attrs} type="${type}" value="${inputValue(value)}" ${options.step ? `step="${escapeHtml(options.step)}"` : ""} />`;
}

const tableColumns = [
  { id: "row", label: "#", locked: true, className: "row-number", cell: (record) => escapeHtml(record.id) },
  { id: "stage", label: "Stage", cell: (record) => `<span class="pill ${lifecycleStage(record)}">${escapeHtml(lifecycleStageLabel(record))}</span>` },
  { id: "status", label: "Status", cell: (record) => editableCell(record, "status", { kind: "select", values: statusOptions }) },
  { id: "item_name", label: "Items", className: "item-cell", cell: (record) => editableCell(record, "item_name", { kind: "textarea" }) },
  { id: "quantity", label: "Reserved", className: "num", cell: (record) => editableCell(record, "quantity", { type: "number", step: "1", className: "numeric" }) },
  { id: "order_number", label: "Order No.", cell: (record) => editableCell(record, "order_number") },
  { id: "tracking", label: "Tracking", cell: (record) => editableCell(record, "tracking") },
  {
    id: "eta",
    label: "Amazon ETA",
    cell: (record) => `<span title="${escapeHtml(record.amazon_delivery_status || record.amazon_delivery_eta || "")}">${escapeHtml(deliveryEtaText(record))}</span>`,
  },
  { id: "insurance", label: "Insurance", cell: (record) => editableCell(record, "insurance") },
  { id: "purchase_total", label: "Retail Price", className: "num", cell: (record) => editableCell(record, "purchase_total", { type: "number", step: "0.01", className: "numeric" }) },
  { id: "payout_total", label: "Subtotal", className: "num", cell: (record) => editableCell(record, "payout_total", { type: "number", step: "0.01", className: "numeric" }) },
  { id: "payout_per_unit", label: "Payout Per Unit", className: "num", cell: (record) => editableCell(record, "payout_per_unit", { type: "number", step: "0.01", className: "numeric" }) },
  { id: "received", label: "Received", className: "num", cell: (record) => editableCell(record, "received", { type: "number", step: "1", className: "numeric" }) },
  { id: "amount_paid", label: "Amount Paid", className: "num", cell: (record) => editableCell(record, "amount_paid", { type: "number", step: "0.01", className: "numeric" }) },
  { id: "date", label: "Date Reserved", cell: (record) => editableCell(record, "date", { type: "date" }) },
  { id: "date_processed", label: "Date Processed", cell: (record) => editableCell(record, "date_processed", { type: "date" }) },
  { id: "date_paid", label: "Date Paid", cell: (record) => editableCell(record, "date_paid", { type: "date" }) },
  { id: "notes", label: "Notes", cell: (record) => editableCell(record, "notes") },
  {
    id: "cashback",
    label: "Cashback",
    className: "num",
    cell: (record) => `<span title="${escapeHtml(record.cashback_rate_source || "")}">${percent.format(Number(record.cashback_rate || 0))}</span>`,
  },
  { id: "account", label: "Account", cell: (record) => escapeHtml(record.account) },
  { id: "profit", label: "Profit", className: "num", cell: (record) => money(record.profit) },
  {
    id: "amazon",
    label: "Amazon",
    cell: (record) => `<span class="pill ${record.amazon_order_matched ? "matched" : "fallback"}">${record.amazon_order_matched ? "Matched" : "Needed"}</span>`,
  },
];

function defaultColumnPrefs() {
  return tableColumns.map((column) => ({ id: column.id, visible: true }));
}

function normalizeColumnPrefs(rawPrefs) {
  const raw = Array.isArray(rawPrefs) ? rawPrefs : [];
  const byId = new Map(raw.map((row) => [row.id, row]));
  const known = new Set(tableColumns.map((column) => column.id));
  const ordered = raw
    .filter((row) => known.has(row.id))
    .map((row) => ({ id: row.id, visible: row.visible !== false }));
  for (const column of tableColumns) {
    if (!ordered.some((row) => row.id === column.id)) {
      ordered.push({ id: column.id, visible: byId.get(column.id)?.visible !== false });
    }
  }
  return ordered.map((row) => {
    const column = tableColumns.find((item) => item.id === row.id);
    return { ...row, visible: column?.locked ? true : row.visible !== false };
  });
}

function loadColumnPrefs() {
  try {
    return normalizeColumnPrefs(JSON.parse(localStorage.getItem("toopa-bfmr-table-columns") || "[]"));
  } catch {
    return defaultColumnPrefs();
  }
}

function saveColumnPrefs() {
  localStorage.setItem("toopa-bfmr-table-columns", JSON.stringify(tableColumnPrefs));
}

function visibleTableColumns() {
  if (!tableColumnPrefs) tableColumnPrefs = loadColumnPrefs();
  return tableColumnPrefs
    .filter((pref) => pref.visible !== false)
    .map((pref) => tableColumns.find((column) => column.id === pref.id))
    .filter(Boolean);
}

function renderColumnPrefs() {
  if (!elements.columnPrefsList) return;
  if (!tableColumnPrefs) tableColumnPrefs = loadColumnPrefs();
  elements.columnPrefsList.innerHTML = tableColumnPrefs
    .map((pref, index) => {
      const column = tableColumns.find((item) => item.id === pref.id);
      if (!column) return "";
      return `
        <div class="column-pref-row" data-column-id="${escapeHtml(column.id)}">
          <label class="checkbox-row">
            <input type="checkbox" ${pref.visible !== false ? "checked" : ""} ${column.locked ? "disabled" : ""} data-column-visible />
            ${escapeHtml(column.label)}
          </label>
          <div class="column-pref-actions">
            <button class="secondary-button icon-button" type="button" data-column-move="up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="secondary-button icon-button" type="button" data-column-move="down" ${index === tableColumnPrefs.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTable(records) {
  elements.rowCount.textContent = `${records.length} rows`;
  const columns = visibleTableColumns();
  elements.ordersHead.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  elements.ordersBody.innerHTML = records
    .map(
      (record) => `
        <tr data-record-id="${escapeHtml(record.id)}">
          ${columns.map((column) => `<td class="${escapeHtml(column.className || "")}">${column.cell(record)}</td>`).join("")}
        </tr>
      `,
    )
    .join("");

  elements.orderCards.innerHTML = records
    .map(
      (record) => `
        <article class="order-card">
          <div class="order-card-title">${escapeHtml(record.item_name)}</div>
          <div class="order-card-meta">
            <span class="pill ${lifecycleStage(record)}">${escapeHtml(lifecycleStageLabel(record))}</span>
            <span class="pill">${escapeHtml(record.status)}</span>
            <span class="pill">${escapeHtml(record.account)}</span>
            <span class="pill ${record.amazon_order_matched ? "matched" : "fallback"}">${record.amazon_order_matched ? "Amazon matched" : "Amazon needed"}</span>
            <span class="pill ${sourceClass(record.price_source)}">${escapeHtml(record.price_source)}</span>
          </div>
          <div class="order-card-grid">
            <div class="mini-stat"><div class="mini-label">Profit</div><div class="mini-value">${money(record.profit)}</div></div>
            <div class="mini-stat"><div class="mini-label">Cashback</div><div class="mini-value">${percent.format(Number(record.cashback_rate || 0))}</div></div>
            <div class="mini-stat"><div class="mini-label">Spend</div><div class="mini-value">${money(record.purchase_total)}</div></div>
            <div class="mini-stat"><div class="mini-label">Payout</div><div class="mini-value">${money(record.payout_total)}</div></div>
            <div class="mini-stat"><div class="mini-label">Open</div><div class="mini-value">${money(openPayout(record))}</div></div>
            <div class="mini-stat"><div class="mini-label">Order</div><div class="mini-value">${escapeHtml(record.order_number || "Unknown")}</div></div>
            <div class="mini-stat"><div class="mini-label">Tracking</div><div class="mini-value">${escapeHtml(record.tracking || "Missing")}</div></div>
            <div class="mini-stat"><div class="mini-label">ETA</div><div class="mini-value">${escapeHtml(deliveryEtaText(record) || "Unknown")}</div></div>
            <div class="mini-stat"><div class="mini-label">Cashback Source</div><div class="mini-value">${escapeHtml(record.cashback_rate_source || "Default 6%")}</div></div>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderAll() {
  if (!dataset) return;
  renderMetadata();
  const records = filteredRecords();
  const addons = filteredAddons();
  const summary = summarize(records, addons);
  const allSummary = summarize(dataset.records.filter(activeRecord), dataset.addons || []);
  renderQuickChips(allSummary);
  renderKpis(summary);
  renderLifecycle(summary);
  renderInsights(summary);
  renderAnalytics(summary);
  renderAttention(summary);
  renderReturns(summary, records);
  renderTable(records);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function resetFilters() {
  state = {
    ...state,
    month: "all",
    status: "all",
    account: "all",
    priceSource: "all",
    tracking: "all",
    payment: "all",
    amazon: "all",
    search: "",
  };
}

function refreshDataset(payload, options = {}) {
  normalizeLoadedDataset(payload);
  if (options.resetFilters) resetFilters();
  renderFilters();
  renderAll();
  renderSettings();
  setActiveTab(state.tab);
}

function resetAddonDate() {
  const input = document.getElementById("addonDate");
  if (input && !input.value) input.value = todayIso();
}

function renderSettings() {
  if (!elements.settingsProfiles) return;
  const settings = mergeSettings(settingsState);
  const assumptions = settings.assumptions;
  const chrome = settings.chrome;
  elements.defaultCashbackRate.value = rateToPercentInput(assumptions.default_cashback_rate);
  elements.noOrderAccount.value = assumptions.no_order_account || "Personal";
  elements.noOrderCashbackRate.value = rateToPercentInput(assumptions.no_order_cashback_rate);
  elements.businessDefaultCashbackRate.value = rateToPercentInput(assumptions.business_default_cashback_rate);
  elements.manualAssumptionsJson.value = JSON.stringify(assumptions.manual_assumed_orders || [], null, 2);
  elements.bfmrProfileDirectory.innerHTML = profileOptionsHtml(chrome.bfmr_profile_directory || "Default");
  elements.skipPaidOrders.checked = Boolean(chrome.skip_paid_orders);
  elements.settingsProfiles.innerHTML = (chrome.profiles || [])
    .map(
      (profile, index) => `
        <div class="settings-profile" data-profile-index="${index}">
          <label>
            Name
            <input data-settings-profile-field="name" type="text" value="${escapeHtml(profile.name || "")}" />
          </label>
          <label>
            Chrome Profile Directory
            <select data-settings-profile-field="profile_directory">
              ${profileOptionsHtml(profile.profile_directory || "Default")}
            </select>
          </label>
          <label>
            Account
            <select data-settings-profile-field="account_type">
              <option value="personal" ${profile.account_type === "business" ? "" : "selected"}>Personal</option>
              <option value="business" ${profile.account_type === "business" ? "selected" : ""}>Business</option>
            </select>
          </label>
          <label class="checkbox-row">
            <input data-settings-profile-field="enabled" type="checkbox" ${profile.enabled === false ? "" : "checked"} />
            Enabled
          </label>
          <button class="secondary-button" data-settings-remove-profile="${index}" type="button">Remove</button>
        </div>
      `,
    )
    .join("");
  elements.settingsStatus.textContent = `${(chrome.profiles || []).filter((profile) => profile.enabled !== false).length} Amazon profile(s) enabled.`;
}

function setActiveTab(tab) {
  state.tab = tab || "dashboard";
  elements.tabButtons.forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === state.tab);
  });
  if (state.tab === "analytics" && dataset) {
    window.requestAnimationFrame(() => {
      const summary = summarize(filteredRecords(), filteredAddons());
      renderAnalytics(summary);
    });
  }
}

function readSettingsForm() {
  const manualRows = JSON.parse(elements.manualAssumptionsJson.value || "[]");
  if (!Array.isArray(manualRows)) throw new Error("Manual assumed orders must be a JSON array.");
  const profiles = [...elements.settingsProfiles.querySelectorAll(".settings-profile")].map((row, index) => {
    const field = (name) => row.querySelector(`[data-settings-profile-field="${name}"]`);
    return {
      id: settingsState.chrome?.profiles?.[index]?.id || `profile-${Date.now()}-${index}`,
      name: field("name").value.trim() || "Amazon Profile",
      profile_directory: field("profile_directory").value.trim() || "Default",
      account_type: field("account_type").value,
      enabled: field("enabled").checked,
    };
  });
  return {
    assumptions: {
      default_cashback_rate: percentInputToRate(elements.defaultCashbackRate.value, 6),
      no_order_account: elements.noOrderAccount.value,
      no_order_cashback_rate: percentInputToRate(elements.noOrderCashbackRate.value, 6),
      business_default_cashback_rate: percentInputToRate(elements.businessDefaultCashbackRate.value, 6),
      manual_assumed_orders: manualRows,
    },
    chrome: {
      bfmr_profile_directory: elements.bfmrProfileDirectory.value.trim() || "Default",
      skip_paid_orders: elements.skipPaidOrders.checked,
      profiles,
    },
  };
}

async function loadData() {
  const [dataResponse, profileResponse] = await Promise.all([
    fetch("/api/data"),
    fetch("/api/chrome-profiles").catch(() => null),
  ]);
  if (!dataResponse.ok) throw new Error("Could not load tracker data.");
  if (profileResponse?.ok) {
    const profilePayload = await profileResponse.json();
    chromeProfiles = Array.isArray(profilePayload.profiles) ? profilePayload.profiles : [];
  }
  refreshDataset(await dataResponse.json());
  resetAddonDate();
}

function setQuickFilter(chip) {
  state = {
    ...state,
    month: "all",
    status: "all",
    account: "all",
    priceSource: "all",
    tracking: "all",
    payment: "all",
    amazon: "all",
    search: chip === "all" ? "" : state.search,
  };
  if (chip === "needs_tracking") state.tracking = "missing";
  if (chip === "open_payout") state.payment = "open";
  if (chip === "fallback") state.priceSource = "Payout fallback";
  if (chip === "paid") state.status = "Paid";
  if (chip === "purchased") state.status = "Purchased";
  if (chip === "amazon_unmatched") state.amazon = "unmatched";
  if (chip === "amazon_matched") state.amazon = "matched";
  syncControlValues();
  renderAll();
}

function applyKpiAction(action) {
  if (!action) return;
  state = {
    ...state,
    status: "all",
    account: "all",
    priceSource: "all",
    tracking: "all",
    payment: "all",
    amazon: "all",
    search: "",
  };
  if (action === "tracking_gaps") {
    state.tracking = "missing";
    state.tab = "orders";
  }
  if (action === "price_fallbacks") {
    state.priceSource = "Payout fallback";
    state.tab = "orders";
  }
  if (action === "amazon_needed") {
    state.amazon = "unmatched";
    state.tab = "orders";
  }
  if (action === "awaiting_pay") {
    state.payment = "open";
    state.tab = "orders";
  }
  if (action === "paid_cash") {
    state.payment = "paid";
    state.tab = "orders";
  }
  if (action === "returns") {
    state.tab = "returns";
  }
  syncControlValues();
  renderAll();
  setActiveTab(state.tab);
}

async function copyExtractorScript(path, label) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${label} script.`);
    const script = await response.text();
    await navigator.clipboard.writeText(script);
    if (elements.manualExtractStatus) elements.manualExtractStatus.textContent = `${label} script copied.`;
    showToast(`${label} script copied.`);
  } catch (error) {
    if (elements.manualExtractStatus) elements.manualExtractStatus.textContent = `Open the ${label} script download instead.`;
    showToast(error.message);
  }
}

function bindControl(select, key) {
  select.addEventListener("change", (event) => {
    state[key] = event.target.value;
    syncControlValues();
    renderAll();
  });
}

bindControl(elements.monthFilter, "month");
bindControl(elements.statusFilter, "status");
bindControl(elements.accountFilter, "account");
if (elements.analyticsMonthFilter) bindControl(elements.analyticsMonthFilter, "month");
if (elements.analyticsStatusFilter) bindControl(elements.analyticsStatusFilter, "status");
if (elements.analyticsAccountFilter) bindControl(elements.analyticsAccountFilter, "account");
if (elements.analyticsAmazonFilter) bindControl(elements.analyticsAmazonFilter, "amazon");
bindControl(elements.priceSourceFilter, "priceSource");
bindControl(elements.trackingFilter, "tracking");
bindControl(elements.paymentFilter, "payment");
bindControl(elements.amazonFilter, "amazon");
bindControl(elements.sortFilter, "sort");

elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  syncControlValues();
  renderAll();
});

if (elements.analyticsSearchInput) {
  elements.analyticsSearchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    syncControlValues();
    renderAll();
  });
}

elements.quickChips.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chip]");
  if (!button) return;
  setQuickFilter(button.dataset.chip);
});

elements.kpiGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-kpi-action]");
  if (!card) return;
  applyKpiAction(card.dataset.kpiAction);
});

elements.kpiGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-kpi-action]");
  if (!card) return;
  event.preventDefault();
  applyKpiAction(card.dataset.kpiAction);
});

if (elements.columnPrefsButton) {
  elements.columnPrefsButton.addEventListener("click", () => {
    elements.columnPrefsPanel.hidden = !elements.columnPrefsPanel.hidden;
    renderColumnPrefs();
  });
}

if (elements.resetColumnPrefs) {
  elements.resetColumnPrefs.addEventListener("click", () => {
    tableColumnPrefs = defaultColumnPrefs();
    saveColumnPrefs();
    renderColumnPrefs();
    renderAll();
    showToast("Table columns reset.");
  });
}

if (elements.columnPrefsList) {
  elements.columnPrefsList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-column-visible]");
    if (!checkbox) return;
    const row = checkbox.closest("[data-column-id]");
    const pref = tableColumnPrefs.find((item) => item.id === row.dataset.columnId);
    const column = tableColumns.find((item) => item.id === row.dataset.columnId);
    if (!pref || column?.locked) return;
    pref.visible = checkbox.checked;
    saveColumnPrefs();
    renderTable(filteredRecords());
  });

  elements.columnPrefsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-column-move]");
    if (!button) return;
    const row = button.closest("[data-column-id]");
    const index = tableColumnPrefs.findIndex((item) => item.id === row.dataset.columnId);
    if (index < 0) return;
    const offset = button.dataset.columnMove === "up" ? -1 : 1;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= tableColumnPrefs.length) return;
    const [pref] = tableColumnPrefs.splice(index, 1);
    tableColumnPrefs.splice(nextIndex, 0, pref);
    saveColumnPrefs();
    renderColumnPrefs();
    renderTable(filteredRecords());
  });
}

elements.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.uploadForm);
  elements.uploadButton.disabled = true;
  elements.uploadButton.textContent = "Replacing...";
  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Upload failed.");
    refreshDataset(payload, { resetFilters: true });
    elements.uploadForm.reset();
    showToast(`Loaded ${dataset.records.length} rows from the new export.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.uploadButton.disabled = false;
    elements.uploadButton.textContent = "Replace Data";
  }
});

if (elements.gusImportForm) {
  elements.gusImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(elements.gusImportForm);
    elements.gusImportButton.disabled = true;
    elements.gusImportButton.textContent = "Importing...";
    try {
      const response = await fetch("/api/import-gus", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Gus import failed.");
      refreshDataset(payload, { resetFilters: true });
      elements.gusImportForm.reset();
      showToast(`Imported ${dataset.records.length} rows from the Gus tracking sheet.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.gusImportButton.disabled = false;
      elements.gusImportButton.textContent = "Import Gus Tracking Sheet";
    }
  });
}

if (elements.copyBfmrExtractor) {
  elements.copyBfmrExtractor.addEventListener("click", () => {
    copyExtractorScript("/extractors/bfmr-manual-extractor.js", "BFMR");
  });
}

if (elements.copyAmazonExtractor) {
  elements.copyAmazonExtractor.addEventListener("click", () => {
    copyExtractorScript("/extractors/amazon-manual-extractor.js", "Amazon");
  });
}

if (elements.bfmrJsonForm) {
  elements.bfmrJsonForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(elements.bfmrJsonForm);
    elements.bfmrJsonButton.disabled = true;
    elements.bfmrJsonButton.textContent = "Importing...";
    try {
      const response = await fetch("/api/manual-bfmr-import", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "BFMR import failed.");
      refreshDataset(payload, { resetFilters: true });
      elements.bfmrJsonForm.reset();
      if (elements.manualExtractStatus) elements.manualExtractStatus.textContent = `Imported ${dataset.records.length} BFMR rows.`;
      showToast(`Imported ${dataset.records.length} BFMR rows.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.bfmrJsonButton.disabled = false;
      elements.bfmrJsonButton.textContent = "Import BFMR";
    }
  });
}

if (elements.amazonJsonForm) {
  elements.amazonJsonForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(elements.amazonJsonForm);
    elements.amazonJsonButton.disabled = true;
    elements.amazonJsonButton.textContent = "Importing...";
    try {
      const response = await fetch("/api/manual-amazon-import", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Amazon import failed.");
      refreshDataset(payload);
      elements.amazonJsonForm.reset();
      const matched = dataset.metadata?.amazon_matched_orders || 0;
      if (elements.manualExtractStatus) elements.manualExtractStatus.textContent = `Imported ${payload.imported || 0} Amazon orders.`;
      showToast(`Amazon import saved. ${matched} BFMR rows matched.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.amazonJsonButton.disabled = false;
      elements.amazonJsonButton.textContent = "Import Amazon";
    }
  });
}

elements.addonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.addonForm);
  const payload = Object.fromEntries(formData.entries());
  elements.addonButton.disabled = true;
  elements.addonButton.textContent = "Adding...";
  try {
    const response = await fetch("/api/addons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not add profit.");
    refreshDataset(result);
    elements.addonForm.reset();
    resetAddonDate();
    showToast("Profit add-on saved.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.addonButton.disabled = false;
    elements.addonButton.textContent = "Add Profit";
  }
});

elements.addonList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-addon-id]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/addons/${encodeURIComponent(button.dataset.addonId)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not remove profit add-on.");
    refreshDataset(result);
    showToast("Profit add-on removed.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

elements.addonList.addEventListener("change", async (event) => {
  const field = event.target.closest("[data-addon-id][data-addon-field]");
  if (!field) return;
  const value = field.value;
  if (String(value) === String(field.dataset.original || "")) return;
  field.disabled = true;
  try {
    const response = await fetch(`/api/addons/${encodeURIComponent(field.dataset.addonId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { [field.dataset.addonField]: value } }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not update profit add-on.");
    refreshDataset(result);
    showToast("Profit add-on updated.");
  } catch (error) {
    field.disabled = false;
    field.value = field.dataset.original || "";
    showToast(error.message);
  }
});

elements.ordersBody.addEventListener("change", async (event) => {
  const field = event.target.closest("[data-record-id][data-field]");
  if (!field) return;
  const value = field.value;
  if (String(value) === String(field.dataset.original || "")) return;
  const recordId = field.dataset.recordId;
  const fieldName = field.dataset.field;
  field.disabled = true;
  field.classList.add("saving");
  try {
    const response = await fetch(`/api/records/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { [fieldName]: value } }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not save that edit.");
    refreshDataset(result);
    showToast("Table edit saved.");
  } catch (error) {
    field.disabled = false;
    field.classList.remove("saving");
    field.value = field.dataset.original || "";
    showToast(error.message);
  }
});

if (elements.chromeSyncButton) {
  elements.chromeSyncButton.addEventListener("click", async () => {
    elements.chromeSyncButton.disabled = true;
    elements.chromeSyncButton.textContent = "Syncing...";
    elements.syncStatus.textContent = "Checking Chrome sync availability...";
    try {
      const response = await fetch("/api/chrome-sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Chrome sync is not ready yet.");
      refreshDataset(result, { resetFilters: true });
      elements.syncStatus.textContent = `Synced ${dataset.records.length} live BFMR rows.`;
      showToast("BFMR live sync complete.");
    } catch (error) {
      elements.syncStatus.textContent = error.message;
      showToast(error.message);
    } finally {
      elements.chromeSyncButton.disabled = false;
      elements.chromeSyncButton.textContent = "Sync";
    }
  });
}

if (elements.amazonSyncButton) {
  elements.amazonSyncButton.addEventListener("click", async () => {
    elements.amazonSyncButton.disabled = true;
    elements.amazonSyncButton.textContent = "Syncing...";
    elements.amazonSyncStatus.textContent = "Checking Amazon profile sync availability...";
    try {
      const response = await fetch("/api/amazon-sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Amazon sync is not ready yet.");
      refreshDataset(result, { resetFilters: true });
      elements.amazonSyncStatus.textContent = `Matched ${dataset.metadata?.amazon_matched_orders || 0} BFMR rows to Amazon.`;
      showToast("Amazon order sync complete.");
    } catch (error) {
      elements.amazonSyncStatus.textContent = error.message;
      showToast(error.message);
    } finally {
      elements.amazonSyncButton.disabled = false;
      elements.amazonSyncButton.textContent = "Sync";
    }
  });
}

if (elements.rescrapeButton) {
  elements.rescrapeButton.addEventListener("click", async () => {
    elements.rescrapeButton.disabled = true;
    elements.rescrapeButton.textContent = "Updating...";
    elements.rescrapeStatus.textContent = "Opening Chrome, refreshing BFMR, then checking unpaid or ETA-stale Amazon orders.";
    try {
      const response = await fetch("/api/rescrape-needed", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Rescrape failed.");
      refreshDataset(result, { resetFilters: true });
      const matched = dataset.metadata?.amazon_matched_orders || 0;
      const uniqueAmazon = dataset.amazon_orders?.length || 0;
      elements.rescrapeStatus.textContent = `Refresh complete. ${dataset.records.length} BFMR line items; ${uniqueAmazon} unique Amazon orders captured; ${matched} line items matched.`;
      showToast("Needed scrape complete.");
    } catch (error) {
      elements.rescrapeStatus.textContent = error.message;
      showToast(error.message);
    } finally {
      elements.rescrapeButton.disabled = false;
      elements.rescrapeButton.textContent = "Run Normal Update";
    }
  });
}

if (elements.rescrapeAllButton) {
  elements.rescrapeAllButton.addEventListener("click", async () => {
    elements.rescrapeAllButton.disabled = true;
    elements.rescrapeAllButton.textContent = "Refreshing All...";
    elements.rescrapeStatus.textContent = "Opening Chrome, refreshing BFMR, then re-checking every non-cancelled Amazon order including paid rows.";
    try {
      const response = await fetch("/api/rescrape-all", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Full rescrape failed.");
      refreshDataset(result, { resetFilters: true });
      const matched = dataset.metadata?.amazon_matched_orders || 0;
      const uniqueAmazon = dataset.amazon_orders?.length || 0;
      elements.rescrapeStatus.textContent = `Full refresh complete. ${dataset.records.length} BFMR line items; ${uniqueAmazon} unique Amazon orders captured; ${matched} line items matched.`;
      showToast("One-time all-order scrape complete.");
    } catch (error) {
      elements.rescrapeStatus.textContent = error.message;
      showToast(error.message);
    } finally {
      elements.rescrapeAllButton.disabled = false;
      elements.rescrapeAllButton.textContent = "Run One-Time All";
    }
  });
}

if (elements.addProfileButton) {
  elements.addProfileButton.addEventListener("click", () => {
    try {
      settingsState = readSettingsForm();
    } catch {
      settingsState = mergeSettings(settingsState);
    }
    settingsState.chrome.profiles.push({
      id: `profile-${Date.now()}`,
      name: "Amazon Profile",
      profile_directory: "Default",
      account_type: "personal",
      enabled: true,
    });
    renderSettings();
  });
}

if (elements.settingsProfiles) {
  elements.settingsProfiles.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-remove-profile]");
    if (!button) return;
    try {
      settingsState = readSettingsForm();
    } catch (error) {
      showToast(error.message);
      return;
    }
    settingsState.chrome.profiles.splice(Number(button.dataset.settingsRemoveProfile), 1);
    renderSettings();
  });
}

if (elements.saveSettingsButton) {
  elements.saveSettingsButton.addEventListener("click", async () => {
    elements.saveSettingsButton.disabled = true;
    elements.saveSettingsButton.textContent = "Saving...";
    try {
      const settings = readSettingsForm();
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save settings.");
      refreshDataset(result);
      showToast("Settings saved.");
    } catch (error) {
      showToast(error.message);
      if (elements.settingsStatus) elements.settingsStatus.textContent = error.message;
    } finally {
      elements.saveSettingsButton.disabled = false;
      elements.saveSettingsButton.textContent = "Save Settings";
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});

elements.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  elements.installButton.hidden = true;
});

if (elements.themeToggle) {
  applyTheme(localStorage.getItem("toopa-theme") || document.documentElement.dataset.theme || "light");
  elements.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
document.body.classList.toggle("standalone", Boolean(standalone));

let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderAll, 140);
});

loadData().catch((error) => {
  elements.metadata.textContent = error.message;
  showToast(error.message);
});

