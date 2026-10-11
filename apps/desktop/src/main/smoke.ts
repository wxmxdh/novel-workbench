import type { BrowserWindow } from "electron";
import {
  CommandEnvelopeSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type SystemHealthPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import type { UtilitySupervisor } from "./supervisor";
import { runBookTemplateSmoke } from "./smoke-book-templates";
import { runExtrasAgentSmoke } from "./smoke-extras-agents";
import { runExtrasChatSmoke } from "./smoke-extras-chat";
import { runContextCompactionSmoke } from "./smoke-context-compaction";
import { runConversationSmoke } from "./smoke-conversation";
import { runVoiceSmoke } from "./smoke-voice";
import { runVoiceUiSmoke } from "./smoke-voice-ui";
import { runI18nSmoke } from "./smoke-i18n";
import { runOtterSmoke } from "./smoke-otter";
import { runOriginalUiSmoke } from "./smoke-original-ui";
import { runLongConversationIsolationSmoke } from "./smoke-long-conversation-isolation";
import { runAccumulationSmoke } from "./smoke-accumulation";
import {
  runReviewSkillsSmoke,
  runReviewSkillMemberSmoke
} from "./smoke-review-skills";
import type { OtterDesktopService } from "../extras/otter/desktop-service";

export async function runApplicationSmoke(
  health: SystemHealthPayload,
  supervisor: UtilitySupervisor,
  window: BrowserWindow,
  setEventTap: (
    tap: ((event: SystemEventEnvelope) => void) | undefined
  ) => void,
  otter?: OtterDesktopService
): Promise<void> {
  if (process.env.DEEPWRITE_SMOKE_SUITE === "accumulation") {
    const accumulation = await runAccumulationSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, accumulation })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "review-skills") {
    const global = await runReviewSkillsSmoke(window);
    const member = await runReviewSkillMemberSmoke(window, global.teamId);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, reviewSkills: { ...global, ...member } })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "parallel-ui") {
    const parallelUi = await window.webContents.executeJavaScript(
      "window.parallelUiSmoke"
    );
    if (!parallelUi || parallelUi.status !== "ok")
      throw new Error("Parallel UI replay did not finish");
    console.log(`DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, parallelUi })}`);
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "startup") {
    const startup = await window.webContents.executeJavaScript(`(async () => {
      const ensure = (value, message) => { if (!value) throw new Error(message); };
      ensure(document.readyState === 'complete', 'Startup document is not ready');
      ensure(document.querySelector('#app')?.children.length > 0, 'Application did not mount');
      ensure(document.body.innerText.trim().length > 0, 'Application UI is empty');
      const api = window.deepwrite;
      ensure(typeof api?.models?.list === 'function', 'Model settings API is unavailable');
      ensure(typeof api?.agentTeams?.list === 'function', 'Agent team API is unavailable');
      const models = await api.models.list();
      const teams = await api.agentTeams.list();
      ensure(Array.isArray(models.models), 'Model settings could not be read');
      ensure(Array.isArray(teams.teams), 'Agent team catalog could not be read');
      return { status: 'ok', applicationMounted: true, modelsReadable: true, teamsReadable: true };
    })()`);
    console.log(`DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, startup })}`);
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "otter") {
    if (!otter) throw new Error("Otter desktop service is unavailable.");
    const integration = await runOtterSmoke(window, otter);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, integration })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "i18n") {
    const localization = await runI18nSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, localization })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "original-ui") {
    if (!otter) throw new Error("Otter desktop service is unavailable.");
    const integration = await runOriginalUiSmoke(window, otter);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, integration })}`
    );
    return;
  }
  if (process.env.DEEPWRITE_SMOKE_SUITE === "long-conversation-isolation") {
    const isolation = await runLongConversationIsolationSmoke(window);
    console.log(`DEEPWRITE_SMOKE_OK ${JSON.stringify({ health, isolation })}`);
    return;
  }
  const sessionId = "session_electron_smoke";
  const commandId = createId("cmd_smoke");
  const events: SystemEventEnvelope[] = [];
  let resolveTerminal: (() => void) | undefined;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });

  setEventTap((event) => {
    if (
      event.type.startsWith("agent.") &&
      "sessionId" in event.payload &&
      event.payload.sessionId === sessionId
    ) {
      events.push(event);
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      ) {
        resolveTerminal?.();
      }
    }
  });

  try {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "agent.prompt",
        {
          sessionId,
          message: "验证 DeepWrite Electron Faux 流式链路",
          thinkingLevel: "medium" as const,
          workspaceContext: {
            activeResource: {
              id: "chapter_smoke",
              domain: "creation" as const,
              title: "冒烟测试章节",
              path: ["测试作品", "冒烟测试章节"],
              format: "正文",
              source: "live-editor" as const,
              content: "这是发送瞬间的实时文稿。"
            }
          }
        },
        {
          id: commandId,
          context: {
            correlationId: commandId,
            sessionId,
            resourceId: "chapter_smoke"
          }
        }
      )
    );

    const result = await supervisor.requestCommand("agent", command);
    if (result.status === "rejected") {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent smoke timed out.")), 8_000)
      )
    ]);

    const completed = events.find(
      (event) => event.type === "agent.message_completed"
    );
    const errors = events.filter((event) => event.type === "agent.error");
    const deltas = events.filter(
      (event) => event.type === "agent.message_delta"
    );
    const thinking = events.filter(
      (event) => event.type === "agent.thinking_delta"
    );
    const deltaText = deltas
      .map((event) =>
        event.type === "agent.message_delta" ? event.payload.delta : ""
      )
      .join("");

    if (
      accepted.runtime.mode !== "local-faux" ||
      !completed ||
      errors.length > 0 ||
      deltas.length < 2 ||
      thinking.length < 1 ||
      (completed.type === "agent.message_completed" &&
        completed.payload.content !== deltaText)
    ) {
      throw new Error("Agent smoke event assertions failed.");
    }

    const conversation = await runConversationSmoke(window);
    const bookTemplates = await runBookTemplateSmoke(window);
    const extrasAgents = await runExtrasAgentSmoke(window);
    const extrasChat = await runExtrasChatSmoke(window);
    const contextCompaction = await runContextCompactionSmoke(window);
    const voice = await runVoiceSmoke(window);
    const voiceUi = await runVoiceUiSmoke(window);
    const localization = await runI18nSmoke(window);
    console.log(
      `DEEPWRITE_SMOKE_OK ${JSON.stringify({
        health,
        conversation,
        bookTemplates,
        extrasAgents,
        extrasChat,
        contextCompaction,
        voice,
        voiceUi,
        localization,
        agent: {
          status: "ok",
          runtime: accepted.runtime,
          deltaCount: deltas.length,
          thinkingDeltaCount: thinking.length,
          completed: true
        }
      })}`
    );
  } finally {
    setEventTap(undefined);
  }
}
