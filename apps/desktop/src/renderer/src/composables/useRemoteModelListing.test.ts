import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftModel } from "../components/modelSettingsDraft";
import { useRemoteModelListing } from "./useRemoteModelListing";
vi.mock("../ui-feedback", () => ({
  uiMessage: { warning: vi.fn(), error: vi.fn(), success: vi.fn() }
}));
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.unstubAllGlobals();
});
function setup(
  listRemote = vi
    .fn()
    .mockResolvedValue({ models: [{ id: "one" }, { id: "two" }] })
) {
  vi.stubGlobal("window", { deepwrite: { models: { listRemote } } });
  const editor = ref<DraftModel>({
    id: "saved",
    label: "Writer",
    modelId: "one",
    provider: "custom",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    hasApiKey: true,
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["high"],
    temperatureOptions: [0.1, 0.7, 1]
  });
  const scope = effectScope();
  scopes.push(scope);
  const listing = scope.run(() => useRemoteModelListing(editor))!;
  return { editor, listing };
}
describe("remote model multi-selection", () => {
  it("selects the existing model, allows multiple and permits clearing the selection", async () => {
    const { listing } = setup();
    await listing.fetchRemoteModels();
    expect(listing.selectedRemoteModelIds.value).toEqual(["one"]);
    listing.setSelectedRemoteModels(["one", "two"]);
    expect(listing.selectedRemoteModels.value.map((model) => model.id)).toEqual(
      ["one", "two"]
    );
    listing.setSelectedRemoteModels([]);
    expect(listing.selectedRemoteModels.value).toEqual([]);
  });
  it("discards stale results when the provider endpoint changes", async () => {
    let complete!: (result: { models: { id: string }[] }) => void;
    const { editor, listing } = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      )
    );
    const pending = listing.fetchRemoteModels();
    editor.value.baseUrl = "https://other.example.test/v1";
    await nextTick();
    complete({ models: [{ id: "stale" }] });
    await pending;
    expect(listing.remoteModelOptions.value).toEqual([]);
    expect(listing.selectedRemoteModelIds.value).toEqual([]);
  });
  it("clears remote selections when switching back to manual entry", async () => {
    const { listing } = setup();
    await listing.fetchRemoteModels();
    listing.clearRemoteModels();
    expect(listing.canSelectRemoteModel.value).toBe(false);
    expect(listing.selectedRemoteModels.value).toEqual([]);
  });
});
