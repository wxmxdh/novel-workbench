import type { LongAgentToolDetails } from "./long-agent-tools";
import { createLongWorkspaceToolSharedState } from "./long-agent-tools";
import {
  describe,
  expect,
  fixtureStoryPlotIndex,
  it,
  longTools,
  resultText,
  storyPlotExecutor,
  toolByName
} from "./long-agent-tools.test-support";

function firstDocumentWrite(details: unknown) {
  const proposal = details as LongAgentToolDetails;
  if (proposal.kind !== "long-mutation-proposal") {
    throw new Error("Expected a long mutation proposal.");
  }
  const write = proposal.batch.documentWrites[0];
  if (!write) throw new Error("Expected a document write proposal.");
  return write;
}

describe("unified long-form tools: shared pending proposals", () => {
  it("shares parent-child pending content while isolating read evidence", async () => {
    const index = fixtureStoryPlotIndex();
    const executor = storyPlotExecutor(index);
    const sharedState = createLongWorkspaceToolSharedState();
    const parentTools = longTools({ executor, index, sharedState });
    const childTools = longTools({ executor, index, sharedState });

    await toolByName(parentTools, "read").execute("parent-read", {
      id: "storyplot_one"
    });
    const parentProposal = await toolByName(parentTools, "edit").execute(
      "parent-edit",
      {
        id: "storyplot_one",
        replacements: [{ original_text: "北上线索", new_text: "月湖死剧" }],
        summary: "父智能体修改故事情节"
      }
    );
    const parentWrite = firstDocumentWrite(parentProposal.details);

    const unreadChildEdit = await toolByName(childTools, "edit").execute(
      "child-edit-without-read",
      {
        id: "storyplot_one",
        replacements: [{ original_text: "月湖死剧", new_text: "蒸馏擦肩" }],
        summary: "子智能体未读取时尝试修改"
      }
    );
    expect(resultText(unreadChildEdit)).toContain("请先用 read 完整读取");

    const childRead = await toolByName(childTools, "read").execute(
      "child-read",
      { id: "storyplot_one" }
    );
    expect(resultText(childRead)).toContain("月湖死剧");

    const childProposal = await toolByName(childTools, "edit").execute(
      "child-edit",
      {
        id: "storyplot_one",
        replacements: [{ original_text: "月湖死剧", new_text: "蒸馏擦肩" }],
        summary: "子智能体继续修改故事情节"
      }
    );
    const childWrite = firstDocumentWrite(childProposal.details);

    expect(parentWrite.content).toContain("月湖死剧");
    expect(childWrite.content).toContain("蒸馏擦肩");
    expect(childWrite.content).not.toContain("月湖死剧");
  });
});
