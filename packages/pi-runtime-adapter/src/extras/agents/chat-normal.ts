import type { ExtrasConversationAgentDefinition } from "../definition";
import { buildNormalTools } from "../tools/chat-normal-tools";
import {
  chatFauxResponse,
  chatReadOnlyBoundary,
  chatSoftwareContext
} from "./chat-prompt";

/** General chat about DeepWrite, limited to catalog and summary tools. */
export const chatNormalAgent: ExtrasConversationAgentDefinition<"chat-normal"> =
  {
    id: "chat-normal",
    interaction: "conversation",
    boundaryTitle: "普通聊天",
    boundary: ({ input }) =>
      input.otterContext
        ? [
            "本轮以 Main 从当前作品 V1 协议校验后的 Context Pack 为资料边界。",
            "讨论输出属于本轮猜想；候选稿和审阅建议由作者判断。没有项目写入或正典确认权限。",
            "按资料中已声明的权威、知识边界、故意未知和 Skill 方法权限执行。"
          ]
        : [
            "普通模式只能查看目录与摘要，不能读取任何书籍、技能或素材正文。",
            ...chatReadOnlyBoundary(input.webSearchEnabled === true),
            ...chatSoftwareContext(
              input.runtime,
              input.webSearchEnabled === true
            )
          ],
    tools: ({ input }) =>
      input.otterContext ? [] : buildNormalTools(input.runtime),
    conversationKey: ({ input }) =>
      input.otterContext
        ? `otter:${input.otterContext.projectId}:${input.otterContext.contextId}:${input.otterContext.baselineHash}`
        : "normal",
    webSearch: ({ input }) => input.webSearchEnabled === true,
    faux: (_task, turn) =>
      chatFauxResponse(
        "普通",
        "正在结合 DeepWrite 当前状态与只读查询工具组织回复。",
        turn
      )
  };
