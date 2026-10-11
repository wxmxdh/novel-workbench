import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/conversation";
import { buildConversationTurns } from "./useConversationTurnNavigator";

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
  attachments?: ChatMessage["attachments"]
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: "2026-08-20T00:00:00.000Z",
    ...(attachments ? { attachments } : {})
  };
}

describe("buildConversationTurns", () => {
  it("pairs each user prompt with the following assistant response", () => {
    const turns = buildConversationTurns([
      message("assistant-welcome", "assistant", "欢迎"),
      message("user-1", "user", "**检查** 第一章"),
      message("assistant-1", "assistant", "已完成第一章检查。"),
      message("user-2", "user", "继续第二章"),
      message("assistant-2", "assistant", "第二章也已检查。")
    ]);

    expect(turns).toEqual([
      {
        id: "user-1",
        number: 1,
        prompt: "检查 第一章",
        response: "已完成第一章检查。"
      },
      {
        id: "user-2",
        number: 2,
        prompt: "继续第二章",
        response: "第二章也已检查。"
      }
    ]);
  });

  it("uses attachment names for a prompt without text", () => {
    const [turn] = buildConversationTurns([
      message("user-image", "user", "", [
        {
          id: "attachment-1",
          name: "第三章.png",
          kind: "image",
          mediaType: "image/png",
          size: 128
        }
      ])
    ]);

    expect(turn).toMatchObject({
      prompt: "附件：第三章.png",
      response: undefined
    });
  });

  it("does not attach a later turn's response to an unanswered prompt", () => {
    const turns = buildConversationTurns([
      message("user-1", "user", "第一问"),
      message("user-2", "user", "第二问"),
      message("assistant-2", "assistant", "第二答")
    ]);

    expect(turns[0]?.response).toBeUndefined();
    expect(turns[1]?.response).toBe("第二答");
  });
});
