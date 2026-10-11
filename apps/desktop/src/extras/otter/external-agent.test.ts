import { describe, expect, it } from "vitest";
import { codexReviewArguments } from "./external-agent";

describe("External Codex terminal review", () => {
  it("uses exec read-only with stdin and structured output without granting project writes", () => {
    const args = codexReviewArguments(
      "D:/project with spaces",
      "schema.json",
      "output.json"
    );
    expect(args[0]).toBe("exec");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--output-schema");
    expect(args).not.toContain("--add-dir");
    expect(args.join(" ")).not.toContain("danger-full-access");
    expect(args.at(-1)).toBe("-");
  });
});
