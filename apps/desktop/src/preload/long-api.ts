import { sourceFolderApi } from "./long-source-folder-api";
import type { DeepWriteApi } from "@deepwrite/contracts";
import {
  listLongBooks,
  createLongBook,
  duplicateLongBook,
  updateLongBookBindings,
  renameLongBook,
  chooseLegacySyncSource,
  applyLegacySync,
  chooseContinuationImportSource,
  importContinuationLongBook,
  importPortableLongBook,
  openLongBook,
  openExistingLongBook,
  unregisterLongBook,
  deleteLongBook
} from "./long-book-api";
import {
  getLongWorkspaceIndex,
  readLongDocument,
  writeLongDocument,
  readLongAgentsMd,
  writeLongAgentsMd,
  previewLongOperations,
  applyLongOperations,
  writeLongChapter,
  commitLongChapter,
  deleteLongLedgerCommit,
  searchLongDocuments
} from "./long-document-api";
import { resolveLongConflicts } from "./long-recovery-api";
import { stageSourceImport, confirmSourceImport } from "./long-source-api";
import { nativeWritingApi } from "./long-native-writing-api";
export const long: DeepWriteApi["long"] = {
  ...nativeWritingApi,
  ...sourceFolderApi,
  stageSourceImport,
  confirmSourceImport,
  resolveConflicts: resolveLongConflicts,
  list: listLongBooks,
  create: createLongBook,
  duplicateBook: duplicateLongBook,
  rename: renameLongBook,
  updateBindings: updateLongBookBindings,
  chooseLegacySyncSource,
  applyLegacySync,
  importPortable: importPortableLongBook,
  chooseContinuationImportSource,
  importContinuation: importContinuationLongBook,
  open: openLongBook,
  openExisting: openExistingLongBook,
  getWorkspaceIndex: getLongWorkspaceIndex,
  readDocument: readLongDocument,
  search: searchLongDocuments,
  writeDocument: writeLongDocument,
  readAgentsMd: readLongAgentsMd,
  writeAgentsMd: writeLongAgentsMd,
  previewOperations: previewLongOperations,
  applyOperations: applyLongOperations,
  writeChapter: writeLongChapter,
  commitChapter: commitLongChapter,
  deleteLedgerCommit: deleteLongLedgerCommit,
  unregister: unregisterLongBook,
  delete: deleteLongBook
};
