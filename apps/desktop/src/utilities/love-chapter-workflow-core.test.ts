import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { LongLoveChapterWorkflowCommandInput } from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./novel-writing-store", () => ({ requireProject: vi.fn() }));

import { requireProject } from "./novel-writing-store";
import { runLoveChapterWorkflowCore } from "./love-chapter-workflow-core";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "love-chapter-core-test-"));
  roots.push(root);
  const outline = "---\nkind: outline\n---\n# 当前隔离测试大纲\n";
  mkdirSync(join(root, ".novel"), { recursive: true });
  mkdirSync(join(root, "outlines"), { recursive: true });
  writeFileSync(join(root, "outlines/ch1.md"), outline);
  writeFileSync(
    join(root, ".novel/project.json"),
    JSON.stringify({
      project: "LOVE",
      bridge_owner: "native-love-comparison-v1",
      chapter_state: ".novel/chapter-state.json"
    })
  );
  writeFileSync(
    join(root, ".novel/chapter-state.json"),
    JSON.stringify({
      project: "LOVE",
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          selected_outline: {
            path: "outlines/ch1.md",
            hash: sha(outline)
          }
        }
      ]
    })
  );
  vi.mocked(requireProject).mockResolvedValue({
    project: { projectRoot: root }
  } as never);
  return root;
}

