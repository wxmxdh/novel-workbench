export function safeErrorDetails(error: unknown): Record<string, unknown> {
  return { kind: error instanceof Error ? error.name : "unknown" };
}
