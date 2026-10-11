import { effectScope, ref, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { UserPromptAttachment } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { useConversationComposer } from "./useConversationComposer";
import type { ChatMessage } from "../types/conversation";

function textAttachment(id: string, length: number): UserPromptAttachment {
  return {
    id,
    kind: "text",
    name: `${id}.txt`,
    mediaType: "text/plain",
    size: length,
    content: "字".repeat(length)
  };
}

describe("conversation composer attachment budget", () => {
  it("blocks combined attachments above the working budget cap and sends a smaller set", async () => {
    const scope = effectScope();
    const pendingAttachments = ref<UserPromptAttachment[]>([
      textAttachment("first", 30_000),
      textAttachment("second", 30_000)
    ]);
    const emitSend = vi.fn();
    const messages = ref<ChatMessage[]>([]);
    const warning = vi.spyOn(uiMessage, "warning").mockReturnValue(-1);
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => "请阅读附件",
        canSend: () => true,
        canSendAttachments: () => true,
        runtimeAvailable: () => true,
        libraryDomain: () => undefined,
        availableSkills: () => [],
        availableMaterials: () => [],
        editorReferences: () => [],
        currentSessionId: () => "budget-test-session",
        messages: () => messages.value,
        textAttachmentMaxCharacters: () => 50_000,
        textAttachmentsTotalMaxCharacters: () => 57_600,
        pendingAttachments,
        readingAttachments: ref(false),
        emitDraft: vi.fn(),
        emitSend,
        emitClearEditorReferences: vi.fn()
      })
    )!;

    try {
      composer.submitMessage();
      expect(emitSend).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("57,600"));
      expect(pendingAttachments.value).toHaveLength(2);

      pendingAttachments.value = pendingAttachments.value.slice(0, 1);
      composer.submitMessage();
      expect(emitSend).toHaveBeenCalledWith([
        expect.objectContaining({ id: "first" })
      ]);
      expect(pendingAttachments.value).toHaveLength(1);
      messages.value.push({
        id: "accepted",
        role: "assistant",
        content: "",
        createdAt: "2026-01-01T00:00:00Z",
        runId: "budget-accepted-run"
      });
      await nextTick();
      expect(pendingAttachments.value).toEqual([]);
    } finally {
      scope.stop();
      warning.mockRestore();
    }
  });
});
