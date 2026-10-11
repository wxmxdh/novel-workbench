import { createHash } from "node:crypto";
import { createId } from "@deepwrite/shared";
import {
  CommandEnvelopeSchema,
  LongReadAgentsMdResultSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  LONG_REQUIRED_RULES_MAX_CHARACTERS,
  LongRequiredRulesSnapshotSchema,
  parseLongRequiredRuleIds,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

type CoreRequest = (command: CommandEnvelope) => Promise<CommandResult>;

/** Main resolves book bindings and complete texts through Core on every run. */
export async function prepareLongRequiredRuleContext(
  context: WorkspaceRuntimeContext | undefined,
  request: CoreRequest
): Promise<WorkspaceRuntimeContext | undefined> {
  const workspace = context?.longWorkspace;
  if (!context || !workspace) return context;
  const bookId = workspace.bookId;
  const query = async (type: string, payload: object) => {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id: createId("required-rule-query") })
    );
    const reply = await request(command);
    if (reply.status !== "accepted") throw new Error(reply.error.message);
    return reply.payload;
  };
  const agents = LongReadAgentsMdResultSchema.parse(
    await query("long.readAgentsMd", { bookId })
  );
  if (agents.bookId !== bookId || agents.truncated) {
    throw new Error("本书执行说明不完整或作品不匹配，不能确认必读规则。");
  }
  const ids = parseLongRequiredRuleIds(agents.content);
  // Drop Renderer-supplied snapshots, including when the book has no binding.
  const { requiredRules: _untrusted, agentsMd: _agents, ...rest } = workspace;
  const next = { ...rest, agentsMd: agents.content };
  if (!ids.length) return { ...context, longWorkspace: next };

  const indexed = LongWorkspaceIndexResultSchema.parse(
    await query("long.getWorkspaceIndex", { bookId })
  );
  if (indexed.bookId !== bookId || indexed.workspaceIndex.bookId !== bookId) {
    throw new Error("读取必读规则时作品索引不匹配。");
  }
  const rules = [];
  let totalCharacters = 0;
  for (const itemId of ids) {
    const item = indexed.workspaceIndex.worldbuilding
      .flatMap((category) => (category.format === "list" ? category.items : []))
      .find((entry) => entry.id === itemId);
    if (!item) throw new Error(`本书绑定的必读规则不存在：${itemId}`);
    const parts: string[] = [];
    let offset = 0;
    let expectedTotal: number | undefined;
    while (true) {
      const page = LongReadDocumentResultSchema.parse(
        await query("long.readDocument", {
          bookId,
          fileId: item.file.id,
          offset,
          maxCharacters: 32_768
        })
      );
      if (
        page.bookId !== bookId ||
        page.file.id !== item.file.id ||
        page.file.path !== item.file.path ||
        page.offset !== offset ||
        page.file.updatedAt !== item.file.updatedAt ||
        (expectedTotal !== undefined && page.totalCharacters !== expectedTotal)
      )
        throw new Error(
          `必读规则版本在读取过程中变化，请重新发送：${item.title}`
        );
      expectedTotal = page.totalCharacters;
      if (
        totalCharacters + expectedTotal >
        LONG_REQUIRED_RULES_MAX_CHARACTERS
      ) {
        throw new Error(
          "必读规则全文超过上下文容量，请收准范围；本轮未截断发送。"
        );
      }
      parts.push(page.content);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    const content = parts.join("");
    if (!content.trim()) throw new Error(`必读规则正文为空：${item.title}`);
    totalCharacters += expectedTotal!;
    rules.push({
      itemId,
      fileId: item.file.id,
      title: item.title,
      updatedAt: item.file.updatedAt,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      content
    });
  }
  // Recheck the authoritative index and binding after paged reads.
  const checked = LongWorkspaceIndexResultSchema.parse(
    await query("long.getWorkspaceIndex", { bookId })
  );
  const checkedAgents = LongReadAgentsMdResultSchema.parse(
    await query("long.readAgentsMd", { bookId })
  );
  if (
    checked.bookId !== bookId ||
    checked.workspaceIndex.updatedAt !== indexed.workspaceIndex.updatedAt ||
    checkedAgents.bookId !== bookId ||
    checkedAgents.truncated ||
    checkedAgents.content !== agents.content
  )
    throw new Error("本书规则或执行说明在读取过程中变化，请重新发送。");
  return {
    ...context,
    longWorkspace: {
      ...next,
      requiredRules: LongRequiredRulesSnapshotSchema.parse(rules)
    }
  };
}
