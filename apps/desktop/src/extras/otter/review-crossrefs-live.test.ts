import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateOtterReviewModuleClosure } from "./review-protocol";

describe("live cross-draft reference module closure", () => {
  it("accepts the actual updated workspace server and its new reference service", async () => {
    const workspace = path.resolve(process.cwd(), "../..");
    const entry = path.join(
      workspace,
      "06_脚本工具",
      "小说对照工作台",
      "server.mjs"
    );
    const modules = await validateOtterReviewModuleClosure(workspace, entry);
    expect(modules.map((file) => path.basename(file))).toContain(
      "draft-reference-service.mjs"
    );
    expect(modules.map((file) => path.basename(file))).toContain("ai-service.mjs");
    expect(modules.every((file) => file.startsWith(workspace + path.sep))).toBe(
      true
    );
  });
});
