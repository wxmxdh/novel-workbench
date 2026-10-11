import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  resolveSubagentTimeoutMs,
  subagentTimeoutMessage
} from "./subagent-timeout";

describe("subagent timeout policy", () => {
  it("allows subagents to run for one hour by default", () => {
    expect(DEFAULT_SUBAGENT_TIMEOUT_MS).toBe(3_600_000);
    expect(resolveSubagentTimeoutMs(undefined)).toBe(3_600_000);
    expect(subagentTimeoutMessage(DEFAULT_SUBAGENT_TIMEOUT_MS)).toContain(
      "3600 秒硬截止时间"
    );
  });

  it("keeps valid overrides and falls back for invalid values", () => {
    expect(resolveSubagentTimeoutMs(20)).toBe(20);
    expect(resolveSubagentTimeoutMs(0)).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);
    expect(resolveSubagentTimeoutMs(Number.NaN)).toBe(
      DEFAULT_SUBAGENT_TIMEOUT_MS
    );
  });
});
