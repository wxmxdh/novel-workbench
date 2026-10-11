import {
  Check,
  buildLongWorkspaceTools,
  committedFixtureIndex,
  createLongWorkspaceNavigationSnapshot,
  describe,
  documentExecutor,
  expect,
  expectNoPhysicalWorldbuildingMetadata,
  fixtureIndex,
  fixtureWorldFile,
  fixtureWorldbuildingIndex,
  it,
  indexResult,
  longTools,
  profile,
  resultText,
  toolByName,
  vi,
  workspace
} from "./long-agent-tools.test-support";
import type { LongCommandExecutor } from "./long-agent-tools.test-support";

describe("unified long-form tools: surface", () => {
  it("packages a scoped Codex writing handoff without creating prose or replacing the outline", async () => {
    const index = fixtureIndex();
    index.bookId = "longbook_9a146bbe";
    const activeWorkspace = workspace("long", "draft");
    activeWorkspace.bookId = index.bookId;
    const executor = vi.fn<LongCommandExecutor>(async (command) => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        ok: true,
        purpose: "draft_handoff",
        promptPath: "test/交给Codex写作.md"
      }
    }));
    const tool = toolByName(
      buildLongWorkspaceTools({
        workspace: activeWorkspace,
        profile: profile("long"),
        sessionId: "handoff_session",
        runId: "handoff_run",
        executor
      }),
      "prepare_codex_review"
    );
    const result = await tool.execute("handoff", {
      scope: "第一章Codex底稿交接",
      purpose: "draft_handoff",
      chapter: 1,
      volume: "第一卷"
    } as never);
    expect(resultText(result)).toContain("promptPath");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]![0]).toMatchObject({
      type: "long.prepareCodexReview",
      payload: { purpose: "draft_handoff", chapter: 1, volume: "第一卷" }
    });
    await expect(
      tool.execute("bad-handoff", {
        scope: "交接",
        purpose: "draft_handoff",
        chapter: 1,
        target: "other-card.md"
      } as never)
    ).rejects.toThrow("不接受替代");
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it("resolves an explicit chapter target to its registered body path", async () => {
    const index = fixtureIndex();
    index.bookId = "longbook_9a146bbe";
    const activeWorkspace = workspace("long", "draft");
    activeWorkspace.bookId = index.bookId;
    activeWorkspace.navigation = createLongWorkspaceNavigationSnapshot(index);
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      if (command.type === "long.getWorkspaceIndex") {
        return indexResult(index);
      }
      if (command.type === "long.prepareCodexReview") {
        return {
          status: "accepted" as const,
          requestId: command.id,
          payload: { ok: true, packageDir: "test-package" }
        };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const tools = buildLongWorkspaceTools({
      workspace: activeWorkspace,
      profile: profile("long"),
      sessionId: "session_codex_target_test",
      runId: "run_codex_target_test",
      executor
    });
    const tool = toolByName(tools, "prepare_codex_review");

    await tool.execute("chapter-target", {
      scope: "测试显式章卡目标",
      target_id: "chapter_one",
      document: "body"
    } as never);

    const command = executor.mock.calls.find(
      ([value]) => value.type === "long.prepareCodexReview"
    )?.[0];
    expect(command?.type).toBe("long.prepareCodexReview");
    if (command?.type !== "long.prepareCodexReview") {
      throw new Error("Review package command was not sent.");
    }
    expect(command.payload.target).toBe("long/chapters/one/body.md");
    expect(command.payload.scope).toContain("已注册章卡 chapter_one/body");
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("exposes original document tools and the scoped source tools", () => {
    const tools = longTools({ executor: documentExecutor(fixtureIndex()) });
    expect(tools.map((tool) => tool.name)).toEqual([
      "query_linked_material_entries",
      "load_skill",
      "ask_user_question",
      "list",
      "read",
      "query_imported_sources",
      "propose_long_source_import",
      "create",
      "edit",
      "delete",
      "propose_continuity_commit"
    ]);
  });

  it("requires a scope id and lists only that scope's second-level structure", async () => {
    const index = fixtureWorldbuildingIndex();
    const tools = longTools({ executor: documentExecutor(index) });
    const list = toolByName(tools, "list");

    expect(
      Check(list.parameters, {
        stage: "plot",
        scope_id: "book_line"
      })
    ).toBe(true);
    expect(Check(list.parameters, { stage: "plot" })).toBe(false);
    await expect(
      list.execute("list-missing-scope", { stage: "plot" } as never)
    ).rejects.toThrow("list 必须提供 scope_id");

    const worldbuilding = resultText(
      await list.execute("list-world", {
        stage: "worldbuilding",
        scope_id: "world_magic"
      })
    );
    expect(worldbuilding).toContain("worlditem_memory");
    expect(worldbuilding).not.toContain("world_rules");
    expectNoPhysicalWorldbuildingMetadata(worldbuilding);

    const characters = resultText(
      await list.execute("list-character", {
        stage: "character",
        scope_id: "protagonist"
      })
    );
    expect(characters).toContain("character_alice");
    expect(characters).toContain("林岚");
    expect(characters).not.toContain("character_overview");

    const plot = resultText(
      await list.execute("list-plot", {
        stage: "plot",
        scope_id: "volume_one"
      })
    );
    expect(plot).toContain("volume_one");
    expect(plot).toContain("arc_one");
    expect(plot).toContain("chapter_one");
    expect(plot).not.toContain("book_line");

    const draft = resultText(
      await list.execute("list-draft", {
        stage: "draft",
        scope_id: "volume_one"
      })
    );
    expect(draft).toContain("chapter_one 第一章");
    expect(draft).toContain("正文：空白");

    const continuity = resultText(
      await list.execute("list-continuity", {
        stage: "continuity",
        scope_id: "chapter_one"
      })
    );
    expect(continuity).toContain("chapter_one");
    expect(continuity).toContain("连续记录 未提交");
  });

  it("reads document and index-backed bodies in full and hides file ids", async () => {
    const index = fixtureIndex();
    const worldFile = fixtureWorldFile(index);
    const tools = longTools({
      executor: documentExecutor(index, {
        [worldFile.id]: "雾潮期间禁止点燃蓝焰。"
      })
    });
    const read = toolByName(tools, "read");

    const world = resultText(
      await read.execute("read-world", { id: "world_rules" })
    );
    expect(world).toContain("世界规则（world_rules）");
    expect(world).toContain("雾潮期间禁止点燃蓝焰。");
    expect(world).not.toContain(worldFile.id);

    const volume = resultText(
      await read.execute("read-volume", { id: "volume_one" })
    );
    expect(volume).toContain("第一卷（volume_one）");
    expect(volume).toContain("（正文为空）");

    const profile = resultText(
      await read.execute("read-character", {
        id: "character_alice",
        document: "core_profile"
      })
    );
    expect(profile).toContain(
      "林岚 / 核心档案（character_alice／core_profile）"
    );
  });

  it("uses one primary id and an optional chapter context", async () => {
    const index = committedFixtureIndex();
    const continuity = index.chapters[0]!.characterContinuity[0]!;
    const read = toolByName(
      longTools({
        executor: documentExecutor(index, {
          [continuity.currentState.id]: "第一章末状态。"
        }),
        index
      }),
      "read"
    );

    expect(
      Check(read.parameters, {
        id: "character_alice",
        document: "current_state",
        chapter_id: "chapter_one"
      })
    ).toBe(true);
    expect(
      Check(read.parameters, {
        id: "chapter_one",
        document: "continuity_character_current_state",
        character_id: "character_alice"
      })
    ).toBe(false);

    const exact = resultText(
      await read.execute("read-exact-character-state", {
        id: "character_alice",
        document: "current_state",
        chapter_id: "chapter_one"
      })
    );
    expect(exact).toContain("第一章末状态。");
    expect(exact).toContain("（character_alice／current_state）");
    expect(exact).not.toContain("continuity_character_current_state");

    await expect(
      read.execute("read-profile-with-chapter", {
        id: "character_alice",
        document: "core_profile",
        chapter_id: "chapter_one"
      })
    ).rejects.toThrow("chapter_id 仅用于人物 current_state 或 history");
  });
});
