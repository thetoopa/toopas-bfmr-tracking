(() => {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  const rowFromCells = (headers, cells) => {
    const row = {};
    headers.forEach((header, index) => {
      const key = clean(header);
      if (key) row[key] = clean(cells[index]?.innerText || cells[index]?.textContent);
    });
    return row;
  };

  const extractTables = () => {
    const rows = [];
    for (const table of document.querySelectorAll("table")) {
      const explicitHeaders = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.innerText || cell.textContent));
      const allRows = [...table.querySelectorAll("tr")];
      const firstCells = [...(allRows[0]?.querySelectorAll("th,td") || [])];
      const fallbackHeaders = firstCells.map((cell) => clean(cell.innerText || cell.textContent));
      const headers = explicitHeaders.length ? explicitHeaders : fallbackHeaders;
      const bodyRows = explicitHeaders.length ? [...table.querySelectorAll("tbody tr")] : allRows.slice(1);

      for (const tr of bodyRows) {
        const cells = [...tr.querySelectorAll("td")];
        if (!cells.length || cells.every((cell) => !clean(cell.innerText || cell.textContent))) continue;
        const row = rowFromCells(headers, cells);
        if (Object.keys(row).length) rows.push(row);
      }
    }
    return rows;
  };

  const extractRoleRows = () => {
    const grids = [...document.querySelectorAll('[role="grid"], [role="table"]')];
    const rows = [];
    for (const grid of grids) {
      const headers = [...grid.querySelectorAll('[role="columnheader"]')].map((cell) =>
        clean(cell.innerText || cell.textContent),
      );
      if (!headers.length) continue;
      for (const rowEl of grid.querySelectorAll('[role="row"]')) {
        const cells = [...rowEl.querySelectorAll('[role="cell"], [role="gridcell"]')];
        if (!cells.length) continue;
        const row = rowFromCells(headers, cells);
        if (Object.keys(row).length) rows.push(row);
      }
    }
    return rows;
  };

  const rows = extractTables();
  if (!rows.length) rows.push(...extractRoleRows());

  return {
    source_url: location.href,
    extracted_at: new Date().toISOString(),
    rows,
  };
})();
