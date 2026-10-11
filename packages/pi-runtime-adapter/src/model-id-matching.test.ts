import { describe, expect, it } from "vitest";
import { findLongestModelIdBoundaryMatch } from "./model-id-matching";

describe("model id boundary matching", () => {
  const models = [
    { id: "model", marker: "short" },
    { id: "enterprise-model", marker: "long" }
  ] as const;

  it("accepts both configured-id prefixes and suffixes", () => {
    expect(
      findLongestModelIdBoundaryMatch(models, "enterprise-model-v2")
    ).toHaveProperty("marker", "long");
    expect(
      findLongestModelIdBoundaryMatch(models, "route-enterprise-model")
    ).toHaveProperty("marker", "long");
  });

  it("selects the longest catalog id among boundary matches", () => {
    expect(
      findLongestModelIdBoundaryMatch(models, "route-enterprise-model")
    ).toHaveProperty("id", "enterprise-model");
  });

  it("does not accept an interior-only substring", () => {
    expect(
      findLongestModelIdBoundaryMatch(models, "route-model-version")
    ).toBeUndefined();
  });
});
