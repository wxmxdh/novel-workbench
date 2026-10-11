import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// A one-off, reviewable three-way transfer; conflicts never replace local files.
const root = process.cwd();
const audit = resolve(
  root,
  "../../我的小说工作台/施工记录/20261010_技能积累版本/上游比较"
);
mkdirSync(audit, { recursive: true });
const paths = [
  "packages/contracts/src/conversation-history-archive.ts",
  "packages/contracts/src/conversation-history.ts",
  "packages/contracts/src/conversation-history.test.ts",
  "packages/contracts/src/general-settings.ts",
  "packages/contracts/src/general-settings.test.ts",
  "packages/contracts/src/session/attachments.ts",
  "apps/desktop/src/main/general-settings-store.ts",
  "apps/desktop/src/main/general-settings-store.test.ts",
  "apps/desktop/src/main/ipc/conversation-history-commands.ts",
  "apps/desktop/src/preload/conversation-history-api.ts",
  "apps/desktop/src/utilities/conversation-history-commands.ts",
  ...[
    "archive-queries.ts",
    "purge.ts",
    "database.ts",
    "database.test.ts",
    "schema.ts",
    "queries.ts",
    "worker-client.ts",
    "worker-entry.ts",
    "legacy-scope-records.ts",
    "scope-merger.ts",
    "staging.ts"
  ].map((p) => "apps/desktop/src/utilities/conversation-storage/" + p),
  "apps/desktop/src/utilities/renderer-state-store.test-support.ts",
  ...[
    "ArchivedConversationsPanel.vue",
    "archived-conversations-panel.css",
    "ConversationHistoryDeleteDialog.vue",
    "ConversationHistoryMenu.vue",
    "ConversationComposer.vue",
    "ConfigurationSettingsPanel.vue",
    "SettingsPage.vue",
    "settings-page.css",
    "WorkspaceFeatureModules.vue",
    "WorkspaceFeatureModules.types.ts"
  ].map((p) => "apps/desktop/src/renderer/src/components/" + p),
  ...[
    "useArchivedConversationDeletion.ts",
    "useArchivedConversationDeletion.test.ts",
    "useArchivedConversationPresentation.ts",
    "useAttachmentDrop.ts",
    "useAttachmentDrop.test.ts",
    "useConversationAttachments.ts",
    "useConversationComposer.ts",
    "useConversationComposer.test.ts",
    "useConversationHistoryManagement.ts",
    "useConversationHistoryManagement.test.ts",
    "useGeneralSettingsCoordinator.ts",
    "useGeneralSettingsCoordinator.test.ts",
    "settingsFeatureModule.ts"
  ].map((p) => "apps/desktop/src/renderer/src/composables/" + p),
  ...[
    "conversationHistoryIndex.ts",
    "promptAttachments.ts",
    "promptAttachments.test.ts",
    "promptDocxAttachments.test.ts",
    "editorTextReferences.ts",
    "editorTextReferences.test.ts"
  ].map((p) => "apps/desktop/src/renderer/src/utils/" + p),
  "apps/desktop/src/renderer/src/styles/conversation-composer.css",
  ...[
    "configurationSettingsPanel",
    "conversationComposer",
    "conversationHistoryDeleteDialog",
    "conversationHistoryMenu",
    "settingsPage"
  ].flatMap((p) =>
    ["zh-CN.ts", "en-US.ts"].map(
      (l) =>
        "apps/desktop/src/renderer/src/i18n/messages/components/" + p + "/" + l
    )
  ),
  ...["zh-CN-conversations.ts", "en-US-conversations.ts"].map(
    (p) => "apps/desktop/src/renderer/src/i18n/messages/workspace/" + p
  )
];
const report = [];
const show = (ref, path) => {
  try {
    return execFileSync("git", ["show", ref + ":" + path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
};
for (const path of paths) {
  const base = show("71424c0", path);
  const upstream = show("v1.6.3", path);
  if (upstream === null || upstream === base) continue;
  const target = resolve(root, path);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  const backup = resolve(audit, path);
  mkdirSync(dirname(backup), { recursive: true });
  if (current !== null) writeFileSync(backup + ".before", current);
  writeFileSync(backup + ".upstream", upstream);
  let merged = upstream;
  if (current !== null && current !== base && current !== upstream) {
    writeFileSync(backup + ".base", base ?? "");
    const result = spawnSync(
      "git",
      [
        "merge-file",
        "-p",
        backup + ".before",
        backup + ".base",
        backup + ".upstream"
      ],
      { encoding: "utf8" }
    );
    writeFileSync(backup + ".merge", result.stdout ?? "");
    if (result.status !== 0) {
      report.push({ path, status: "conflict", code: result.status });
      continue;
    }
    merged = result.stdout;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, merged);
  report.push({
    path,
    status: current === upstream ? "already-present" : "adopted"
  });
}
writeFileSync(
  resolve(audit, "report.json"),
  JSON.stringify(
    { base: "71424c0", upstream: "bd1e58a", files: report },
    null,
    2
  ) + "\n"
);
console.log(JSON.stringify(report));
