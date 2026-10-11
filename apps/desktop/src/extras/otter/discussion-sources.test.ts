import { describe, expect, it, vi } from "vitest";
import type { OtterDiscussionInput } from "@deepwrite/contracts";
import type { OtterProjectAdapter } from "./project-adapter";
import { discussionSources } from "./discussion-sources";
import { prepareProjectDiscussion } from "./discussion-service";
import type { createOtterProtocolService } from "./protocol-service";

const projectId = "otter_project_a";
const project = { projectRoot: "C:/fictional/project" };

function adapterWith(
  documents: Array<Record<string, unknown>>,
  reads: Record<string, string> = {}
) {
  return {
    openProject: vi.fn(async () => ({ documents })),
    listProjects: vi.fn(async () => []),
    resolveProject: vi.fn(async () => project),
    readDocument: vi.fn(async (_projectId: string, path: string) => ({
      path,
      content:
        reads[path] ??
        (path === ".novel/project.json"
          ? JSON.stringify({ project: "Book A" })
          : ""),
      hash: "0".repeat(64)
    }))
  } as unknown as OtterProjectAdapter;
}

const target = {
  path: "004_写作中/第001章_大纲.md",
  category: "plan",
  chapter: "第001章",
  volume: "第一卷",
  status: "current"
};

