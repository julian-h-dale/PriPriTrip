/**
 * Exchange rates from Frankfurter (https://frankfurter.dev): free, no key,
 * callable from the browser. Rates are reference (mid-market) rates per 1
 * USD, kept on this device for 12 hours — every calculation uses the stored
 * rate, and offline the last one is still there, with its date.
 */

export const API = "https://api.frankfurter.dev/v2";
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RATES_KEY = "fx:USD";
const CURRENCIES_KEY = "fx:currencies";

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the rate still works for this visit.
  }
}

/** { fetchedAt, rates: { JPY: { rate, date } } } or an empty one. */
export function storedRates() {
  const stored = read(RATES_KEY);
  return stored && typeof stored.rates === "object" ? stored : { fetchedAt: null, rates: {} };
}

export function isFresh(stored, codes, now = Date.now()) {
  if (!stored.fetchedAt || now - new Date(stored.fetchedAt).getTime() > MAX_AGE_MS) return false;
  return codes.every((c) => stored.rates[c]);
}

/** Today's rates for `codes`, merged into what's stored. Throws when it can't fetch. */
export async function fetchRates(codes, now = Date.now()) {
  const res = await fetch(`${API}/rates?base=USD&quotes=${codes.join(",")}`);
  if (!res.ok) throw new Error(`Frankfurter answered ${res.status}`);
  const rows = await res.json();
  const stored = storedRates();
  const rates = { ...stored.rates };
  for (const row of rows) {
    if (row.base === "USD" && typeof row.rate === "number") rates[row.quote] = { rate: row.rate, date: row.date };
  }
  const next = { fetchedAt: new Date(now).toISOString(), rates };
  write(RATES_KEY, next);
  return next;
}

/** Every currency Frankfurter still has rates for: [{ code, name, symbol }], stored once fetched. */
export async function fetchCurrencyList(now = Date.now()) {
  const stored = read(CURRENCIES_KEY);
  if (Array.isArray(stored) && stored.length) return stored;
  const res = await fetch(`${API}/currencies`);
  if (!res.ok) throw new Error(`Frankfurter answered ${res.status}`);
  const list = (await res.json())
    // `end_date` is its latest rate: an old one means a retired currency.
    .filter((c) => c.iso_code && c.iso_code !== "USD" && now - new Date(c.end_date).getTime() < 30 * 864e5)
    .map((c) => ({ code: c.iso_code, name: c.name, symbol: c.symbol }));
  write(CURRENCIES_KEY, list);
  return list;
}

/** Per trip, on this device: extra currencies picked with "Other…". */
export function tripExtras(tripId) {
  const stored = read(`fx:trip:${tripId}`);
  return Array.isArray(stored) ? stored : [];
}

export function saveTripExtras(tripId, codes) {
  write(`fx:trip:${tripId}`, codes);
}
