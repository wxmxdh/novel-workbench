import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LongApplyLoveLocalRevisionInput,
  LongPrepareComparisonDraftInput
} from "@deepwrite/contracts";

const mocks = vi.hoisted(() => ({
  getPreparation: vi.fn(),
  requireProject: vi.fn()
}));

vi.mock("./novel-writing-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./novel-writing-store")>();
  return {
    ...actual,
    getLoveComparisonPreparation: mocks.getPreparation,
    requireProject: mocks.requireProject
  };
});
vi.mock("./external-project-operations", () => ({
  withExternalProjectLock: async (_root: string, action: () => unknown) =>
    action()
}));

import {
  applyNovelLoveLocalRevision,
  prepareNovelLoveLocalRevision
} from "./love-local-revision-store";
import { registerNativeComparison } from "./native-comparison-registration";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const require = createRequire(import.meta.url);
const fixtureModule = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../写作协议V1/test/fixtures.mjs"
);
const { fixture } = require(fixtureModule) as {
  fixture: () => {
    workspace: string;
    root: string;
    put: (path: string, value: unknown, base?: string) => string;
    cleanup: () => void;
  };
};
const publicCli = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../写作协议V1"
);
const LOVE_PATH = "00_创作项目/项目/LOVE";
const BOOK_ID = "longbook_9a146bbe";
const PROJECT_ID = "otter_0123456789abcdef";
const runtime = {
  provider: "fixture-provider",
  model: "gpt-6.1-sol",
  mode: "provider" as const,
  configId: "fixture-config"
};
const fixtures: Array<{ cleanup: () => void }> = [];

afterEach(() => {
  mocks.getPreparation.mockReset();
  mocks.requireProject.mockReset();
  for (const item of fixtures.splice(0)) item.cleanup();
});

