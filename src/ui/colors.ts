/** Mixes a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount)),
  );
  return `#${((parts[0] << 16) | (parts[1] << 8) | parts[2]).toString(16).padStart(6, '0')}`;
}
