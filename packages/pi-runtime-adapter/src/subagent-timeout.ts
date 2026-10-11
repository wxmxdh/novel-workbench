export const DEFAULT_SUBAGENT_TIMEOUT_MS = 60 * 60_000;

export function resolveSubagentTimeoutMs(
  timeoutMs: number | undefined
): number {
  return timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_SUBAGENT_TIMEOUT_MS;
}

export function subagentTimeoutMessage(timeoutMs: number): string {
  return `子智能体超过 ${Math.ceil(timeoutMs / 1_000)} 秒硬截止时间，运行已终止。`;
}
