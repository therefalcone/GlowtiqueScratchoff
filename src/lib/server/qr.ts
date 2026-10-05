import QRCode from "qrcode";

/** Inline SVG QR code (no external image requests, prints crisply). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    color: { dark: "#1f1a14", light: "#ffffff" },
  });
}
