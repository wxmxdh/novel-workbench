import type { Context } from "@earendil-works/pi-ai";

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProviderToolSchemaValidationOptions {
  /** Gemini's legacy Schema API cannot express literal boolean true. */
  allowBooleanTrueLiteral?: boolean;
}

function assertPortableSchemaKeywords(
  toolName: string,
  value: unknown,
  options: ProviderToolSchemaValidationOptions
): void {
  if (Array.isArray(value)) {
    value.forEach((item) =>
      assertPortableSchemaKeywords(toolName, item, options)
    );
    return;
  }
  if (!isSchemaRecord(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, "const")) {
    if (
      options.allowBooleanTrueLiteral &&
      value.type === "boolean" &&
      value.const === true
    ) {
      Object.values(value).forEach((child) =>
        assertPortableSchemaKeywords(toolName, child, options)
      );
      return;
    }
    throw new Error(
      `工具“${toolName}”的参数 schema 不得使用 const，请使用 PI StringEnum。`
    );
  }
  Object.values(value).forEach((child) =>
    assertPortableSchemaKeywords(toolName, child, options)
  );
}

/**
 * Validate the canonical PI-facing schema without rewriting it. Provider
 * function tools always receive a JSON object as their arguments, and root
 * unions are intentionally rejected because legacy provider serializers can
 * silently discard their branches.
 */
export function assertProviderToolParameterSchema(
  toolName: string,
  value: unknown,
  options: ProviderToolSchemaValidationOptions = {}
): Record<string, unknown> {
  if (!isSchemaRecord(value)) {
    throw new Error(
      `工具“${toolName}”的参数 schema 必须是 JSON Schema 对象，当前根节点无效。`
    );
  }
  if (value.type !== "object") {
    const actualType =
      value.type === undefined || value.type === null
        ? "未声明"
        : JSON.stringify(value.type);
    throw new Error(
      `工具“${toolName}”的参数 schema 根节点必须声明 type: "object"，当前为 ${actualType}。`
    );
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(value[keyword])) {
      throw new Error(
        `工具“${toolName}”的参数 schema 根节点不得使用 ${keyword}，请改为普通对象参数。`
      );
    }
  }
  assertPortableSchemaKeywords(toolName, value, options);
  return value;
}

export function enforceProviderToolSchemaCompatibility(
  context: Context,
  options: ProviderToolSchemaValidationOptions = {}
): Context {
  if (!context.tools?.length) return context;
  for (const tool of context.tools) {
    assertProviderToolParameterSchema(tool.name, tool.parameters, options);
  }
  return context;
}
