import type { WorkspaceDocument } from "../types/workspace";
import { catalogDocumentReadDescriptor } from "./catalogDocumentContent";

interface SavedBody {
  content: string;
  contentBytes: number;
  expectedProjectRevision: number | undefined;
  sourceDescriptorKey: string | undefined;
}

export type SavedBodyProjectionResolution =
  | { kind: "none" }
  | { kind: "retain"; content: string }
  | { kind: "contradicts" };

function descriptorKey(
  document: WorkspaceDocument | undefined
): string | undefined {
  return document
    ? catalogDocumentReadDescriptor(document)?.cacheKey
    : undefined;
}

/** Carries a successful write across stale and refreshed metadata projections. */
export function createCatalogSavedBodyRetention() {
  const bodies = new Map<string, SavedBody>();

  function preserve(
    document: WorkspaceDocument | undefined,
    documentId: string,
    content: string,
    expectedProjectRevision?: number
  ): void {
    bodies.set(documentId, {
      content,
      contentBytes: new TextEncoder().encode(content).byteLength,
      expectedProjectRevision,
      sourceDescriptorKey: descriptorKey(document)
    });
  }

  function reconcile(
    projected: WorkspaceDocument
  ): SavedBodyProjectionResolution {
    const saved = bodies.get(projected.id);
    if (!saved) return { kind: "none" };

    const projectionAdvanced =
      descriptorKey(projected) !== saved.sourceDescriptorKey ||
      (saved.expectedProjectRevision !== undefined &&
        projected.catalogProjectRevision !== undefined &&
        projected.catalogProjectRevision >= saved.expectedProjectRevision);
    const projectionContradictsSavedBody =
      projectionAdvanced &&
      projected.catalogContentBytes !== undefined &&
      projected.catalogContentBytes !== saved.contentBytes;

    if (projectionAdvanced) bodies.delete(projected.id);
    return projectionContradictsSavedBody
      ? { kind: "contradicts" }
      : { kind: "retain", content: saved.content };
  }

  function prune(projectedDocumentIds: ReadonlySet<string>): void {
    for (const documentId of bodies.keys()) {
      if (!projectedDocumentIds.has(documentId)) bodies.delete(documentId);
    }
  }

  return {
    clear: () => bodies.clear(),
    has: (documentId: string) => bodies.has(documentId),
    preserve,
    prune,
    reconcile
  };
}
