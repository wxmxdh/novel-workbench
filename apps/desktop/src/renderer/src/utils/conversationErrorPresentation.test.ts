import { describe, expect, it } from "vitest";
import {
  presentConversationError,
  sanitizeConversationErrorDetails
} from "./conversationErrorPresentation";

describe("conversation error presentation", () => {
  it("recognizes the deterministic Gemini tool-parameter schema 400", () => {
    const presentation = presentConversationError(
      "400 Invalid argument: request.tools[0].function_declarations[8].parameters.properties[6].value.enum[0] (TYPE_STRING), true"
    );

    expect(presentation.kind).toBe("gemini-tool-schema");
    expect(presentation.details).toContain(
      "request.tools[0].function_declarations[8].parameters"
    );
  });

  it("does not classify ordinary context-length 400 errors as schema failures", () => {
    const presentation = presentConversationError(
      "400 Bad Request: prompt exceeds the context window"
    );

    expect(presentation).toEqual({
      kind: "generic",
      summary: "400 Bad Request: prompt exceeds the context window"
    });
  });

  it("keeps long errors available while shortening the default summary", () => {
    const raw = `400 Bad Request: ${"provider detail ".repeat(30)}`;
    const presentation = presentConversationError(raw);

    expect(presentation.summary.length).toBeLessThanOrEqual(221);
    expect(presentation.details).toBe(raw);
  });

  it("redacts obvious authorization and API-key values from expandable details", () => {
    const raw =
      '400 Invalid argument: request.tools[0].function_declarations[0].parameters.properties.x enum[0] Authorization: Bearer auth-secret api_key="api-secret"';
    const safe = sanitizeConversationErrorDetails(raw);

    expect(safe).toContain(
      "request.tools[0].function_declarations[0].parameters"
    );
    expect(safe).not.toContain("auth-secret");
    expect(safe).not.toContain("api-secret");
    expect(safe).toContain("[redacted]");
  });
});
