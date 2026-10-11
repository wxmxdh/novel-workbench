import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { buildProviderRuntime } from "./index";
import {
  isOllamaProviderName,
  isGeminiToolSchemaTarget,
  resolvePortableToolSchemaProfile,
  resolveProviderToolSchemaMode,
  sanitizeGeminiToolSchema,
  sanitizePortableToolSchema,
  sanitizePortableWritingToolSchema
} from "./portable-tool-schema";

function workspaceContext(
  kind: "shortWorkspace" | "scriptWorkspace" | "longWorkspace"
): WorkspaceRuntimeContext {
  return { [kind]: {} } as unknown as WorkspaceRuntimeContext;
}

function writingGrammarTool(): AgentTool {
  const parameters = Type.Object({
    direct_text: Type.String({ minLength: 1, maxLength: 200_000 }),
    pattern: Type.Optional(Type.String({ maxLength: 256 })),
    replacements: Type.Array(
      Type.Object({
        original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
        new_text: Type.String({ maxLength: 20_000 })
      }),
      { minItems: 1, maxItems: 100, uniqueItems: true }
    )
  });
  return {
    name: "edit_writing_text",
    label: "Edit writing text",
    description: "Edit writing text with exact replacements.",
    parameters,
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {}
    })
  };
}

async function captureToolParameters(
  config: AgentProviderRuntimeConfig,
  profile: "default" | "writing-workspace"
): Promise<Record<string, unknown>> {
  const tool = writingGrammarTool();
  const { model, streamFn } = buildProviderRuntime(config, 0.7, "off", {
    portableToolSchemaProfile: profile
  });
  let payload: unknown;
  const stream = await streamFn(
    model,
    {
      systemPrompt: "Use the available tool.",
      messages: [{ role: "user", content: "Edit the text.", timestamp: 0 }],
      tools: [tool]
    },
    {
      onPayload: (value) => {
        payload = value;
        throw new Error("payload captured");
      }
    }
  );
  await stream.result();
  return (
    payload as {
      tools: Array<{ function: { parameters: Record<string, unknown> } }>;
    }
  ).tools[0]!.function.parameters;
}

function explicitTrueTool(
  name: string,
  parameters: AgentTool["parameters"]
): AgentTool {
  return {
    name,
    label: name,
    description: "This test tool requires an explicit true value.",
    parameters,
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {}
    })
  };
}

async function captureProviderPayload(
  config: AgentProviderRuntimeConfig,
  tools: AgentTool[]
): Promise<Record<string, unknown>> {
  const { model, streamFn } = buildProviderRuntime(config, 0.7, "off");
  let payload: unknown;
  const stream = await streamFn(
    model,
    {
      systemPrompt: "Use the available tool.",
      messages: [{ role: "user", content: "Check the schema.", timestamp: 0 }],
      tools
    },
    {
      onPayload: (value) => {
        payload = value;
        throw new Error("payload captured");
      }
    }
  );
  await stream.result();
  if (!payload || typeof payload !== "object") {
    throw new Error("Provider payload was not captured.");
  }
  return payload as Record<string, unknown>;
}

function findToolParameters(
  value: unknown,
  toolName: string
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findToolParameters(child, toolName);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const nestedFunction = record.function;
  if (
    nestedFunction &&
    typeof nestedFunction === "object" &&
    (nestedFunction as Record<string, unknown>).name === toolName
  ) {
    const functionRecord = nestedFunction as Record<string, unknown>;
    const parameters =
      functionRecord.parameters ?? functionRecord.parametersJsonSchema;
    if (parameters && typeof parameters === "object") {
      return parameters as Record<string, unknown>;
    }
  }
  if (record.name === toolName) {
    const parameters = record.parameters ?? record.parametersJsonSchema;
    if (parameters && typeof parameters === "object") {
      return parameters as Record<string, unknown>;
    }
  }
  for (const child of Object.values(record)) {
    const found = findToolParameters(child, toolName);
    if (found) return found;
  }
  return undefined;
}

