import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import {
  countLine,
  leafScope,
  listScopeHeader,
  nextReadLine,
  unknownScope,
  wrongStage
} from "./list-shared";
import { longEntityKindForId } from "./entity-registry";

export function worldbuildingScopeLines(
  index: LongWorkspaceIndexSnapshot,
  scopeId: string
): string[] {
  const category = index.worldbuilding.find(({ id }) => id === scopeId);
  if (category) {
    if (category.format === "text") {
      return [
        listScopeHeader("worldbuilding", category.title, category.id),
        "共 0 项：该分类是整篇文本，没有结构化子条目。",
        nextReadLine(`read(id=${category.id})`)
      ];
    }
    const items = [...category.items].sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
    return [
      listScopeHeader("worldbuilding", category.title, category.id),
      countLine(items.length, "项"),
      ...items.map((item) => `- ${item.id} ${item.title}`),
      nextReadLine("read(id=<worlditem_id>)")
    ];
  }
  if (
    index.worldbuilding.some(
      (candidate) =>
        candidate.format === "list" &&
        candidate.items.some(({ id }) => id === scopeId)
    )
  ) {
    leafScope(scopeId, `read(id=${scopeId})`);
  }
  const kind = longEntityKindForId(scopeId);
  if (kind === "worldbuilding_category" || kind === "worldbuilding_item") {
    unknownScope(scopeId);
  }
  if (kind) {
    wrongStage(
      scopeId,
      kind === "character" || kind === "character_overview"
        ? "character"
        : "plot"
    );
  }
  unknownScope(scopeId);
}

export function characterScopeLines(
  index: LongWorkspaceIndexSnapshot,
  scopeId: string
): string[] {
  const type = index.characterTypes.find(({ id }) => id === scopeId);
  if (type) {
    const members = index.characters
      .filter(({ group }) => group === type.id)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    return [
      listScopeHeader("character", type.title, type.id),
      countLine(members.length, "人"),
      ...members.map((character) => {
        const aliases = character.aliases.length
          ? `（别名：${character.aliases.join("、")}）`
          : "";
        return `- ${character.id} ${character.name}${aliases}`;
      }),
      nextReadLine("read(id=<人物 id>, document=<人物文档>)")
    ];
  }
  if (scopeId === "character_overview") {
    leafScope(scopeId, "read(id=character_overview)");
  }
  if (index.characters.some(({ id }) => id === scopeId)) {
    leafScope(scopeId, `read(id=${scopeId}, document=<人物文档>)`);
  }
  const kind = longEntityKindForId(scopeId);
  if (kind === "character" || kind === "character_overview") {
    unknownScope(scopeId);
  }
  if (kind) {
    wrongStage(
      scopeId,
      kind === "worldbuilding_category" || kind === "worldbuilding_item"
        ? "worldbuilding"
        : "plot"
    );
  }
  unknownScope(scopeId);
}
