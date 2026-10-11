import { describe, expect, it } from "vitest";
import { createLoveWorkflowStart } from "./love-workflow-start";
import type { AgentRunInput } from "./runtime-types";

function setup(
  prompt: string,
  catalog: unknown[] = [{ chapter: 2, volume: "第一卷" }]
) {
  const calls: string[] = [];
  const commands: Array<{
    type: string;
    payload: Record<string, unknown>;
    context: { runId?: string };
  }> = [];
  const input = {
    runId: "run-source",
    sessionId: "session-source",
    prompt,
    workspaceContext: { longWorkspace: { bookId: "longbook_9a146bbe" } },
    longCommandExecutor: async (command: {
      type: string;
      payload: { action: string };
      context: { runId?: string };
    }) => {
      expect(command.context.runId).toBe("run-source");
      calls.push(command.payload.action);
      commands.push(command);
      return {
        status: "accepted",
        payload:
          command.payload.action === "status"
            ? { ok: true, chapterCatalog: catalog }
            : command.payload.action === "read_notes"
              ? {
                  ok: true,
                  action: "read_notes",
                  annotationFile: {
                    items: [{ authorText: "作者批注全文" }]
                  },
                  annotatedDraft: { content: "被批注原稿全文" },
                  references: [{ excerpt: "完整参考摘录" }]
                }
              : {
                  ok: true,
                  action: "prepare",
                  packet: {
                    previousDraft: {
                      content: "实际前章全文：他在车棚收好了伞。",
                      hash: "test"
                    },
                    selectedOutline: { content: "实际第二章已选大纲" },
                    missing: []
                  }
                }
      };
    }
  } as unknown as AgentRunInput;
  return { input, calls, commands, hook: createLoveWorkflowStart(input)! };
}

