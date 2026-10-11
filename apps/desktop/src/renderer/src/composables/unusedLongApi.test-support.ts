import { vi } from "vitest";
import type { DeepWriteApi } from "@deepwrite/contracts";
const unavailable = vi.fn(async () => {
  throw new Error("Long workspace is not used by conversation tests.");
});
export function createUnusedLongApi(): DeepWriteApi["long"] {
  return {
    listNativeWriting: unavailable,
    saveNativeWriting: unavailable,
    selectNativeWriting: unavailable,
    readNativeWriting: unavailable,
    resolveConflicts: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    list: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    create: vi.fn(async () => null),
    chooseSourceFolder: unavailable,
    confirmSourceFolder: unavailable,
    querySourceFolder: unavailable,
    disconnectSourceFolder: unavailable,
    stageSourceImport: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    confirmSourceImport: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    duplicateBook: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    rename: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    updateBindings: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    chooseLegacySyncSource: vi.fn(async () => null),
    applyLegacySync: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    importPortable: vi.fn(async () => null),
    chooseContinuationImportSource: vi.fn(async () => null),
    importContinuation: vi.fn(async () => null),
    open: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    openExisting: vi.fn(async () => null),
    getWorkspaceIndex: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    readDocument: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    search: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    writeDocument: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    readAgentsMd: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    writeAgentsMd: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    previewOperations: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    applyOperations: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    writeChapter: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    commitChapter: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    deleteLedgerCommit: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    unregister: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    }),
    delete: vi.fn(async () => {
      throw new Error("Long workspace is not used by conversation tests.");
    })
  };
}
