import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes fields with commas, quotes and newlines; CRLF rows", () => {
    const out = toCsv([
      ["link", "label", "created_at"],
      ["https://x/c/abc", "Front desk, week 1", "2026-10-05T00:00:00.000Z"],
      ["https://x/c/def", 'say "hi"', ""],
      ["https://x/c/ghi", "two\nlines", ""],
    ]);
    expect(out).toBe(
      'link,label,created_at\r\n' +
        'https://x/c/abc,"Front desk, week 1",2026-10-05T00:00:00.000Z\r\n' +
        'https://x/c/def,"say ""hi""",\r\n' +
        'https://x/c/ghi,"two\nlines",\r\n'
    );
  });
});
