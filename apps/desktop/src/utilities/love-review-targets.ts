import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoveReviewSnapshot } from "@deepwrite/contracts";
import { readReviewFile, reviewField, reviewHash } from "./love-review-files";

type Target = LoveReviewSnapshot["targets"][number];
interface Delivery {
  artifact: { path: string; hash: string };
  identity: { model_raw: string };
  created_at: string;
}

export async function readReviewDraftTargets(input: {
  root: string;
  chapter: number;
  volume: string;
  targetPaths?: string[];
}): Promise<Target[]> {
  let paths = input.targetPaths;
  const expected = new Map<string, string>();
  if (!paths) {
    let filenames: string[];
    try {
      filenames = await readdir(join(input.root, ".novel/deliveries"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          "当前章没有登记的独立稿件，请先保存稿件或明确本项目内待审路径。"
        );
      throw error;
    }
    const latest = new Map<string, Delivery>();
    for (const filename of filenames.filter((name) => name.endsWith(".json"))) {
      const value = JSON.parse(
        await readReviewFile(input.root, `.novel/deliveries/${filename}`)
      ) as Delivery;
      if (
        !value.artifact?.path?.startsWith("004_写作中/") ||
        !value.identity?.model_raw ||
        !/^[a-f0-9]{64}$/u.test(value.artifact.hash) ||
        !Number.isFinite(Date.parse(value.created_at))
      )
        throw new Error("独立稿交付记录不完整，不能猜测待审来源。");
      const text = await readReviewFile(input.root, value.artifact.path);
      if (!reviewField(text, "chapter") || !reviewField(text, "volume"))
        throw new Error("登记稿件卷章身份或版本已变化，不能默默跳过该稿。");
      if (
        Number(reviewField(text, "chapter")) !== input.chapter ||
        reviewField(text, "volume") !== input.volume
      )
        continue;
      const old = latest.get(value.identity.model_raw);
      if (!old || value.created_at > old.created_at)
        latest.set(value.identity.model_raw, value);
    }
    paths = [...latest.values()].map((entry) => {
      expected.set(entry.artifact.path, entry.artifact.hash);
      return entry.artifact.path;
    });
  }
  if (!paths.length)
    throw new Error(
      "当前卷章没有可读的已登记独立稿，原生正文为空不能替代独立稿。"
    );
  if (paths.length > 10 || new Set(paths).size !== paths.length)
    throw new Error("待审稿件范围重复或过大。");
  const targets: Target[] = [];
  for (const [index, path] of paths.entries()) {
    if (
      !path.endsWith(".md") ||
      !path.replaceAll("\\", "/").startsWith("004_写作中/")
    )
      throw new Error(
        "待审正文须位于 LOVE 的 004_写作中，不能改读同名旧项目。"
      );
    const content = await readReviewFile(input.root, path);
    if (
      !content.trim() ||
      Number(reviewField(content, "chapter")) !== input.chapter ||
      reviewField(content, "volume") !== input.volume
    )
      throw new Error("待审稿件缺少当前卷章身份或正文为空。");
    const sha256 = reviewHash(content);
    if (expected.has(path) && expected.get(path) !== sha256)
      throw new Error(
        `稿件版本已变化：${path}。请明确审当前版本，不能沿用旧交付证明。`
      );
    targets.push({
      id: `draft-${index + 1}`,
      path,
      role: "draft",
      version: sha256.slice(0, 12),
      sha256,
      content,
      model:
        reviewField(content, "model_raw") ??
        reviewField(content, "model") ??
        "unknown"
    });
  }
  return targets;
}
