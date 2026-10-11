import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { orderedLongChapterCards } from "./chapter-ordering";
import { longEntityKindForId } from "./entity-registry";
import {
  beatTypeLabel,
  bodyStatusLabel,
  chapterTitle,
  connectionTypeLabel,
  countLine,
  disclosureLabel,
  eventTitle,
  executionStatusLabel,
  foreshadowingStatusLabel,
  leafScope,
  listScopeHeader,
  narrativeModeLabel,
  nextReadLine,
  nextStepLine,
  resolvedBeatChapterId,
  unknownScope,
  wrongStage
} from "./list-shared";

function eventLine(
  event: LongWorkspaceIndexSnapshot["plot"]["storyEvents"][number]
): string {
  const details = [
    event.timeLabel ? `时间：${event.timeLabel}` : "",
    event.location ? `地点：${event.location}` : "",
    event.arcIds.length ? `剧情点：${event.arcIds.join("、")}` : "",
    event.characterIds.length ? `人物：${event.characterIds.join("、")}` : ""
  ].filter(Boolean);
  return `- ${event.id} ${event.title}${details.length ? `（${details.join("；")}）` : ""}`;
}

function bookLineScopeLines(index: LongWorkspaceIndexSnapshot): string[] {
  const events = [...index.plot.storyEvents].sort(
    (left, right) =>
      left.storyOrder - right.storyOrder || left.id.localeCompare(right.id)
  );
  const threads = index.plot.foreshadowing;
  return [
    listScopeHeader("plot", "全书故事线", "book_line"),
    "- book_line 全书故事线（可读取正文）",
    countLine(events.length, "个故事事件"),
    ...events.map(eventLine),
    countLine(threads.length, "条伏笔线"),
    ...threads.map(
      (thread) =>
        `- ${thread.id} ${thread.title}（${foreshadowingStatusLabel(thread.status)}${
          thread.plannedSpan ? `；跨度：${thread.plannedSpan}` : ""
        }；触点：${thread.beats.length}）`
    ),
    `关系摘要：事件连接 ${index.plot.eventConnections.length} 条，叙事落点 ${index.plot.narrativePlacements.length} 个。`,
    nextReadLine(
      "read(id=book_line)，或继续 list(stage=plot, scope_id=<event_id|foreshadowing_id>)"
    )
  ];
}

function beatVolumeIds(
  index: LongWorkspaceIndexSnapshot,
  beat: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]["beats"][number]
): Set<string> {
  const ids = new Set<string>();
  if (beat.volumeId) ids.add(beat.volumeId);
  if (beat.arcId) {
    const volumeId = index.plot.arcs.find(
      ({ id }) => id === beat.arcId
    )?.volumeId;
    if (volumeId) ids.add(volumeId);
  }
  if (beat.eventId) {
    const event = index.plot.storyEvents.find(({ id }) => id === beat.eventId);
    for (const arcId of event?.arcIds ?? []) {
      const volumeId = index.plot.arcs.find(({ id }) => id === arcId)?.volumeId;
      if (volumeId) ids.add(volumeId);
    }
  }
  const chapterId = resolvedBeatChapterId(index, beat);
  const chapter = index.plot.chapterCards.find(({ id }) => id === chapterId);
  if (chapter) ids.add(chapter.volumeId);
  return ids;
}

