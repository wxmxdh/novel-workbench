import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  createDefaultCreativePlotStages,
  type WorkspaceAgentSettings
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { withShortBookDefaultPlotStages } from "./shortBookDefaultPlotStages";

const settings: WorkspaceAgentSettings[] = [
  {
    ...DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
    defaultPlotStageIds: ["plot_design", "plot_refine"]
  },
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS
];
const plotStages = createDefaultCreativePlotStages().reverse();

describe("withShortBookDefaultPlotStages", () => {
  it("adds the saved defaults to a short-book creation input", () => {
    expect(
      withShortBookDefaultPlotStages(
        { workspaceType: "short", title: "短篇", genre: "其他" },
        settings,
        plotStages
      )
    ).toMatchObject({
      defaultPlotStageIds: ["plot_refine", "plot_design"]
    });
  });

  it("preserves explicit template stages instead of global defaults", () => {
    const input = {
      workspaceType: "short" as const,
      title: "模板作品",
      genre: "其他" as const,
      defaultPlotStageIds: ["outline"]
    };
    expect(withShortBookDefaultPlotStages(input, settings, plotStages)).toBe(
      input
    );
  });
  it("leaves script creation inputs unchanged", () => {
    const input = {
      workspaceType: "script",
      title: "剧本",
      genre: "其他"
    } as const;
    expect(withShortBookDefaultPlotStages(input, settings, plotStages)).toBe(
      input
    );
  });
});
