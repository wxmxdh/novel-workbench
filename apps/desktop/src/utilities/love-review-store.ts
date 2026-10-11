import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  LOVE_REVIEW_SPECIALIST_IDS,
  LOVE_REVIEW_INDEPENDENT_ID,
  LoveReviewSnapshotSchema,
  LongPrepareLoveReviewInputSchema,
  LongSubmitLoveReviewInputSchema,
  type LoveReviewCoverage,
  type LoveReviewSnapshot,
  type LongPrepareLoveReviewInput,
  type LongSubmitLoveReviewInput
} from "@deepwrite/contracts";
import { withExternalProjectLock } from "./external-project-operations";
import {
  readReviewFile,
  reviewHash,
  reviewSetHash,
  writeReviewJson
} from "./love-review-files";
import { readReviewDraftTargets } from "./love-review-targets";

export interface NativeReviewSources {
  chapter: number;
  volume: string;
  cardPath: string;
  cardContent: string;
  bodyPath: string;
  bodyContent: string;
  evidence: string;
}
interface StoredReview {
  snapshot: LoveReviewSnapshot;
  sessionId: string;
  createdAt?: string;
  targetPaths?: string[];
}
type Source = LoveReviewSnapshot["sources"][number];
const source = (
  id: string,
  path: string,
  role: string,
  content: string
): Source => ({ id, path, role, sha256: reviewHash(content), content });

function coverage(
  snapshot: LoveReviewSnapshot,
  phase: LoveReviewCoverage["phase"]
): LoveReviewCoverage {
  const missingReviewerIds = snapshot.reviewerIds.filter(
    (id) =>
      !snapshot.reports.some(
        (entry) =>
          entry.phase === "specialist" &&
          entry.reviewerId === id &&
          entry.report.status === "reviewed" &&
          !entry.report.missingSources.length
      )
  );
  const independent = snapshot.reports.find(
    (entry) => entry.phase === "independent"
  );
  const main = snapshot.reports.find((entry) => entry.phase === "summary");
  return {
    reviewId: snapshot.reviewId,
    targetSetSha256: snapshot.targetSetSha256,
    expectedCount: snapshot.reviewerIds.length,
    completedCount: snapshot.reviewerIds.length - missingReviewerIds.length,
    missingReviewerIds,
    phase,
    ...(independent
      ? { independentFindingCount: independent.report.findings.length }
      : {}),
    state: missingReviewerIds.length
      ? "incomplete"
      : main?.report.status === "reviewed" &&
          !main.report.missingSources.length &&
          independent?.report.status === "reviewed" &&
          !independent.report.missingSources.length
        ? "ready"
        : "needs_independent_review"
  };
}

/** Locate the newest matching same-session batch without creating a replacement. */
export async function findLatestLoveReviewIdAtRoot(input: {
  root: string;
  sessionId: string;
  chapter: number;
  volume: string;
  targetKind: LoveReviewSnapshot["targetKind"];
}): Promise<string> {
  const directory = ".novel/reviews";
  const entries = await readdir(join(input.root, directory), {
    withFileTypes: true
  }).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return [];
    throw error;
  });
  const matches: { reviewId: string; createdAt: number }[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !/^review-[a-zA-Z0-9-]{16,100}$/u.test(entry.name)
    )
      continue;
    const relativeManifest = `${directory}/${entry.name}/manifest.json`;
    const [content, fileStat] = await Promise.all([
      readReviewFile(input.root, relativeManifest),
      stat(join(input.root, relativeManifest))
    ]);
    let stored: StoredReview;
    try {
      stored = JSON.parse(content) as StoredReview;
      stored.snapshot = LoveReviewSnapshotSchema.parse(stored.snapshot);
    } catch {
      throw new Error("存在无法核对的审阅存档，不能安全判断最新批次。");
    }
    const snapshot = stored.snapshot;
    if (
      stored.sessionId !== input.sessionId ||
      snapshot.chapter !== input.chapter ||
      snapshot.volume !== input.volume ||
      snapshot.targetKind !== input.targetKind
    )
      continue;
    const createdAt = stored.createdAt
      ? Date.parse(stored.createdAt)
      : fileStat.birthtimeMs;
    if (!Number.isFinite(createdAt))
      throw new Error("审阅批次缺少可核对的创建时间，不能判断最新记录。");
    matches.push({ reviewId: snapshot.reviewId, createdAt });
  }
  if (!matches.length)
    throw new Error("当前会话没有匹配的既有审阅批次；未新建批次。");
  matches.sort((a, b) => b.createdAt - a.createdAt);
  if (matches.length > 1 && matches[0]!.createdAt === matches[1]!.createdAt)
    throw new Error("存在多个时间无法区分的匹配审阅批次；不会猜测恢复目标。");
  return matches[0]!.reviewId;
}