function volumeScopeLines(
  index: LongWorkspaceIndexSnapshot,
  volume: LongWorkspaceIndexSnapshot["plot"]["volumes"][number]
): string[] {
  const arcs = index.plot.arcs
    .filter(({ volumeId }) => volumeId === volume.id)
    .sort((left, right) => left.order - right.order);
  const arcIds = new Set(arcs.map(({ id }) => id));
  const chapters = orderedLongChapterCards(index).filter(
    ({ volumeId }) => volumeId === volume.id
  );
  const chapterIds = new Set(chapters.map(({ id }) => id));
  const events = index.plot.storyEvents.filter(
    (event) =>
      event.arcIds.some((id) => arcIds.has(id)) ||
      index.plot.narrativePlacements.some(
        (placement) =>
          placement.eventId === event.id &&
          chapterIds.has(placement.chapterCardId)
      )
  );
  const threads = index.plot.foreshadowing.filter((thread) =>
    thread.beats.some((beat) => beatVolumeIds(index, beat).has(volume.id))
  );
  return [
    listScopeHeader("plot", volume.title, volume.id),
    countLine(arcs.length, "个剧情点"),
    ...arcs.map((arc) => {
      const storyPlots = index.plot.storyPlots.filter(
        ({ arcId }) => arcId === arc.id
      ).length;
      const chapterCount = chapters.filter(
        ({ primaryArcId }) => primaryArcId === arc.id
      ).length;
      return `- ${arc.id} ${arc.title}（故事情节：${storyPlots}；主线章卡：${chapterCount}）`;
    }),
    countLine(chapters.length, "张章卡"),
    ...chapters.map((chapter) => {
      const files = index.chapters.find(
        ({ chapterCardId }) => chapterCardId === chapter.id
      );
      return `- ${chapter.id} ${chapter.title}（主剧情点：${chapter.primaryArcId ?? "未关联"}；正文：${bodyStatusLabel(files?.bodyStatus ?? "empty")}）`;
    }),
    `关系摘要：相关故事事件 ${events.length} 个，相关伏笔线 ${threads.length} 条。`,
    nextStepLine(
      "剧情点或章卡可继续 list(stage=plot, scope_id=<arc_id|chapter_id>)；故事情节是叶子，使用 read，不要再 list"
    )
  ];
}

function arcScopeLines(
  index: LongWorkspaceIndexSnapshot,
  arc: LongWorkspaceIndexSnapshot["plot"]["arcs"][number]
): string[] {
  const storyPlots = index.plot.storyPlots
    .filter(({ arcId }) => arcId === arc.id)
    .sort((left, right) => left.order - right.order);
  const chapters = orderedLongChapterCards(index).filter(
    ({ primaryArcId }) => primaryArcId === arc.id
  );
  const events = index.plot.storyEvents
    .filter(({ arcIds }) => arcIds.includes(arc.id))
    .sort((left, right) => left.storyOrder - right.storyOrder);
  return [
    listScopeHeader("plot", arc.title, arc.id),
    countLine(storyPlots.length, "条故事情节"),
    ...storyPlots.map((item) => `- ${item.id} ${item.title}`),
    countLine(chapters.length, "张主线章卡"),
    ...chapters.map((chapter) => `- ${chapter.id} ${chapter.title}`),
    countLine(events.length, "个故事事件"),
    ...events.map(eventLine),
    nextStepLine(
      "剧情点概要用 read(id=<arc_id>)，不要把概要写成故事情节；故事情节 storyplot_* 是叶子，使用 read(id=<storyplot_id>)；章卡或事件可继续 list(stage=plot, scope_id=<chapter_id|event_id>)"
    )
  ];
}

function chapterScopeLines(
  index: LongWorkspaceIndexSnapshot,
  chapter: LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number]
): string[] {
  const placements = index.plot.narrativePlacements
    .filter(({ chapterCardId }) => chapterCardId === chapter.id)
    .sort((left, right) => left.orderInChapter - right.orderInChapter);
  const beats = index.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter((beat) => resolvedBeatChapterId(index, beat) === chapter.id)
      .map((beat) => ({ beat, thread }))
  );
  return [
    listScopeHeader("plot", chapter.title, chapter.id),
    `定位：分卷 ${chapter.volumeId}；主剧情点 ${chapter.primaryArcId ?? "未关联"}。`,
    countLine(placements.length, "个叙事落点"),
    ...placements.map(
      (placement) =>
        `- ${placement.id} ${eventTitle(index, placement.eventId)}（顺序：${placement.orderInChapter}；${narrativeModeLabel(placement.mode)}；${disclosureLabel(placement.disclosure)}；${executionStatusLabel(placement.status)}）`
    ),
    countLine(beats.length, "个伏笔触点"),
    ...beats.map(
      ({ beat, thread }) =>
        `- ${beat.id} ${thread.title}（伏笔线：${thread.id}；${beatTypeLabel(beat.type)}；${executionStatusLabel(beat.status)}）`
    ),
    nextReadLine(`read(id=${chapter.id}, document=card)`)
  ];
}

