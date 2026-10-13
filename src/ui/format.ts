const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Display-only unit conversion; the domain stays in SI. */
export function formatMass(kg: number): string {
  if (Math.abs(kg) < 1000) return `${int.format(kg)} kg`;
  const t = kg / 1000;
  return Math.abs(t) < 100 ? `${one.format(t)} t` : `${int.format(t)} t`;
}

export function formatForce(n: number): string {
  if (n === 0) return '0 kN';
  return Math.abs(n) >= 1e6 ? `${one.format(n / 1e6)} MN` : `${int.format(n / 1e3)} kN`;
}

export function formatCredits(c: number): string {
  return `${int.format(c)} cr`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
