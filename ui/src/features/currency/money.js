/**
 * "¥1,000", "NT$100", "$6.33". US English on purpose: the app converts to US
 * dollars, so "$" is the dollar and other currencies keep a telling symbol
 * (a phone set to another locale could show "US$" or a bare "$" for NT$).
 */
export function money(amount, code) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** A round local amount worth showing next to the rate: ¥100, NT$100, €1. */
export function referenceAmount(rate) {
  return 10 ** Math.max(0, Math.round(Math.log10(rate)));
}

/** "1,234.5" or "1234,5" typed on a phone -> 1234.5; null when it isn't a number. */
export function parseAmount(text) {
  const cleaned = String(text).replace(/\s/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
