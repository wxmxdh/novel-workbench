import {
  MATERIAL_KINDS,
  SKILL_KINDS,
  type LongBookSummary,
  type CatalogSnapshot,
  type LongAgentProfile
} from "@deepwrite/contracts/renderer";
import {
  buildLibraryAttachments,
  type LibraryAttachmentBuildResult
} from "./libraryAttachments";
import type { WorkspaceDocument } from "../types/workspace";

type LongReadableAttachments = Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
>;

export function buildLongLibraryAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot,
  profile: LongAgentProfile
): LibraryAttachmentBuildResult {
  const skillKinds = new Set(profile.readAccess.skillKinds);
  const materialKinds = new Set(profile.readAccess.materialKinds);
  const materialIds = (kind: (typeof MATERIAL_KINDS)[number]) =>
    summary.linkedMaterialIdsByKind[kind];
  const skillIds = (kind: (typeof SKILL_KINDS)[number]) =>
    summary.linkedSkillIdsByKind[kind];
  return buildLibraryAttachments(snapshot, {
    id: summary.id,
    bookType: "long",
    linkedMaterialIdsByKind: {
      character: materialKinds.has("character") ? materialIds("character") : [],
      gimmick: materialKinds.has("gimmick") ? materialIds("gimmick") : [],
      plot: materialKinds.has("plot") ? materialIds("plot") : [],
      draft: materialKinds.has("draft") ? materialIds("draft") : [],
      other: materialKinds.has("other") ? materialIds("other") : []
    },
    linkedSkillIdsByKind: {
      general: skillKinds.has("general") ? skillIds("general") : [],
      plot: skillKinds.has("plot") ? skillIds("plot") : [],
      style: skillKinds.has("style") ? skillIds("style") : [],
      other: skillKinds.has("other") ? skillIds("other") : []
    }
  });
}

export function filterLongReadableAttachmentsForProfile(
  attachments: LibraryAttachmentBuildResult,
  profile: LongAgentProfile
): LongReadableAttachments {
  const skillKinds = new Set(profile.readAccess.skillKinds);
  const materialKinds = new Set(profile.readAccess.materialKinds);
  return {
    attachedSkills: attachments.attachedSkills.filter(
      (skill) => skill.kind !== undefined && skillKinds.has(skill.kind)
    ),
    attachedMaterials: attachments.attachedMaterials.filter(
      (material) =>
        material.kind !== undefined && materialKinds.has(material.kind)
    )
  };
}

export function buildLongReadableAttachmentsForProfile(
  summary: LongBookSummary,
  snapshot: CatalogSnapshot | null,
  profile: LongAgentProfile
): LongReadableAttachments {
  if (!snapshot) {
    return {
      attachedSkills: [],
      attachedMaterials: []
    };
  }
  return filterLongReadableAttachmentsForProfile(
    buildLongLibraryAttachmentsForProfile(summary, snapshot, profile),
    profile
  );
}

export function longCatalogContextDocuments(
  summary: LongBookSummary,
  profile: LongAgentProfile,
  documents: readonly WorkspaceDocument[]
): WorkspaceDocument[] {
  const libraryIds = new Set<string>();
  const materialKinds = new Set(profile.readAccess.materialKinds);
  const skillKinds = new Set(profile.readAccess.skillKinds);
  for (const kind of MATERIAL_KINDS) {
    if (materialKinds.has(kind)) {
      summary.linkedMaterialIdsByKind[kind].forEach((id) => libraryIds.add(id));
    }
  }
  for (const kind of SKILL_KINDS) {
    if (skillKinds.has(kind)) {
      summary.linkedSkillIdsByKind[kind].forEach((id) => libraryIds.add(id));
    }
  }
  // Filtering the source array preserves the context ordering used by
  // previous sends; gathering from per-library buckets would reorder it.
  return documents.filter(
    (document) =>
      document.libraryId !== undefined && libraryIds.has(document.libraryId)
  );
}