async function load(
  root: string,
  reviewId: string,
  sessionId: string
): Promise<StoredReview> {
  if (!/^review-[a-zA-Z0-9-]{16,100}$/u.test(reviewId))
    throw new Error("审阅批次标识无效。");
  const stored = JSON.parse(
    await readReviewFile(root, `.novel/reviews/${reviewId}/manifest.json`)
  ) as StoredReview;
  stored.snapshot = LoveReviewSnapshotSchema.parse(stored.snapshot);
  if (stored.snapshot.reviewId !== reviewId || stored.sessionId !== sessionId)
    throw new Error("审阅批次不属于当前作品会话，不能借用其他会话结果。");
  return stored;
}

async function verifyCurrent(
  root: string,
  stored: StoredReview,
  native: NativeReviewSources
): Promise<boolean> {
  const snapshot = stored.snapshot;
  if (native.chapter !== snapshot.chapter || native.volume !== snapshot.volume)
    return false;
  if (snapshot.targetKind === "drafts") {
    try {
      const currentTargets = await readReviewDraftTargets({
        root,
        chapter: snapshot.chapter,
        volume: snapshot.volume,
        ...(stored.targetPaths ? { targetPaths: stored.targetPaths } : {})
      });
      const identity = (targets: typeof snapshot.targets) =>
        targets
          .map(({ path, sha256 }) => ({ path, sha256 }))
          .sort((a, b) => a.path.localeCompare(b.path));
      if (
        JSON.stringify(identity(currentTargets)) !==
        JSON.stringify(identity(snapshot.targets))
      )
        return false;
    } catch {
      return false;
    }
  }
  for (const item of [...snapshot.targets, ...snapshot.sources]) {
    if (item.path.startsWith("author:")) continue;
    let text: string;
    if (item.path === "native:current") text = native.evidence;
    else if (item.path === `native:${native.cardPath}`)
      text = native.cardContent;
    else if (item.path === `native:${native.bodyPath}`)
      text = native.bodyContent;
    else if (item.path.startsWith("native:")) return false;
    else {
      try {
        text = await readReviewFile(root, item.path);
      } catch {
        return false;
      }
    }
    if (reviewHash(text) !== item.sha256) return false;
  }
  return (
    reviewSetHash(snapshot.targets) === snapshot.targetSetSha256 &&
    reviewSetHash(snapshot.sources) === snapshot.sourceSetSha256
  );
}

