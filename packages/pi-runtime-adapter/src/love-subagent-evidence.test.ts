import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildLoveSubagentEvidence } from "./love-subagent-evidence";

describe("LOVE parent evidence", () => {
  it("does not attribute kernel-acquired chapter sources to the human author", () => {
    const evidence = buildLoveSubagentEvidence([
      {
        role: "user",
        content:
          "讨论第二章大纲\n\n【运行器实际读取的LOVE接续材料】模型必须读：前章中的候选心理描写",
        timestamp: 1
      }
    ] as AgentMessage[]);
    expect(evidence).toContain("讨论第二章大纲");
    expect(evidence).not.toContain("候选心理描写");
  });
  it("extracts user words from the runtime project wrapper without misattribution", () => {
    const evidence = buildLoveSubagentEvidence([
      {
        role: "user",
        content:
          "【本轮长篇工作区上下文】\nAGENTS 及项目资料中的解释\n【用户消息与上传附件】\n作者：这个动作只在这里删掉",
        timestamp: 1
      }
    ] as AgentMessage[]);
    expect(evidence).toContain("这个动作只在这里删掉");
    expect(evidence).not.toContain("项目资料中的解释");
  });
  it("does not relabel a system compaction checkpoint as author testimony", () => {
    const evidence = buildLoveSubagentEvidence([
      {
        role: "user",
        content: "【较早对话的压缩检查点】\n机器总结",
        timestamp: 1
      },
      { role: "user", content: "这是本轮作者的话", timestamp: 2 }
    ] as AgentMessage[]);
    expect(evidence).toContain("系统压缩摘要：不是作者原话");
    expect(evidence).not.toContain("作者可见消息 1");
    expect(evidence).toContain("作者可见消息 2");
  });
  it("preserves author qualifications and labels AI claims separately", () => {
    const messages = [
      {
        role: "user",
        content: "这里只是不适合，不是全书禁止；贾可能朋友不多？",
        timestamp: 1
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "全书禁止且只有宋一个朋友。" }
        ],
        timestamp: 2
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "tool instructions" }],
        timestamp: 3
      }
    ] as unknown as AgentMessage[];
    const evidence = buildLoveSubagentEvidence(messages);
    expect(evidence).toContain(
      "这里只是不适合，不是全书禁止；贾可能朋友不多？"
    );
    expect(evidence).toContain("候选，不能归为作者原话");
    expect(evidence).not.toContain("private reasoning");
    expect(evidence).not.toContain("tool instructions");
  });

  it("keeps newest author messages and reports incomplete history", () => {
    const messages = Array.from({ length: 15 }, (_, index) => ({
      role: "user",
      content: `原话${index}:` + "字".repeat(4_000),
      timestamp: index
    })) as AgentMessage[];
    const evidence = buildLoveSubagentEvidence(messages);
    expect(evidence).toContain("原话14:");
    expect(evidence).not.toContain("原话0:");
    expect(evidence).toContain("历史决定请回源");
    expect(evidence.length).toBeLessThan(34_000);
  });

  it("explicitly marks an overlong author quote and AI candidate", () => {
    const messages = [
      { role: "user", content: "字".repeat(40_000), timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "稿".repeat(20_000) }],
        timestamp: 2
      }
    ] as unknown as AgentMessage[];
    expect(buildLoveSubagentEvidence(messages)).toContain("本条截断");
    expect(buildLoveSubagentEvidence(messages)).toContain("AI 输出截断");
  });
});
