import {
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  clipped,
  list,
  record,
  safeUnicode,
  stringValue,
  title,
  type DeterministicIdRegistry,
  type WarningCollector
} from "./normalize";
import type { ImportDocumentBuilder } from "./plan-documents";

const MAX_WORLD_ITEM_TEXT = 1_000_000;
const MAX_WORLD_ITEMS_PER_CATEGORY = 10_000;
const MAX_STRUCTURAL_WORLD_CATEGORIES = 9_000;
// Leave room for up to 10,000 UTF-8 titles and list markers beneath the
// 32 MiB per-document store limit. Legacy values clipped by these budgets are
// retained verbatim in migration evidence.
const MAX_WORLD_LIST_CONTENT_CHARACTERS = 4 * 1024 * 1024;
const MAX_WORLD_TEXT_DOCUMENT_CHARACTERS = 7 * 1024 * 1024;
const WORLD_ITEM_MARKER_PREFIX = "<!-- deepwrite-world-item:";

const DEFAULT_WORLD_CATEGORIES = [
  ["rules", "规则"],
  ["factions", "势力"],
  ["geography", "地理"],
  ["history", "历史"],
  ["terminology", "术语"],
  ["realms", "境界"],
  ["items", "物品"]
] as const;

export function worldItemTitle(
  value: unknown,
  fallback: string,
  warnings: WarningCollector,
  label: string,
  sourcePath: string
): string {
  const normalized = title(value, fallback, warnings, label);
  const singleLine = normalized
    .replace(/\r\n?|\n/gu, " ")
    .replace(/[^\S\r\n]+/gu, " ")
    .trim();
  if (singleLine !== normalized) {
    warnings.add(
      `${label}包含换行或多余空白，结构标题已规范为单行；完整原值已写入迁移证据。`
    );
    warnings.preserveDecision(
      "coerce",
      sourcePath,
      "当前世界观条目标题必须为单行，已将换行规范为空格。",
      value
    );
  }
  return singleLine || fallback.slice(0, 256);
}

export function worldItemContent(
  value: unknown,
  warnings: WarningCollector,
  label: string,
  sourcePath: string,
  raw: unknown
): string {
  const normalized = safeUnicode(value, warnings, label);
  const escaped = normalized.includes(WORLD_ITEM_MARKER_PREFIX)
    ? normalized.replaceAll(
        WORLD_ITEM_MARKER_PREFIX,
        "<!-- deepwrite-world-item&#58;"
      )
    : normalized;
  if (escaped !== normalized) {
    warnings.add(
      `${label}包含当前格式的保留标记，结构正文已安全转义；完整原值已写入迁移证据。`
    );
    warnings.preserveDecision(
      "coerce",
      sourcePath,
      "世界观列表正文不能包含 DeepWrite 条目标记，已对标记冒号进行转义。",
      raw
    );
  }
  return clipped(escaped, MAX_WORLD_ITEM_TEXT, warnings, label);
}

