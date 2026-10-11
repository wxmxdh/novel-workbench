import { longStoryPlotBodyFileId } from "./index";
import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  describe,
  expect,
  file,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

function storyPlotFile(id: string) {
  return file(
    longStoryPlotBodyFileId(id),
    `long/story-plots/${id}/body.md`,
    later
  );
}

function createStoryPlot(
  id: string,
  arcId: string,
  title: string,
  order: number
) {
  return {
    type: "storyPlot.create" as const,
    storyPlot: {
      id,
      arcId,
      title,
      order,
      file: storyPlotFile(id)
    }
  };
}

describe("long workspace ordered creates", () => {
  it("appends a story plot even when the baked order collides or leaves a gap", () => {
    const source = workspace();
    source.plot.arcs.push({
      id: "arc_other",
      volumeId: "volume_one",
      title: "另一条线",
      order: 2,
      outline: ""
    });
    for (let index = 0; index < 16; index += 1) {
      const id = `storyplot_existing_${index + 1}`;
      source.plot.storyPlots.push({
        id,
        arcId: "arc_other",
        title: `既有情节 ${index + 1}`,
        order: index + 1,
        file: storyPlotFile(id)
      });
    }
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);

    const created = applyLongWorkspaceOperations(
      parsed,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          createStoryPlot("storyplot_new", "arc_letter", "新情节", 17)
        ]
      })
    );

    expect(
      created.snapshot.plot.storyPlots.filter(
        ({ arcId }) => arcId === "arc_letter"
      )
    ).toEqual([
      expect.objectContaining({
        id: "storyplot_new",
        order: 1
      })
    ]);
    expect(
      created.snapshot.plot.storyPlots.filter(
        ({ arcId }) => arcId === "arc_other"
      )
    ).toHaveLength(16);
  });

  it("assigns contiguous orders when two story-plot creates bake the same order", () => {
    const source = workspace();
    const created = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          createStoryPlot("storyplot_one", "arc_letter", "节一", 1),
          createStoryPlot("storyplot_two", "arc_letter", "节二", 1)
        ]
      })
    );

    expect(
      [...created.snapshot.plot.storyPlots]
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "storyplot_one", order: 1 },
      { id: "storyplot_two", order: 2 }
    ]);
  });

  it("appends after existing plots in the same arc instead of inserting at order 1", () => {
    const source = workspace();
    source.plot.storyPlots.push(
      {
        id: "storyplot_a",
        arcId: "arc_letter",
        title: "一",
        order: 1,
        file: storyPlotFile("storyplot_a")
      },
      {
        id: "storyplot_b",
        arcId: "arc_letter",
        title: "二",
        order: 2,
        file: storyPlotFile("storyplot_b")
      },
      {
        id: "storyplot_c",
        arcId: "arc_letter",
        title: "三",
        order: 3,
        file: storyPlotFile("storyplot_c")
      }
    );
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const created = applyLongWorkspaceOperations(
      parsed,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [createStoryPlot("storyplot_d", "arc_letter", "四", 1)]
      })
    );

    expect(
      [...created.snapshot.plot.storyPlots]
        .filter(({ arcId }) => arcId === "arc_letter")
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "storyplot_a", order: 1 },
      { id: "storyplot_b", order: 2 },
      { id: "storyplot_c", order: 3 },
      { id: "storyplot_d", order: 4 }
    ]);
  });

  it("compacts remaining story-plot orders after deleting a middle entry", () => {
    const source = workspace();
    source.plot.storyPlots.push(
      {
        id: "storyplot_a",
        arcId: "arc_letter",
        title: "一",
        order: 1,
        file: storyPlotFile("storyplot_a")
      },
      {
        id: "storyplot_b",
        arcId: "arc_letter",
        title: "二",
        order: 2,
        file: storyPlotFile("storyplot_b")
      },
      {
        id: "storyplot_c",
        arcId: "arc_letter",
        title: "三",
        order: 3,
        file: storyPlotFile("storyplot_c")
      }
    );
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const deleteBatch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "storyPlot.delete", id: "storyplot_b" }]
    });
    const deletePreview = previewLongWorkspaceOperations(parsed, deleteBatch);
    const deleted = applyLongWorkspaceOperations(parsed, {
      ...deleteBatch,
      expectedImpact: deletePreview.confirmation
    });

    expect(
      [...deleted.snapshot.plot.storyPlots]
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "storyplot_a", order: 1 },
      { id: "storyplot_c", order: 2 }
    ]);
  });

  it("applies sequential story-plot batches that both baked the same next order", () => {
    const source = workspace();
    const first = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [createStoryPlot("storyplot_one", "arc_letter", "节一", 1)]
      })
    );
    const second = applyLongWorkspaceOperations(
      first.snapshot,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [createStoryPlot("storyplot_two", "arc_letter", "节二", 1)]
      })
    );

    expect(
      [...second.snapshot.plot.storyPlots]
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "storyplot_one", order: 1 },
      { id: "storyplot_two", order: 2 }
    ]);
  });

  it("appends volumes, arcs, and events instead of inserting at a stale baked order", () => {
    const source = workspace();
    source.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const created = applyLongWorkspaceOperations(
      parsed,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "volume.create",
            volume: {
              id: "volume_prologue",
              title: "序卷",
              order: 1,
              summary: ""
            }
          },
          {
            type: "arc.create",
            arc: {
              id: "arc_new",
              volumeId: "volume_one",
              title: "新剧情点",
              order: 1,
              outline: ""
            }
          },
          {
            type: "event.create",
            event: {
              id: "event_new",
              title: "新事件",
              summary: "",
              timeMode: "sequence",
              timeLabel: "",
              storyOrder: 1,
              location: "",
              arcIds: ["arc_letter"],
              characterIds: []
            }
          }
        ]
      })
    );

    expect(
      [...created.snapshot.plot.volumes]
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "volume_one", order: 1 },
      { id: "volume_two", order: 2 },
      { id: "volume_prologue", order: 3 }
    ]);
    expect(
      created.snapshot.plot.arcs
        .filter(({ volumeId }) => volumeId === "volume_one")
        .sort((left, right) => left.order - right.order)
        .map(({ id, order }) => ({ id, order }))
    ).toEqual([
      { id: "arc_letter", order: 1 },
      { id: "arc_new", order: 2 }
    ]);
    expect(
      [...created.snapshot.plot.storyEvents]
        .sort((left, right) => left.storyOrder - right.storyOrder)
        .map(({ id, storyOrder }) => ({ id, storyOrder }))
    ).toEqual([
      { id: "event_letter", storyOrder: 1 },
      { id: "event_new", storyOrder: 2 }
    ]);
  });
});
