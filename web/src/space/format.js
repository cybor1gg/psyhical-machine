// Currency formatting for the space theme: МКД with dot thousands
// separators, whole denars ("1.000 МКД"). Sub-denar balances keep two
// decimals with a comma, the Macedonian way ("1.000,50 МКД").
export function fmtMKD(n) {
  const v = Number(n) || 0;
  const whole = Math.floor(Math.abs(v) + 1e-9);
  const cents = Math.round((Math.abs(v) - whole) * 100);
  const sign = v < 0 ? "-" : "";
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sign + grouped + (cents > 0 ? "," + String(cents).padStart(2, "0") : "") + " МКД";
}
