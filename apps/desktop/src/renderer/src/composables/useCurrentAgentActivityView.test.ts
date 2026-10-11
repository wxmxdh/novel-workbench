import { ref, shallowRef } from "vue";
import { describe, expect, it } from "vitest";
import type { AgentConversationController } from "./useAgentConversation";
import { useCurrentAgentActivityView } from "./useCurrentAgentActivityView";

function controller(): AgentConversationController {
  return {} as AgentConversationController;
}

describe("useCurrentAgentActivityView", () => {
  it("keeps a short activity target independent from a transient long selection", () => {
    const shortConversation = controller();
    const longConversation = controller();
    const activeFeature = ref("conversation");
    const shortResourceId = ref("short-book:section-two");
    const longResourceId = ref("long-book:chapter-two");
    const view = useCurrentAgentActivityView({
      activeFeature,
      shortResourceId,
      longResourceId,
      shortConversation: shallowRef(shortConversation),
      shortContext: ref({
        agentLabel: "正文智能体",
        bookTitle: "短篇作品",
        contextTitle: "第二节"
      }),
      longConversation: shallowRef(longConversation),
      longProfile: ref({ label: "长篇智能体" }),
      longBook: ref({ title: "长篇作品" }),
      longSelection: ref({ title: "第二章", chapterCardId: "chapter-two" }),
      longRoot: ref("draft")
    });

    expect(view.value).toMatchObject({
      controller: shortConversation,
      targetResourceId: "short-book:section-two"
    });

    activeFeature.value = "long-workspace";
    expect(view.value).toMatchObject({
      controller: longConversation,
      targetResourceId: "long-book:chapter-two",
      chapterCardId: "chapter-two"
    });
  });
});