describe("LOVE local revision Core delivery", () => {
  it("prepares real V1 context, previews without writes, then delivers a separate revision with evidence", async () => {
    const f = fixture();
    fixtures.push(f);
    const root = join(f.workspace, LOVE_PATH);
    mkdirSync(root, { recursive: true });
    const cliDestination = join(f.workspace, "06_脚本工具", "写作协议V1");
    mkdirSync(cliDestination, { recursive: true });
    for (const entry of readdirSync(publicCli, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith(".mjs"))
        cpSync(join(publicCli, entry.name), join(cliDestination, entry.name));

    const card =
      "# 第一章\n## 开场\n宋子凡进入教室。\n## 散场\n宋子凡取回水瓶离开。\n";
    const volume = "测试卷卡：第一卷。\n";
    const nativeEvidence =
      "宋子凡、贾思远、程北辰为测试人物；仅用于隔离测试，不含真实作品事实。";
    f.put("AGENTS.md", "LOVE 隔离测试入口。\n", root);
    const authorizationId = "local-revision-store-auth-001";
    const authorText = "按已绑定批注只调整这一句。";
    const authPath = `.novel/author-requests/${authorizationId}.md`;
    const put = (path: string, value: string | unknown) =>
      f.put(path, value, root);
    const request: LongPrepareComparisonDraftInput = {
      bookId: BOOK_ID,
      authorizationId,
      chapter: 1,
      chapterCardId: "chapter_local_revision_test",
      authorRequestId: "request-local-revision-test",
      volumeId: "volume_local_revision_test",
      authorRequest: {
        requestId: "request-local-revision-test",
        exactText: authorText,
        authorizationQuote: authorText,
        receivedAt: "2026-10-05T00:00:00.000Z"
      },
      chapterCardSha256: sha(card),
      volumeSha256: sha(volume)
    };
    await registerNativeComparison({
      workspace: f.workspace,
      relative: LOVE_PATH,
      root,
      request,
      source: {
        cardTitle: "第一章",
        cardContent: card,
        chapterCardId: request.chapterCardId,
        volumeId: request.volumeId,
        volumeLabel: "第一卷",
        volumeContent: volume,
        nativeEvidence
      }
    });
    put(authPath, authorText);

    const sourcePath = "004_写作中/第001章_正文草稿_gpt-6.1-sol.md";
    const sourceText =
      '---\nworkbench: novel-draft-v1\nmodel: "gpt-6.1-sol"\nvolume: "第一卷"\nchapter: "1"\ntitle: "第一章"\nkind: draft\nstatus: 待审阅\n---\n开头保留。旧句。结尾保留。\n';
    put(sourcePath, sourceText);
    const notePath = "006_批注/第001章_gpt-6.1-sol_批注.md";
    const noteText = "请把‘旧句’改成一句更自然的生活动作。\n";
    put(notePath, noteText);
    const adoptedNotePath = "006_批注/批注.json";
    const annotationView = sourceText
      .replace(/^\uFEFF/u, "")
      .replace(/\r\n?/gu, "\n");
    const annotationItems = [
      {
        id: "local-adopted-1",
        fileId: "fixture-file-id",
        fileRelative: sourcePath,
        sourceHash: sha(sourceText),
        start: annotationView.indexOf("旧句。"),
        end: annotationView.indexOf("旧句。") + "旧句。".length,
        quote: "旧句。",
        comment: noteText.trim(),
        authorText: noteText.trim(),
        status: "resolved",
        updated: "2026-10-06T00:00:00.000Z"
      },
      {
        id: "local-adopted-stale-2",
        fileId: "fixture-file-id",
        fileRelative: sourcePath,
        sourceHash: sha(sourceText),
        start: annotationView.indexOf("结尾保留。"),
        end: annotationView.indexOf("结尾保留。") + "结尾保留。".length,
        quote: "结尾保留。",
        comment: "这条最初也被采用。",
        authorText: "这条最初也被采用。",
        status: "resolved",
        updated: "2026-10-06T00:00:00.000Z"
      }
    ];
    put(adoptedNotePath, JSON.stringify({ schema: 1, items: annotationItems }, null, 2));
    const workflowPath = join(
      f.workspace,
      "我的小说工作台/LOVE_Codex审核交接/工具/love-chapter-workflow.mjs"
    );
    mkdirSync(dirname(workflowPath), { recursive: true });
    cpSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../../../我的小说工作台/LOVE_Codex审核交接/工具/love-chapter-workflow.mjs"
      ),
      workflowPath
    );
    const workflow = await import(pathToFileURL(workflowPath).href);
    await workflow.selectLoveDraft({
      root,
      chapter: 1,
      volume: "第一卷",
      draft: sourcePath,
      status: "selected",
      authorActionEvidence: {
        requestId: "select-source-test",
        quote: "作者选择隔离测试底稿"
      }
    });
    await workflow.attachLoveDraftNotes({
      root,
      chapter: 1,
      volume: "第一卷",
      noteSources: [notePath, adoptedNotePath],
      annotationItemIds: ["local-adopted-1", "local-adopted-stale-2"],
      authorActionEvidence: {
        requestId: "attach-note-test",
        quote: "作者绑定隔离测试批注"
      }
    });
    annotationItems[1]!.comment = "条目后来被改写，旧采用不得继续执行。";
    annotationItems[1]!.authorText = annotationItems[1]!.comment;
    annotationItems[1]!.updated = "2026-10-06T00:01:00.000Z";
    put(adoptedNotePath, JSON.stringify({ schema: 1, items: annotationItems }, null, 2));

    const state = JSON.parse(
      readFileSync(join(root, ".novel/chapter-state.json"), "utf8")
    );
    const chapterEntry = state.chapters[0];
    const selectedOutline = chapterEntry.selected_outline;
    mocks.getPreparation.mockReturnValue({
      workspaceRoot: f.workspace,
      projectId: PROJECT_ID,
      projectRoot: root,
      chapter: 1,
      volumeLabel: "第一卷",
      selectedOutline,
      authorRequestQuote: authorText,
      authorizationId,
      expiresAt: Date.now() + 60_000
    });
    const hashText = (text: string | Uint8Array) => sha(text.toString());
    const adapter = {
      readDocument: async (_id: string, path: string) => {
        const content = readFileSync(join(root, path), "utf8");
        return { path, content, hash: hashText(content) };
      }
    };
    mocks.requireProject.mockResolvedValue({
      adapter,
      target: { id: PROJECT_ID },
      project: {
        relativePath: LOVE_PATH,
        projectRoot: root,
        workspaceRoot: f.workspace
      }
    });

    const prepared = await prepareNovelLoveLocalRevision(
      f.workspace,
      {
        bookId: BOOK_ID,
        authorizationId,
        comparisonPreparationId: "comparison-preparation-local-test",
        sourcePath,
        sourceSha256: sha(sourceText)
      },
      { nativeEvidence }
    );
    expect(prepared.readContent).toContain(sourceText);
    expect(prepared.readContent).toContain(noteText);
    expect(prepared.readContent).toContain("本轮批注复验");
    const receipts = readdirSync(join(root, ".novel/receipts"))
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        JSON.parse(readFileSync(join(root, ".novel/receipts", name), "utf8"))
      );
    const v1Receipt = receipts.find((item) =>
      item.read_sources?.some(
        (source: { path?: string }) => source.path === adoptedNotePath
      )
    );
    expect(v1Receipt?.read_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: sourcePath,
          hash: sha(sourceText),
          role: "text"
        }),
        expect.objectContaining({
          path: notePath,
          hash: sha(noteText),
          role: "reference"
        }),
        expect.objectContaining({
          path: expect.stringContaining("adopted-annotations.md"),
          role: "annotation"
        }),
        expect.objectContaining({
          path: adoptedNotePath,
          hash: sha(readFileSync(join(root, adoptedNotePath), "utf8")),
          role: "reference"
        })
      ])
    );
    expect(
      v1Receipt?.read_sources?.some(
        (source: { path?: string; role?: string }) =>
          source.path === adoptedNotePath && source.role === "annotation"
      )
    ).toBe(false);
    const basePayload = {
      bookId: BOOK_ID,
      authorizationId,
      revisionPreparationId: prepared.revisionPreparationId,
      patches: [
        {
          oldText: "旧句。",
          newText: "调整后的句子。",
          reason: "按作者批注局部调整"
        }
      ]
    } satisfies Omit<
      LongApplyLoveLocalRevisionInput,
      "action" | "runtime" | "authorRevisionEvidence"
    >;
    const preview = await applyNovelLoveLocalRevision(
      f.workspace,
      {
        ...basePayload,
        action: "preview"
      },
      { nativeEvidence }
    );
    expect(preview.writes).toBe(0);
    expect(readFileSync(join(root, sourcePath), "utf8")).toBe(sourceText);
    expect(readFileSync(join(root, notePath), "utf8")).toBe(noteText);

    await expect(
      applyNovelLoveLocalRevision(
        f.workspace,
        { ...basePayload, action: "preview" },
        { nativeEvidence: `${nativeEvidence}\n资料变化` }
      )
    ).rejects.toThrow("原生资料在准备后已变化");

    await expect(
      applyNovelLoveLocalRevision(
        f.workspace,
        {
          ...basePayload,
          action: "deliver",
          authorRevisionEvidence: {
            ...prepared.authorRevisionEvidence,
            quote: "伪造授权"
          },
          runtime
        },
        { nativeEvidence }
      )
    ).rejects.toThrow("授权");

    writeFileSync(join(root, sourcePath), `${sourceText}外部改动\n`, "utf8");
    await expect(
      applyNovelLoveLocalRevision(
        f.workspace,
        {
          ...basePayload,
          action: "preview"
        },
        { nativeEvidence }
      )
    ).rejects.toThrow("底稿在准备后已变化");
    writeFileSync(join(root, sourcePath), sourceText, "utf8");

    const outlinePath = selectedOutline.path;
    const outlineText = readFileSync(join(root, outlinePath), "utf8");
    writeFileSync(
      join(root, outlinePath),
      `${outlineText}\n外部变更\n`,
      "utf8"
    );
    await expect(
      applyNovelLoveLocalRevision(
        f.workspace,
        {
          ...basePayload,
          action: "deliver",
          authorRevisionEvidence: prepared.authorRevisionEvidence,
          runtime
        },
        { nativeEvidence }
      )
    ).rejects.toThrow();
    writeFileSync(join(root, outlinePath), outlineText, "utf8");

    const delivered = await applyNovelLoveLocalRevision(
      f.workspace,
      {
        ...basePayload,
        action: "deliver",
        authorRevisionEvidence: prepared.authorRevisionEvidence,
        runtime
      },
      { nativeEvidence }
    );
    expect(delivered.writes).toBe(1);
    expect(delivered.path).not.toBe(sourcePath);
    const artifact = readFileSync(join(root, delivered.path!), "utf8");
    expect(artifact).toContain("调整后的句子。");
    expect(artifact).toContain(`revision_of: "${sourcePath}"`);
    expect(artifact).toContain(`base_hash: "${sha(sourceText)}"`);
    const deliveryRecord = JSON.parse(
      readFileSync(join(root, delivered.deliveryRecord!), "utf8")
    );
    expect(deliveryRecord.revision_base).toEqual({
      path: sourcePath,
      sha256: sha(sourceText)
    });
    expect(deliveryRecord.completion).toBeTruthy();
    expect(readFileSync(join(root, sourcePath), "utf8")).toBe(sourceText);
    expect(readFileSync(join(root, notePath), "utf8")).toBe(noteText);
  });
});
