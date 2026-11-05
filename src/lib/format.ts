export function fmtMoney(n: number, currency = "USD", locale = "en-US", digits = 2) {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtSigned(n: number, currency = "USD", locale = "en-US") {
  const s = fmtMoney(Math.abs(n), currency, locale);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export function fmtDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function shortAddr(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