describe("discussion source selection", () => {
  it("binds a target outline only to its exact selected outline entry", async () => {
    const chapterStatePath = ".novel/chapter-state.json";
    const state = {
      project: "Book A",
      schema_version: 1,
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          status: "planned",
          selected_outline: { path: target.path },
          volume_confirmation: { source: "author" }
        },
        {
          chapter: 1,
          volume: "第二卷",
          status: "planned",
          selected_outline: { path: "plans/other.md" }
        }
      ]
    };
    const adapter = adapterWith([target], {
      [chapterStatePath]: JSON.stringify(state)
    });

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A", chapter_state: chapterStatePath },
        target.path
      )
    ).resolves.toMatchObject({
      chapter: 1,
      volume: "第一卷",
      volumeConfirmation: { source: "author" },
      sources: [
        { path: target.path, role: "text" },
        { path: chapterStatePath, role: "chapter-state" }
      ]
    });
  });

  it("matches chapter metadata only when an explicit volume makes the match unique", async () => {
    const chapterStatePath = ".novel/chapter-state.json";
    const alternateTarget = {
      ...target,
      volume: "第一卷",
      path: "004_写作中/第001章_正文.md"
    };
    const state = {
      project: "Book A",
      schema_version: 1,
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          status: "planned",
          selected_outline: { path: "plans/outline.md" }
        },
        {
          chapter: 1,
          volume: "第二卷",
          status: "planned",
          selected_outline: { path: "plans/other.md" }
        }
      ]
    };
    const adapter = adapterWith([alternateTarget], {
      [chapterStatePath]: JSON.stringify(state)
    });

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A", chapter_state: chapterStatePath },
        alternateTarget.path
      )
    ).resolves.toMatchObject({ chapter: 1, volume: "第一卷" });
  });

  it("does not infer a chapter from another chapter's latest or highest-version record", async () => {
    const chapterStatePath = ".novel/chapter-state.json";
    const unnumberedTarget = {
      path: "004_写作中/个人想法.md",
      category: "plan",
      status: "candidate"
    };
    const adapter = adapterWith([unnumberedTarget], {
      [chapterStatePath]: JSON.stringify({
        project: "Book A",
        schema_version: 1,
        chapters: [
          {
            chapter: 99,
            volume: "第十卷",
            status: "planned",
            selected_outline: { path: "old-outline-v1.md" },
            version: "v99"
          }
        ]
      })
    });

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A", chapter_state: chapterStatePath },
        unnumberedTarget.path
      )
    ).resolves.toMatchObject({
      chapter: undefined,
      volume: undefined,
      sources: [{ path: unnumberedTarget.path, role: "text" }]
    });
  });

  it("refuses to guess when an unvolumed chapter number occurs in multiple volumes", async () => {
    const chapterStatePath = ".novel/chapter-state.json";
    const noVolumeTarget = { ...target, volume: undefined };
    const state = {
      project: "Book A",
      schema_version: 1,
      chapters: [
        { chapter: 1, volume: "第一卷", status: "planned" },
        { chapter: 1, volume: "第二卷", status: "planned" }
      ]
    };
    const adapter = adapterWith([noVolumeTarget], {
      [chapterStatePath]: JSON.stringify(state)
    });

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A", chapter_state: chapterStatePath },
        target.path
      )
    ).rejects.toThrow("有多个登记");
  });

  it("rejects a chapter registry whose project identity does not match", async () => {
    const chapterStatePath = ".novel/chapter-state.json";
    const adapter = adapterWith([target], {
      [chapterStatePath]: JSON.stringify({
        project: "Book B",
        schema_version: 1,
        chapters: [{ chapter: 1, volume: "第一卷", status: "planned" }]
      })
    });

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A", chapter_state: chapterStatePath },
        target.path
      )
    ).rejects.toThrow("不属于当前项目");
  });

  it("rejects target paths outside the active project's document catalogue", async () => {
    const adapter = adapterWith([target]);

    await expect(
      discussionSources(
        adapter,
        projectId,
        { project: "Book A" },
        "other-project/第001章_大纲.md"
      )
    ).rejects.toThrow("不在当前项目目录");
  });

  it("includes non-index people, excludes partial/stale/archived records, and preserves unverified source identity", async () => {
    const documents = [
      {
        path: "characters/宋子凡.md",
        category: "character",
        status: "current"
      },
      {
        path: "relationships/宋子凡-刘瑞东.md",
        category: "relationship",
        status: "current"
      },
      { path: "characters/index.md", category: "character", status: "current" },
      { path: "characters/stale.md", category: "character", status: "stale" },
      {
        path: "characters/partial.md",
        category: "character",
        status: "partial"
      },
      {
        path: "relationships/unverified.md",
        category: "relationship",
        status: "unverified"
      },
      {
        path: "characters/archive/old.md",
        category: "character",
        status: "current"
      },
      { path: "characters/old.md", category: "character", status: "retired" },
      { path: "timeline/events.md", category: "timeline", status: "current" }
    ];
    const adapter = adapterWith(documents);

    const result = await discussionSources(
      adapter,
      projectId,
      { project: "Book A" },
      undefined,
      true
    );

    expect(result.sources.map(({ path }) => path)).toEqual([
      "characters/宋子凡.md",
      "relationships/宋子凡-刘瑞东.md",
      "relationships/unverified.md"
    ]);
  });

  it("does not silently truncate automatic people sources beyond the V1 limit", async () => {
    const documents = Array.from({ length: 31 }, (_, index) => ({
      path: `characters/person-${index + 1}.md`,
      category: "character",
      status: "current"
    }));
    const adapter = adapterWith(documents);
    const protocol = { workflow: vi.fn() } as unknown as ReturnType<
      typeof createOtterProtocolService
    >;
    const input: OtterDiscussionInput = {
      projectId,
      topic: "讨论当前作品的人物关系",
      sources: [],
      includeProjectPeople: true
    };

    await expect(
      prepareProjectDiscussion(adapter, protocol, input)
    ).rejects.toThrow("超过30份");
    expect(protocol.workflow).not.toHaveBeenCalled();
  });

  it("passes all thirty automatic people sources to V1 at the configured limit", async () => {
    const documents = Array.from({ length: 30 }, (_, index) => ({
      path: `characters/person-${index + 1}.md`,
      category: "character",
      status: "current"
    }));
    const adapter = adapterWith(documents);
    const workflow = vi.fn(async (_request: unknown) => ({
      status: "PASS",
      pack: "C:/fictional/project/.novel/context.md",
      receipt: "C:/fictional/project/.novel/receipt.json"
    }));
    const protocol = { workflow } as unknown as ReturnType<
      typeof createOtterProtocolService
    >;

    await prepareProjectDiscussion(adapter, protocol, {
      projectId,
      topic: "讨论当前作品的人物关系",
      sources: [],
      includeProjectPeople: true
    });

    expect(workflow).toHaveBeenCalledTimes(1);
    const request = workflow.mock.calls[0]?.[0] as unknown as {
      input: { sources: Array<{ path: string }> };
    };
    expect(request.input.sources.map(({ path }) => path)).toEqual(
      documents.map(({ path }) => path)
    );
  });
});
