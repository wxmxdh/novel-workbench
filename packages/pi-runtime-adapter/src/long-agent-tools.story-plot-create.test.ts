import type { LongAgentToolDetails } from "./long-agent-tools";
import {
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  fixtureStoryPlotIndex,
  it,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";

function storyPlotCreateOrder(details: LongAgentToolDetails): number {
  if (details.kind !== "long-mutation-proposal") {
    throw new Error("expected a plot mutation proposal");
  }
  const created = details.batch.operations.find(
    (operation) => operation.type === "storyPlot.create"
  );
  if (!created || created.type !== "storyPlot.create") {
    throw new Error("expected a storyPlot.create operation");
  }
  return created.storyPlot.order;
}

describe("unified long-form tools: story-plot create order", () => {
  it("gives consecutive same-run story plots unique contiguous orders", async () => {
    const tools = longTools({
      executor: documentExecutor(fixtureIndex()),
      activeRoot: "plot_design"
    });
    const create = toolByName(tools, "create");
    const list = toolByName(tools, "list");

    const first = await create.execute("create-story-plot-1", {
      kind: "story_plot",
      meta: { title: "节一：失散坠落", arc_id: "arc_one" },
      content: "空间风暴失散坠落。",
      summary: "新建故事情节节一"
    });
    expect(storyPlotCreateOrder(first.details)).toBe(1);
    expect(
      resultText(
        await list.execute("list-after-first", {
          stage: "plot",
          scope_id: "arc_one"
        })
      )
    ).toContain("节一：失散坠落");

    const second = await create.execute("create-story-plot-2", {
      kind: "story_plot",
      meta: { title: "节二：重攒根基", arc_id: "arc_one" },
      content: "以丹道与黑市匿名经营。",
      summary: "新建故事情节节二"
    });
    expect(storyPlotCreateOrder(second.details)).toBe(2);
  });

  it("appends after story plots that already exist in the live index", async () => {
    const tools = longTools({
      executor: documentExecutor(fixtureStoryPlotIndex()),
      activeRoot: "plot_design",
      index: fixtureStoryPlotIndex()
    });
    const created = await toolByName(tools, "create").execute(
      "create-story-plot-next",
      {
        kind: "story_plot",
        meta: { title: "北上线索", arc_id: "arc_one" },
        content: "继续追查旧信。",
        summary: "新建下一条故事情节"
      }
    );
    expect(storyPlotCreateOrder(created.details)).toBe(2);
  });
});
