import type { LongBookAnalysisPreset } from "@deepwrite/contracts/renderer";

export function cloneLongBookAnalysisPreset(
  preset: LongBookAnalysisPreset
): LongBookAnalysisPreset {
  return {
    ...preset,
    output: { ...preset.output }
  };
}
