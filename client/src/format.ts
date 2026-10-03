export function formatClock(simMin: number): string {
  const total = Math.floor(simMin);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `T+${h}:${String(m).padStart(2, '0')}`;
}

export function formatMin(simMin: number): string {
  return `${Math.max(0, simMin).toFixed(1)} min`;
}
