import type { ChatContextCompaction } from "../types/conversation";

export const compactionReasonKeys = {
  threshold: "reasonThreshold",
  overflow: "reasonOverflow",
  manual: "reasonManual",
  idle: "reasonIdle",
  run_limit: "reasonRunLimit"
} as const;
export const compactionTokenSourceKeys = {
  "provider-usage": "tokenSourceProviderUsage",
  "local-estimate": "tokenSourceLocalEstimate",
  "context-window-floor": "tokenSourceWindowFloor"
} as const;

/** Hide ordinary no-op prune attempts; keep failures and explicit no-ops visible. */
export function visibleCompaction(item: ChatContextCompaction): boolean {
  if (item.status === "failed" || item.status === "unchanged") return true;
  return (
    item.status !== "completed" ||
    item.level === "summary" ||
    !!item.checkpoint ||
    (item.tokensBefore ?? 0) > (item.tokensAfter ?? 0)
  );
}
