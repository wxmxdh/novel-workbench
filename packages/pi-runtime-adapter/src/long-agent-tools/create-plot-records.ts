import { allocateStableId, maxOrder } from "./shared";
import {
  requireMeta,
  type LongCreateInput,
  type LongCreateResult
} from "./create-support";
import { parseForeshadowingBody } from "./entity-records";

/**
 * Plot entities that live only in the central index. Their body text goes into
 * the one field that carries prose; everything else stays minimal metadata.
 * A plot point's prose field is `summary`; `outline` stays empty so load-time
 * legacy migration cannot turn that summary into a story plot.
 */
export function createPlotRecord(input: LongCreateInput): LongCreateResult {
  const { index, meta, content, idSeed } = input;

  if (input.kind === "volume") {
    const title = requireMeta(meta.title, "title");
    const id = allocateStableId(index, "volume", idSeed);
    return {
      operations: [
        {
          type: "volume.create",
          volume: {
            id,
            title,
            order: maxOrder(index.plot.volumes.map(({ order }) => order)) + 1,
            summary: content
          }
        }
      ],
      changes: [],
      createdId: id,
      label: `分卷《${title}》`
    };
  }

  if (input.kind === "arc") {
    const title = requireMeta(meta.title, "title");
    const volumeId = requireMeta(meta.volume_id, "volume_id");
    const id = allocateStableId(index, "arc", idSeed);
    return {
      operations: [
        {
          type: "arc.create",
          arc: {
            id,
            volumeId,
            title,
            order:
              maxOrder(
                index.plot.arcs
                  .filter((arc) => arc.volumeId === volumeId)
                  .map(({ order }) => order)
              ) + 1,
            summary: content,
            outline: ""
          }
        }
      ],
      changes: [],
      createdId: id,
      label: `剧情点《${title}》`
    };
  }

  if (input.kind === "story_event") {
    const title = requireMeta(meta.title, "title");
    const id = allocateStableId(index, "event", idSeed);
    return {
      operations: [
        {
          type: "event.create",
          event: {
            id,
            title,
            summary: content,
            timeMode: meta.time_mode ?? "unknown",
            timeLabel: meta.time_label ?? "",
            storyOrder:
              maxOrder(
                index.plot.storyEvents.map(({ storyOrder }) => storyOrder)
              ) + 1,
            location: meta.location ?? "",
            arcIds: meta.arc_ids ?? [],
            characterIds: meta.character_ids ?? []
          }
        }
      ],
      changes: [],
      createdId: id,
      label: `故事事件《${title}》`
    };
  }

  if (input.kind === "event_connection") {
    const id = allocateStableId(index, "connection", idSeed);
    return {
      operations: [
        {
          type: "connection.create",
          connection: {
            id,
            sourceEventId: requireMeta(meta.source_event_id, "source_event_id"),
            targetEventId: requireMeta(meta.target_event_id, "target_event_id"),
            type: requireMeta(meta.type, "type") as "causes",
            note: content
          }
        }
      ],
      changes: [],
      createdId: id,
      label: "事件连接"
    };
  }

  if (input.kind === "narrative_placement") {
    const chapterCardId = requireMeta(meta.chapter_card_id, "chapter_card_id");
    const id = allocateStableId(index, "placement", idSeed);
    return {
      operations: [
        {
          type: "placement.create",
          placement: {
            id,
            eventId: requireMeta(meta.event_id, "event_id"),
            chapterCardId,
            orderInChapter:
              maxOrder(
                index.plot.narrativePlacements
                  .filter(
                    (placement) => placement.chapterCardId === chapterCardId
                  )
                  .map(({ orderInChapter }) => orderInChapter)
              ) + 1,
            mode: requireMeta(meta.mode, "mode") as "scene",
            disclosure: requireMeta(meta.disclosure, "disclosure") as "hint",
            writingPrompt: content,
            status: "planned",
            commitId: null
          }
        }
      ],
      changes: [],
      createdId: id,
      label: "叙事落点"
    };
  }

  if (input.kind === "foreshadowing") {
    const title = requireMeta(meta.title, "title");
    const id = allocateStableId(index, "foreshadow", idSeed);
    const sections = parseForeshadowingBody(content);
    return {
      operations: [
        {
          type: "foreshadowing.create",
          thread: {
            id,
            title,
            coreQuestion: sections.coreQuestion,
            hiddenTruth: sections.hiddenTruth,
            ...(meta.planned_span ? { plannedSpan: meta.planned_span } : {}),
            truthEventId: meta.truth_event_id ?? null,
            expectedReaderEffect: sections.expectedReaderEffect,
            status: "planned",
            beats: []
          }
        }
      ],
      changes: [],
      createdId: id,
      label: `伏笔线《${title}》`
    };
  }

  const threadId = requireMeta(meta.foreshadowing_id, "foreshadowing_id");
  const thread = index.plot.foreshadowing.find(({ id }) => id === threadId);
  if (!thread) throw new Error(`伏笔线 ${threadId} 不存在。`);
  const id = allocateStableId(index, "beat", idSeed);
  return {
    operations: [
      {
        type: "foreshadowingBeat.create",
        threadId,
        beat: {
          id,
          type: requireMeta(meta.type, "type") as "plant",
          order: maxOrder(thread.beats.map(({ order }) => order)) + 1,
          volumeId: meta.volume_id ?? null,
          arcId: meta.arc_id ?? null,
          eventId: meta.event_id ?? null,
          placementId: meta.placement_id ?? null,
          chapterCardId: meta.chapter_card_id ?? null,
          plannedScope: meta.planned_scope ?? "",
          note: content,
          status: "planned",
          commitId: null
        }
      }
    ],
    changes: [],
    createdId: id,
    label: `伏笔触点（${thread.title}）`
  };
}
