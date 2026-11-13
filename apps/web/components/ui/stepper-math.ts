export interface StepBounds {
  min?: number;
  max?: number;
  step?: number;
}

/** Number of decimals in a step like 0.1 or 2.5e-3 (so results can be rounded without float drift). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const s = String(step);
  const exp = /e-(\d+)$/i.exec(s);
  if (exp) {
    const mantissa = s.split(/e/i)[0] ?? "";
    const frac = mantissa.split(".")[1]?.length ?? 0;
    return Number(exp[1]) + frac;
  }
  return s.split(".")[1]?.length ?? 0;
}

export function clamp(value: number, min = -Infinity, max = Infinity): number {
  return Math.min(max, Math.max(min, value));
}

/** One press of − (dir -1) or + (dir 1): add step, round to the step's decimals, clamp to [min, max]. */
export function stepValue(value: number, dir: 1 | -1, { min = -Infinity, max = Infinity, step = 1 }: StepBounds = {}): number {
  const size = step > 0 && Number.isFinite(step) ? step : 1;
  const decimals = Math.max(stepDecimals(size), stepDecimals(Number.isFinite(value) ? value : 0));
  const start = Number.isFinite(value) ? value : Number.isFinite(min) ? min : 0;
  const raw = start + dir * size;
  const rounded = Number(raw.toFixed(Math.min(decimals, 100)));
  return clamp(rounded, min, max);
}
