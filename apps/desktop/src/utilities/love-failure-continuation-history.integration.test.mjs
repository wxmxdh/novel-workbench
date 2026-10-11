import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./conversation-storage/database";
import { handleConversationHistoryCommand } from "./conversation-history-commands";
import { createConversationHistoryWrite } from "../renderer/src/utils/conversationHistoryWriter";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";
import {
  createDeferredApi,
  document,
  runtime
} from "../renderer/src/composables/useAgentConversation.test-support";
import { readLoveFailureContinuationHistory } from "../main/love-failure-continuation-history";

const bookId = "longbook_9a146bbe";
const key =
  "conversation-history:" +
  encodeURIComponent("long:" + encodeURIComponent(bookId) + ":chat");
const currentText = "继续失败的两份，保留成功稿，不要重写其他稿。";
const date = "2026-10-06T00:00:00.000Z";
const tempPrefix = "love-history-recovery-";
const cleanup = [];

async function removeOwnedTestDirectory(directory) {
  const [tempRoot, target] = await Promise.all([
    realpath(tmpdir()),
    realpath(directory)
  ]);
  if (dirname(target) !== tempRoot || !basename(target).startsWith(tempPrefix))
    throw new Error(
      "Refusing to remove a directory outside this test's temp child."
    );
  await rm(target, { recursive: true, force: true });
}

function createHistoryApi(database) {
  return {
    mergeScopes: async (query) => database.mergeScopes(query),
    metadataDetail: async (query) => database.metadataDetail(query),
    stage: async (batch) => database.stage(batch),
    commit: async (batch) => database.commit(batch),
    list: async (query) => database.list(query),
    session: async (query) => database.session(query),
    messages: async (query) => database.messages(query),
    detail: async (query) => database.detail(query),
    turns: async (query) => database.turns(query)
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function createStorage() {
  const directory = await mkdtemp(join(tmpdir(), tempPrefix));
  cleanup.push(() => removeOwnedTestDirectory(directory));
  const database = new ConversationDatabase(join(directory, "history.sqlite"));
  database.claimMainInstance("love-history-recovery-test");
  cleanup.push(() => database.close());
  return { database, api: createHistoryApi(database) };
}

function flushWith(api, controller) {
  let pending;
  return async () => {
    for (;;) {
      if (!pending) {
        const changes = controller.capturePersistenceChanges();
        if (!changes.conversations.length) return;
        pending = {
          revision: changes.revision,
          write: createConversationHistoryWrite(api, key, changes)
        };
      }
      await pending.write();
      controller.acknowledgePersistenceChanges(pending.revision);
      pending = undefined;
    }
  };
}

describe("Core-persisted LOVE continuation history", () => {
  it("filters the unclaimed renderer placeholder and keeps only the exact current user tail", async () => {
    const { database, api } = await createStorage();
    const previousTrace = [
      {
        parentToolCallId: "parent-call",
        subagentRunId: "failed-child-run",
        subagentId: "love-writer-deepseek",
        name: "DeepSeek R1",
        task: "撰写第一章独立稿",
        status: "error",
        runtime: {
          mode: "provider",
          provider: "deepseek",
          model: "deepseek-r1",
          configId: "deepseek-config"
        },
        toolCalls: [],
        processingSteps: [],
        startedAt: date
      }
    ];
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      initialMessages: [
        {
          id: "author-original",
          role: "user",
          content: "请写第一章正文。",
          createdAt: date,
          status: "completed"
        },
        {
          id: "assistant-original",
          role: "assistant",
          content: "两份独立稿任务均已启动。",
          createdAt: date,
          status: "completed",
          runId: "parent-run",
          runtime,
          subagentRuns: previousTrace
        }
      ],
      flushPersistence: () => flushWith(api, controller)()
    });
    cleanup.push(() => controller.dispose());
    await flushWith(api, controller)();

    controller.draft.value = currentText;
    const sending = controller.sendMessage(document);
    await vi.waitFor(() => expect(deferred.prompts).toHaveLength(1));

    const sessionId = controller.sessionId.value;
    const stored = database.messages({ key, sessionId });
    expect(stored.messages).toHaveLength(3);
    expect(stored.messages.at(-1)?.value).toMatchObject({
      role: "user",
      content: currentText
    });
    expect(
      stored.messages.some(({ value }) => value.activityOnly === true)
    ).toBe(false);

    const sendCoreCommand = (command) =>
      handleConversationHistoryCommand(api, command);
    const history = await readLoveFailureContinuationHistory({
      bookId,
      sessionId,
      currentText,
      sendCoreCommand
    });
    expect(history).toHaveLength(2);
    expect(history?.[1]?.value.subagentRuns).toEqual(previousTrace);
    expect(history?.some(({ value }) => value.content === currentText)).toBe(
      false
    );

    deferred.resolveAccepted(0, {
      sessionId,
      runId: "retry-parent-run",
      runtime,
      acceptedAt: date
    });
    await sending;
  });
});
