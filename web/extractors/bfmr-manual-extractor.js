(() => {
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
  const headersFromTable = (table) => {
    const explicit = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.innerText || cell.textContent));
    if (explicit.length) return explicit;
    const firstRow = table.querySelector("tr");
    return [...(firstRow?.querySelectorAll("th,td") || [])].map((cell) => clean(cell.innerText || cell.textContent));
  };
  const rowFromCells = (headers, cells) => {
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = clean(cells[index]?.innerText || cells[index]?.textContent);
    });
    return row;
  };
  const rows = [];
  for (const table of document.querySelectorAll("table")) {
    const headers = headersFromTable(table);
    const bodyRows = [...table.querySelectorAll("tbody tr")];
    const fallbackRows = [...table.querySelectorAll("tr")].slice(1);
    for (const tr of bodyRows.length ? bodyRows : fallbackRows) {
      const cells = [...tr.querySelectorAll("td")];
      if (!cells.length) continue;
      const row = rowFromCells(headers, cells);
      if (row.Status && (row.Items || row.Item) && (row["Order No."] || row["Order #"] || row.Order)) {
        rows.push(row);
      }
    }
  }
  const payload = {
    type: "bfmr_tracker_rows",
    source_url: location.href,
    extracted_at: new Date().toISOString(),
    rows,
  };
  downloadJson(`bfmr-tracker-${new Date().toISOString().slice(0, 10)}.json`, payload);
  console.log(`BFMR extractor saved ${rows.length} rows. Upload the JSON to Toopa's BFMR Tracking.`);
  return payload;
})();
