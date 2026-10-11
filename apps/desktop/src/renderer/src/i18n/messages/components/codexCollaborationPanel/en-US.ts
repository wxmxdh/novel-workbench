export default {
  title: "Independent Codex task",
  description:
    "Choose a model available on this computer. Tasks run in a temporary directory and do not read or modify book files.",
  currentBook: "Current book: {book}",
  attachedSource:
    "Your selected source will be included in the first turn: {source}",
  refreshModels: "Refresh models",
  modelAccessible: "Codex model",
  modelPlaceholder: "Choose a Codex model",
  effortAccessible: "Codex reasoning effort",
  threadLabel: "Independent task: {thread}",
  newTask: "New task",
  resumePlaceholder: "Resume an existing Codex thread ID",
  resumeTask: "Resume task",
  emptyState:
    "Each task has its own Codex conversation. It does not share chat history with Free Discussion or Plot Planning in the workbench.",
  you: "You",
  codex: "Codex",
  notice: "Notice",
  composerPlaceholder: "Describe the discussion or review task for Codex",
  permissionNote:
    "Codex file and command permission requests are denied, with the reason shown here.",
  stop: "Stop",
  send: "Send to Codex",
  tooLong:
    "The task and selected source exceed 100,000 characters. Reduce the source selection and try again.",
  modelLoadError: "Could not load Codex models.",
  requestError: "Codex request failed.",
  resumeError: "Could not resume the Codex task.",
  resumedThread: "Resumed independent task: {thread}",
  turnInterrupted: "This turn was stopped and is not a complete result.",
  turnFailed:
    "This turn did not complete and cannot be saved as a complete candidate."
} as const;
