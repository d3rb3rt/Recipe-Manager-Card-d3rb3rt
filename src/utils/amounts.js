// Robust parsing / scaling / formatting of ingredient amounts.
// Handles "2", "1,5", "1.5", "1/2", "1 1/2", "½", "1½", "2-3", "2 – 3", "2 bis 3", "2 to 3".
// Anything else (e.g. "etwas", "nach Belieben") is returned unchanged by scaleAmountString().

const UNICODE_FRACTIONS = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

function normalize(str) {
  let s = String(str).trim();
  s = s.replace(/[–—−]/g, '-');
  s = s.replace(/([0-9])?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, d, f) => (d ? `${d} ` : '') + UNICODE_FRACTIONS[f]);
  return s.replace(/\s+/g, ' ');
}

function parseSingle(s) {
  s = s.trim();
  let m;
  if ((m = /^(\d+) (\d+)\/(\d+)$/.exec(s))) {
    const d = +m[3];
    return d ? +m[1] + (+m[2]) / d : null;
  }
  if ((m = /^(\d+)\/(\d+)$/.exec(s))) {
    const d = +m[2];
    return d ? (+m[1]) / d : null;
  }
  if (/^(\d+([.,]\d+)?|[.,]\d+)$/.test(s)) return parseFloat(s.replace(',', '.'));
  return null;
}

/**
 * @returns {{values:number[], comma:boolean, dot:boolean}|null}  values has 1 (single) or 2 (range) entries
 */
export function parseAmount(str) {
  if (str === null || str === undefined) return null;
  const raw = String(str);
  if (!raw.trim()) return null;
  const s = normalize(raw);
  const single = parseSingle(s);
  const flags = { comma: /\d,\d|^,/.test(s), dot: /\d\.\d|^\./.test(s) };
  if (single !== null) return { values: [single], ...flags };
  const parts = s.split(/\s*(?:-|\bbis\b|\bto\b)\s*/i);
  if (parts.length === 2) {
    const a = parseSingle(parts[0]);
    const b = parseSingle(parts[1]);
    if (a !== null && b !== null) return { values: [a, b], ...flags };
  }
  return null;
}

function preferComma(parsed) {
  if (parsed.comma) return true;
  if (parsed.dot) return false;
  const lang = (typeof navigator !== 'undefined' && navigator.language) || '';
  return /^(de|fr|es|it|nl|pt)/i.test(lang);
}

export function formatNumber(v, comma = false) {
  if (!isFinite(v)) return '';
  let out;
  if (Math.abs(v - Math.round(v)) < 1e-6) out = String(Math.round(v));
  else if (v >= 100) out = String(Math.round(v));
  else if (v >= 10) out = v.toFixed(1).replace(/\.0$/, '');
  else out = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return comma ? out.replace('.', ',') : out;
}

/** Scale an amount string by `mult`. Unparseable input is returned unchanged. */
export function scaleAmountString(amount, mult) {
  if (!amount) return amount;
  if (mult === 1) return amount;
  const p = parseAmount(amount);
  if (!p) return amount;
  const comma = preferComma(p);
  return p.values.map(v => formatNumber(v * mult, comma)).join('-');
}

/** Numeric value of an amount (midpoint for ranges) or null. */
export function amountValue(amount) {
  const p = parseAmount(amount);
  if (!p) return null;
  return p.values.reduce((a, b) => a + b, 0) / p.values.length;
}

const TO_BASE = {
  g: ['g', 1], gr: ['g', 1], gramm: ['g', 1], kg: ['g', 1000],
  oz: ['g', 28.3495], lb: ['g', 453.592], lbs: ['g', 453.592],
  ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000], liter: ['ml', 1000],
  'fl oz': ['ml', 29.5735], cup: ['ml', 250], cups: ['ml', 250],
};

/**
 * Sum of all weight/volume ingredients (ml counted like g).
 * @returns {{total:number, unit:'g'|'ml', share:number}|null}
 *   share = fraction of real (non-heading) ingredients that contributed.
 */
export function computeTotal(ingredients) {
  const real = (ingredients || []).filter(i => i && !i.is_heading && !(i.name || '').startsWith('#'));
  if (!real.length) return null;
  let total = 0, counted = 0, gSum = 0, mlSum = 0;
  for (const ing of real) {
    const conv = TO_BASE[(ing.unit || '').toLowerCase().trim()];
    const val = amountValue(ing.amount);
    if (!conv || val === null) continue;
    const base = val * conv[1];
    total += base;
    if (conv[0] === 'g') gSum += base; else mlSum += base;
    counted++;
  }
  if (!counted || total <= 0) return null;
  return { total, unit: mlSum > gSum ? 'ml' : 'g', share: counted / real.length };
}

export function formatTotal(total, unit) {
  total = Math.round(total);
  if (total >= 10000) {
    const big = unit === 'ml' ? 'l' : 'kg';
    const v = total / 1000;
    return `${(Math.round(v * 100) / 100).toString().replace('.', ',')} ${big}`;
  }
  return `${Math.round(total)} ${unit}`;
}