function addAnnotationFixture(root: string, includeOtherDraft = false) {
  const draftPath = "004_写作中/第001章_正文草稿_gpt-6.1-sol.md";
  const referencePath = "004_写作中/第001章_正文草稿_gemini-3.1-pro.md";
  const annotatedQuote = "宋子凡在门口停了一下。";
  const referenceQuote = "报到那天很热，教室里的人来来往往。";
  const draft = [
    "---",
    "workbench: novel-draft-v1",
    'model: "gpt-6.1-sol"',
    'volume: "第一卷"',
    'chapter: "1"',
    "kind: draft",
    "---",
    "# 第一章",
    "",
    `${annotatedQuote}教室里坐了不少人。`,
    ""
  ].join("\n");
  const reference = [
    "---",
    "workbench: novel-draft-v1",
    'model: "gemini-3.1-pro"',
    'volume: "第一卷"',
    'chapter: "1"',
    "kind: draft",
    "---",
    "# 第一章",
    "",
    referenceQuote,
    ""
  ].join("\n");
  mkdirSync(join(root, "004_写作中"), { recursive: true });
  writeFileSync(join(root, draftPath), draft);
  writeFileSync(join(root, referencePath), reference);
  const referenceStart = reference.indexOf(referenceQuote);
  const makeItem = (input: {
    id: string;
    model: string;
    fileRelative: string;
    sourceHash: string;
    quote: string;
    start: number;
    draftReferences?: unknown[];
  }) => ({
    id: input.id,
    model: input.model,
    storyVolume: "第一卷",
    fileRelative: input.fileRelative,
    sourceHash: input.sourceHash,
    start: input.start,
    end: input.start + input.quote.length,
    quote: input.quote,
    updated: "2026-10-06T00:00:00.000Z",
    authorText: `请调整：${input.id}`,
    comment: `请调整：${input.id}`,
    status: "open",
    intent: "comment",
    draftReferences: input.draftReferences ?? [],
    draftReferenceTombstones: [
      {
        id: "removed-reference-01",
        number: 2,
        quote: "已撤回的完整历史摘录。",
        removedAt: "2026-10-05T00:00:00.000Z"
      }
    ]
  });
  const referenceInfo = {
    id: "reference-01",
    number: 1,
    fileId: sha(referencePath.split("/").join(String.fromCharCode(92))).slice(
      0,
      20
    ),
    sourceHash: sha(reference),
    start: referenceStart,
    end: referenceStart + referenceQuote.length,
    quote: referenceQuote,
    model: "gemini-3.1-pro",
    fileRelative: referencePath,
    volume: "第一卷",
    chapter: "001",
    startLine: reference.slice(0, referenceStart).split("\n").length,
    endLine: reference
      .slice(0, referenceStart + referenceQuote.length - 1)
      .split("\n").length
  };
  const items = [
    makeItem({
      id: "note-gpt-01",
      model: "gpt-6.1-sol",
      fileRelative: draftPath,
      sourceHash: sha(draft),
      quote: annotatedQuote,
      start: draft.indexOf(annotatedQuote),
      draftReferences: [referenceInfo]
    })
  ];
  if (includeOtherDraft) {
    const otherDraftPath = "004_写作中/第001章_正文草稿_gemini-3.8-flash.md";
    const otherDraft = draft.replaceAll("gpt-6.1-sol", "gemini-3.8-flash");
    writeFileSync(join(root, otherDraftPath), otherDraft);
    items.push(
      makeItem({
        id: "note-gemini-01",
        model: "gemini-3.8-flash",
        fileRelative: otherDraftPath,
        sourceHash: sha(otherDraft),
        quote: annotatedQuote,
        start: otherDraft.indexOf(annotatedQuote)
      })
    );
  }
  const annotationsDir = join(root, "006_批注", "第一卷", "第001章");
  mkdirSync(annotationsDir, { recursive: true });
  writeFileSync(
    join(root, "006_批注", "批注入口.md"),
    "# 作者批注入口\n\n- [第一卷 · 第001章](第一卷/第001章/批注汇总.md)\n"
  );
  writeFileSync(
    join(annotationsDir, "批注汇总.md"),
    "# 第一卷第001章作者批注\n\n作者意见完整内容。\n"
  );
  writeFileSync(
    join(annotationsDir, "批注.json"),
    JSON.stringify({ schema: 1, items }, null, 2)
  );
  const workflowDir = join(root, ".novel/workflow");
  mkdirSync(workflowDir, { recursive: true });
  const statePath = join(workflowDir, "chapter-workflow.json");
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: "love-chapter-workflow/v1",
        project: "LOVE",
        updatedAt: "2026-10-06T00:00:00.000Z",
        chapters: {}
      },
      null,
      2
    )}\n`
  );
  return {
    draftPath,
    referencePath,
    statePath,
    annotationsDir,
    draft,
    reference
  };
}

function tempNames() {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith("deepwrite-love-native-")
  );
}

function readNotes(
  root: string,
  target: Partial<
    Pick<LongLoveChapterWorkflowCommandInput, "targetDraftPath" | "targetModel">
  > = {}
) {
  vi.mocked(requireProject).mockResolvedValue({
    project: { projectRoot: root }
  } as never);
  return runLoveChapterWorkflowCore("unused-user-data-path", {
    bookId: "longbook_9a146bbe",
    action: "read_notes",
    chapter: 1,
    volume: "第一卷",
    ...target
  });
}

async function expectNoNativeTempLeaks(before: string[]) {
  expect(tempNames().sort()).toEqual([...before].sort());
}

afterEach(async () => {
  const tempRoot = await realpath(tmpdir());
  for (const created of roots.splice(0)) {
    const target = await realpath(created);
    const parent = await realpath(dirname(target));
    const rel = relative(tempRoot, target);
    if (
      parent.toLocaleLowerCase("en-US") !==
        tempRoot.toLocaleLowerCase("en-US") ||
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      rel.includes(sep)
    )
      throw new Error(
        "Test fixture cleanup target escaped the OS temp directory."
      );
    rmSync(target, { recursive: true, force: true });
  }
  vi.mocked(requireProject).mockReset();
});

describe("LOVE workflow Core evidence bridge", () => {
  it("reads unselected draft annotations as separate objects without writing adoption state", async () => {
    const root = fixture();
    const { statePath, annotationsDir } = addAnnotationFixture(root, true);
    const notesPath = join(annotationsDir, "批注.json");
    const beforeState = readFileSync(statePath, "utf8");
    const beforeNotes = readFileSync(notesPath, "utf8");
    const workflowDirectoryEntries = readdirSync(dirname(statePath)).sort();

    const result = (await readNotes(root)) as {
      action: string;
      targetGroups: Array<{
        target: { path: string; status: string };
        annotations: Array<{
          authorText: string;
          draftReferences: Array<{ freshness: string }>;
          draftReferenceTombstones: Array<{
            freshness: string;
            historicalExcerpt: string;
          }>;
        }>;
      }>;
      integrity: { references: string };
    };

    expect(result.action).toBe("read_notes");
    expect(result.targetGroups).toHaveLength(2);
    expect(
      new Set(result.targetGroups.map(({ target }) => target.path)).size
    ).toBe(2);
    expect(
      result.targetGroups.every(({ annotations }) => annotations.length === 1)
    ).toBe(true);
    expect(result.targetGroups[0]?.annotations[0]?.authorText).toBe(
      "请调整：note-gpt-01"
    );
    expect(
      result.targetGroups[0]?.annotations[0]?.draftReferences[0]?.freshness
    ).toBe("valid");
    expect(
      result.targetGroups[0]?.annotations[0]?.draftReferenceTombstones[0]
    ).toMatchObject({
      freshness: "removed",
      historicalExcerpt: "已撤回的完整历史摘录。"
    });
    expect(result.integrity.references).toBe("current");
    expect(readFileSync(statePath, "utf8")).toBe(beforeState);
    expect(readFileSync(notesPath, "utf8")).toBe(beforeNotes);
    expect(readdirSync(dirname(statePath)).sort()).toEqual(workflowDirectoryEntries);
  });

  it("filters one draft by explicit model or exact path without requiring selection", async () => {
    const root = fixture();
    const { draftPath } = addAnnotationFixture(root, true);
    const byModel = (await readNotes(root, { targetModel: "gpt-6.1-sol" })) as {
      targetGroups: Array<{ target: { path: string }; annotations: unknown[] }>;
    };
    const byPath = (await readNotes(root, { targetDraftPath: draftPath })) as {
      targetGroups: Array<{ target: { path: string }; annotations: unknown[] }>;
    };

    expect(byModel.targetGroups).toHaveLength(1);
    expect(byModel.targetGroups[0]?.target.path).toBe(draftPath);
    expect(byPath.targetGroups).toHaveLength(1);
    expect(byPath.targetGroups[0]?.target.path).toBe(draftPath);
  });

  it("keeps multiple revisions of the same model in separate hash groups", async () => {
    const root = fixture();
    const { draftPath, draft, annotationsDir } = addAnnotationFixture(root);
    const revisionPath = "004_写作中/第001章_正文草稿_gpt-6.1-sol_修订01.md";
    const revision = draft.replace("教室里坐了不少人。", "教室里坐得很满。");
    writeFileSync(join(root, revisionPath), revision);
    const notesPath = join(annotationsDir, "批注.json");
    const document = JSON.parse(readFileSync(notesPath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };
    document.items.push({
      ...document.items[0],
      id: "note-gpt-revision-01",
      fileRelative: revisionPath,
      sourceHash: sha(revision)
    });
    writeFileSync(notesPath, JSON.stringify(document));

    const result = (await readNotes(root, { targetModel: "gpt-6.1-sol" })) as {
      targetGroups: Array<{ target: { path: string; expectedSha256: string } }>;
      requiresVersionChoice: boolean;
    };

    expect(result.targetGroups).toHaveLength(2);
    expect(result.targetGroups.map(({ target }) => target.path)).toEqual([
      draftPath,
      revisionPath
    ]);
    expect(result.targetGroups[0]?.target.expectedSha256).not.toBe(
      result.targetGroups[1]?.target.expectedSha256
    );
    expect(result.requiresVersionChoice).toBe(true);
  });

  it("returns author words and current text when the annotated draft has changed", async () => {
    const root = fixture();
    const { draftPath, draft } = addAnnotationFixture(root);
    const currentText = `${draft}\n作者后续修改后的安全当前稿。\n`;
    writeFileSync(join(root, draftPath), currentText);

    const result = (await readNotes(root)) as {
      targetGroups: Array<{
        target: { status: string; issues: string[] };
        annotations: Array<{
          authorText: string;
          integrity: { status: string; issues: string[] };
        }>;
        annotatedDraft: { content: string; status: string };
      }>;
    };
    const group = result.targetGroups[0]!;

    expect(group.target.status).toBe("needs_check");
    expect(group.target.issues).toContain("annotated_draft_changed");
    expect(group.annotatedDraft).toMatchObject({
      status: "needs_check",
      content: currentText
    });
    expect(group.annotations[0]?.authorText).toBe("请调整：note-gpt-01");
    expect(group.annotations[0]?.integrity.issues).toContain(
      "annotated_draft_changed"
    );
  });

  it("keeps notes readable when the annotated source is missing", async () => {
    const root = fixture();
    const { draftPath } = addAnnotationFixture(root);
    rmSync(join(root, draftPath));

    const result = (await readNotes(root)) as {
      targetGroups: Array<{
        target: { status: string };
        annotations: Array<{
          authorText: string;
          integrity: { status: string };
        }>;
        annotatedDraft: { content: string | null; status: string };
      }>;
    };
    const group = result.targetGroups[0]!;

    expect(group.target.status).toBe("missing");
    expect(group.annotatedDraft).toMatchObject({
      status: "missing",
      content: null
    });
    expect(group.annotations[0]?.authorText).toBe("请调整：note-gpt-01");
    expect(group.annotations[0]?.integrity.status).toBe("needs_check");
  });

  it("returns stale reference history and only a uniquely located current excerpt", async () => {
    const root = fixture();
    const { referencePath, reference } = addAnnotationFixture(root);
    writeFileSync(
      join(root, referencePath),
      `${reference}\n参考稿的无关更新。\n`
    );

    const result = (await readNotes(root)) as {
      targetGroups: Array<{
        annotations: Array<{
          draftReferences: Array<{
            freshness: string;
            freshnessReason: string;
            excerpt: string;
            currentExcerpt: string | null;
            currentExcerptStatus: string;
          }>;
        }>;
      }>;
    };
    const referenceResult =
      result.targetGroups[0]?.annotations[0]?.draftReferences[0]!;

    expect(referenceResult).toMatchObject({
      freshness: "stale",
      freshnessReason: "source_changed",
      excerpt: "报到那天很热，教室里的人来来往往。",
      currentExcerpt: "报到那天很热，教室里的人来来往往。",
      currentExcerptStatus: "located_needs_check"
    });
  });

  it("does not let one missing reference suppress other annotations", async () => {
    const root = fixture();
    const { referencePath } = addAnnotationFixture(root, true);
    rmSync(join(root, referencePath));

    const result = (await readNotes(root)) as {
      targetGroups: Array<{
        annotations: Array<{
          authorText: string;
          draftReferences: Array<{ freshness: string }>;
        }>;
      }>;
    };

    expect(result.targetGroups).toHaveLength(2);
    expect(result.targetGroups[0]?.annotations[0]?.authorText).toBe(
      "请调整：note-gpt-01"
    );
    expect(
      result.targetGroups[0]?.annotations[0]?.draftReferences[0]?.freshness
    ).toBe("missing");
    expect(result.targetGroups[1]?.annotations[0]?.authorText).toBe(
      "请调整：note-gemini-01"
    );
  });

  it("rejects a reference that traverses a symlink outside the LOVE project", async () => {
    const root = fixture();
    const { annotationsDir, referencePath } = addAnnotationFixture(root);
    const outsideRoot = mkdtempSync(join(tmpdir(), "love-reference-outside-"));
    roots.push(outsideRoot);
    writeFileSync(
      join(outsideRoot, "reference.md"),
      readFileSync(join(root, referencePath), "utf8")
    );
    symlinkSync(outsideRoot, join(root, "004_写作中", "linked"), "junction");
    const notesPath = join(annotationsDir, "批注.json");
    const annotations = JSON.parse(readFileSync(notesPath, "utf8")) as {
      items: Array<{
        draftReferences: Array<{ fileRelative: string; fileId: string }>;
      }>;
    };
    const reference = annotations.items[0]!.draftReferences[0]!;
    reference.fileRelative = "004_写作中/linked/reference.md";
    reference.fileId = sha(reference.fileRelative).slice(0, 20);
    writeFileSync(notesPath, JSON.stringify(annotations));

    await expect(readNotes(root)).rejects.toThrow("包含符号链接");
  });

  it("rejects malicious paths stored in annotation data before any read", async () => {
    const root = fixture();
    const { annotationsDir } = addAnnotationFixture(root);
    const notesPath = join(annotationsDir, "批注.json");
    const annotations = JSON.parse(readFileSync(notesPath, "utf8")) as {
      items: Array<{ fileRelative: string }>;
    };
    annotations.items[0]!.fileRelative = "004_写作中/../../outside.md";
    writeFileSync(notesPath, JSON.stringify(annotations));

    await expect(readNotes(root)).rejects.toThrow("LOVE 项目内规范化相对路径");
  });

  it("passes a UTF-8 annotation larger than 35KB through the actual CLI bridge intact", async () => {
    const root = fixture();
    const { annotationsDir } = addAnnotationFixture(root);
    const notesPath = join(annotationsDir, "批注.json");
    const annotations = JSON.parse(readFileSync(notesPath, "utf8")) as {
      items: Array<{ authorText: string; comment: string }>;
    };
    const marker = "\nFULL-ANNOTATION-END\n";
    const authorText = `${"作者批注全文。".repeat(6_000)}${marker}`;
    expect(Buffer.byteLength(authorText, "utf8")).toBeGreaterThan(35 * 1024);
    annotations.items[0]!.authorText = authorText;
    writeFileSync(notesPath, JSON.stringify(annotations));

    const result = (await readNotes(root)) as {
      targetGroups: Array<{ annotations: Array<{ authorText: string }> }>;
    };

    expect(result.targetGroups[0]?.annotations[0]?.authorText).toBe(authorText);
    expect(
      result.targetGroups[0]?.annotations[0]?.authorText.endsWith(marker)
    ).toBe(true);
  });

  it("passes evidence larger than Windows argv limits via a temporary file and removes it", async () => {
    fixture();
    const nativeEvidence = "当前Core资料。".repeat(5_000);
    expect(nativeEvidence.length).toBeGreaterThan(32_768);
    const before = tempNames();
    const input: LongLoveChapterWorkflowCommandInput = {
      bookId: "longbook_9a146bbe",
      action: "prepare",
      chapter: 1,
      volume: "第一卷"
    };

    const result = (await runLoveChapterWorkflowCore(
      "unused-user-data-path",
      input,
      nativeEvidence
    )) as {
      ok: boolean;
      packet: {
        nativeCurrent: { status: string; hash: string; content: string };
      };
    };

    expect(result.ok).toBe(true);
    expect(result.packet.nativeCurrent).toMatchObject({
      status: "verified_current",
      hash: sha(nativeEvidence),
      content: nativeEvidence
    });
    await expectNoNativeTempLeaks(before);
  });

  it("prepares chapter-two discussion without a selected outline and reads a selected previous draft", async () => {
    const root = fixture();
    const chapterStatePath = join(root, ".novel/chapter-state.json");
    writeFileSync(
      chapterStatePath,
      JSON.stringify({
        project: "LOVE",
        chapters: [{ chapter: 2, volume: "第一卷", status: "planned" }]
      })
    );
    const previousContent = "前章作者选用稿全文；人物只保留当前已知。";
    mkdirSync(join(root, "drafts"), { recursive: true });
    writeFileSync(join(root, "drafts/ch1.md"), previousContent);
    mkdirSync(join(root, ".novel/workflow"), { recursive: true });
    writeFileSync(
      join(root, ".novel/workflow/chapter-workflow.json"),
      JSON.stringify({
        schema: "love-chapter-workflow/v1",
        project: "LOVE",
        updatedAt: "2026-10-06T00:00:00.000Z",
        chapters: {
          "第一卷::1": {
            chapter: 1,
            volume: "第一卷",
            selection: {
              path: "drafts/ch1.md",
              hash: sha(previousContent),
              status: "selected"
            }
          }
        }
      })
    );
    const nativeEvidence = "本轮Core当前原生隔离资料。".repeat(20);
    const input: LongLoveChapterWorkflowCommandInput = {
      bookId: "longbook_9a146bbe",
      action: "prepare",
      chapter: 2,
      volume: "第一卷"
    };

    const result = (await runLoveChapterWorkflowCore(
      "unused-user-data-path",
      input,
      nativeEvidence
    )) as {
      packet: {
        selectedOutline: null;
        previousDraft: { content: string };
        nativeCurrent: { status: string; content: string };
      };
    };

    expect(result.packet.selectedOutline).toBeNull();
    expect(result.packet.previousDraft.content).toBe(previousContent);
    expect(result.packet.nativeCurrent).toMatchObject({
      status: "verified_current",
      content: nativeEvidence
    });
  });

  it("allows discussion without an outline or previous draft and labels both missing", async () => {
    const root = fixture();
    writeFileSync(
      join(root, ".novel/chapter-state.json"),
      JSON.stringify({
        project: "LOVE",
        chapters: [{ chapter: 2, volume: "第一卷", status: "planned" }]
      })
    );
    const input: LongLoveChapterWorkflowCommandInput = {
      bookId: "longbook_9a146bbe",
      action: "prepare",
      chapter: 2,
      volume: "第一卷"
    };

    const result = (await runLoveChapterWorkflowCore(
      "unused-user-data-path",
      input
    )) as {
      packet: {
        selectedOutline: null;
        previousDraft: null;
        nativeCurrent: { status: string };
        safeguards: string[];
      };
    };

    expect(result.packet.selectedOutline).toBeNull();
    expect(result.packet.previousDraft).toBeNull();
    expect(result.packet.nativeCurrent.status).toBe("unverified");
    expect(result.packet.safeguards).toContain(
      "未提供前章作者选用稿；本轮仍可讨论，但若进入接续写作，须先由作者选择前章稿。"
    );
  });

  it("returns a bounded CLI error and cleans the evidence file after failure", async () => {
    fixture();
    const nativeEvidence = "当前隔离资料。".repeat(100);
    const before = tempNames();
    const input: LongLoveChapterWorkflowCommandInput = {
      bookId: "longbook_9a146bbe",
      action: "redraft_context",
      chapter: 1,
      volume: "第一卷"
    };

    await expect(
      runLoveChapterWorkflowCore("unused-user-data-path", input, nativeEvidence)
    ).rejects.toThrow("尚未明确选择第1章的底稿");
    await expectNoNativeTempLeaks(before);
  });
});
