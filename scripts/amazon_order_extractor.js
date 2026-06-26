(() => {
  const ORDER_RE = /\b\d{3}-\d{7}-\d{7}\b/g;
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const lines = (text) => clean(text).split(/(?=Order placed|Order #|Payment method|Earns|\$|\b[A-Z][a-z]+ \d{1,2}, \d{4})/);

  const firstMatch = (parts, pattern) => clean(parts.find((part) => pattern.test(part)) || "");

  const parseOrderDate = (parts) => {
    const text = firstMatch(parts, /Order placed|Ordered on|Order date|[A-Z][a-z]+ \d{1,2}, \d{4}/i);
    const date = text.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
    return date ? date[0] : text.replace(/Order placed|Ordered on|Order date/gi, "").trim();
  };

  const parseOrderTotal = (parts) => {
    const text = firstMatch(parts, /Order total|Total|\$\d/i);
    const money = text.match(/\$[\d,]+(?:\.\d{2})?/);
    return money ? money[0] : "";
  };

  const parsePaymentMethod = (parts) => {
    const payment = firstMatch(parts, /Payment method|ending in|Amazon Visa|Business American Express|card/i);
    return payment.replace(/^Payment method\s*/i, "").trim();
  };

  const parseRewardText = (parts) => {
    const reward = firstMatch(parts, /Earns\s+\d|% back|No-Rush|cash back|cashback/i);
    return reward;
  };

  const orderCards = () => {
    const selectors = [
      "[data-order-id]",
      ".js-order-card",
      ".order-card",
      ".order",
      ".a-box-group",
      ".a-box",
      "[class*='order']",
    ];
    const cards = [...document.querySelectorAll(selectors.join(","))]
      .filter((element) => {
        ORDER_RE.lastIndex = 0;
        return ORDER_RE.test(element.innerText || element.textContent || "");
      })
      .map((element) => {
        ORDER_RE.lastIndex = 0;
        return element;
      });
    return [...new Set(cards)];
  };

  const extractFromCard = (element) => {
    const text = clean(element.innerText || element.textContent);
    const orderNumbers = [...new Set(text.match(ORDER_RE) || [])];
    const parts = lines(text);
    return orderNumbers.map((orderNumber) => ({
      order_number: orderNumber,
      order_date: parseOrderDate(parts),
      order_total: parseOrderTotal(parts),
      payment_method: parsePaymentMethod(parts),
      reward_text: parseRewardText(parts),
      raw_text: text.slice(0, 1800),
    }));
  };

  const extractFallback = () => {
    const text = clean(document.body.innerText || document.body.textContent);
    const orderNumbers = [...new Set(text.match(ORDER_RE) || [])];
    return orderNumbers.map((orderNumber) => {
      const index = text.indexOf(orderNumber);
      const windowText = text.slice(Math.max(index - 800, 0), index + 1600);
      const parts = lines(windowText);
      return {
        order_number: orderNumber,
        order_date: parseOrderDate(parts),
        order_total: parseOrderTotal(parts),
        payment_method: parsePaymentMethod(parts),
        reward_text: parseRewardText(parts),
        raw_text: windowText,
      };
    });
  };

  const cardRows = orderCards().flatMap(extractFromCard);
  const rowsByOrder = new Map();
  for (const row of cardRows.length ? cardRows : extractFallback()) {
    if (row.order_number && !rowsByOrder.has(row.order_number)) rowsByOrder.set(row.order_number, row);
  }

  return {
    source_url: location.href,
    extracted_at: new Date().toISOString(),
    rows: [...rowsByOrder.values()],
  };
})();
