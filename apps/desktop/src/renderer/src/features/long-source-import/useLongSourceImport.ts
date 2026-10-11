import { computed, ref } from "vue";
import {
  type DeepWriteApi,
  type LongConfirmSourceImportInput,
  type LongImportedSource,
  type LongSourceAuthority,
  type LongSourcePurpose,
  type LongStageSourceImportInput,
  type LongStageSourceImportResult,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";

const t = createScopedTranslator("components.longSourceImportDialog");

export interface LongSourceImportProposal {
  source_name: string;
  title: string;
  purpose: LongSourcePurpose;
  authority: LongSourceAuthority;
  summary: string;
  conflicts: string[];
  unresolved_questions: string[];
  candidate_content?: string;
}

const purposes: readonly LongSourcePurpose[] = [
  "foundation",
  "character",
  "outline",
  "discussion",
  "reference",
  "other"
];
const authorities: readonly LongSourceAuthority[] = [
  "candidate",
  "undecided",
  "reference"
];

/** Parses only the dedicated long-agent proposal payload; never trusts arbitrary message text. */
export function parseLongSourceImportProposal(
  value: unknown
): LongSourceImportProposal | null {
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  const row = candidate as Record<string, unknown>;
  if (
    typeof row.source_name !== "string" ||
    !row.source_name ||
    row.source_name.length > 240 ||
    typeof row.title !== "string" ||
    !row.title ||
    row.title.length > 240 ||
    !purposes.includes(row.purpose as LongSourcePurpose) ||
    !authorities.includes(row.authority as LongSourceAuthority) ||
    typeof row.summary !== "string" ||
    row.summary.length > 4_000 ||
    !Array.isArray(row.conflicts) ||
    row.conflicts.length > 30 ||
    !row.conflicts.every((item) => typeof item === "string") ||
    row.conflicts.some((item) => item.length > 1_000) ||
    !Array.isArray(row.unresolved_questions) ||
    row.unresolved_questions.length > 30 ||
    !row.unresolved_questions.every((item) => typeof item === "string") ||
    row.unresolved_questions.some((item) => item.length > 1_000) ||
    (row.candidate_content !== undefined &&
      (typeof row.candidate_content !== "string" ||
        row.candidate_content.length > 100_000))
  )
    return null;
  if (row.source_name === "本次讨论") {
    if (
      row.purpose !== "outline" ||
      row.authority !== "candidate" ||
      typeof row.candidate_content !== "string" ||
      !row.candidate_content.trim()
    )
      return null;
  } else if (row.candidate_content !== undefined) {
    return null;
  }
  return {
    source_name: row.source_name,
    title: row.title,
    purpose: row.purpose as LongSourcePurpose,
    authority: row.authority as LongSourceAuthority,
    summary: row.summary,
    conflicts: row.conflicts as string[],
    unresolved_questions: row.unresolved_questions as string[],
    ...(typeof row.candidate_content === "string"
      ? { candidate_content: row.candidate_content }
      : {})
  };
}

export interface LongSourceImportCandidate {
  bookId: string;
  expectedIndexUpdatedAt: string;
  sourceName: string;
  sourcePath?: string;
  title: string;
  content: string;
  purpose: LongSourcePurpose;
  authority: LongSourceAuthority;
  summary: string;
  conflicts: string[];
  unresolvedQuestions: string[];
  fromDiscussion: boolean;
  purposeNote?: string;
}

export interface LongSourceImportNotifications {
  error(message: string): void;
  success(message: string): void;
  warning?(message: string): void;
}

export function useLongSourceImport(options: {
  api: () => DeepWriteApi["long"] | undefined;
  notifications: LongSourceImportNotifications;
  refreshIndex: (bookId: string) => Promise<unknown>;
}) {
  const candidate = ref<LongSourceImportCandidate | null>(null);
  const staged = ref<LongStageSourceImportResult | null>(null);
  const saving = ref(false);
  const error = ref("");
  const isOpen = computed(() => candidate.value !== null);

  function open(input: {
    proposal: LongSourceImportProposal;
    bookId: string;
    expectedIndexUpdatedAt: string;
    attachments: readonly UserPromptAttachment[];
  }): boolean {
    const { proposal } = input;
    const fromDiscussion = proposal.source_name === "本次讨论";
    let content: string;
    let sourcePath: string | undefined;
    if (fromDiscussion) {
      if (!proposal.candidate_content?.trim()) {
        options.notifications.error(t("missingDiscussionContent"));
        return false;
      }
      content = proposal.candidate_content;
    } else {
      const matches = input.attachments.filter(
        (attachment) =>
          attachment.kind === "text" && attachment.name === proposal.source_name
      );
      if (matches.length !== 1) {
        options.notifications.error(
          t(
            matches.length === 0 ? "attachmentNotFound" : "attachmentAmbiguous",
            {
              arg0: proposal.source_name
            }
          )
        );
        return false;
      }
      const attachment = matches[0]!;
      if (attachment.kind !== "text" || attachment.truncated) {
        options.notifications.error(t("truncatedAttachment"));
        return false;
      }
      content = attachment.content;
      sourcePath = t("sourceAttachmentLabel", { arg0: attachment.name });
    }
    candidate.value = {
      bookId: input.bookId,
      expectedIndexUpdatedAt: input.expectedIndexUpdatedAt,
      sourceName: proposal.source_name,
      ...(sourcePath ? { sourcePath } : {}),
      title: proposal.title,
      content,
      purpose: proposal.purpose,
      authority: proposal.authority,
      summary: proposal.summary,
      conflicts: proposal.conflicts,
      unresolvedQuestions: proposal.unresolved_questions,
      fromDiscussion
    };
    staged.value = null;
    error.value = "";
    return true;
  }

  function close(): void {
    if (saving.value) return;
    candidate.value = null;
    staged.value = null;
    error.value = "";
  }

  async function stage(): Promise<boolean> {
    const current = candidate.value;
    const api = options.api();
    if (!current || !api || saving.value) return false;
    saving.value = true;
    error.value = "";
    try {
      const input: LongStageSourceImportInput = {
        bookId: current.bookId,
        title: current.title,
        sourceName: current.sourceName,
        ...(current.sourcePath ? { sourcePath: current.sourcePath } : {}),
        content: current.content,
        purpose: current.purpose,
        authority: current.authority,
        ...(current.purposeNote?.trim()
          ? { purposeNote: current.purposeNote.trim() }
          : {}),
        expectedIndexUpdatedAt: current.expectedIndexUpdatedAt
      };
      const preview = await api.stageSourceImport(input);
      if (
        preview.bookId !== current.bookId ||
        preview.title !== current.title ||
        preview.sourceName !== current.sourceName ||
        preview.content !== current.content ||
        preview.purpose !== current.purpose ||
        preview.authority !== current.authority ||
        preview.purposeNote !== (current.purposeNote?.trim() || undefined) ||
        preview.sourcePath !== current.sourcePath
      ) {
        throw new Error(t("previewMismatch"));
      }
      staged.value = preview;
      return true;
    } catch (cause: unknown) {
      error.value = formatError(cause, t("previewFailed"));
      options.notifications.error(error.value);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function confirm(): Promise<LongImportedSource | null> {
    const preview = staged.value;
    const api = options.api();
    if (!preview || !api || saving.value) return null;
    saving.value = true;
    error.value = "";
    try {
      const input: LongConfirmSourceImportInput = {
        bookId: preview.bookId,
        previewId: preview.previewId
      };
      const result = await api.confirmSourceImport(input);
      candidate.value = null;
      staged.value = null;
      options.notifications.success(
        t("saveSuccessPath", { arg0: result.source.file.path })
      );
      try {
        await options.refreshIndex(result.bookId);
      } catch (cause: unknown) {
        options.notifications.warning?.(
          t("refreshAfterSaveFailed", {
            arg0: formatError(cause, t("refreshFailed"))
          })
        );
      }
      return result.source;
    } catch (cause: unknown) {
      error.value = formatError(cause, t("confirmSaveFailed"));
      options.notifications.error(error.value);
      return null;
    } finally {
      saving.value = false;
    }
  }

  return {
    candidate,
    staged,
    saving,
    error,
    isOpen,
    open,
    close,
    stage,
    confirm,
    edit() {
      if (!saving.value) {
        staged.value = null;
        error.value = "";
      }
    }
  };
}
