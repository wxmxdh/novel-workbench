import { describe, expect, it } from "vitest";
import { OtterContextRefSchema } from "@deepwrite/contracts";
import { contextRef, inspectSources, requestsTeam } from "./teamRunSelection";

describe("explicit team routing and source evidence", () => {
  it("reads outline version from the exact hash-bound source when V1 metadata omits it", () => {
    const pack = {
      metadata: {
        selectedOutline: { path: "outline_v999.md", hash: "selected" }
      },
      sources: [
        {
          path: "outline_v999.md",
          hash: "selected",
          role: "outline",
          line_start: 1,
          line_end: 8,
          content: '---\nversion: "2.2"\n---\n# Outline\n'
        }
      ]
    };
    expect(inspectSources(JSON.stringify(pack)).selectedOutline).toBe(
      "outline_v999.md · v2.2"
    );
    pack.sources[0]!.hash = "changed";
    expect(inspectSources(JSON.stringify(pack)).selectedOutline).toBe(
      "outline_v999.md"
    );
  });
  it("routes natural-language requests to a picker without pretending the model called anyone", () => {
    expect(requestsTeam("用这个团队来看看大纲2.2的问题")).toBe(true);
    expect(requestsTeam("让智能体团队审核人物动机")).toBe(true);
    expect(requestsTeam("讨论一下人物动机")).toBe(false);
  });
  it("passes a strict reference without result-only fields across IPC", () => {
    const input = {
      projectId: "otter_0123456789abcdef",
      contextPath: ".novel/context/CTX-1.json",
      receiptPath: ".novel/receipts/RCPT-1.json",
      contextId: "CTX-1",
      status: "PASS" as const
    };
    expect(() => OtterContextRefSchema.parse(input)).toThrow();
    expect(OtterContextRefSchema.parse(contextRef(input))).toEqual({
      projectId: input.projectId,
      contextPath: input.contextPath,
      receiptPath: input.receiptPath
    });
  });
  it("only labels a source fully delivered when verified navigation proves the whole range", () => {
    const evidence = inspectSources(
      JSON.stringify({
        sources: [
          {
            path: "人物.md",
            role: "character",
            authority: "derived",
            line_start: 1,
            line_end: 20
          },
          { path: "摘要.md", role: "text", line_start: 3, line_end: 4 }
        ],
        navigation: {
          must_read: [
            { path: "人物.md", mustReadFully: true },
            { path: "摘要.md", mustReadFully: false }
          ]
        },
        metadata: {
          selectedOutline: { path: "作者登记的大纲.md", version: "2.2" }
        }
      })
    );
    expect(evidence.sources.map((source) => source.full)).toEqual([
      true,
      false
    ]);
    expect(evidence.sources[0]?.authority).toBe("derived");
    expect(evidence.selectedOutline).toBe("作者登记的大纲.md · v2.2");
  });
});
