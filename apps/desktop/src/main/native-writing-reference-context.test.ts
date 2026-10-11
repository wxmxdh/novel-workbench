import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  LongReadDocumentInputSchema,
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { fixtureWorldbuildingIndex } from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import {
  listNativeNovelWriting,
  readNativeNovelWriting,
  saveNativeNovelWriting,
  selectNativeNovelWriting,
  type NativeWritingScope
} from "../utilities/novel-writing-store";
import { prepareNativeWritingReferenceContext } from "./native-writing-reference-context";
import {
  LongNativeWritingListResultSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema
} from "@deepwrite/contracts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
);

describe("trusted native writing references", () => {
  it("passes a real selected store candidate only after Core-scoped read and strips forged packets", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-writing-context-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    const index = fixtureWorldbuildingIndex();
    index.bookId = "longbook_9a146bbe";
    const card = index.plot.chapterCards[0]!;
    const entry = index.chapters.find(
      (chapter) => chapter.chapterCardId === card.id
    )!;
    const scope: NativeWritingScope = {
      bookId: index.bookId,
      chapterCardId: card.id,
      chapter: 1,
      volume: "第一卷",
      cardTitle: card.title
    };
    const saved = await saveNativeNovelWriting(project, scope, {
      role: "candidate",
      content: "她把杯子放回桌上。",
      title: "作者选定参考",
      model: "test-model",
      version: "v1"
    });
    await selectNativeNovelWriting(project, scope, {
      path: saved.path,
      hash: saved.hash,
      action: "reference"
    });
    const request = async (
      command: CommandEnvelope
    ): Promise<CommandResult> => {
      let payload: unknown;
      if (command.type === "long.getWorkspaceIndex")
        payload = { bookId: index.bookId, workspaceIndex: index };
      else if (command.type === "long.nativeWritingList")
        payload = {
          bookId: index.bookId,
          chapterCardId: command.payload.chapterCardId,
          items: await listNativeNovelWriting(project, {
            ...scope,
            chapterCardId: command.payload.chapterCardId
          })
        };
      else if (command.type === "long.nativeWritingRead")
        payload = await readNativeNovelWriting(
          project,
          { ...scope, chapterCardId: command.payload.chapterCardId },
          { path: command.payload.path, hash: command.payload.hash }
        );
      else if (command.type === "long.readDocument") {
        const input = LongReadDocumentInputSchema.parse(command.payload);
        const file = input.fileId === entry.card.id ? entry.card : entry.body;
        const content = "# No selected outline\n";
        const page = content.slice(
          input.offset,
          input.offset + input.maxCharacters
        );
        payload = {
          bookId: index.bookId,
          file,
          content: page,
          offset: input.offset,
          totalCharacters: content.length,
          nextOffset: null
        };
      } else throw new Error(`Unexpected command ${command.type}`);
      return { status: "accepted", requestId: command.id, payload };
    };
    const forged = {
      longWorkspace: {
        bookId: index.bookId,
        selectedDraftReferences: [{ content: "forged" }],
        selectedChapterOutline: { content: "forged" }
      }
    } as unknown as WorkspaceRuntimeContext;
    const result = await prepareNativeWritingReferenceContext(forged, request, {
      required: true,
      targetChapterCardId: card.id
    });
    expect(result?.longWorkspace?.selectedDraftReferences).toHaveLength(1);
    expect(result?.longWorkspace?.selectedDraftReferences?.[0]?.content).toBe(
      "她把杯子放回桌上。"
    );
    expect(result?.longWorkspace?.selectedDraftReferences?.[0]?.hash).toBe(
      saved.hash
    );
    expect(result?.longWorkspace?.selectedChapterOutline).toBeUndefined();
    expect(result?.longWorkspace?.activeChapterCardId).toBe(card.id);
    expect(
      createHash("sha256")
        .update(result!.longWorkspace!.selectedDraftReferences![0]!.content)
        .digest("hex")
    ).toBe(createHash("sha256").update("她把杯子放回桌上。").digest("hex"));
  });

  it("reads a selected multi-page outline and stops on stale selection, changed selection, or changed adjacent order", async () => {
    const index = fixtureWorldbuildingIndex();
    index.bookId = "longbook_9a146bbe";
    const target = index.plot.chapterCards[0]!;
    const entry = index.chapters.find(
      (chapter) => chapter.chapterCardId === target.id
    )!;
    const outline = "大纲正文。".repeat(12_000);
    const outlineHash = createHash("sha256").update(outline).digest("hex");
    const selection = {
      sourceFileId: entry.card.id,
      version: "outline-v1",
      sha256: outlineHash,
      status: "current" as "current" | "needs-recheck",
      selectedAt: "2026-10-11T00:00:00.000Z",
      evidence: "author-explicit-selection" as const
    };
    const makeRequest = (
      options: {
        selection?: typeof selection;
        changedAfterRead?: boolean;
        moveAnchor?: boolean;
      } = {}
    ) => {
      let indexReads = 0;
      let pageReads = 0;
      return {
        request: async (command: CommandEnvelope): Promise<CommandResult> => {
          const snapshot = structuredClone(index);
          if (options.selection)
            snapshot.plot.chapterCards[0]!.outlineSelection = options.selection;
          if (options.moveAnchor && indexReads > 0)
            snapshot.plot.chapterCards[0]!.narrativeOrder += 1;
          if (options.changedAfterRead && indexReads > 0)
            snapshot.plot.chapterCards[0]!.outlineSelection = {
              ...selection,
              sha256: "f".repeat(64)
            };
          let payload: unknown;
          if (command.type === "long.getWorkspaceIndex") {
            indexReads++;
            payload = LongWorkspaceIndexResultSchema.parse({
              bookId: snapshot.bookId,
              workspaceIndex: snapshot
            });
          } else if (command.type === "long.nativeWritingList")
            payload = LongNativeWritingListResultSchema.parse({
              bookId: index.bookId,
              chapterCardId: command.payload.chapterCardId,
              items: []
            });
          else if (command.type === "long.readDocument") {
            const input = command.payload as {
              offset: number;
              maxCharacters: number;
            };
            const content = outline.slice(
              input.offset,
              input.offset + input.maxCharacters
            );
            pageReads++;
            const nextOffset = input.offset + content.length;
            payload = LongReadDocumentResultSchema.parse({
              bookId: index.bookId,
              file: entry.card,
              content,
              offset: input.offset,
              totalCharacters: outline.length,
              nextOffset: nextOffset < outline.length ? nextOffset : null
            });
          } else throw new Error(`Unexpected command ${command.type}`);
          return { status: "accepted", requestId: command.id, payload };
        },
        getPageReads: () => pageReads
      };
    };
    const context = {
      longWorkspace: { bookId: index.bookId }
    } as unknown as WorkspaceRuntimeContext;
    const good = makeRequest({ selection });
    const result = await prepareNativeWritingReferenceContext(
      context,
      good.request,
      { required: true, targetChapterCardId: target.id }
    );
    expect(result?.longWorkspace?.selectedChapterOutline?.content).toBe(
      outline
    );
    expect(good.getPageReads()).toBeGreaterThan(1);
    await expect(
      prepareNativeWritingReferenceContext(
        context,
        makeRequest({ selection: { ...selection, status: "needs-recheck" } })
          .request,
        { required: true, targetChapterCardId: target.id }
      )
    ).rejects.toThrow(/失效/u);
    await expect(
      prepareNativeWritingReferenceContext(
        context,
        makeRequest({ selection: { ...selection, sha256: "e".repeat(64) } })
          .request,
        { required: true, targetChapterCardId: target.id }
      )
    ).rejects.toThrow(/hash/u);
    await expect(
      prepareNativeWritingReferenceContext(
        context,
        makeRequest({ selection, changedAfterRead: true }).request,
        { required: true, targetChapterCardId: target.id }
      )
    ).rejects.toThrow(/变化/u);
    const noSelection = await prepareNativeWritingReferenceContext(
      context,
      makeRequest().request,
      { required: true, targetChapterCardId: target.id }
    );
    expect(noSelection?.longWorkspace?.selectedChapterOutline).toBeUndefined();
    expect(noSelection?.longWorkspace?.selectedDraftReferences).toBeUndefined();
  });
});
