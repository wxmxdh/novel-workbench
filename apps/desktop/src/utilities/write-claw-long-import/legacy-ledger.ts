import { list, record, stringValue } from "./normalize";

export function legacyChapterLocatorMatches(
  row: Record<string, unknown>,
  legacyCardId: string,
  stageId: string
): boolean {
  const rowStage = stringValue(row.chapter_stage_id).trim();
  const rowCard = stringValue(row.chapter_card_id).trim();
  return (
    Boolean(rowStage || rowCard) &&
    (!rowStage || rowStage === stageId) &&
    (!rowCard || rowCard === legacyCardId)
  );
}

export function legacyLedgerChapterSummary(
  workspace: Record<string, unknown>,
  legacyCardId: string,
  stageId: string
) {
  const ledger = record(workspace.ledger);
  const keys = [
    "timeline",
    "character_states",
    "faction_states",
    "realm_states",
    "foreshadowing_states",
    "continuity_notes"
  ] as const;
  const values = Object.fromEntries(
    keys.map((key) => {
      const lines = list(ledger[key]).flatMap((raw) => {
        const row = typeof raw === "string" ? { content: raw } : record(raw);
        if (!legacyChapterLocatorMatches(row, legacyCardId, stageId)) {
          return [];
        }
        const content = stringValue(
          row.content ?? row.description ?? row.detail ?? row.state ?? row.note
        ).trim();
        return content ? [content] : [];
      });
      for (const rawChange of list(ledger.chapter_changes)) {
        const change = record(rawChange);
        if (!legacyChapterLocatorMatches(change, legacyCardId, stageId)) {
          continue;
        }
        const content = stringValue(record(change.text)[key]).trim();
        if (content && content !== "本章无变化") lines.push(content);
      }
      return [key, lines.join("\n") || "旧版未提供本项摘要。"];
    })
  ) as Record<(typeof keys)[number], string>;
  return {
    timeline: values.timeline,
    characterStates: values.character_states,
    factionStates: values.faction_states,
    realmStates: values.realm_states,
    foreshadowingStates: values.foreshadowing_states,
    continuityNotes: values.continuity_notes
  };
}

export function hasLegacyTimelineAudit(
  workspace: Record<string, unknown>,
  legacyCardId: string,
  stageId: string,
  legacyCommitId: string
): boolean {
  return list(record(workspace.ledger).timeline).some((raw) => {
    const row = typeof raw === "string" ? { content: raw } : record(raw);
    const rowCommitId = stringValue(row.commit_id).trim();
    return (
      Boolean(
        stringValue(
          row.content ?? row.description ?? row.detail ?? row.note
        ).trim()
      ) &&
      legacyChapterLocatorMatches(row, legacyCardId, stageId) &&
      rowCommitId === legacyCommitId
    );
  });
}

export function appendLegacyLedgerText(
  workspace: Record<string, unknown>,
  legacyCardId: string,
  stageId: string,
  currentText: string
): string {
  const ledger = record(workspace.ledger);
  const sections: string[] = [];
  const buckets = [
    ["timeline", "时间线"],
    ["character_states", "人物状态"],
    ["faction_states", "势力状态"],
    ["realm_states", "境界状态"],
    ["foreshadowing_states", "伏笔状态"],
    ["continuity_notes", "连续性记录"]
  ] as const;
  for (const [key, label] of buckets) {
    const lines = list(ledger[key]).flatMap((raw) => {
      const row = typeof raw === "string" ? { content: raw } : record(raw);
      if (!legacyChapterLocatorMatches(row, legacyCardId, stageId)) {
        return [];
      }
      const content = stringValue(
        row.content ?? row.description ?? row.detail ?? row.state ?? row.note
      ).trim();
      return content ? [content] : [];
    });
    if (lines.length > 0) {
      sections.push(`### ${label}\n\n${lines.join("\n")}`);
    }
  }
  for (const rawChange of list(ledger.chapter_changes)) {
    const change = record(rawChange);
    if (!legacyChapterLocatorMatches(change, legacyCardId, stageId)) {
      continue;
    }
    const text = record(change.text);
    for (const [key, label] of buckets) {
      const content = stringValue(text[key]).trim();
      if (content && content !== "本章无变化") {
        sections.push(`### ${label}\n\n${content}`);
      }
    }
  }
  const plot = record(workspace.plot);
  const placementChapterById = new Map<string, string>();
  const placementDecisionLines = list(plot.narrative_placements).flatMap(
    (rawPlacement) => {
      const placement = record(rawPlacement);
      const id = stringValue(placement.id).trim();
      const chapterCardId = stringValue(placement.chapter_card_id).trim();
      if (id) placementChapterById.set(id, chapterCardId);
      if (chapterCardId !== legacyCardId) return [];
      const status = stringValue(
        placement.execution_status ?? placement.status
      ).trim();
      if (
        status !== "committed" &&
        status !== "missed" &&
        status !== "completed" &&
        status !== "executed"
      ) {
        return [];
      }
      const note = stringValue(placement.note ?? placement.writing_prompt)
        .trim()
        .slice(0, 4_000);
      return [
        `- placement_id=${id || "unknown"}；旧状态=${status}${
          note ? `；证据/说明=${note}` : ""
        }`
      ];
    }
  );
  if (placementDecisionLines.length > 0) {
    sections.push(
      `### 旧版叙事落点执行判定（迁移证据）\n\n${placementDecisionLines.join("\n")}`
    );
  }

  const beatDecisionLines = list(plot.foreshadowing).flatMap((rawThread) => {
    const thread = record(rawThread);
    const threadId = stringValue(thread.id).trim();
    return list(thread.beats).flatMap((rawBeat) => {
      const beat = record(rawBeat);
      const placementId = stringValue(beat.placement_id).trim();
      const chapterCardId =
        stringValue(beat.chapter_card_id).trim() ||
        placementChapterById.get(placementId) ||
        "";
      if (chapterCardId !== legacyCardId) return [];
      const status = stringValue(beat.status ?? beat.execution_status).trim();
      if (
        status !== "committed" &&
        status !== "missed" &&
        status !== "completed" &&
        status !== "executed"
      ) {
        return [];
      }
      const note = stringValue(
        beat.note ?? beat.intended_knowledge ?? beat.target_scope
      )
        .trim()
        .slice(0, 4_000);
      return [
        `- foreshadowing_id=${threadId || "unknown"}；beat_id=${
          stringValue(beat.id).trim() || "unknown"
        }；旧状态=${status}${note ? `；证据/说明=${note}` : ""}`
      ];
    });
  });
  if (beatDecisionLines.length > 0) {
    sections.push(
      `### 旧版伏笔节拍执行判定（迁移证据）\n\n${beatDecisionLines.join("\n")}`
    );
  }

  if (sections.length === 0) return currentText;
  return [
    currentText.trimEnd(),
    "## 旧版状态账本（待重新提交）",
    sections.join("\n\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}
