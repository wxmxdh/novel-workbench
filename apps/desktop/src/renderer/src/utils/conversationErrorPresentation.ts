const GEMINI_TOOL_SCHEMA_400 =
  /\b400\b[\s\S]{0,180}?\binvalid argument\b[\s\S]{0,180}?request\.tools\[\d+\]\.function_declarations\[\d+\]\.parameters\b/i;

const MAX_ERROR_SUMMARY_LENGTH = 220;

export interface ConversationErrorPresentation {
  kind: "generic" | "gemini-tool-schema";
  summary: string;
  details?: string;
}

export function sanitizeConversationErrorDetails(errorMessage: string): string {
  return errorMessage
    .replace(
      /(["']?(?:authorization|x-api-key|api[-_]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|key)["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^"'`,;\s}\]]+/gi,
      "$1[redacted]"
    )
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

export function presentConversationError(
  errorMessage: string | undefined
): ConversationErrorPresentation {
  const details = errorMessage
    ? sanitizeConversationErrorDetails(errorMessage)
    : "";
  if (!details) return { kind: "generic", summary: "" };

  if (GEMINI_TOOL_SCHEMA_400.test(details)) {
    return { kind: "gemini-tool-schema", summary: "", details };
  }

  const summary = details.replace(/\s+/g, " ").trim();
  if (summary.length <= MAX_ERROR_SUMMARY_LENGTH) {
    return { kind: "generic", summary };
  }
  return {
    kind: "generic",
    summary: `${summary.slice(0, MAX_ERROR_SUMMARY_LENGTH).trimEnd()}…`,
    details
  };
}
