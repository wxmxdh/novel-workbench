import type {
  CreateScriptBookInput,
  CreateShortBookInput,
  CreativePlotStage,
  WorkspaceAgentSettings
} from "@deepwrite/contracts";

type ShortOrScriptBookInput =
  | ({ workspaceType: "short" } & CreateShortBookInput)
  | ({ workspaceType: "script" } & CreateScriptBookInput);

export function withShortBookDefaultPlotStages<
  Input extends ShortOrScriptBookInput
>(
  input: Input,
  settings: readonly WorkspaceAgentSettings[],
  plotStages: readonly CreativePlotStage[]
): Input {
  if (
    input.workspaceType !== "short" ||
    input.defaultPlotStageIds !== undefined
  )
    return input;
  const shortSettings = settings.find(
    (candidate) => candidate.workspaceType === "short"
  );
  const configuredIds = new Set(shortSettings?.defaultPlotStageIds);
  const defaultPlotStageIds = plotStages
    .filter(({ id }) => configuredIds.has(id))
    .map(({ id }) => id);
  return {
    ...input,
    defaultPlotStageIds:
      defaultPlotStageIds.length > 0
        ? defaultPlotStageIds
        : [plotStages[0]?.id ?? "plot_design"]
  };
}
