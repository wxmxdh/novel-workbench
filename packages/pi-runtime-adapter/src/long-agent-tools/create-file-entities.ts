import {
  createEmptyLongMarkdownFileReference,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId,
  longStoryPlotBodyFileId,
  longStoryPlotFilePath,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId
} from "@deepwrite/contracts";
import { allocateStableId, maxOrder } from "./shared";
import {
  createChange,
  newLongFile,
  requireMeta,
  type LongCreateInput,
  type LongCreateResult
} from "./create-support";

export function createWorldbuildingItem(
  input: LongCreateInput
): LongCreateResult {
  const categoryId = requireMeta(input.meta.category_id, "category_id");
  const title = requireMeta(input.meta.title, "title");
  const category = input.index.worldbuilding.find(
    ({ id }) => id === categoryId
  );
  if (!category || category.format !== "list") {
    throw new Error("世界观条目只能建在已有的列表型分类下。");
  }
  const id = allocateStableId(input.index, "worlditem", input.idSeed);
  const file = newLongFile(
    longWorldbuildingItemFileId(id),
    longWorldbuildingItemContentPath(categoryId, id),
    input.timestamp,
    input.content
  );
  return {
    operations: [
      {
        type: "worldbuildingItem.create",
        categoryId,
        item: { id, title, order: category.items.length + 1, file }
      }
    ],
    changes: [
      createChange(
        {
          addressing: "document",
          kind: "worldbuilding_item",
          stage: "worldbuilding",
          id,
          categoryId,
          itemId: id,
          title: `${category.title} / ${title}`,
          file
        },
        file,
        input.content
      )
    ],
    createdId: id,
    label: `世界观条目《${title}》`
  };
}

export function createCharacter(input: LongCreateInput): LongCreateResult {
  const name = requireMeta(input.meta.name, "name");
  const typeId = requireMeta(input.meta.type_id, "type_id");
  if (!input.index.characterTypes.some(({ id }) => id === typeId)) {
    throw new Error(`人物类型 ${typeId} 不存在。`);
  }
  const id = allocateStableId(input.index, "character", input.idSeed);
  const coreProfile = newLongFile(
    longCharacterCoreProfileFileId(id),
    longCharacterFilePath(id, "core-profile.md"),
    input.timestamp,
    input.content
  );
  const blank = (fileId: string, filename: "relationships.md") =>
    createEmptyLongMarkdownFileReference(
      fileId,
      longCharacterFilePath(id, filename),
      input.timestamp
    );
  return {
    operations: [
      {
        type: "character.create",
        character: {
          id,
          name,
          group: typeId,
          order:
            maxOrder(
              input.index.characters
                .filter((character) => character.group === typeId)
                .map(({ order }) => order)
            ) + 1,
          aliases: input.meta.aliases ?? []
        },
        files: {
          characterId: id,
          coreProfile,
          relationships: blank(
            longCharacterRelationshipsFileId(id),
            "relationships.md"
          )
        }
      }
    ],
    changes: [
      createChange(
        {
          addressing: "document",
          kind: "character",
          stage: "character",
          id,
          document: "core_profile",
          characterId: id,
          characterName: name,
          title: `${name} / 核心档案`,
          file: coreProfile
        },
        coreProfile,
        input.content
      )
    ],
    createdId: id,
    label: `人物《${name}》`
  };
}

export function createChapterCard(input: LongCreateInput): LongCreateResult {
  const title = requireMeta(input.meta.title, "title");
  const volumeId = requireMeta(input.meta.volume_id, "volume_id");
  const id = allocateStableId(input.index, "chapter", input.idSeed);
  const card = newLongFile(
    longChapterCardFileId(id),
    longChapterFilePath(id, "card.md"),
    input.timestamp,
    input.content
  );
  const blank = (fileId: string, path: string) =>
    createEmptyLongMarkdownFileReference(fileId, path, input.timestamp);
  return {
    operations: [
      {
        type: "chapter.create",
        chapterCard: {
          id,
          volumeId,
          primaryArcId: input.meta.primary_arc_id ?? null,
          title,
          narrativeOrder:
            maxOrder(
              input.index.plot.chapterCards
                .filter((chapter) => chapter.volumeId === volumeId)
                .map(({ narrativeOrder }) => narrativeOrder)
            ) + 1
        },
        files: {
          chapterCardId: id,
          bodyStatus: "empty",
          body: blank(
            longChapterBodyFileId(id),
            longChapterFilePath(id, "body.md")
          ),
          card,
          characterState: blank(
            longChapterCharacterStateFileId(id),
            longChapterFilePath(id, "character-state.md")
          ),
          handoff: blank(
            longChapterHandoffFileId(id),
            longChapterFilePath(id, "handoff.md")
          ),
          foreshadowingChanges: blank(
            longChapterForeshadowingChangesFileId(id),
            longChapterContinuityFilePath(id, "foreshadowing-changes.md")
          ),
          worldReveals: null,
          characterContinuity: [],
          commitId: null
        }
      }
    ],
    changes: [
      createChange(
        {
          addressing: "document",
          kind: "chapter_card",
          stage: "plot",
          id,
          document: "card",
          chapterTitle: title,
          title: `${title} / 章卡`,
          file: card
        },
        card,
        input.content
      )
    ],
    createdId: id,
    label: `章卡《${title}》`
  };
}

export function createStoryPlot(input: LongCreateInput): LongCreateResult {
  const title = requireMeta(input.meta.title, "title");
  const arcId = requireMeta(input.meta.arc_id, "arc_id");
  const id = allocateStableId(input.index, "storyplot", input.idSeed);
  const file = newLongFile(
    longStoryPlotBodyFileId(id),
    longStoryPlotFilePath(id),
    input.timestamp,
    input.content
  );
  return {
    operations: [
      {
        type: "storyPlot.create",
        storyPlot: {
          id,
          arcId,
          title,
          order:
            maxOrder(
              input.index.plot.storyPlots
                .filter((storyPlot) => storyPlot.arcId === arcId)
                .map(({ order }) => order)
            ) + 1,
          file
        }
      }
    ],
    changes: [
      createChange(
        {
          addressing: "document",
          kind: "story_plot",
          stage: "plot",
          id,
          title,
          file
        },
        file,
        input.content
      )
    ],
    createdId: id,
    label: `故事情节《${title}》`
  };
}
