/** Future contract only. No implementation, transport, port, cloud SDK or credentials. */
export type OtterSyncSemanticClass =
  "canon" | "derived" | "draft" | "annotation" | "context";
export interface OtterSyncFile {
  path: string;
  contentHash: string;
  baseHash: string | null;
  versionId: string;
  modifiedAt: string;
  semanticClass: OtterSyncSemanticClass;
}
export interface OtterSyncManifest {
  projectId: string;
  deviceId: string;
  files: OtterSyncFile[];
}
export interface OtterSyncConflict {
  path: string;
  kind: "concurrent-edit" | "delete-edit" | "canon-requires-author";
  localHash: string | null;
  remoteHash: string | null;
  baseHash: string | null;
}
export interface OtterSyncPlan {
  conflicts: OtterSyncConflict[];
  operations: { direction: "pull" | "push"; file: OtterSyncFile }[];
}
export interface OtterSyncProvider {
  readonly id: string;
  capabilities(): Promise<{ history: boolean; conditionalWrite: boolean }>;
  manifest(projectId: string): Promise<OtterSyncManifest>;
  plan(
    local: OtterSyncManifest,
    remote: OtterSyncManifest
  ): Promise<OtterSyncPlan>;
  /** Requires a separately authorized future implementation. */
  apply(plan: OtterSyncPlan): Promise<void>;
}
