import { effectScope, nextTick, ref } from "vue";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestTranslations } from "../../../test-utils/rendererI18n";
import type { ChatMessage } from "../types/conversation";
import { useConversationComposer } from "./useConversationComposer";

let scope: ReturnType<typeof effectScope>;

beforeEach(async () => {
  await initializeTestTranslations();
  scope = effectScope();
});

afterEach(() => scope.stop());

function markdownAttachments(): UserPromptAttachment[] {
  return [
    {
      id: "attachment_world_rules",
      name: "世界规则.md",
      kind: "text",
      mediaType: "text/markdown",
      size: 21,
      content: "合成设定：潮汐每夜转向。"
    },
    {
      id: "attachment_character_notes",
      name: "人物小传.md",
      kind: "text",
      mediaType: "text/markdown",
      size: 20,
      content: "合成人物：守灯人沈禾。"
    },
    {
      id: "attachment_relationship_map",
      name: "关系草案.md",
      kind: "text",
      mediaType: "text/markdown",
      size: 19,
      content: "合成关系：沈禾欠顾岚一封信。"
    }
  ];
}

describe("conversation composer attachment retention", () => {
  it("keeps several Markdown files after a failed send and clears them only after a new run is accepted", async () => {
    const sessionId = ref("session_synthetic");
    const messages = ref<ChatMessage[]>([
      {
        id: "old_assistant",
        role: "assistant",
        content: "旧会话回复",
        createdAt: "2026-07-26T10:00:00.000Z",
        runId: "run_already_known"
      }
    ]);
    const pendingAttachments = ref(markdownAttachments());
    const sent = vi.fn<(attachments: UserPromptAttachment[]) => void>();
    const options = {
      draft: () => "请综合这些资料",
      canSend: () => true,
      canSendAttachments: () => true,
      runtimeAvailable: () => true,
      libraryDomain: () => undefined,
      availableSkills: () => [],
      availableMaterials: () => [],
      editorReferences: () => [],
      textAttachmentMaxCharacters: () => 100_000,
      textAttachmentsTotalMaxCharacters: () => 200_000,
      currentSessionId: () => sessionId.value,
      messages: () => messages.value,
      pendingAttachments,
      readingAttachments: ref(false),
      emitDraft: vi.fn(),
      emitSend: sent,
      emitClearEditorReferences: vi.fn()
    };
    const composer = scope.run(() => useConversationComposer(options));
    if (!composer) throw new Error("Composer setup did not run.");

    composer.submitMessage();
    const expected = markdownAttachments();
    expect(sent).toHaveBeenNthCalledWith(1, expected);
    expect(pendingAttachments.value).toEqual(expected);

    // A failed request leaves only the unclaimed assistant placeholder. It is
    // not an acceptance marker, so retrying still includes all original files.
    messages.value.push({
      id: "pending_assistant",
      role: "assistant",
      content: "",
      createdAt: "2026-07-26T10:01:00.000Z",
      activityOnly: true,
      status: "streaming"
    });
    await nextTick();
    expect(pendingAttachments.value).toEqual(expected);

    composer.submitMessage();
    expect(sent).toHaveBeenNthCalledWith(2, expected);

    messages.value.push({
      id: "run_retry_assistant",
      role: "assistant",
      content: "",
      createdAt: "2026-07-26T10:02:00.000Z",
      runId: "run_retry",
      status: "streaming"
    });
    await nextTick();
    expect(pendingAttachments.value).toEqual([]);

    composer.submitMessage();
    expect(sent).toHaveBeenNthCalledWith(3, []);
  });

  it("does not consume attachments when the composer changes sessions before acceptance", async () => {
    const sessionId = ref("session_first");
    const pendingAttachments = ref(markdownAttachments());
    const sent = vi.fn<(attachments: UserPromptAttachment[]) => void>();
    const messages = ref<ChatMessage[]>([]);
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => "检查合成资料",
        canSend: () => true,
        canSendAttachments: () => true,
        runtimeAvailable: () => true,
        libraryDomain: () => undefined,
        availableSkills: () => [],
        availableMaterials: () => [],
        editorReferences: () => [],
        textAttachmentMaxCharacters: () => 100_000,
        textAttachmentsTotalMaxCharacters: () => 200_000,
        currentSessionId: () => sessionId.value,
        messages: () => messages.value,
        pendingAttachments,
        readingAttachments: ref(false),
        emitDraft: vi.fn(),
        emitSend: sent,
        emitClearEditorReferences: vi.fn()
      })
    );
    if (!composer) throw new Error("Composer setup did not run.");

    composer.submitMessage();
    sessionId.value = "session_second";
    messages.value.push({
      id: "other_session_assistant",
      role: "assistant",
      content: "另一会话的运行",
      createdAt: "2026-07-26T10:03:00.000Z",
      runId: "run_other_session"
    });
    await nextTick();

    expect(pendingAttachments.value).toEqual(markdownAttachments());
  });
});
