/** Serialize text for spreadsheet consumers without allowing formula execution. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return `\uFEFF${rows.map(row => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function downloadCsv(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
