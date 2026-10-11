import { createHash } from "node:crypto";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  model,
  assistant,
  response
} from "./kernel/context/context.test-support";
import type { ComparisonDraftWriterContext } from "@deepwrite/contracts";
import {
  buildLongWorkspaceTools,
  type LongComparisonDraftExecutor
} from "./long-agent-tools";
import {
  fixtureIndex,
  workspace,
  profile,
  documentExecutor,
  resultText,
  vi,
  it,
  expect
} from "./long-agent-tools.test-support";
import { buildLongSubagentRequirements } from "./long-subagent-requirements";

const runtime = {
  provider: "test",
  model: "writer-test",
  mode: "provider" as const
};
const cap: ComparisonDraftWriterContext = {
  bookId: "longbook_9a146bbe",
  chapter: 1,
  chapterCardId: "chapter_one",
  authorizationId: "authorization-test-0001",
  writers: [{ definitionId: "love-writer-test", runtime }],
  authorRequest: {
    requestId: "author-test",
    exactText: "请独立写第一章",
    authorizationQuote: "请独立写第一章",
    receivedAt: "2026-10-05T00:00:00.000Z"
  }
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const card = "章卡开头\n" + "中间必须保留的材料".repeat(1000) + "\n章卡结尾";

function setup(
  mainDraft = false,
  writerContext: ComparisonDraftWriterContext = cap
) {
  const index = fixtureIndex();
  index.bookId = writerContext.bookId;
  index.plot.volumes[0]!.summary = "卷次来源全文";
  const book = workspace("long", "plot_design");
  book.bookId = writerContext.bookId;
  book.navigation.bookId = writerContext.bookId;
  const query = documentExecutor(index, { [index.chapters[0]!.card.id]: card });
  const comparison = vi.fn<LongComparisonDraftExecutor>(async (command) => {
    if (command.type === "long.deliverComparisonDraft")
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: writerContext.bookId,
          preparationId: command.payload.preparationId,
          path: "004_写作中/test.md",
          sha256: sha(command.payload.content),
          model: runtime.model,
          status: "待审阅",
          deliveryRecord: "records/test.md"
        }
      };
    return {
      status: "accepted",
      requestId: command.id,
      payload: {
        preparationId: "preparation-test-0001",
        bookId: writerContext.bookId,
        chapter: 1,
        chapterCardId: writerContext.chapterCardId,
        chapterCardSha256: sha(card),
        chapterCardContent: card,
        volumeId: "volume_one",
        selectedOutline: {
          path: "plan/one.md",
          sha256: sha("选定大纲"),
          version: "author-selected",
          content: "选定大纲",
          selectionEvidence: {
            path: "state.md",
            sha256: sha("作者选择"),
            quote: "作者选择"
          }
        },
        volume: {
          label: "第一卷",
          content: "卷次来源全文",
          evidence: {
            path: "volume.md",
            sha256: sha("卷次来源全文"),
            quote: "第一卷"
          }
        },
        readEvidence: ["outline", "chapter-card", "volume-evidence"].map(
          (role) => ({ role, path: role + ".md", sha256: sha(role) })
        ),
        preparedAt: "2026-10-05T00:00:00.000Z",
        contextReadContent: "Context全部来源：选定大纲"
      }
    };
  });
  let compact = () => {};
  const tools = buildLongWorkspaceTools({
    workspace: book,
    profile: profile("long"),
    sessionId: "test-session",
    runId: "test-run",
    executor: query,
    comparisonDraftExecutor: comparison,
    comparisonDraftWriterContext: mainDraft
      ? {
          ...writerContext,
          writers: [{ definitionId: "love-writer-main-draft", runtime }]
        }
      : writerContext,
    ...(mainDraft
      ? {}
      : { childRuntime: runtime, childDefinitionId: "love-writer-test" }),
    onContextCompacted: (listener) => {
      const previous = compact;
      compact = () => {
        previous();
        listener();
      };
    }
  });
  const prepare = tools.find(
    (tool) => tool.name === "prepare_comparison_draft"
  )!;
  const deliver = tools.find(
    (tool) => tool.name === "deliver_comparison_draft"
  )!;
  return {
    index,
    book,
    query,
    comparison,
    prepare,
    deliver,
    compact: () => compact()
  };
}

