import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  fixture,
  initialInput,
  oldKey,
  oldModel
} from "./model-config-fault.test-support";

const added = {
  ...oldModel,
  id: "batch-added",
  credentialProfileId: oldModel.id,
  modelId: "reader",
  sourceApiKeyId: oldModel.id
};

describe("batch model saved credentials", () => {
  it("copies a saved encrypted key and keeps the reference out of persisted and public configuration", async () => {
    const context = await fixture();
    const store = context.createStore();
    await store.save(initialInput);
    const saved = await store.save({
      models: [oldModel, added],
      defaultModelId: oldModel.id
    });
    expect(saved.models.find((model) => model.id === added.id)?.hasApiKey).toBe(
      true
    );
    expect(saved.models[1]).not.toHaveProperty("sourceApiKeyId");
    expect(saved.models[1]).not.toHaveProperty("apiKey");
    expect(await readFile(context.modelsPath, "utf8")).not.toContain(
      "sourceApiKeyId"
    );
    await expect(
      context.createStore().resolve(added.id)
    ).resolves.toMatchObject({ apiKey: oldKey });
  });
  it.each([
    { baseUrl: "https://other.example.test/v1" },
    { provider: "other" },
    { api: "anthropic-messages" as const },
    { credentialProfileId: "different-account" },
    { sourceApiKeyId: "missing" }
  ])("rejects invalid credential reuse atomically: %j", async (changes) => {
    const context = await fixture();
    const store = context.createStore();
    await store.save(initialInput);
    const before = await readFile(context.modelsPath, "utf8");
    await expect(
      store.save({
        models: [oldModel, { ...added, ...changes }],
        defaultModelId: oldModel.id
      })
    ).rejects.toThrow("无法复用");
    expect(await readFile(context.modelsPath, "utf8")).toBe(before);
  });
});
