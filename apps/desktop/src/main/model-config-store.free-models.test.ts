import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  temporaryRoots,
  managedModel,
  customModel,
  officialCatalog,
  type DeepWriteFreeModelCatalog
} from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

describe("ModelConfigStore retired built-in free models", () => {
  it("does not initialize or refresh the free catalog and omits it from public models", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-"));
    temporaryRoots.push(root);
    const catalog: DeepWriteFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "deepwrite-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "deepwrite-free-writing": "fake-key-not-a-secret" }
    };
    const initialize = vi.fn(async () => undefined);
    const refreshCatalog = vi.fn(async () => structuredClone(catalog));
    const freeModelCatalog = {
      initialize,
      getCatalog: async () => structuredClone(catalog),
      refreshCatalog
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog,
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([])
      }
    });

    const settings = await store.initialize().then(() => store.list());
    expect(initialize).not.toHaveBeenCalled();
    expect(refreshCatalog).not.toHaveBeenCalled();
    expect(settings.models).toEqual([]);
    expect(settings).not.toHaveProperty("deepwriteFreeModels");
    expect(settings).not.toHaveProperty("deepwriteFreeEnabledModelIds");

    await expect(
      store.setFreeModelEnabled("deepwrite-free-writing", true)
    ).rejects.toThrow("DeepWrite 内置免费模型已移除");
    await store.refreshFreeModels();
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it("keeps custom models when legacy settings include an opted-in free model", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-store-v1-"));
    temporaryRoots.push(root);
    const configDirectory = join(root, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "models.json"),
      `${JSON.stringify({
        version: 1,
        defaultModelId: "deepwrite-free-writing",
        models: [managedModel("vendor/writer-v1"), customModel()],
        disabledOfficialModelIds: []
      })}\n`,
      "utf8"
    );
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => ({
          revision: "",
          enabled: false,
          message: "",
          manifestAvailable: false,
          canDeprecateMissingModels: false,
          defaultModelId: "",
          models: [],
          apiKeys: {}
        })
      },
      officialModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => officialCatalog([])
      }
    });
    const settings = await store.list();
    expect(settings.models.map((model) => model.id)).toEqual(["custom-writer"]);
    expect(settings.defaultModelId).toBe("custom-writer");
    expect(settings).not.toHaveProperty("deepwriteFreeModels");
  });
});