it("prepares from bound Core sources without manual read or guessed IDs", async () => {
  const test = setup();
  const result = await test.prepare.execute("prepare", {
    confirm_chapter: 1
  } as never);
  const text = resultText(result);
  expect(text).toContain(card);
  expect(text).toContain("卷次来源全文");
  expect(text).toContain("Context全部来源");
  const evidenceLine = text.match(
    /【LOVE对照稿恢复证据 v1】(\{[^\r\n]+\})/u
  )?.[1];
  expect(evidenceLine).toBeDefined();
  expect(JSON.parse(evidenceLine!)).toMatchObject({
    version: 1,
    bookId: cap.bookId,
    chapter: 1,
    chapterCardId: cap.chapterCardId,
    chapterCardSha256: sha(card),
    volumeId: "volume_one",
    volumeSha256: sha("卷次来源全文"),
    sourceMode: "independent",
    definitionId: "love-writer-test",
    runtime,
    authorRequestId: cap.authorRequest.requestId,
    authorTextSha256: sha(cap.authorRequest.exactText),
    authorRequestQuote: cap.authorRequest.authorizationQuote
  });
  const commands = test.query.mock.calls.map(([command]) => command);
  expect(commands.map((command) => command.type)).toEqual([
    "long.getWorkspaceIndex",
    "long.readDocument"
  ]);
  expect(test.comparison.mock.calls[0]![0].payload).toMatchObject({
    chapterCardId: cap.chapterCardId,
    chapterCardSha256: sha(card),
    volumeId: "volume_one",
    volumeSha256: sha("卷次来源全文")
  });
  const deliveryText = resultText(
    await test.deliver.execute("deliver", {
      content: "独立测试内容"
    } as never)
  );
  expect(deliveryText).toContain("已另存");
  const deliveryLine = deliveryText.match(
    /【LOVE对照稿交付证据 v1】(\{[^\r\n]+\})/u
  )?.[1];
  expect(JSON.parse(deliveryLine!)).toMatchObject({
    version: 1,
    bookId: cap.bookId,
    authorizationId: cap.authorizationId,
    definitionId: "love-writer-test",
    runtime,
    path: "004_写作中/test.md",
    sha256: sha("独立测试内容"),
    model: runtime.model,
    status: "待审阅",
    deliveryRecord: "records/test.md"
  });
});

it("persists original authorization lineage beside the current retry evidence", async () => {
  const retryContext: ComparisonDraftWriterContext = {
    ...cap,
    authorizationId: "authorization-retry-0001",
    priorAuthorizationId: cap.authorizationId,
    priorAuthorTextSha256: sha(cap.authorRequest.exactText),
    authorRequest: {
      requestId: "retry-author-request",
      exactText: "继续失败的一份，保留已保存稿",
      authorizationQuote: "继续失败的一份",
      receivedAt: "2026-10-06T00:00:00.000Z"
    }
  };
  const test = setup(false, retryContext);
  const result = await test.prepare.execute("prepare", {
    confirm_chapter: 1
  } as never);
  const evidenceLine = resultText(result).match(
    /【LOVE对照稿恢复证据 v1】(\{[^\r\n]+\})/u
  )?.[1];

  expect(JSON.parse(evidenceLine!)).toMatchObject({
    authorizationId: retryContext.authorizationId,
    priorAuthorizationId: cap.authorizationId,
    priorAuthorTextSha256: sha(cap.authorRequest.exactText),
    authorTextSha256: sha(retryContext.authorRequest.exactText),
    authorRequestQuote: retryContext.authorRequest.authorizationQuote
  });
});

it("allows the actual parent model to prepare and deliver only with a Main-minted solo writer", async () => {
  const test = setup(true);
  expect(test.prepare).toBeDefined();
  expect(test.deliver).toBeDefined();
  await test.prepare.execute("prepare-main", { confirm_chapter: 1 } as never);
  const result = await test.deliver.execute("deliver-main", {
    content: "主模型隔离测试稿。"
  } as never);
  expect(resultText(result)).toContain("已另存");
  expect(test.comparison.mock.calls.at(-1)?.[0].payload).toMatchObject({
    definitionId: "love-writer-main-draft",
    runtime
  });
  const ordinaryParentTools = buildLongWorkspaceTools({
    workspace: test.book,
    profile: profile("long"),
    sessionId: "test-session",
    runId: "test-run",
    executor: test.query,
    comparisonDraftExecutor: test.comparison,
    comparisonDraftWriterContext: cap
  });
  expect(
    ordinaryParentTools.some((tool) => tool.name === "prepare_comparison_draft")
  ).toBe(true);
  expect(
    ordinaryParentTools.some((tool) => tool.name === "deliver_comparison_draft")
  ).toBe(false);
});

