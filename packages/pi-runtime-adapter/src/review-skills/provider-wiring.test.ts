import { describe, expect, it } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import { buildSpawnSubagentTool } from "../subagent-runtime";
import { reviewFixture } from "../love-review.test-support";
import { reviewSkillBundle } from "./runtime";
import { validateLoveReviewReport } from "../love-review-report";

describe("review skills reach the actual child provider", () => {
  it.each([undefined, [], ["sepia"]] as const)(
    "respects member settings %s without write tools and persists suggestion attribution",
    async (ids) => {
      const faux = fauxProvider({
        api: "review-skills-fixture",
        provider: "review-skills-fixture",
        tokensPerSecond: 0,
        models: [{ id: "fixture-model", name: "Fixture", reasoning: false }]
      });
      const fixture = reviewFixture("请审阅当前原稿", ["love-expression"]);
      const report = JSON.parse(fixture.report());
      report.findings = [
        {
          id: "suggestion-1",
          category: "literary-suggestion",
          scope: "本句",
          issue: "可保留普通动作",
          sourceId: "draft-1",
          quote: "我把表格放在桌上。",
          suggestion: "原样保留。",
          skillIds: ids?.length === 0 ? [] : ids ?? ["shuorenhua"]
        }
      ];
      faux.setResponses([fauxAssistantMessage(JSON.stringify(report))]);
      const models = createModels();
      models.setProvider(faux.provider);
      const requests: Array<{ system: string; tools: string[] }> = [];
      const streamFn: StreamFn = (model, context, options) => {
        requests.push({
          system: context.systemPrompt ?? "",
          tools: context.tools?.map((item) => item.name) ?? []
        });
        return models.streamSimple(model, context, options);
      };
      const tool = buildSpawnSubagentTool({
        parentSessionId: "fixture-session",
        model: faux.getModel("fixture-model") as Model<Api>,
        thinkingLevel: "off",
        streamFn,
        definitions: [
          {
            id: "love-expression",
            name: "表达审核",
            description: "审核表达",
            systemPrompt: "只给建议",
            enabled: true,
            modelMode: "inherit",
            ...(ids === undefined ? {} : { reviewSkillIds: [...ids] })
          }
        ],
        loveReviewSnapshot: fixture.snapshot,
        loveReviewAuthorText: fixture.snapshot.authorText,
        loveReviewCoordinates: {
          bookId: fixture.snapshot.bookId,
          sessionId: "fixture-session",
          runId: "fixture-run"
        },
        loveReviewExecutor: fixture.executor,
        buildChildTools: () =>
          [
            { name: "write", label: "Write" },
            { name: "read", label: "Read" }
          ] as never
      })!;
      await tool.execute("fixture", {
        subagent_id: "love-expression",
        task: "审核表达"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.tools).not.toContain("write");
      expect(requests[0]!.tools).toContain("read");
      if (ids?.length === 0) {
        expect(requests[0]!.tools).not.toContain("load_review_skill");
        expect(requests[0]!.system).not.toContain(
          reviewSkillBundle.shuorenhua.files["SKILL.md"]
        );
      } else {
        expect(requests[0]!.tools).toContain("load_review_skill");
        if (ids === undefined)
          expect(requests[0]!.system).toContain(
            "56a156045d2ac25ebf8210768b6c2608a42c37ac7ee4979d746cde7b026012db"
          );
        expect(requests[0]!.system).toContain(
          (ids === undefined
            ? reviewSkillBundle.shuorenhua.files["SKILL.md"]
            : reviewSkillBundle.sepia.files["SKILL.md"])
        );
        expect(requests[0]!.system).not.toContain(
          reviewSkillBundle["human-writing"].files["SKILL.md"]!
        );
      }
      expect(fixture.snapshot.reports[0]?.report.findings[0]).toMatchObject({
        suggestion: "原样保留。",
        skillIds: ids?.length === 0 ? [] : ids ?? ["shuorenhua"]
      });
    }
  );
  it("retains four-column fields and rejects fabricated method IDs", () => {
    const source = [{ id: "draft", content: "原句。" }];
    const finding = {
      id: "finding",
      category: "literary-suggestion",
      scope: "本句",
      issue: "问题",
      sourceId: "draft",
      quote: "原句。",
      suggestion: "建议。",
      skillIds: ["shuorenhua"]
    };
    const report = {
      status: "reviewed",
      summary: "已审阅",
      findings: [finding],
      missingSources: [],
      reviewedSourceIds: ["draft"]
    };
    expect(
      validateLoveReviewReport(JSON.stringify(report), source)
    ).toMatchObject({ ok: true, report: { findings: [finding] } });
    finding.skillIds = ["imaginary-detector"];
    expect(
      validateLoveReviewReport(JSON.stringify(report), source)
    ).toMatchObject({ ok: false, reason: expect.stringContaining("Skill") });
  });
});
