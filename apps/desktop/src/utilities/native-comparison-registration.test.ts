import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { registerNativeComparison } from "./native-comparison-registration";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const publicCli = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../写作协议V1"
);
interface TestFixture {
  workspace: string;
  cleanup(): void;
  put(path: string, value: unknown, root?: string): string;
}
const { fixture } = createRequire(import.meta.url)(
  join(publicCli, "test/fixtures.mjs")
) as {
  fixture(): TestFixture;
};
const fixtures: TestFixture[] = [];
afterEach(() => {
  for (const current of fixtures.splice(0)) current.cleanup();
});

function setup() {
  const current = fixture();
  fixtures.push(current);
  const destination = join(current.workspace, "06_脚本工具/写作协议V1");
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(publicCli, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs"))
      cpSync(join(publicCli, entry.name), join(destination, entry.name));
  }
  const relative = "projects/native-LOVE";
  const root = join(current.workspace, relative);
  mkdirSync(root, { recursive: true });
  current.put("AGENTS.md", "# 独立隔离测试入口\n", root);
  const card = "# 第一章\n## 开场\n隔离测试起点。\n## 结尾\n隔离测试终点。\n";
  const request = {
    bookId: "longbook_9a146bbe" as const,
    authorizationId: "fixture-registration-auth-01",
    chapter: 1,
    chapterCardId: "fixture-chapter-01",
    authorRequestId: "fixture-author-01",
    volumeId: "fixture-volume-01",
    chapterCardSha256: digest(card),
    volumeSha256: digest("隔离卷卡"),
    authorRequest: {
      requestId: "fixture-author-01",
      exactText: "按当前已选大纲写第一章独立稿。",
      authorizationQuote: "按当前已选大纲写第一章独立稿。",
      receivedAt: "2026-10-06T00:00:00.000Z"
    }
  };
  const source = {
    cardTitle: "第一章",
    cardContent: card,
    chapterCardId: request.chapterCardId,
    volumeId: request.volumeId,
    volumeLabel: "第一卷",
    volumeContent: "隔离卷卡",
    nativeEvidence: "隔离人物状态与关系，未知保留。"
  };
  const base = { workspace: current.workspace, relative, root };
  const statePath = join(root, ".novel/chapter-state.json");
  const projectPath = join(root, ".novel/project.json");
  return { current, base, request, source, statePath, projectPath };
}

describe("native execution registration preserves author outline selection", () => {
  it("keeps the current task pointer when a new task cannot be saved", async () => {
    const data = setup();
    await registerNativeComparison({
      ...data.base,
      request: data.request,
      source: data.source
    });
    const beforeState = readFileSync(data.statePath, "utf8");
    const next = {
      ...data.request,
      authorizationId: "fixture-registration-auth-02"
    };
    data.current.put(
      `.novel/native-execution/${next.authorizationId}/task.json`,
      "conflicting fixture",
      data.base.root
    );
    await expect(
      registerNativeComparison({
        ...data.base,
        request: next,
        source: data.source
      })
    ).rejects.toThrow();
    expect(readFileSync(data.statePath, "utf8")).toBe(beforeState);
  });
  it("keeps the same chosen outline, plan and selection proof for a new writing authorization", async () => {
    const data = setup();
    await registerNativeComparison({
      ...data.base,
      request: data.request,
      source: data.source
    });
    const before = JSON.parse(readFileSync(data.statePath, "utf8")).chapters[0];
    const next = {
      ...data.request,
      authorizationId: "fixture-registration-auth-02"
    };
    await registerNativeComparison({
      ...data.base,
      request: next,
      source: data.source
    });
    const after = JSON.parse(readFileSync(data.statePath, "utf8")).chapters[0];
    expect(after.selected_outline).toEqual(before.selected_outline);
    expect(after.registered_plan).toEqual(before.registered_plan);
    expect(after.volume_confirmation).toEqual(before.volume_confirmation);
    expect(after.comparison_task).not.toBe(before.comparison_task);
    expect(
      existsSync(
        join(
          data.base.root,
          ".novel/native-execution",
          next.authorizationId,
          "chapter-card.md"
        )
      )
    ).toBe(false);
    const task = JSON.parse(
      readFileSync(join(data.base.root, after.comparison_task), "utf8")
    );
    expect(task.plan).toBe(before.registered_plan.path);
    expect(task.volume_confirmation).toEqual(before.volume_confirmation);
  });

  it("refuses a different native card before changing selection or the runtime snapshot", async () => {
    const data = setup();
    await registerNativeComparison({
      ...data.base,
      request: data.request,
      source: data.source
    });
    const beforeState = readFileSync(data.statePath, "utf8");
    const beforeProject = readFileSync(data.projectPath, "utf8");
    const changedCard = data.source.cardContent + "新的隔离场次。\n";
    const next = {
      ...data.request,
      authorizationId: "fixture-registration-auth-02",
      chapterCardSha256: digest(changedCard)
    };
    await expect(
      registerNativeComparison({
        ...data.base,
        request: next,
        source: {
          ...data.source,
          cardContent: changedCard,
          nativeEvidence: "另一个资料版本。"
        }
      })
    ).rejects.toThrow("不会自动重新选纲");
    expect(readFileSync(data.statePath, "utf8")).toBe(beforeState);
    expect(readFileSync(data.projectPath, "utf8")).toBe(beforeProject);
    expect(
      existsSync(
        join(data.base.root, ".novel/native-execution", next.authorizationId)
      )
    ).toBe(false);
  });

  it("refreshes an execution snapshot without replacing the unchanged outline or author plan", async () => {
    const data = setup();
    await registerNativeComparison({
      ...data.base,
      request: data.request,
      source: data.source
    });
    const before = JSON.parse(readFileSync(data.statePath, "utf8")).chapters[0];
    const nativeEvidence =
      "隔离人物当前状态更新；未知仍保留，未登记新故事事实。";
    await registerNativeComparison({
      ...data.base,
      request: {
        ...data.request,
        authorizationId: "fixture-registration-auth-02"
      },
      source: { ...data.source, nativeEvidence }
    });
    const after = JSON.parse(readFileSync(data.statePath, "utf8")).chapters[0];
    const project = JSON.parse(readFileSync(data.projectPath, "utf8"));
    const task = JSON.parse(
      readFileSync(join(data.base.root, after.comparison_task), "utf8")
    );
    expect(after.selected_outline).toEqual(before.selected_outline);
    expect(after.registered_plan).toEqual(before.registered_plan);
    expect(project.canon.hash).toBe(digest(nativeEvidence));
    expect(
      task.sources.every(
        (item: { path: string }) => item.path === project.canon.source
      )
    ).toBe(true);
    expect(
      readFileSync(join(data.base.root, project.canon.source), "utf8")
    ).toBe(nativeEvidence);
  });
});
