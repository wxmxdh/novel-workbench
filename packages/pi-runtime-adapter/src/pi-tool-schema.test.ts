import { describe, expect, it } from "vitest";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  piStrictToolSampling,
  supportsPiStrictToolSchema
} from "./pi-tool-schema";

describe("PI tool schema policy", () => {
  it("enables strict prefer only for fully required closed objects", () => {
    const schema = Type.Object(
      {
        mode: StringEnum(["read", "write"] as const),
        target: Type.Object(
          { id: Type.String() },
          { additionalProperties: false }
        )
      },
      { additionalProperties: false }
    );

    expect(supportsPiStrictToolSchema(schema)).toBe(true);
    expect(piStrictToolSampling(schema)).toEqual({
      constrainedSampling: { type: "json_schema", strict: "prefer" }
    });
  });

  it.each([
    Type.Object({ value: Type.String() }),
    Type.Object(
      { value: Type.Optional(Type.String()) },
      { additionalProperties: false }
    ),
    Type.Object(
      { value: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false }
    ),
    Type.Object(
      { nested: Type.Object({ value: Type.String() }) },
      { additionalProperties: false }
    )
  ])("keeps non-strict schemas on normal tool calling", (schema) => {
    expect(supportsPiStrictToolSchema(schema)).toBe(false);
    expect(piStrictToolSampling(schema)).toEqual({});
  });
});
