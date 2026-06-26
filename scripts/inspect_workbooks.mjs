import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = [
  {
    label: "tracker_data",
    file: "C:/Users/coope/Downloads/tracker_data (6).xlsx",
  },
  {
    label: "existing_tracker",
    file: "C:/Users/coope/Downloads/BFMR Tracking.xlsx",
  },
];

const outputDir = path.resolve("outputs");
await fs.mkdir(outputDir, { recursive: true });

const blocks = [];

for (const source of files) {
  const input = await FileBlob.load(source.file);
  const workbook = await SpreadsheetFile.importXlsx(input);

  blocks.push(`\n===== ${source.label}: ${source.file} =====`);
  const overview = await workbook.inspect({
    kind: "workbook,sheet,table",
    maxChars: 12000,
    tableMaxRows: 12,
    tableMaxCols: 20,
    tableMaxCellChars: 120,
  });
  blocks.push(overview.ndjson);

  const sheetList = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 4000,
  });
  blocks.push("\n--- Sheets ---");
  blocks.push(sheetList.ndjson);

  const formulaScan = await workbook.inspect({
    kind: "formula",
    maxChars: 12000,
    options: { maxResults: 200 },
  });
  blocks.push("\n--- Formula Scan ---");
  blocks.push(formulaScan.ndjson);
}

await fs.writeFile(path.join(outputDir, "workbook_inspection.txt"), blocks.join("\n"), "utf8");
console.log(path.join(outputDir, "workbook_inspection.txt"));
