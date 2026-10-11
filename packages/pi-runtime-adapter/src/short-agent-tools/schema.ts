import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import type { ShortWorkspaceToolDetails } from "./shared";

export function literalUnion<T extends string>(
  values: readonly T[],
  options?: { description?: string }
) {
  if (values.length === 1) {
    return Type.Literal(values[0]!, options);
  }
  return Type.Union(
    values.map((value) => Type.Literal(value)),
    options
  );
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

export function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    output[key] = sanitizeToolSchemaForGemini(child);
  }

  for (const unionKey of ["anyOf", "oneOf"]) {
    const union = output[unionKey];
    if (!Array.isArray(union) || union.length === 0) continue;
    const branches = union as Array<Record<string, unknown>>;
    if (
      branches.every(
        (branch) =>
          branch &&
          typeof branch === "object" &&
          Object.prototype.hasOwnProperty.call(branch, "const")
      )
    ) {
      const values = branches.map((branch) => branch.const);
      delete output[unionKey];
      output.enum = values;
      if (!output.type) {
        const types = [...new Set(values.map(primitiveTypeOf).filter(Boolean))];
        if (types.length === 1) output.type = types[0];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "const")) {
    output.enum = [output.const];
    if (!output.type) output.type = primitiveTypeOf(output.const);
    delete output.const;
  }
  return output;
}

export function defineTool<
  T extends ReturnType<typeof Type.Object>
>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<ShortWorkspaceToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, ShortWorkspaceToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute,
    ...(definition.executionMode
      ? { executionMode: definition.executionMode }
      : {})
  };
}
