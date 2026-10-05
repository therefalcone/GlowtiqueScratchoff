import { describe, expect, it } from "vitest";
import { formatPhone, isValidEmail, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("normalizes US numbers to E.164 and keeps international ones", () => {
    expect(normalizePhone("(239) 555-0142")).toBe("+12395550142");
    expect(normalizePhone("239.555.0142")).toBe("+12395550142");
    expect(normalizePhone("1 239 555 0142")).toBe("+12395550142");
    expect(normalizePhone("+1 239 555 0142")).toBe("+12395550142");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects garbage", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("555-0142")).toBeNull();
    expect(normalizePhone("0239555014")).toBeNull();
    expect(normalizePhone("+1")).toBeNull();
    expect(normalizePhone("hello")).toBeNull();
  });
  it("formats US numbers for display", () => {
    expect(formatPhone("+12395550142")).toBe("(239) 555-0142");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
    expect(formatPhone(null)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts and rejects the obvious", () => {
    expect(isValidEmail("lena.rosetti@gmail.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});