export async function prepareLoveReviewAtRoot(input: {
  root: string;
  sessionId: string;
  request: LongPrepareLoveReviewInput;
  native: NativeReviewSources;
}): Promise<LoveReviewSnapshot> {
  const request = LongPrepareLoveReviewInputSchema.parse(input.request);
  const { root, native, sessionId } = input;
  if (!sessionId.trim()) throw new Error("审阅需要实际会话身份。");
  return withExternalProjectLock(root, async () => {
    const resumeId =
      request.reviewId ??
      (request.resumeLatest
        ? await findLatestLoveReviewIdAtRoot({
            root,
            sessionId,
            chapter: native.chapter,
            volume: native.volume,
            targetKind: request.targetKind
          })
        : undefined);
    if (resumeId) {
      const stored = await load(root, resumeId, sessionId);
      if (
        request.targetKind !== stored.snapshot.targetKind ||
        (request.targetPaths &&
          JSON.stringify(request.targetPaths) !==
            JSON.stringify(stored.snapshot.targets.map(({ path }) => path))) ||
        new Set(request.reviewerIds).size !== request.reviewerIds.length ||
        request.reviewerIds.some(
          (id) => !stored.snapshot.reviewerIds.includes(id)
        )
      )
        throw new Error("审阅对象或成员范围变化，请建立新批次，不沿用旧回执。");
      if (!(await verifyCurrent(root, stored, native))) {
        stored.snapshot.coverage = {
          ...stored.snapshot.coverage,
          state: "stale"
        };
        await writeReviewJson(root, resumeId, stored);
        throw new Error(
          "待审正文或依据版本已变化，旧审阅不能覆盖新版本，请建立新批次。"
        );
      }
      if (
        request.authorText !== stored.snapshot.authorText &&
        stored.snapshot.sources.find(({ id }) => id === "author-current")
          ?.sha256 !== reviewHash(request.authorText)
      ) {
        const update = source(
          "author-current",
          "author:current",
          "current-author-verbatim",
          request.authorText
        );
        stored.snapshot.sources = [
          ...stored.snapshot.sources.filter(({ id }) => id !== update.id),
          update
        ];
        stored.snapshot.sourceSetSha256 = reviewSetHash(
          stored.snapshot.sources
        );
        stored.snapshot.reports = stored.snapshot.reports.filter(
          (entry) => entry.phase !== "independent"
        );
        stored.snapshot.coverage = coverage(stored.snapshot, "summary");
        // Keep the original request, and carry the new verbatim instruction to
        // the independent checker without rewriting prior professional reports.
        await writeReviewJson(root, resumeId, stored);
      }
      return stored.snapshot;
    }
    if (
      new Set(request.reviewerIds).size !== request.reviewerIds.length ||
      request.reviewerIds.some(
        (id) => !(LOVE_REVIEW_SPECIALIST_IDS as readonly string[]).includes(id)
      )
    )
      throw new Error(
        "审阅成员不是本书受控专业角色，不能把写作成员或打包员算作审阅员。"
      );
    let selected: { path: string; hash: string } | undefined;
    let outline: string | undefined;
    try {
      const state = JSON.parse(
        await readReviewFile(root, ".novel/chapter-state.json")
      ) as {
        chapters: {
          chapter: number;
          volume: string;
          selected_outline?: { path: string; hash: string };
        }[];
      };
      const chapters = state.chapters.filter(
        (entry) =>
          entry.chapter === native.chapter && entry.volume === native.volume
      );
      if (chapters.length > 1) throw new Error("当前卷章存在重复工作流状态。");
      selected = chapters[0]?.selected_outline;
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (selected) {
      outline = await readReviewFile(root, selected.path);
      if (reviewHash(outline) !== selected.hash)
        throw new Error("已选大纲hash不符，审阅准备未完成。");
      const outlineBody = outline.replace(
        /^---\r?\n[\s\S]*?\r?\n---\r?\n/u,
        ""
      );
      if (
        request.targetKind !== "chapter_card" &&
        outlineBody.trim() !== native.cardContent.trim()
      )
        throw new Error(
          "原生章卡与已选执行大纲已不同步，先报告差异，不借用旧版本。"
        );
    } else if (request.targetKind !== "chapter_card") {
      throw new Error("当前卷章没有唯一已选大纲，不能从旧摘要猜测来源。");
    }
    if (!native.evidence.trim() || !native.cardContent.trim())
      throw new Error("本书必读原文缺失。");
    const targets =
      request.targetKind === "drafts"
        ? await readReviewDraftTargets({
            root,
            chapter: native.chapter,
            volume: native.volume,
            ...(request.targetPaths ? { targetPaths: request.targetPaths } : {})
          })
        : [
            {
              ...source(
                "target-1",
                `native:${request.targetKind === "chapter_body" ? native.bodyPath : native.cardPath}`,
                request.targetKind,
                request.targetKind === "chapter_body"
                  ? native.bodyContent
                  : native.cardContent
              ),
              version: reviewHash(
                request.targetKind === "chapter_body"
                  ? native.bodyContent
                  : native.cardContent
              ).slice(0, 12)
            }
          ];
    if (targets.some((entry) => !entry.content.trim()))
      throw new Error("待审正文为空，不能登记为审阅完成。");
    const sources = [
      source(
        "native-current",
        "native:current",
        "current-project-sources",
        native.evidence
      ),
      ...(selected && outline
        ? [
            source(
              "selected-outline",
              selected.path,
              "selected-outline",
              outline
            )
          ]
        : []),
      source(
        "chapter-card",
        `native:${native.cardPath}`,
        "chapter-card",
        native.cardContent
      ),
      source(
        "author-request",
        "author:request",
        "author-verbatim",
        request.authorText
      )
    ];
    if (
      [...targets, ...sources].some(
        ({ content }) => content.length > 500_000
      ) ||
      [...targets, ...sources].reduce(
        (sum, entry) => sum + entry.content.length,
        0
      ) > 1_000_000
    )
      throw new Error("审阅资料超出完整读取范围，请缩小范围，本轮未截断发送。");
    const reviewId = `review-${randomUUID()}`;
    const snapshot = LoveReviewSnapshotSchema.parse({
      reviewId,
      bookId: request.bookId,
      chapter: native.chapter,
      volume: native.volume,
      targetKind: request.targetKind,
      reviewerIds: request.reviewerIds,
      authorText: request.authorText,
      targets,
      sources,
      targetSetSha256: reviewSetHash(targets),
      sourceSetSha256: reviewSetHash(sources),
      reports: [],
      coverage: {
        reviewId,
        targetSetSha256: reviewSetHash(targets),
        state: "incomplete",
        expectedCount: request.reviewerIds.length,
        completedCount: 0,
        missingReviewerIds: request.reviewerIds,
        phase: "specialist"
      }
    });
    await writeReviewJson(root, reviewId, {
      snapshot,
      sessionId,
      createdAt: new Date().toISOString(),
      ...(request.targetPaths ? { targetPaths: request.targetPaths } : {})
    });
    return snapshot;
  });
}

export async function submitLoveReviewAtRoot(input: {
  root: string;
  sessionId: string;
  request: LongSubmitLoveReviewInput;
  native: NativeReviewSources;
}): Promise<LoveReviewCoverage> {
  const request = LongSubmitLoveReviewInputSchema.parse(input.request);
  return withExternalProjectLock(input.root, async () => {
    const stored = await load(input.root, request.reviewId, input.sessionId);
    const snapshot = stored.snapshot;
    if (!(await verifyCurrent(input.root, stored, input.native))) {
      snapshot.coverage = { ...snapshot.coverage, state: "stale" };
      await writeReviewJson(input.root, request.reviewId, stored);
      throw new Error(
        "正文或依据已变化，当前报告仅属旧版，不能登记当前版完成。"
      );
    }
    if (request.targetSetSha256 !== snapshot.targetSetSha256)
      throw new Error("报告绑定的待审稿hash不符。");
    if (
      (request.phase === "specialist" &&
        !snapshot.reviewerIds.includes(request.reviewerId)) ||
      (request.phase === "summary" && request.reviewerId !== "main") ||
      (request.phase === "independent" &&
        request.reviewerId !== LOVE_REVIEW_INDEPENDENT_ID)
    )
      throw new Error("报告角色与本次审阅范围不符。");
    if (
      request.report.status === "reviewed" &&
      request.report.missingSources.length
    )
      throw new Error("报告存在缺读，不能登记审阅完成。");
    if (
      new Set(request.report.findings.map((finding) => finding.id)).size !==
      request.report.findings.length
    )
      throw new Error("报告问题编号重复。");
    if (
      request.phase === "independent" &&
      (coverage(snapshot, "specialist").missingReviewerIds.length ||
        !snapshot.reports.some(
          (entry) =>
            entry.phase === "summary" &&
            entry.report.status === "reviewed" &&
            !entry.report.missingSources.length
        ))
    )
      throw new Error("专业审阅或实际主汇总尚未取得，不能声称独立复核完成。");
    const main = snapshot.reports.find((entry) => entry.phase === "summary");
    const evidenceSources = [
      ...snapshot.targets,
      ...snapshot.sources,
      ...(main
        ? [
            source(
              "main-summary",
              "report:main-summary",
              "submitted-summary",
              main.report.summary
            )
          ]
        : []),
      ...snapshot.reports.map((entry) =>
        source(
          `${entry.reviewerId}:${entry.phase}`,
          `report:${entry.reviewerId}:${entry.phase}`,
          "original-report",
          JSON.stringify(entry.report)
        )
      )
    ];
    if (
      new Set(request.report.reviewedSourceIds).size !==
        request.report.reviewedSourceIds.length ||
      request.report.reviewedSourceIds.some(
        (id) => !evidenceSources.some((source) => source.id === id)
      )
    )
      throw new Error("报告声明了重复或未提供的读取来源。");
    const requiredIds = [...snapshot.targets, ...snapshot.sources].map(
      ({ id }) => id
    );
    if (request.phase === "independent")
      requiredIds.push(
        "main-summary",
        ...snapshot.reports
          .filter((entry) => entry.phase === "specialist")
          .map((entry) => `${entry.reviewerId}:specialist`)
      );
    if (
      request.report.status === "reviewed" &&
      requiredIds.some((id) => !request.report.reviewedSourceIds.includes(id))
    )
      throw new Error(
        "报告未声明完整覆盖本次提供的待审稿与依据，不能登记完成。"
      );
    for (const finding of request.report.findings) {
      const item = evidenceSources.find(({ id }) => id === finding.sourceId);
      if (!item || !item.content.includes(finding.quote))
        throw new Error(`审阅引文不在声明的原文中：${finding.id}`);
      if (
        finding.reportId &&
        !snapshot.reports.some(
          (entry) => `${entry.reviewerId}:${entry.phase}` === finding.reportId
        )
      )
        throw new Error("汇总引用了不存在的原始报告。");
    }
    // A changed report or summary invalidates the prior independent check.
    snapshot.reports = snapshot.reports.filter(
      (entry) =>
        !(
          entry.phase === request.phase &&
          entry.reviewerId === request.reviewerId
        ) &&
        (request.phase === "independent" || entry.phase !== "independent") &&
        (request.phase !== "specialist" || entry.phase !== "summary")
    );
    snapshot.reports.push({
      reviewerId: request.reviewerId,
      phase: request.phase,
      report: request.report,
      runtime: request.runtime
    });
    snapshot.coverage = coverage(snapshot, request.phase);
    await writeReviewJson(input.root, request.reviewId, stored);
    return snapshot.coverage;
  });
}
