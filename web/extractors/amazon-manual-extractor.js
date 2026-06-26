(() => {
  const ORDER_RE = /\b\d{3}-\d{7}-\d{7}\b/;
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const downloadJson = (filename, payload) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const cardElements = () => {
    const candidates = [...document.querySelectorAll("[data-order-id], .a-box-group, .order-card, .js-order-card, [class*=order]")];
    return [...new Set(candidates)].filter((element) => {
      const text = element.innerText || element.textContent || "";
      return ORDER_RE.test(text) && text.length < 12000;
    });
  };
  const rewardText = (text) => {
    const reward = text.match(/Earns\s+\d+(?:\.\d+)?%\s+back(?:[^.]*?extra\s+\d+(?:\.\d+)?%[^.]*)?/i);
    if (reward) return clean(reward[0]);
    const cashBack = text.match(/\d+(?:\.\d+)?%\s+(?:back|cash\s*back)(?:[^.]*?No-Rush[^.]*)?/i);
    return cashBack ? clean(cashBack[0]) : "";
  };
  const paymentText = (text) => {
    const payment = text.match(/Payment method\s+(.{0,180}?)(?:Earns|Order placed|$)/i);
    if (payment) return clean(payment[1]);
    const card = text.match(/(?:Amazon Visa|Business American Express|American Express|Visa|Mastercard|ending in \d{4}).{0,120}/i);
    return card ? clean(card[0]) : "";
  };
  const rowsByOrder = new Map();
  const sourceElements = cardElements();
  const elements = sourceElements.length ? sourceElements : [document.body];
  for (const element of elements) {
    const text = clean(element.innerText || element.textContent || "");
    const orderNumber = (text.match(ORDER_RE) || [""])[0];
    if (!orderNumber || rowsByOrder.has(orderNumber)) continue;
    const date = (text.match(/Order placed\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i) || [,""])[1];
    const total = (text.match(/Total\s+(\$[\d,]+(?:\.\d{2})?)/i) || [,""])[1];
    rowsByOrder.set(orderNumber, {
      order_number: orderNumber,
      order_date: date,
      order_total: total,
      payment_method: paymentText(text),
      reward_text: rewardText(text),
      raw_text: text.slice(0, 1800),
    });
  }
  const payload = {
    type: "amazon_order_history_rows",
    source_url: location.href,
    extracted_at: new Date().toISOString(),
    rows: [...rowsByOrder.values()],
  };
  downloadJson(`amazon-orders-${new Date().toISOString().slice(0, 10)}.json`, payload);
  console.log(`Amazon extractor saved ${payload.rows.length} orders. Upload the JSON to Toopa's BFMR Tracking.`);
  return payload;
})();