function eventScopeLines(
  index: LongWorkspaceIndexSnapshot,
  event: LongWorkspaceIndexSnapshot["plot"]["storyEvents"][number]
): string[] {
  const connections = index.plot.eventConnections.filter(
    ({ sourceEventId, targetEventId }) =>
      sourceEventId === event.id || targetEventId === event.id
  );
  const placements = index.plot.narrativePlacements.filter(
    ({ eventId }) => eventId === event.id
  );
  const beats = index.plot.foreshadowing.flatMap((thread) =>
    thread.beats
      .filter(
        ({ eventId, placementId }) =>
          eventId === event.id ||
          (placementId
            ? placements.some(({ id }) => id === placementId)
            : false)
      )
      .map((beat) => ({ beat, thread }))
  );
  return [
    listScopeHeader("plot", event.title, event.id),
    eventLine(event).slice(2),
    countLine(connections.length, "条事件连接"),
    ...connections.map((connection) => {
      const direction = connection.sourceEventId === event.id ? "出边" : "入边";
      return `- ${connection.id} ${direction}：${eventTitle(index, connection.sourceEventId)} → ${eventTitle(index, connection.targetEventId)}（${connectionTypeLabel(connection.type)}）`;
    }),
    countLine(placements.length, "个叙事落点"),
    ...placements.map(
      (placement) =>
        `- ${placement.id} ${chapterTitle(index, placement.chapterCardId)}（章卡：${placement.chapterCardId}；${executionStatusLabel(placement.status)}）`
    ),
    countLine(beats.length, "个伏笔触点"),
    ...beats.map(
      ({ beat, thread }) =>
        `- ${beat.id} ${thread.title}（伏笔线：${thread.id}；${beatTypeLabel(beat.type)}）`
    ),
    nextReadLine(`read(id=${event.id})`)
  ];
}

function foreshadowingScopeLines(
  index: LongWorkspaceIndexSnapshot,
  thread: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]
): string[] {
  const beats = [...thread.beats].sort(
    (left, right) => left.order - right.order
  );
  return [
    listScopeHeader("plot", thread.title, thread.id),
    `状态：${foreshadowingStatusLabel(thread.status)}${thread.plannedSpan ? `；计划跨度：${thread.plannedSpan}` : ""}。`,
    countLine(beats.length, "个伏笔触点"),
    ...beats.map((beat) => {
      const anchors = [
        beat.volumeId ? `卷：${beat.volumeId}` : "",
        beat.arcId ? `剧情点：${beat.arcId}` : "",
        beat.eventId ? `事件：${beat.eventId}` : "",
        beat.placementId ? `落点：${beat.placementId}` : "",
        resolvedBeatChapterId(index, beat)
          ? `章卡：${resolvedBeatChapterId(index, beat)}`
          : "",
        beat.plannedScope ? `计划范围：${beat.plannedScope}` : ""
      ].filter(Boolean);
      return `- ${beat.id} ${beatTypeLabel(beat.type)}（${executionStatusLabel(beat.status)}${anchors.length ? `；${anchors.join("；")}` : ""}）`;
    }),
    nextReadLine(`read(id=${thread.id})`)
  ];
}

export function plotScopeLines(
  index: LongWorkspaceIndexSnapshot,
  scopeId: string
): string[] {
  if (scopeId === "book_line") return bookLineScopeLines(index);
  const volume = index.plot.volumes.find(({ id }) => id === scopeId);
  if (volume) return volumeScopeLines(index, volume);
  const arc = index.plot.arcs.find(({ id }) => id === scopeId);
  if (arc) return arcScopeLines(index, arc);
  const chapter = index.plot.chapterCards.find(({ id }) => id === scopeId);
  if (chapter) return chapterScopeLines(index, chapter);
  const event = index.plot.storyEvents.find(({ id }) => id === scopeId);
  if (event) return eventScopeLines(index, event);
  const thread = index.plot.foreshadowing.find(({ id }) => id === scopeId);
  if (thread) return foreshadowingScopeLines(index, thread);

  const kind = longEntityKindForId(scopeId);
  if (
    kind === "story_plot" ||
    kind === "event_connection" ||
    kind === "narrative_placement" ||
    kind === "foreshadowing_beat"
  ) {
    leafScope(scopeId, `read(id=${scopeId})`);
  }
  if (kind === "worldbuilding_category" || kind === "worldbuilding_item") {
    wrongStage(scopeId, "worldbuilding");
  }
  if (kind === "character" || kind === "character_overview") {
    wrongStage(scopeId, "character");
  }
  unknownScope(scopeId);
}
