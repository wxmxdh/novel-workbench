import { describe, expect, it } from "vitest";
import { buildShortWorkspaceTools } from "./short-agent-tools";
import {
  details,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

describe("unified short workspace create tool", () => {
  it("describes character creation differently for text and list structures", () => {
    const textTools = buildShortWorkspaceTools({
      workspace: shortWorkspace(),
      profile: shortProfile()
    });
    expect(toolByName(textTools, "create").description).toContain(
      "当前人物为文本样式"
    );
    expect(toolByName(textTools, "create").description).toContain(
      "不要用 kind=character 创建独立条目"
    );
    expect(toolByName(textTools, "create").description).toContain(
      "把所有人设写入同一份 character_overview"
    );
    expect(
      JSON.stringify(toolByName(textTools, "create").parameters)
    ).toContain("文本样式禁止使用 character");

    const listTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design", { characterList: true }),
      profile: shortProfile()
    });
    expect(toolByName(listTools, "create").description).toContain(
      "当前人物为条目样式"
    );
    expect(toolByName(listTools, "create").description).toContain(
      "kind=character 为单个人物创建独立条目"
    );
  });

  it("rejects creating a character item when the stage is text-styled", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile()
    });
    await expect(
      toolByName(tools, "create").execute("create-character-text", {
        kind: "character",
        meta: { title: "许舟" },
        content: "许舟负责保管车票。",
        summary: "创建人物"
      })
    ).rejects.toThrow("当前人物为文本样式，不能创建独立人物条目");
  });

  it("creates a character together with its character-card content", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design", { characterList: true }),
      profile: shortProfile()
    });
    const created = await toolByName(tools, "create").execute(
      "create-character",
      {
        kind: "character",
        meta: { title: "许舟" },
        content: "许舟负责保管车票。",
        summary: "创建人物"
      }
    );
    expect(details(created)).toMatchObject({
      kind: "workspace-character-structure-mutation",
      mutation: { type: "createItem", title: "许舟" },
      initialContent: "许舟负责保管车票。"
    });
    const itemId = resultText(created).match(/item_id=(\S+)/u)?.[1];
    expect(itemId).toBeTruthy();
    expect(
      resultText(
        await toolByName(tools, "read").execute("read-created-character", {
          kind: "character",
          id: itemId!
        })
      )
    ).toContain("许舟负责保管车票。");
  });

  it("creates a draft section together with body and character state", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("draft"),
      profile: shortProfile()
    });
    const created = await toolByName(tools, "create").execute("create-draft", {
      kind: "draft_section",
      meta: {
        title: "第三节",
        word_count_requirement: "1200 字",
        after_id: "section-2"
      },
      content: "第三节正文。",
      character_state: "林默确认了名单。",
      summary: "创建第三节"
    });
    expect(details(created)).toMatchObject({
      kind: "workspace-expert-draft-section-creation",
      afterSectionId: "section-2",
      sections: [
        {
          title: "第三节",
          wordCountRequirement: "1200 字",
          bodyContent: "第三节正文。",
          characterStateContent: "林默确认了名单。"
        }
      ]
    });
    const sectionId = resultText(created).match(/section_id=(\S+)/u)?.[1];
    expect(sectionId).toMatch(/^pending:section:/u);
    const read = toolByName(tools, "read");
    expect(
      resultText(
        await read.execute("read-created-body", {
          kind: "draft_section",
          id: sectionId!,
          document: "body"
        })
      )
    ).toContain("第三节正文。");
    expect(
      resultText(
        await read.execute("read-created-state", {
          kind: "draft_section",
          id: sectionId!,
          document: "character_state"
        })
      )
    ).toContain("林默确认了名单。");
  });

  it("creates a global plot structure together with this book's text", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("plot_design"),
      profile: shortProfile()
    });
    const created = await toolByName(tools, "create").execute("create-plot", {
      kind: "plot_stage",
      meta: {
        title: "真相回收",
        description: "回收前文线索并揭示核心真相。"
      },
      content: "名单其实记录的是失踪船员。",
      summary: "增加真相回收结构"
    });
    expect(details(created)).toMatchObject({
      kind: "workspace-plot-structure-mutation",
      mutation: {
        type: "create",
        title: "真相回收",
        description: "回收前文线索并揭示核心真相。",
        content: "名单其实记录的是失踪船员。"
      }
    });
    const stageId = resultText(created).match(/stage_id=(\S+)/u)?.[1];
    expect(stageId).toMatch(/^pending:plot-stage:/u);
    expect(
      resultText(
        await toolByName(tools, "read").execute("read-created-plot", {
          kind: "plot_stage",
          id: stageId!
        })
      )
    ).toContain("名单其实记录的是失踪船员。");
  });
});
