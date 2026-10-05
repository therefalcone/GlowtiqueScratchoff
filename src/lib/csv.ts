/** RFC 4180 CSV: quotes fields containing commas, quotes or newlines. */
export function toCsv(rows: string[][]): string {
  const escape = (field: string) =>
    /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
  return rows.map((r) => r.map(escape).join(",")).join("\r\n") + "\r\n";
}
