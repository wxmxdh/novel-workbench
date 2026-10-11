import {
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longCharacterRelationshipsFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  longCharacterBatchForFiles,
  longWorldbuildingBatchForFile
} from "./long-file-proposal-batches";

const timestamp = "2026-08-22T02:00:00.000Z";
const runtime = {
  provider: "deepwrite",
  model: "proposal-test",
  mode: "local-faux" as const
};
const envelopeContext = {
  sessionId: "session-create-content",
  runId: "run-create-content",
  resourceId: "longbook_create_content"
};

function event<Type extends SystemEventEnvelope["type"]>(
  type: Type,
  payload: Extract<SystemEventEnvelope, { type: Type }>["payload"]
): Extract<SystemEventEnvelope, { type: Type }> {
  return createEnvelope(type, payload, {
    id: `event-${type}`,
    context: envelopeContext,
    timestamp
  }) as unknown as Extract<SystemEventEnvelope, { type: Type }>;
}

describe("long file proposal batch adaptation", () => {
  it("keeps create-mode initial content for a worldbuilding item", () => {
    const content = "每次施法都会遗忘一段童年。";
    const itemId = "worlditem_memory";
    const fileId = longWorldbuildingItemFileId(itemId);
    const filePath = longWorldbuildingItemContentPath("world_magic", itemId);
    const proposal = event("long.worldbuilding_file_proposal", {
      sessionId: envelopeContext.sessionId,
      runId: envelopeContext.runId,
      toolCallId: "tool-create-worldbuilding",
      bookId: "longbook_create_content",
      agentId: "long",
      summary: "新建魔法条目",
      runtime,
      batch: {
        updatedAt: timestamp,
        operations: [
          {
            type: "worldbuildingItem.create",
            categoryId: "world_magic",
            item: {
              id: itemId,
              title: "记忆代价",
              order: 1,
              file: { id: fileId, path: filePath, updatedAt: timestamp }
            }
          }
        ],
        documentWrites: [
          {
            proposalId: "proposal_create_worldbuilding",
            fileId,
            content,
            mode: "create",
            updatedAt: timestamp,
            reason: "新建魔法条目"
          }
        ]
      },
      files: [
        {
          categoryId: "world_magic",
          itemId,
          fileId,
          filePath,
          title: "魔法体系 / 记忆代价",
          operation: "create",
          beforeText: "",
          afterText: content
        }
      ]
    });

    expect(longWorldbuildingBatchForFile(proposal)?.documentWrites).toEqual([
      expect.objectContaining({ fileId, mode: "create", content })
    ]);
  });

  it("keeps the core-profile content when creating a character", () => {
    const content = "林岚是雾港巡夜人，始终随身携带旧信。";
    const characterId = "character_lan";
    const coreProfile = createEmptyLongMarkdownFileReference(
      longCharacterCoreProfileFileId(characterId),
      longCharacterFilePath(characterId, "core-profile.md"),
      timestamp
    );
    const relationships = createEmptyLongMarkdownFileReference(
      longCharacterRelationshipsFileId(characterId),
      longCharacterFilePath(characterId, "relationships.md"),
      timestamp
    );
    const proposal = event("long.character_file_proposal", {
      sessionId: envelopeContext.sessionId,
      runId: envelopeContext.runId,
      toolCallId: "tool-create-character",
      bookId: "longbook_create_content",
      agentId: "long",
      summary: "新建林岚",
      runtime,
      batch: {
        updatedAt: timestamp,
        operations: [
          {
            type: "character.create",
            character: {
              id: characterId,
              name: "林岚",
              group: "protagonist",
              order: 1,
              aliases: []
            },
            files: {
              characterId,
              coreProfile,
              relationships
            }
          }
        ],
        documentWrites: [
          {
            proposalId: "proposal_create_character",
            fileId: coreProfile.id,
            content,
            mode: "create",
            updatedAt: timestamp,
            reason: "新建林岚"
          }
        ]
      },
      files: [
        {
          characterId,
          characterName: "林岚",
          document: "core_profile",
          fileId: coreProfile.id,
          filePath: coreProfile.path,
          title: "林岚 / 核心档案",
          operation: "create",
          beforeText: "",
          afterText: content
        }
      ]
    });

    expect(longCharacterBatchForFiles(proposal)?.documentWrites).toEqual([
      expect.objectContaining({
        fileId: coreProfile.id,
        mode: "create",
        content
      })
    ]);
  });
});
