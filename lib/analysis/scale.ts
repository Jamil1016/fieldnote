/** Heatmap colour scale: seven diverging bins whose edges sit on the policy lines. */
import { POLICY } from "../policy";

export type VarianceBin = "under-3" | "under-2" | "under-1" | "zero" | "over-1" | "over-2" | "over-3";

const EPS = 1e-9;

export function varianceBin(v: number, breach: number = POLICY.varianceBreach, watch: number = POLICY.varianceWatch): VarianceBin {
  if (v <= -2 * breach + EPS) return "under-3";
  if (v <= -breach + EPS) return "under-2";
  if (v <= -watch + EPS) return "under-1";
  if (v < watch - EPS) return "zero";
  if (v < breach - EPS) return "over-1";
  if (v < 2 * breach - EPS) return "over-2";
  return "over-3";
}

const pct = (x: number) => Math.round(x * 100);

export function legendBins(breach: number = POLICY.varianceBreach, watch: number = POLICY.varianceWatch): { bin: VarianceBin; label: string }[] {
  return [
    { bin: "under-3", label: `<= -${pct(2 * breach)}%` },
    { bin: "under-2", label: `<= -${pct(breach)}%` },
    { bin: "under-1", label: `<= -${pct(watch)}%` },
    { bin: "zero", label: `within ${pct(watch)}%` },
    { bin: "over-1", label: `>= +${pct(watch)}%` },
    { bin: "over-2", label: `>= +${pct(breach)}%` },
    { bin: "over-3", label: `>= +${pct(2 * breach)}%` },
  ];
}
