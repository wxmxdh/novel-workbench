import type { LongWorkspaceIndexSnapshot } from "../long-workspace";

export interface LongChapterMutationViolation {
  code: "not_found";
  message: string;
}

export function chapterMutationViolation(
  workspace: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  action: string
): LongChapterMutationViolation | null {
  const chapter = workspace.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (!chapter) {
    return {
      code: "not_found",
      message: `Chapter ${chapterCardId} does not exist.`
    };
  }
  void chapter;
  void action;
  return null;
}