describe("portable tool schema compatibility", () => {
  it("selects the writing profile only for writing workspaces", () => {
    expect(resolvePortableToolSchemaProfile()).toBe("default");
    expect(resolvePortableToolSchemaProfile({})).toBe("default");
    expect(
      resolvePortableToolSchemaProfile(workspaceContext("shortWorkspace"))
    ).toBe("writing-workspace");
    expect(
      resolvePortableToolSchemaProfile(workspaceContext("scriptWorkspace"))
    ).toBe("writing-workspace");
    expect(
      resolvePortableToolSchemaProfile(workspaceContext("longWorkspace"))
    ).toBe("writing-workspace");
  });

  it("recognizes only the explicit Ollama provider name", () => {
    expect(isOllamaProviderName("ollama")).toBe(true);
    expect(isOllamaProviderName(" OLLAMA ")).toBe(true);
    expect(isOllamaProviderName("custom")).toBe(false);
    expect(isOllamaProviderName("ollama-compatible")).toBe(false);
    expect(resolveProviderToolSchemaMode("ollama")).toBe("portable");
    expect(resolveProviderToolSchemaMode("custom")).toBe("native");
    expect(resolveProviderToolSchemaMode("custom", "portable")).toBe(
      "portable"
    );
    expect(resolveProviderToolSchemaMode("ollama", "native")).toBe("native");
  });

  it("identifies Gemini by API and the actual request model", () => {
    expect(
      isGeminiToolSchemaTarget({
        api: "google-generative-ai",
        modelId: "models/gemini-3.8-flash"
      })
    ).toBe(true);
    expect(
      isGeminiToolSchemaTarget({
        api: "openai-completions",
        modelId: "kdi-gemini-3.8-flash"
      })
    ).toBe(true);
    expect(
      isGeminiToolSchemaTarget({
        api: "openai-responses",
        modelId: "gemini-3.1-pro-preview"
      })
    ).toBe(true);
    for (const [api, modelId] of [
      ["google-generative-ai", "custom-alias"],
      ["openai-completions", "gpt-6.1-sol"],
      ["openai-responses", "claude-opus-4"],
      ["anthropic-messages", "gemini-3.8-flash"],
      ["openai-completions", "notgemini-compatible"]
    ] as const) {
      expect(isGeminiToolSchemaTarget({ api, modelId })).toBe(false);
    }
  });

  it("removes only boolean literal keywords from a transport clone", () => {
    const schema = {
      type: "object",
      properties: {
        must_be_true: {
          type: "boolean",
          enum: [true],
          description: "必须显式传 true。"
        },
        literal_true: {
          type: "boolean",
          const: true,
          description: "同样必须显式传 true。"
        },
        mode: { type: "string", enum: ["left", "right"] }
      }
    };
    const sanitized = sanitizeGeminiToolSchema(schema) as typeof schema;

    expect(sanitized).not.toBe(schema);
    expect(sanitized.properties.must_be_true).toEqual({
      type: "boolean",
      description: "必须显式传 true。"
    });
    expect(sanitized.properties.literal_true).toEqual({
      type: "boolean",
      description: "同样必须显式传 true。"
    });
    expect(sanitized.properties.mode).toEqual(schema.properties.mode);
    expect(schema.properties.must_be_true.enum).toEqual([true]);
    expect(schema.properties.literal_true.const).toBe(true);
  });

  it("captures Gemini and forwarded-Gemini requests with short, long, and team literals sanitized", async () => {
    const shortParameters = Type.Object({
      include_all_sections: Type.Optional(
        Type.Literal(true, { description: "全部读取时必须显式传 true。" })
      )
    });
    const longParameters = Type.Object({
      allow_overwrite_existing: Type.Optional(
        Type.Unsafe<true>({
          type: "boolean",
          enum: [true],
          description: "覆盖现有正文时必须显式传 true。"
        })
      )
    });
    const teamParameters = Type.Object({
      require_independent_review: Type.Optional(
        Type.Unsafe<true>({
          type: "boolean",
          enum: [true],
          description: "需要独立审阅时必须显式传 true。"
        })
      )
    });
    const short = explicitTrueTool("short_read", shortParameters);
    const long = explicitTrueTool("long_edit", longParameters);
    const team = explicitTrueTool("team_delegate", teamParameters);
    const tools = [short, long, team];
    const geminiConfig: AgentProviderRuntimeConfig = {
      id: "gemini-schema-test",
      label: "Gemini schema test",
      provider: "custom",
      modelId: "gemini-3.8-flash",
      api: "google-generative-ai",
      baseUrl: "https://provider.example.test/v1beta",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only"
    };
    const forwardedGeminiConfig: AgentProviderRuntimeConfig = {
      ...geminiConfig,
      id: "forwarded-gemini-schema-test",
      label: "Forwarded Gemini schema test",
      modelId: "kdi-gemini-3.8-flash",
      api: "openai-completions",
      baseUrl: "https://openai-gateway.example.test/v1"
    };

    for (const config of [geminiConfig, forwardedGeminiConfig]) {
      const payload = await captureProviderPayload(config, tools);
      for (const tool of tools) {
        const providerParameters = findToolParameters(payload, tool.name);
        expect(providerParameters, tool.name).toBeDefined();
        expect(JSON.stringify(providerParameters)).not.toMatch(
          /"(?:enum|const)"\s*:\s*(?:\[\s*true\s*\]|true)/u
        );
      }
    }

    expect(shortParameters.properties.include_all_sections).toBeDefined();
    expect(longParameters.properties.allow_overwrite_existing).toMatchObject({
      type: "boolean",
      enum: [true]
    });
    expect(teamParameters.properties.require_independent_review).toMatchObject({
      type: "boolean",
      enum: [true]
    });
  });

  it("leaves a non-Gemini OpenAI request schema unchanged", async () => {
    const parameters = Type.Object({
      allow_overwrite_existing: Type.Optional(
        Type.Unsafe<true>({ type: "boolean", enum: [true] })
      )
    });
    const config: AgentProviderRuntimeConfig = {
      id: "openai-schema-test",
      label: "OpenAI schema test",
      provider: "custom",
      modelId: "gpt-6.1-sol",
      api: "openai-completions",
      baseUrl: "https://provider.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["off"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: "test-only"
    };
    const payload = await captureProviderPayload(config, [
      explicitTrueTool("edit", parameters)
    ]);
    expect(findToolParameters(payload, "edit")).toMatchObject({
      properties: {
        allow_overwrite_existing: { type: "boolean", enum: [true] }
      }
    });
    expect(parameters.properties.allow_overwrite_existing).toMatchObject({
      type: "boolean",
      enum: [true]
    });
  });

  it("keeps the default sanitizer limited to the known nested maxLength bug", () => {
    const schema = {
      type: "object",
      properties: {
        direct_text: { type: "string", maxLength: 200_000 },
        nested: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 2_000 }
          }
        }
      }
    };
    const sanitized = sanitizePortableToolSchema(schema) as typeof schema;

    expect(sanitized.properties.direct_text.maxLength).toBe(200_000);
    expect(sanitized.properties.nested.properties.text).not.toHaveProperty(
      "maxLength"
    );
    expect(schema.properties.nested.properties.text.maxLength).toBe(2_000);
  });

  it("removes writing grammar constraints without deleting same-named parameters", () => {
    const schema = {
      type: "object",
      default: {
        pattern: "literal default value",
        maxItems: 3
      },
      properties: {
        pattern: { type: "string", maxLength: 256 },
        maxItems: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", pattern: "^[A-Z]+$" }
        }
      }
    };
    const sanitized = sanitizePortableWritingToolSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(sanitized.properties).toHaveProperty("pattern");
    expect(sanitized.properties).toHaveProperty("maxItems");
    expect(sanitized.properties.pattern).not.toHaveProperty("maxLength");
    const maxItemsParameter = sanitized.properties.maxItems;
    if (!maxItemsParameter) throw new Error("Missing maxItems test parameter.");
    expect(maxItemsParameter).toMatchObject({
      type: "array",
      minItems: 1
    });
    expect(maxItemsParameter).not.toHaveProperty("maxItems");
    expect(maxItemsParameter).not.toHaveProperty("uniqueItems");
    expect(
      maxItemsParameter.items as Record<string, unknown>
    ).not.toHaveProperty("pattern");
    expect(sanitized).toMatchObject({
      default: {
        pattern: "literal default value",
        maxItems: 3
      }
    });
    expect(schema.properties.maxItems.maxItems).toBe(100);
  });

  it("applies the writing profile only to Ollama provider payloads", async () => {
    const config: AgentProviderRuntimeConfig = {
      id: "local-writing-model",
      label: "Local writing model",
      provider: "ollama",
      modelId: "writer-model",
      api: "openai-completions",
      baseUrl: "https://ollama.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.2, 0.7, 1.2],
      apiKey: ""
    };

    const writingParameters = await captureToolParameters(
      config,
      "writing-workspace"
    );
    const writingSchema = JSON.stringify(writingParameters);
    expect(writingSchema).not.toContain('"maxLength"');
    expect(writingSchema).not.toContain('"maxItems"');
    expect(writingSchema).not.toContain('"uniqueItems"');
    expect(writingSchema).toContain('"minLength"');
    expect(writingSchema).toContain('"minItems"');
    expect(writingParameters).toMatchObject({
      properties: {
        pattern: { type: "string" },
        replacements: {
          items: {
            properties: {
              original_text: { type: "string", minLength: 1 },
              new_text: { type: "string" }
            }
          }
        }
      }
    });

    const defaultParameters = await captureToolParameters(config, "default");
    expect(defaultParameters).toMatchObject({
      properties: {
        direct_text: { maxLength: 200_000 },
        replacements: { maxItems: 100, uniqueItems: true }
      }
    });

    const customParameters = await captureToolParameters(
      { ...config, provider: "custom", apiKey: "test-only" },
      "writing-workspace"
    );
    expect(customParameters).toMatchObject({
      properties: {
        direct_text: { maxLength: 200_000 },
        replacements: {
          maxItems: 100,
          uniqueItems: true,
          items: {
            properties: {
              original_text: { maxLength: 2_400 },
              new_text: { maxLength: 20_000 }
            }
          }
        }
      }
    });

    const portableCustomParameters = await captureToolParameters(
      {
        ...config,
        provider: "custom",
        apiKey: "test-only",
        toolSchemaProfile: "portable"
      },
      "writing-workspace"
    );
    expect(JSON.stringify(portableCustomParameters)).not.toContain(
      '"maxLength"'
    );

    const nativeOllamaParameters = await captureToolParameters(
      { ...config, toolSchemaProfile: "native" },
      "writing-workspace"
    );
    expect(nativeOllamaParameters).toMatchObject({
      properties: {
        direct_text: { maxLength: 200_000 },
        replacements: { maxItems: 100, uniqueItems: true }
      }
    });
  });
});
