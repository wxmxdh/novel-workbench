import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";

const LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE = 50;

export function renderLongWorldbuildingScopeDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const categories = [...navigation.worldbuilding].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  return categories.length
    ? categories
        .map(
          (category) =>
            `- ${category.title}（category_id=${category.id}；类型=${category.format === "text" ? "文本" : "条目列表"}）`
        )
        .join("\n")
    : "- 暂无世界观分类";
}

export function renderLongCharacterTypeDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const types = [...navigation.characterTypes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  return types.length
    ? types
        .map((type) => {
          const count = navigation.characters.filter(
            ({ group }) => group === type.id
          ).length;
          return `- ${type.title}（type_id=${type.id}；共 ${count} 人）`;
        })
        .join("\n")
    : "- 暂无人物类型";
}

export function renderLongWorldbuildingDirectory(
  directory: LongWorkspaceRuntimeContext["worldbuildingDirectory"],
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const categories = directory?.categories ?? [];
  const lines = categories.flatMap((category) => {
    if (category.format === "text") {
      return [
        `- ${category.title}（category_id=${category.categoryId}；类型=文本）`
      ];
    }
    const header = `- ${category.title}（category_id=${category.categoryId}；类型=条目列表；共 ${category.itemCount} 项）`;
    const items = category.items.length
      ? category.items.map(
          (item) =>
            `  - ${item.title}（item_id=${item.itemId}；顺序=${item.order}）`
        )
      : ["  - 暂无条目"];
    if (category.omittedItemCount > 0) {
      items.push(
        `  - 另有 ${category.omittedItemCount} 项未进入固定上下文，需要时调用 list（stage=worldbuilding, scope_id=${category.categoryId}）查询。`
      );
    }
    return [header, ...items];
  });
  const includedCategoryIds = new Set(
    categories.map(({ categoryId }) => categoryId)
  );
  const omittedCategories = navigation.worldbuilding
    .filter(({ id }) => !includedCategoryIds.has(id))
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id)
    );
  for (const category of omittedCategories) {
    lines.push(
      `- ${category.title}（category_id=${category.id}；类型=${category.format === "text" ? "文本" : "条目列表"}；二层内容未注入，需要时调用 list（stage=worldbuilding, scope_id=${category.id}））`
    );
  }
  return lines.length ? lines.join("\n") : "- 暂无世界观分类";
}

export function renderLongCharacterDirectory(
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  const types = [...navigation.characterTypes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const knownTypeIds = new Set(types.map((characterType) => characterType.id));
  const extraGroups = [
    ...new Set(
      navigation.characters
        .map((character) => character.group)
        .filter((group) => !knownTypeIds.has(group))
    )
  ].sort((left, right) => left.localeCompare(right));
  const sections = [
    ...types.map((characterType) => ({
      typeId: characterType.id,
      title: characterType.title
    })),
    ...extraGroups.map((group) => ({
      typeId: group,
      title: group
    }))
  ];
  const lines = sections.flatMap((section) => {
    const characters = navigation.characters
      .filter((character) => character.group === section.typeId)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    const visible = characters.slice(
      0,
      LONG_CHARACTER_DIRECTORY_LIMIT_PER_TYPE
    );
    const header = `- ${section.title}（type_id=${section.typeId}；共 ${characters.length} 人）`;
    const items = visible.length
      ? visible.map(
          (character) =>
            `  - ${character.name}（id=${character.id}；顺序=${character.order}）`
        )
      : ["  - 暂无条目"];
    const omitted = characters.length - visible.length;
    if (omitted > 0) {
      items.push(
        `  - 另有 ${omitted} 人未进入固定上下文，需要时调用 list（stage=character, scope_id=${section.typeId}）查询。`
      );
    }
    return [header, ...items];
  });
  return lines.length ? lines.join("\n") : "- 暂无人物类型";
}

function renderLongWorldbuildingStageBrief(
  focus: NonNullable<LongWorkspaceRuntimeContext["worldbuildingFocus"]>,
  directory: LongWorkspaceRuntimeContext["worldbuildingDirectory"]
): string {
  const category = directory?.categories.find(
    (entry) => entry.title === focus.categoryTitle
  );
  const categoryId = category?.categoryId;
  const itemId =
    focus.currentStage.kind === "item" && category?.format === "list"
      ? category.items.find((item) => item.title === focus.currentStage.title)
          ?.itemId
      : undefined;
  const ids = [
    categoryId ? `category_id=${categoryId}` : "",
    itemId ? `item_id=${itemId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  const location =
    focus.format === "list"
      ? `列表型分类「${focus.categoryTitle}」${
          focus.currentStage.kind === "item"
            ? ` / 条目「${focus.currentStage.title}」`
            : " / 分类概览"
        }${ids ? `（${ids}）` : ""}`
      : `文本型分类「${focus.categoryTitle}」${
          categoryId ? `（category_id=${categoryId}）` : ""
        }`;
  const readId = itemId ?? categoryId;
  return [
    `当前用户所处的世界观阶段: ${location}`,
    `当前阶段简要信息: 仅定位当前页面，正文未注入；需要时调用 read${
      readId ? `（id=${readId}）` : ""
    }读取。`
  ].join("\n");
}

function renderLongCharacterStageBrief(
  focus: NonNullable<LongWorkspaceRuntimeContext["characterFocus"]>,
  navigation: LongWorkspaceRuntimeContext["navigation"]
): string {
  if (focus.currentDocument.kind === "overview") {
    return [
      "当前用户所处的人物阶段: 人物概览",
      "当前阶段简要信息: 仅定位人物概览，正文未注入；需要时调用 read（id=character_overview）读取。"
    ].join("\n");
  }
  const character = navigation.characters.find(
    (entry) =>
      entry.name === focus.characterName &&
      (focus.group === undefined || entry.group === focus.group)
  );
  const characterId = character?.id;
  const typeId = focus.group ?? character?.group;
  const ids = [
    characterId ? `id=${characterId}` : "",
    `document=${focus.currentDocument.kind}`,
    typeId ? `type_id=${typeId}` : ""
  ]
    .filter(Boolean)
    .join("；");
  return [
    `当前用户所处的人物阶段: 「${focus.characterName}」 / ${focus.currentDocument.title}${
      ids ? `（${ids}）` : ""
    }`,
    `当前阶段简要信息: 仅定位当前人物文档，正文未注入；需要时调用 read${
      characterId
        ? `（id=${characterId}, document=${focus.currentDocument.kind}）`
        : ""
    }读取。`
  ].join("\n");
}

export function renderLongCurrentStageSection(
  worldbuildingFocus: LongWorkspaceRuntimeContext["worldbuildingFocus"],
  characterFocus: LongWorkspaceRuntimeContext["characterFocus"],
  longWorkspace: LongWorkspaceRuntimeContext | undefined
): string {
  const parts = [
    worldbuildingFocus
      ? renderLongWorldbuildingStageBrief(
          worldbuildingFocus,
          longWorkspace?.worldbuildingDirectory
        )
      : "",
    characterFocus && longWorkspace
      ? renderLongCharacterStageBrief(characterFocus, longWorkspace.navigation)
      : ""
  ].filter(Boolean);
  return parts.length ? `【当前阶段信息与要求】\n${parts.join("\n")}` : "";
}