it("uses independent query IDs for writers sharing the same authorized run", async () => {
  const tests = Array.from({ length: 4 }, () => setup());
  await Promise.all(
    tests.map((test) =>
      test.prepare.execute("prepare", { confirm_chapter: 1 } as never)
    )
  );
  const commands = tests.flatMap((test) =>
    test.query.mock.calls.map(([command]) => command)
  );
  expect(new Set(commands.map((command) => command.id)).size).toBe(8);
  expect(
    commands.every((command) => command.context?.runId === "test-run")
  ).toBe(true);
});

it("returns full source bytes to the provider on the next real Agent turn", async () => {
  const test = setup();
  let calls = 0;
  const agent = new Agent({
    initialState: {
      model,
      tools: [test.prepare],
      thinkingLevel: "off",
      systemPrompt: buildLongSubagentRequirements({
        sessionId: "test",
        runId: "run",
        prompt: "测试",
        workspaceContext: { longWorkspace: test.book },
        comparisonDraftWriterContext: cap
      })
    },
    streamFn: (_model, context) => {
      if (++calls === 1) {
        expect(context.systemPrompt).toContain(cap.chapterCardId);
        return response({
          ...assistant(),
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "prepare-call",
              name: "prepare_comparison_draft",
              arguments: { confirm_chapter: 1 }
            }
          ]
        });
      }
      const tool = context.messages.find(
        (message) => message.role === "toolResult"
      );
      expect(tool?.role).toBe("toolResult");
      if (tool?.role === "toolResult") {
        expect(tool.isError).toBe(false);
        expect(
          tool.content.some(
            (block) => block.type === "text" && block.text.includes(card)
          )
        ).toBe(true);
      }
      return response(assistant("测试完成，不生成小说"));
    }
  });
  await agent.prompt("运行准备工具");
  expect(calls).toBe(2);
});

it("rejects a different chapter before reading any source", async () => {
  const test = setup();
  await expect(
    test.prepare.execute("wrong", { confirm_chapter: 2 } as never)
  ).rejects.toThrow("不一致");
  expect(test.query).not.toHaveBeenCalled();
  expect(test.comparison).not.toHaveBeenCalled();
});

it("invalidates preparation after compaction or a failed new preparation", async () => {
  const test = setup();
  await test.prepare.execute("prepare", { confirm_chapter: 1 } as never);
  test.compact();
  await expect(
    test.deliver.execute("deliver", { content: "测试" } as never)
  ).rejects.toThrow("先调用");
  await test.prepare.execute("prepare", { confirm_chapter: 1 } as never);
  await expect(
    test.prepare.execute("wrong", { confirm_chapter: 2 } as never)
  ).rejects.toThrow("不一致");
  await expect(
    test.deliver.execute("deliver", { content: "测试" } as never)
  ).rejects.toThrow("先调用");
});

it("stops when Core preparation does not match the freshly read card", async () => {
  const test = setup();
  const original = test.comparison.getMockImplementation()!;
  test.comparison.mockImplementation(async (...args) => {
    const response = await original(...args);
    if (response.status !== "accepted")
      throw new Error("Expected accepted fixture");
    return {
      ...response,
      payload: {
        ...(response.payload as object),
        chapterCardSha256: "0".repeat(64)
      }
    };
  });
  await expect(
    test.prepare.execute("prepare", { confirm_chapter: 1 } as never)
  ).rejects.toThrow("不同章节");
  await expect(
    test.deliver.execute("deliver", { content: "测试" } as never)
  ).rejects.toThrow("先调用");
});

it("provides authoritative chapter and volume locators to isolated children", () => {
  const test = setup();
  const text = buildLongSubagentRequirements({
    sessionId: "test",
    runId: "run",
    prompt: "写作",
    workspaceContext: { longWorkspace: test.book },
    comparisonDraftWriterContext: cap
  });
  expect(text).toContain("chapter_one");
  expect(text).toContain("volume_one");
  expect(text).toContain('prepare_comparison_draft({"confirm_chapter":1})');
  expect(text).toContain("不代表资料已经阅读");
});
