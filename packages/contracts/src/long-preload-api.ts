import type {
  LongSourceFolderPreview,
  LongConfirmSourceFolderInput,
  LongConfirmSourceFolderResult,
  LongQuerySourceFolderInput,
  LongQuerySourceFolderResult
} from "./long-source-folders";
import type {
  CreateLongBookInput,
  LongDuplicateBookInput,
  LongImportPortableResult,
  LongApplyLegacySyncInput,
  LongApplyLegacySyncResult,
  LongChooseLegacySyncSourceResult,
  LongChooseContinuationImportSourceResult,
  LongImportContinuationInput,
  LongImportContinuationResult,
  LongApplyOperationsInput,
  LongApplyOperationsResult,
  LongListBooksResult,
  LongOpenBookInput,
  LongOpenBookResult,
  LongPreviewOperationsInput,
  LongPreviewOperationsResult,
  LongReadDocumentInput,
  LongReadDocumentResult,
  LongReadAgentsMdInput,
  LongReadAgentsMdResult,
  LongRenameBookInput,
  LongRemoveBookInput,
  LongRemoveBookResult,
  LongSearchInput,
  LongSearchResult,
  LongUpdateBindingsInput,
  LongWorkspaceIndexResult,
  LongWriteDocumentInput,
  LongWriteDocumentResult,
  LongWriteAgentsMdInput,
  LongWriteAgentsMdResult
} from "./long-workspace-api";
import type {
  LongConfirmSourceImportInput,
  LongImportSourceResult,
  LongStageSourceImportInput,
  LongStageSourceImportResult
} from "./long-workspace/sources";
import type {
  LongCommitChapterInput,
  LongCommitChapterResult,
  LongDeleteLedgerCommitInput,
  LongDeleteLedgerCommitResult,
  LongWriteChapterInput,
  LongWriteChapterResult
} from "./long-ledger";
import type {
  LongResolveConflictsInput,
  LongResolveConflictsResult
} from "./long-project-recovery";
import type {
  LongNativeWritingListInput,
  LongNativeWritingListResultSchema,
  LongNativeWritingSaveInput,
  LongNativeWritingSelectInput,
  LongNativeWritingReadInput,
  LongNativeWritingSaveResultSchema,
  LongNativeWritingSelectResultSchema,
  LongNativeWritingReadResultSchema
} from "./long-native-writing";
import type { z } from "zod";
export interface LongPreloadApi {
  listNativeWriting(input: LongNativeWritingListInput): Promise<z.infer<typeof LongNativeWritingListResultSchema>>;
  saveNativeWriting(input: LongNativeWritingSaveInput): Promise<z.infer<typeof LongNativeWritingSaveResultSchema>>;
  selectNativeWriting(input: LongNativeWritingSelectInput): Promise<z.infer<typeof LongNativeWritingSelectResultSchema>>;
  readNativeWriting(input: LongNativeWritingReadInput): Promise<z.infer<typeof LongNativeWritingReadResultSchema>>;
  chooseSourceFolder(input: {
    bookId: string;
  }): Promise<LongSourceFolderPreview | null>;
  confirmSourceFolder(
    input: LongConfirmSourceFolderInput
  ): Promise<LongConfirmSourceFolderResult>;
  querySourceFolder(
    input: LongQuerySourceFolderInput
  ): Promise<LongQuerySourceFolderResult>;
  disconnectSourceFolder(input: {
    bookId: string;
    sourceId: string;
  }): Promise<LongQuerySourceFolderResult>;
  resolveConflicts(
    input: LongResolveConflictsInput
  ): Promise<LongResolveConflictsResult>;
  list(): Promise<LongListBooksResult>;
  create(input: CreateLongBookInput): Promise<LongOpenBookResult | null>;
  stageSourceImport(
    input: LongStageSourceImportInput
  ): Promise<LongStageSourceImportResult>;
  confirmSourceImport(
    input: LongConfirmSourceImportInput
  ): Promise<LongImportSourceResult>;
  duplicateBook(input: LongDuplicateBookInput): Promise<LongOpenBookResult>;
  chooseLegacySyncSource(): Promise<LongChooseLegacySyncSourceResult | null>;
  applyLegacySync(
    input: LongApplyLegacySyncInput
  ): Promise<LongApplyLegacySyncResult>;
  importPortable(): Promise<LongImportPortableResult | null>;
  chooseContinuationImportSource(): Promise<LongChooseContinuationImportSourceResult | null>;
  importContinuation(
    input: LongImportContinuationInput
  ): Promise<LongImportContinuationResult | null>;
  open(input: LongOpenBookInput): Promise<LongOpenBookResult>;
  rename(input: LongRenameBookInput): Promise<LongOpenBookResult>;
  updateBindings(input: LongUpdateBindingsInput): Promise<LongOpenBookResult>;
  openExisting(): Promise<LongOpenBookResult | null>;
  getWorkspaceIndex(
    input: LongOpenBookInput
  ): Promise<LongWorkspaceIndexResult>;
  readDocument(input: LongReadDocumentInput): Promise<LongReadDocumentResult>;
  search(input: LongSearchInput): Promise<LongSearchResult>;
  writeDocument(
    input: LongWriteDocumentInput
  ): Promise<LongWriteDocumentResult>;
  readAgentsMd(input: LongReadAgentsMdInput): Promise<LongReadAgentsMdResult>;
  writeAgentsMd(
    input: LongWriteAgentsMdInput
  ): Promise<LongWriteAgentsMdResult>;
  previewOperations(
    input: LongPreviewOperationsInput
  ): Promise<LongPreviewOperationsResult>;
  applyOperations(
    input: LongApplyOperationsInput
  ): Promise<LongApplyOperationsResult>;
  writeChapter(input: LongWriteChapterInput): Promise<LongWriteChapterResult>;
  commitChapter(
    input: LongCommitChapterInput
  ): Promise<LongCommitChapterResult>;
  deleteLedgerCommit(
    input: LongDeleteLedgerCommitInput
  ): Promise<LongDeleteLedgerCommitResult>;
  unregister(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
  delete(input: LongRemoveBookInput): Promise<LongRemoveBookResult>;
}
