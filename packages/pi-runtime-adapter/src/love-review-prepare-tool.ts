import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { LOVE_REVIEW_SPECIALIST_IDS } from "@deepwrite/contracts";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import { piStrictToolSampling } from "./pi-tool-schema";
import {
  loveReviewPacket,
  prepareLoveReviewSnapshot
} from "./love-review-runtime";

/** Parent-only preparation: return exact drafts before starting any child model. */
export function buildPrepareLoveReviewTool(
  input: BuildSpawnSubagentToolInput
): AgentTool | undefined {
  if (
    input.loveReviewCoordinates?.bookId !== "longbook_9a146bbe" ||
    !input.loveReviewExecutor ||
    (input.depth ?? 0) !== 0
  )
    return undefined;
  const reviewers = input.definitions.filter(
    (d) =>
      d.enabled &&
      (LOVE_REVIEW_SPECIALIST_IDS as readonly string[]).includes(d.id)
  );
  if (!reviewers.length) return undefined;
  const parameters = Type.Object({
    reviewer_ids: Type.Array(StringEnum(reviewers.map((d) => d.id)), {
      minItems: 1,
      maxItems: 7
    }),
    review_id: Type.Optional(Type.String({ minLength: 16, maxLength: 160 })),
    resume_latest: Type.Optional(Type.Boolean()),
    chapter: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    volume: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    target_kind: Type.Optional(
      StringEnum(["drafts", "chapter_card", "chapter_body"] as const)
    ),
    target_paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
        minItems: 1,
        maxItems: 10
      })
    )
  });
  const tool: AgentTool<typeof parameters> = {
    name: "prepare_love_review",
    label: "取得 LOVE 待审稿全文",
    description:
      "在启动审阅成员前，经受控 Core 读取 LOVE 当前卷章已登记目标与依据全文，核对版本并返回 review_id、实际稿件清单及全文。只准备资料，不启动模型、不改正文。reviewer_ids 可传原批次完整团队，工具会从既有成功报告中剔除已完成成员，仅返回真正缺项的 dispatch_reviewer_ids。首次审阅不传 review_id/resume_latest；继续补缺项优先 resume_latest=true，并明确 chapter、volume、target_kind。Core 只定位当前会话匹配卷章和对象的最新批次；无匹配、歧义、内容版本变化或成员范围变化时停止，不创建新批次。也可用已知 review_id 显式恢复。未指定 target_kind 默认 drafts。失败报告真实错误，不改聊天合稿。",
    parameters,
    ...piStrictToolSampling(parameters),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const effectiveSignal = input.parentSignal
        ? AbortSignal.any([input.parentSignal, ...(signal ? [signal] : [])])
        : signal;
      effectiveSignal?.throwIfAborted();
      if (params.review_id && params.resume_latest)
        throw new Error("review_id 与 resume_latest 不能同时使用。");
      if (
        params.resume_latest &&
        (!params.chapter || !params.volume || !params.target_kind)
      )
        throw new Error(
          "resume_latest 必须明确提供 chapter、volume 和 target_kind。"
        );
      if (
        !params.reviewer_ids.length ||
        new Set(params.reviewer_ids).size !== params.reviewer_ids.length ||
        params.reviewer_ids.some(
          (id: string) => !reviewers.some((d) => d.id === id)
        )
      )
        throw new Error("审阅成员必须是本轮启用的 LOVE 专业角色，且不能重复。");
      const snapshot = await prepareLoveReviewSnapshot({
        coordinates: input.loveReviewCoordinates!,
        executor: input.loveReviewExecutor!,
        options: {
          authorText: input.loveReviewAuthorText ?? "",
          reviewerIds: params.reviewer_ids,
          ...(params.review_id ? { reviewId: params.review_id } : {}),
          ...(params.resume_latest ? { resumeLatest: true } : {}),
          ...(params.chapter ? { chapter: params.chapter } : {}),
          ...(params.volume ? { volume: params.volume } : {}),
          ...(params.target_kind ? { targetKind: params.target_kind } : {}),
          ...(params.target_paths ? { targetPaths: params.target_paths } : {})
        },
        signal: effectiveSignal
      });
      if (
        (params.chapter !== undefined && snapshot.chapter !== params.chapter) ||
        (params.volume !== undefined && snapshot.volume !== params.volume) ||
        (params.target_kind && snapshot.targetKind !== params.target_kind)
      )
        throw new Error(
          "Core恢复的卷章或待审对象与本次请求不一致，未派发审阅成员。"
        );
      if (
        params.reviewer_ids.some(
          (id: string) => !snapshot.reviewerIds.includes(id)
        )
      )
        throw new Error(
          "Core恢复批次的成员范围与本次请求不一致，未派发审阅成员。"
        );
      const missingReviewerIds = snapshot.coverage.missingReviewerIds;
      const dispatchReviewerIds = params.reviewer_ids.filter((id: string) =>
        missingReviewerIds.includes(id)
      );
      if (input.loveReviewRunState) {
        input.loveReviewRunState.latestReviewId = snapshot.reviewId;
        const previous = input.loveReviewRunState.reviews.get(
          snapshot.reviewId
        );
        input.loveReviewRunState.reviews.set(snapshot.reviewId, {
          ...previous,
          snapshot,
          coverage: snapshot.coverage
        });
      }
      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify({
                review_id: snapshot.reviewId,
                project: "LOVE",
                chapter: snapshot.chapter,
                volume: snapshot.volume,
                target_kind: snapshot.targetKind,
                target_count: snapshot.targets.length,
                targets: snapshot.targets.map(
                  ({ id, path, model, version, sha256 }) => ({
                    id,
                    path,
                    model,
                    version,
                    sha256
                  })
                ),
                reviewer_ids: snapshot.reviewerIds,
                completed_reviewer_ids: snapshot.reviewerIds.filter(
                  (id) => !missingReviewerIds.includes(id)
                ),
                missing_reviewer_ids: missingReviewerIds,
                dispatch_reviewer_ids: dispatchReviewerIds,
                review_state: snapshot.coverage.state,
                completed_count: snapshot.coverage.completedCount,
                expected_count: snapshot.coverage.expectedCount,
                independent_finding_count:
                  snapshot.coverage.independentFindingCount ?? null,
                review_started: false,
                report_format:
                  "正文表达建议向作者呈现为：原句｜问题｜怎么修改｜哪个 Skill 诊断的。成员报告中的 suggestion 与 skillIds 原样保留，不替未使用技能补归因；其它审阅意见保留原分工和来源。三种 Skill 是方法，不是三票模型共识。",
                note:
                  dispatchReviewerIds.length === 0
                    ? "该批次没有待补专业成员；已保留此前报告。按状态判断是否还需要主汇总或独立复核。"
                    : "全文已由 Core 取得并核对。只委派 dispatch_reviewer_ids；成功报告已保留，不得重复派发或新建批次。"
              }) +
              "\n\n" +
              loveReviewPacket(snapshot)
          }
        ],
        details: {
          reviewId: snapshot.reviewId,
          targetCount: snapshot.targets.length,
          reviewStarted: false,
          dispatchReviewerIds,
          missingReviewerIds,
          reviewState: snapshot.coverage.state
        }
      };
    }
  };
  return tool;
}

