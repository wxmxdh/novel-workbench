import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const updateService = readFileSync(
  new URL("./update-service.ts", import.meta.url),
  "utf8"
);
const builderConfig = readFileSync(
  new URL("../../electron-builder.yml", import.meta.url),
  "utf8"
);
const desktopServices = readFileSync(
  new URL("./desktop-services.ts", import.meta.url),
  "utf8"
);

describe("local fork release policy", () => {
  it("does not connect the Main updater to an upstream manifest or feed", () => {
    expect(updateService).not.toContain("autoUpdater");
    expect(updateService).not.toContain("UPDATE_MANIFEST_URL");
    expect(updateService).not.toContain("net.fetch");
  });

  it("builds with an independent application identity and no publish target", () => {
    expect(builderConfig).toContain("appId: studio.otter.novel-workbench");
    expect(builderConfig).toContain("productName: Otter Novel Workbench");
    expect(builderConfig).not.toMatch(/^publish:/mu);
    expect(builderConfig).toContain("-local.");
  });

  it("keeps automatic model-catalog, usage, and alert requests disabled", () => {
    expect(desktopServices).toContain("automaticCatalogRefresh: false");
    expect(desktopServices).toContain("{ enabled: false }");
    expect(desktopServices).toContain("remoteEnabled: false");
  });
});
