import { describe, expect, it } from "vitest";
import type { AgentToolTrace } from "../types/conversation";
import {
  foldWorkGroups,
  type WorkGroupDisplayItem
} from "./conversationWorkGroups";
import { workGroupActivityLabel } from "./conversationActivityLabel";

function thinking(
  id: string,
  content = "思考"
): {
  id: string;
  type: "thinking";
  content: string;
  createdAt: string;
} {
  return {
    id,
    type: "thinking",
    content,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function response(
  id: string,
  content: string
): { id: string; type: "response"; content: string; createdAt: string } {
  return {
    id,
    type: "response",
    content,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function toolGroup(id: string): {
  id: string;
  type: "tool-group";
  tools: AgentToolTrace[];
} {
  return {
    id,
    type: "tool-group",
    tools: [
      {
        id,
        name: "read_workspace_content",
        args: {},
        status: "completed",
        requestedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

describe("foldWorkGroups", () => {
  it("merges consecutive thinking and tools into one work group", () => {
    const items = foldWorkGroups(
      [thinking("t1"), toolGroup("g1"), thinking("t2")],
      false
    );
    expect(items.map((item) => item.type)).toEqual(["work-group"]);
    expect(items[0]).toMatchObject({
      id: "work:t1",
      type: "work-group",
      running: false
    });
    expect(
      (items[0] as WorkGroupDisplayItem).items.map((item) => item.id)
    ).toEqual(["t1", "g1", "t2"]);
  });

  it("breaks on visible responses, subagents and approval cards", () => {
    const items = foldWorkGroups(
      [
        thinking("t1"),
        response("r1", "正文"),
        toolGroup("g1"),
        {
          id: "subagent:child",
          type: "subagent" as const,
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        thinking("t2"),
        {
          id: "edit:p1",
          type: "edit-proposal" as const,
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      false
    );
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group",
      "subagent",
      "work-group",
      "edit-proposal"
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "work:t1",
      "r1",
      "work:g1",
      "subagent:child",
      "work:t2",
      "edit:p1"
    ]);
  });

  it("skips empty responses so they do not split a work group", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("empty", ""), toolGroup("g1")],
      true
    );
    expect(items.map((item) => item.type)).toEqual(["work-group"]);
    expect((items[0] as WorkGroupDisplayItem).running).toBe(true);
    expect(
      (items[0] as WorkGroupDisplayItem).items.map((item) => item.id)
    ).toEqual(["t1", "g1"]);
  });

  it("marks only the trailing work group as running", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("r1", "正文"), toolGroup("g1")],
      true
    );
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group"
    ]);
    expect((items[0] as WorkGroupDisplayItem).running).toBe(false);
    expect((items[2] as WorkGroupDisplayItem).running).toBe(true);
  });

  it("keeps completed work groups closed when a breaker follows", () => {
    const items = foldWorkGroups(
      [thinking("t1"), response("r1", "正文")],
      true
    );
    expect((items[0] as WorkGroupDisplayItem).running).toBe(false);
    expect(workGroupActivityLabel(items[0] as WorkGroupDisplayItem)).toBe(
      "处理完成"
    );
    const running = foldWorkGroups([thinking("t2"), toolGroup("g1")], true);
    expect(workGroupActivityLabel(running[0] as WorkGroupDisplayItem)).toBe(
      "读取文件"
    );
    const thinkingLast = foldWorkGroups(
      [toolGroup("g1"), thinking("after")],
      true
    );
    expect(
      workGroupActivityLabel(thinkingLast[0] as WorkGroupDisplayItem)
    ).toBe("思考中");
  });
});
