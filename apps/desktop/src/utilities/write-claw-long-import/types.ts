import type {
  LongProjectManifest,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { WriteClawLongArchiveSource } from "../write-claw-long-archive";

export type WriteClawLongImportSourceKind =
  WriteClawLongArchiveSource["sourceKind"];

export interface WriteClawLongImportDocument {
  fileId: string;
  path: string;
  kind: "markdown" | "json";
  content: string;
}

export interface WriteClawLongImportPlan {
  schemaVersion: 1;
  sourceKind: WriteClawLongImportSourceKind;
  legacySchemaVersion: number;
  committedChapterPolicy: "written-uncommitted" | "legacy-checkpoints";
  manifest: LongProjectManifest;
  index: LongWorkspaceIndexSnapshot;
  documents: WriteClawLongImportDocument[];
  warnings: string[];
  idMap: Record<string, Record<string, string>>;
}

export interface CreateWriteClawLongImportPlanOptions {
  importedAt?: string;
  title?: string;
  genre?: string;
  sourceIdentity?: string;
}