export function buildImportedWorldbuilding(
  worldSource: Record<string, unknown>,
  ids: DeterministicIdRegistry,
  documents: ImportDocumentBuilder,
  warnings: WarningCollector
): LongWorkspaceIndexSnapshot["worldbuilding"] {
  let rawWorldCategories = list(worldSource.categories);
  if (rawWorldCategories.length > MAX_STRUCTURAL_WORLD_CATEGORIES) {
    warnings.add(
      `来源世界观分类超过 ${MAX_STRUCTURAL_WORLD_CATEGORIES} 项；当前结构保留前 ${MAX_STRUCTURAL_WORLD_CATEGORIES} 项，其余分类完整保存在迁移证据中。`
    );
    warnings.preserveDecision(
      "drop",
      `long_workspace.json.worldbuilding.categories[${MAX_STRUCTURAL_WORLD_CATEGORIES}:]`,
      "为当前索引和只读迁移证据预留安全容量，超出结构上限的分类未写入可编辑结构。",
      rawWorldCategories.slice(MAX_STRUCTURAL_WORLD_CATEGORIES)
    );
    rawWorldCategories = rawWorldCategories.slice(
      0,
      MAX_STRUCTURAL_WORLD_CATEGORIES
    );
  }
  if (rawWorldCategories.length === 0) {
    rawWorldCategories = DEFAULT_WORLD_CATEGORIES.map(([id, name]) => ({
      id,
      name,
      format: "list",
      items: []
    }));
    warnings.add("来源缺少世界观分类，已补齐七个默认分类。");
  }
  return rawWorldCategories.map((rawCategory, index) => {
    const category = record(rawCategory);
    const legacyCategoryId =
      stringValue(category.id).trim() || `category-${index + 1}`;
    const categoryId = ids.allocate(
      "worldbuilding",
      "world",
      category.id,
      `category-${index + 1}`
    );
    const format = category.format === "text" ? "text" : "list";
    if (
      category.format !== undefined &&
      category.format !== "text" &&
      category.format !== "list"
    ) {
      warnings.preserveDecision(
        "coerce",
        `long_workspace.json.worldbuilding.categories[${index}].format`,
        "未知世界观格式已回退为 list。",
        category.format
      );
    }
    let content = "";
    let listItems: Array<{
      id: string;
      title: string;
      content: string;
    }> = [];
    if (format === "text") {
      content = clipped(
        [stringValue(category.overview), stringValue(category.text)]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n\n"),
        MAX_WORLD_TEXT_DOCUMENT_CHARACTERS,
        warnings,
        `世界观“${legacyCategoryId}”文本正文`
      );
    } else {
      const markdownItems: Array<{
        id: string;
        title: string;
        content: string;
      }> = [];
      let remainingContentCharacters = MAX_WORLD_LIST_CONTENT_CHARACTERS;
      const overview = worldItemContent(
        category.overview,
        warnings,
        `世界观“${legacyCategoryId}”概览`,
        `long_workspace.json.worldbuilding.categories[${index}].overview`,
        category.overview
      ).trim();
      if (overview) {
        const retainedOverview = overview.slice(0, remainingContentCharacters);
        remainingContentCharacters -= retainedOverview.length;
        markdownItems.push({
          id: ids.allocate(
            `worldItem:${legacyCategoryId}`,
            "worlditem",
            "__overview__",
            "overview"
          ),
          title: "分类概览",
          content: retainedOverview
        });
      }
      let rawItems = list(category.items);
      const itemCapacity = MAX_WORLD_ITEMS_PER_CATEGORY - markdownItems.length;
      if (rawItems.length > itemCapacity) {
        warnings.add(
          `世界观“${legacyCategoryId}”条目超过 ${MAX_WORLD_ITEMS_PER_CATEGORY} 项；结构保留前 ${itemCapacity} 个旧版条目，其余条目完整保存在迁移证据中。`
        );
        warnings.preserveDecision(
          "drop",
          `long_workspace.json.worldbuilding.categories[${index}].items[${itemCapacity}:]`,
          "当前世界观 Markdown 列表最多容纳 10,000 项，超出部分未写入可编辑结构。",
          rawItems.slice(itemCapacity)
        );
        rawItems = rawItems.slice(0, itemCapacity);
      }
      let contentBudgetDecisionRecorded = false;
      rawItems.forEach((rawItem, itemIndex) => {
        const item = record(rawItem);
        const itemContentSource = [
          stringValue(item.description).trim()
            ? `描述：${stringValue(item.description).trim()}`
            : "",
          stringValue(item.detail ?? item.introduction).trim()
        ]
          .filter(Boolean)
          .join("\n\n");
        const itemContent =
          remainingContentCharacters > 0
            ? worldItemContent(
                itemContentSource,
                warnings,
                `世界观条目 ${itemIndex + 1} 内容`,
                `long_workspace.json.worldbuilding.categories[${index}].items[${itemIndex}]`,
                rawItem
              )
            : "";
        const retainedContent = itemContent.slice(
          0,
          remainingContentCharacters
        );
        if (
          retainedContent.length < itemContent.length &&
          !contentBudgetDecisionRecorded
        ) {
          contentBudgetDecisionRecorded = true;
          warnings.add(
            `世界观“${legacyCategoryId}”列表正文超过当前单文档安全预算；后续结构正文已裁剪，完整条目仍保存在迁移证据中。`
          );
          warnings.preserveDecision(
            "coerce",
            `long_workspace.json.worldbuilding.categories[${index}].items[${itemIndex}:]`,
            "当前世界观列表文档需保持在 16 MiB 解析预算内，后续条目正文已裁剪。",
            rawItems.slice(itemIndex)
          );
        }
        if (
          remainingContentCharacters === 0 &&
          itemContentSource &&
          !contentBudgetDecisionRecorded
        ) {
          contentBudgetDecisionRecorded = true;
          warnings.add(
            `世界观“${legacyCategoryId}”列表正文超过当前单文档安全预算；后续结构正文已裁剪，完整条目仍保存在迁移证据中。`
          );
          warnings.preserveDecision(
            "coerce",
            `long_workspace.json.worldbuilding.categories[${index}].items[${itemIndex}:]`,
            "当前世界观列表文档需保持在 16 MiB 解析预算内，后续条目正文已裁剪。",
            rawItems.slice(itemIndex)
          );
        }
        remainingContentCharacters -= retainedContent.length;
        markdownItems.push({
          id: ids.allocate(
            `worldItem:${legacyCategoryId}`,
            "worlditem",
            item.id,
            `item-${itemIndex + 1}`
          ),
          title: worldItemTitle(
            item.name,
            `未命名条目${itemIndex + 1}`,
            warnings,
            `世界观条目 ${itemIndex + 1} 标题`,
            `long_workspace.json.worldbuilding.categories[${index}].items[${itemIndex}].name`
          ),
          content: retainedContent
        });
      });
      const legacyText = stringValue(category.text).trim();
      if (legacyText && markdownItems.length === 0) {
        const legacyContent = worldItemContent(
          legacyText,
          warnings,
          `世界观“${legacyCategoryId}”正文`,
          `long_workspace.json.worldbuilding.categories[${index}].text`,
          category.text
        ).slice(0, remainingContentCharacters);
        markdownItems.push({
          id: ids.allocate(
            `worldItem:${legacyCategoryId}`,
            "worlditem",
            "__legacy_text__",
            "legacy-text"
          ),
          title: "正文",
          content: legacyContent
        });
      }
      listItems = markdownItems;
    }
    const categoryTitle = title(
      category.name,
      `未命名分类${index + 1}`,
      warnings,
      `世界观分类 ${index + 1} 标题`
    );
    return format === "text"
      ? {
          id: categoryId,
          title: categoryTitle,
          order: index + 1,
          format: "text" as const,
          contentAuthority: "markdown" as const,
          file: documents.add(
            longWorldbuildingFileId(categoryId),
            longWorldbuildingContentPath(categoryId),
            content
          )
        }
      : {
          id: categoryId,
          title: categoryTitle,
          order: index + 1,
          format: "list" as const,
          contentAuthority: "files" as const,
          overview: documents.add(
            longWorldbuildingOverviewFileId(categoryId),
            longWorldbuildingOverviewContentPath(categoryId),
            ""
          ),
          items: listItems.map((item, itemIndex) => ({
            id: item.id,
            title: item.title,
            order: itemIndex + 1,
            file: documents.add(
              longWorldbuildingItemFileId(item.id),
              longWorldbuildingItemContentPath(categoryId, item.id),
              item.content
            )
          }))
        };
  });
}