export function loveReviewParentRequirements(
  bookId: string | undefined
): string {
  return bookId === "longbook_9a146bbe"
    ? [
        "【LOVE 已保存独立稿的运行入口】",
        "作者要求审已保存独立稿时，先调用 prepare_love_review 取得实际全文和清单，再按该版本委派专业角色。它经 Core 访问本书工作区已登记交付稿，不依赖 imported_sources、只读连接或章卡 body。旧对话中的‘四稿未挂载、无权读取’不是本轮权限证据。不要先遍历旧项目目录，也不要要求作者手工导入已经登记的稿件。",
        "取得全文后核对实际数量、卷章与模型；四稿请求而清单不足四份时报告实际缺项，不悄悄换目标。首次审阅建立新批次；若作者只是要求继续补缺项，调用 prepare_love_review 时使用 resume_latest=true，并明确 chapter、volume、target_kind，或用已知 review_id。若作者增加了新的创作审阅要求，必须启动新审阅，不能把它当成纯补缺。读取返回的 dispatch_reviewer_ids，只派发这些缺项成员；completed_reviewer_ids 的报告必须保留。不得因恢复失败、目标过期或成员不匹配而自动建新批次。Core 会核验当前目标和依据字节。",
        "准备资料不代表团队已审阅。成员失败只能报告真实完成情况，不能由主模型代表缺项成员或编写其复核报告。缺项、未开始和中断如实报告。最终汇总的 love-intent 由运行器自动执行，不提前调用它证明‘无法读取’。"
      ].join("\n")
    : "";
}