describe("LOVE source acquisition before a chapter turn", () => {
  it("loads actual previous text and current outline using registered volume", async () => {
    const { hook, calls } = setup("讨论第二章大纲");
    expect(hook.context()).toBe("");
    await hook.load(new AbortController().signal);
    expect(calls).toEqual(["status", "prepare"]);
    expect(hook.context()).toContain("实际前章全文");
    expect(hook.context()).toContain("实际第二章已选大纲");
  });
  it("reads full annotation materials for natural annotation-review requests", async () => {
    const { hook, calls, commands } = setup("请核对第一章批注和参考摘录", [
      { chapter: 1, volume: "第一卷" }
    ]);
    await hook.load(new AbortController().signal);
    expect(calls).toEqual(["status", "read_notes"]);
    expect(hook.context()).toContain("作者批注全文");
    expect(hook.context()).toContain("被批注原稿全文");
    expect(hook.context()).toContain("完整参考摘录");
    expect(hook.context()).toContain("不选择底稿");
    expect(commands.at(-1)?.payload).not.toHaveProperty("targetModel");
    expect(commands.at(-1)?.payload).not.toHaveProperty("targetDraftPath");
  });
  it("narrows a copied handoff to its exact in-project draft path", async () => {
    const { hook, commands } = setup(
      [
        "作者批注回读",
        "项目：LOVE",
        "类型：正文",
        "卷章：第一卷／第1章",
        "本次批注模型：gpt-6.1-sol",
        "项目根目录：`D:/A book with spaces/LOVE`",
        "批注对应的稿件：",
        "- gpt-6.1-sol：D:/A book with spaces/LOVE/004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
        "大纲来源：",
        "- 尚未核验。",
        "请读取完整批注。"
      ].join("\n"),
      [{ chapter: 1, volume: "第一卷" }]
    );
    await hook.load(new AbortController().signal);
    expect(commands.at(-1)?.payload).toMatchObject({
      action: "read_notes",
      targetDraftPath: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md"
    });
    expect(commands.at(-1)?.payload).not.toHaveProperty("targetModel");
  });
  it("preserves the scope of actual workbench handoffs after pasted line breaks collapse", async () => {
    const { buildFeedbackPrompt } = await import(
      new URL(
        "../../../../小说对照工作台/public/feedback-prompt.js",
        import.meta.url
      ).href
    );
    const root = "D:/A book with spaces/00_创作项目/项目/LOVE";
    const files = [
      {
        id: "gpt",
        model: "gpt-6.1-sol",
        relative: "004_写作中/第001章 正文 gpt.md",
        hash: "gpt"
      },
      {
        id: "gemini",
        model: "gemini-3.8-flash",
        relative: "004_写作中/第001章 正文 gemini.md",
        hash: "gemini"
      }
    ];
    const notes = files.map((file) => ({
      id: file.id,
      model: file.model,
      fileId: file.id,
      fileRelative: file.relative,
      sourceHash: file.hash
    }));
    const shared = {
      project: "LOVE",
      root,
      volume: "第一卷",
      chapter: "001",
      notesPath: "006_批注/第一卷/第001章/批注汇总.md",
      files,
      activeFiles: files,
      notes
    };
    for (const modelId of ["gpt-6.1-sol", null]) {
      const prompt = buildFeedbackPrompt({ ...shared, modelId });
      for (const value of [
        prompt,
        prompt.replace(/\s+/gu, " "),
        prompt.replace(/\r?\n/gu, "")
      ]) {
        const { hook, calls, commands } = setup(value, [
          { chapter: 1, volume: "第一卷" }
        ]);
        await hook.load(new AbortController().signal);
        expect(calls).toEqual(["status", "read_notes"]);
        if (modelId)
          expect(commands.at(-1)?.payload.targetDraftPath).toBe(
            files[0]!.relative
          );
        else {
          expect(commands.at(-1)?.payload).not.toHaveProperty(
            "targetDraftPath"
          );
          expect(commands.at(-1)?.payload).not.toHaveProperty("targetModel");
        }
      }
    }
    for (const value of [
      buildFeedbackPrompt({ ...shared, isOutline: true }),
      buildFeedbackPrompt({
        ...shared,
        project: "What Is Love",
        root: "D:/What Is Love"
      })
    ]) {
      const { hook, calls } = setup(value.replace(/\r?\n/gu, ""), [
        { chapter: 1, volume: "第一卷" }
      ]);
      await hook.load(new AbortController().signal);
      expect(calls).toEqual([]);
      expect(hook.context()).not.toContain("运行器已通过Core只读回读");
    }
  });
  it("falls back to the explicit model when the handoff path is outside its declared root", async () => {
    const { hook, commands } = setup(
      [
        "作者批注回读",
        "项目：LOVE",
        "类型：正文",
        "卷章：第一卷／第1章",
        "本次批注模型：gpt-6.1-sol",
        "项目根目录：D:/Current/LOVE",
        "批注对应的稿件：",
        "- gpt-6.1-sol：D:/Other/LOVE/004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
        "大纲来源："
      ].join("\n"),
      [{ chapter: 1, volume: "第一卷" }]
    );
    await hook.load(new AbortController().signal);
    expect(commands.at(-1)?.payload).toMatchObject({
      action: "read_notes",
      targetModel: "gpt-6.1-sol"
    });
    expect(commands.at(-1)?.payload).not.toHaveProperty("targetDraftPath");
  });
  it("does not read body annotations for a copied outline-review handoff", async () => {
    const { hook, calls } = setup(
      "作者批注回读\n项目：LOVE\n类型：大纲\n卷章：第一卷／第1章\n请读取完整批注。",
      [{ chapter: 1, volume: "第一卷" }]
    );
    await hook.load(new AbortController().signal);
    expect(calls).toEqual([]);
    expect(hook.context()).toContain("对象明确为大纲");
    expect(hook.context()).toContain("没有自动读取正文批注");
  });
  it("does not map an explicitly different project to the current LOVE book", async () => {
    const { input, calls } = setup(
      "项目：`D:/A path with spaces/What Is Love`\n项目根目录：`D:/A path with spaces/What Is Love`\n请读取第一章批注",
      [{ chapter: 1, volume: "第一卷" }]
    );
    const hook = createLoveWorkflowStart(input)!;
    await hook.load(new AbortController().signal);
    expect(calls).toEqual([]);
    expect(hook.context()).toContain("与当前书籍 LOVE 不一致");
  });
  it("does not pick one volume when the same chapter number is ambiguous", async () => {
    const { hook, calls } = setup("写第二章", [
      { chapter: 2, volume: "第一卷" },
      { chapter: 2, volume: "第二卷" }
    ]);
    await hook.load(new AbortController().signal);
    expect(calls).toEqual(["status"]);
    expect(hook.context()).toContain("缺项");
  });
  it("does not substitute LOVE for an explicitly named other book in natural language", async () => {
    const { input, calls } = setup("读一下 What Is Love 第一章批注", [
      { chapter: 1, volume: "第一卷" }
    ]);
    const hook = createLoveWorkflowStart(input)!;
    await hook.load(new AbortController().signal);
    expect(calls).toEqual([]);
    expect(hook.context()).toContain("What Is Love");
    expect(hook.context()).toContain("读取已停止");
  });
  it("does not acquire annotation materials after an explicit refusal to read them", () => {
    for (const prompt of [
      "不读第一章批注",
      "不看第一章批注",
      "不用读第一章批注",
      "不必读第一章批注",
      "这次不想看第一章批注",
      "别看第一章批注"
    ]) {
      expect(createLoveWorkflowStart(setup(prompt).input)).toBeUndefined();
    }
  });
  it("can start planning an unregistered next chapter using the only existing volume, marked provisional", async () => {
    const { hook, calls } = setup("讨论第二章", [
      { chapter: 1, volume: "第一卷" }
    ]);
    await hook.load(new AbortController().signal);
    expect(calls).toEqual(["status", "prepare"]);
    expect(hook.context()).toContain("当前章未登记");
    expect(hook.context()).toContain("不是新卷章正文授权");
  });
  it("reports unavailable sources without fabricating a ready packet", async () => {
    const { input } = setup("讨论第二章");
    input.longCommandExecutor = async () => {
      throw new Error("登记大纲hash已变");
    };
    const hook = createLoveWorkflowStart(input)!;
    await hook.load(new AbortController().signal);
    expect(hook.context()).toContain("登记大纲hash已变");
    expect(hook.context()).toContain("不得声称已取得全文");
  });
  it("propagates cancellation instead of treating it as a literary missing-source notice", async () => {
    const { input } = setup("讨论第二章");
    const controller = new AbortController();
    controller.abort();
    input.longCommandExecutor = async (_command, signal) => {
      signal?.throwIfAborted();
      throw new Error("unreachable");
    };
    await expect(
      createLoveWorkflowStart(input)!.load(controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("stays out of unrelated projects and unscoped conversation", () => {
    const { input } = setup("今天的讨论有哪些问题");
    expect(createLoveWorkflowStart(input)).toBeUndefined();
    input.prompt = "写第二章";
    input.workspaceContext = {
      longWorkspace: { bookId: "other-book" }
    } as NonNullable<AgentRunInput["workspaceContext"]>;
    expect(createLoveWorkflowStart(input)).toBeUndefined();
  });
});
