import {
  LongWorkspaceOperationBatchSchema,
  type LongDocumentWriteProposal,
  type LongWorkspaceOperationBatch,
  type SystemEventEnvelope
} from "@deepwrite/contracts";

type LongWorldbuildingFileProposalEvent = Extract<
  SystemEventEnvelope,
  { type: "long.worldbuilding_file_proposal" }
>;

type LongCharacterFileProposalEvent = Extract<
  SystemEventEnvelope,
  { type: "long.character_file_proposal" }
>;

function matchesDisplayedFile(
  write: LongDocumentWriteProposal,
  file: {
    fileId: string;
    afterText: string;
    operation: "create" | "write" | "edit";
  }
): boolean {
  return (
    write.fileId === file.fileId &&
    write.content === file.afterText &&
    (file.operation === "create"
      ? write.mode === "create"
      : write.mode !== "create")
  );
}

export function longWorldbuildingBatchForFile(
  event: LongWorldbuildingFileProposalEvent
): LongWorkspaceOperationBatch | undefined {
  const file = event.payload.files[0];
  if (!file || event.payload.files.length !== 1) return undefined;
  const operations = event.payload.batch.operations.filter(
    (operation) =>
      file.operation === "create" &&
      operation.type === "worldbuildingItem.create" &&
      operation.categoryId === file.categoryId &&
      operation.item.id === file.itemId &&
      operation.item.file.id === file.fileId
  );
  const documentWrites = event.payload.batch.documentWrites.filter(
    (write) => write.fileId === file.fileId
  );
  const validCreateWrite =
    documentWrites.length === 1 &&
    matchesDisplayedFile(documentWrites[0]!, file);
  if (
    (file.operation === "create" &&
      (operations.length !== 1 ||
        event.payload.batch.operations.length !== 1 ||
        event.payload.batch.documentWrites.length !== documentWrites.length ||
        !validCreateWrite)) ||
    (file.operation !== "create" &&
      (operations.length !== 0 ||
        event.payload.batch.operations.length !== 0 ||
        documentWrites.length !== 1 ||
        event.payload.batch.documentWrites.length !== 1 ||
        !matchesDisplayedFile(documentWrites[0]!, file)))
  ) {
    return undefined;
  }
  return LongWorkspaceOperationBatchSchema.parse({
    ...event.payload.batch,
    operations,
    documentWrites
  });
}

function characterOperationFileId(
  operation: Extract<
    LongWorkspaceOperationBatch["operations"][number],
    { type: "character.create" }
  >,
  document: "core_profile" | "relationships"
): string {
  if (document === "core_profile") return operation.files.coreProfile.id;
  return operation.files.relationships.id;
}

export function longCharacterBatchForFiles(
  event: LongCharacterFileProposalEvent
): LongWorkspaceOperationBatch | undefined {
  const files = event.payload.files;
  if (!files.length) return undefined;
  const isCreation = files.every(({ operation }) => operation === "create");
  if (isCreation) {
    const operation = event.payload.batch.operations[0];
    if (
      event.payload.batch.operations.length !== 1 ||
      operation?.type !== "character.create" ||
      files.some(
        (file) =>
          file.document === "overview" ||
          file.characterId !== operation.character.id ||
          characterOperationFileId(operation, file.document) !== file.fileId
      )
    ) {
      return undefined;
    }

    const documentWrites = event.payload.batch.documentWrites;
    const isUnifiedContentCreation =
      files.length === 1 &&
      files[0]!.document === "core_profile" &&
      documentWrites.length === 1 &&
      matchesDisplayedFile(documentWrites[0]!, files[0]!);
    if (!isUnifiedContentCreation) return undefined;
    return LongWorkspaceOperationBatchSchema.parse(event.payload.batch);
  }

  const file = files[0];
  if (
    files.length !== 1 ||
    !file ||
    file.operation === "create" ||
    event.payload.batch.operations.length !== 0 ||
    event.payload.batch.documentWrites.length !== 1 ||
    !matchesDisplayedFile(event.payload.batch.documentWrites[0]!, file)
  ) {
    return undefined;
  }
  return LongWorkspaceOperationBatchSchema.parse(event.payload.batch);
}
