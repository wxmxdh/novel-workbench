import { describe, expect, it } from "vitest";
import { CodexAppServer } from "./app-server";

const enabled = process.env.DEEPWRITE_CODEX_REAL_PROBE === "1";

describe("Codex app-server installed CLI probe", () => {
  (enabled ? it : it.skip)(
    "lists models and starts/closes a read-only thread without a turn",
    async () => {
      const server = new CodexAppServer();
      try {
        const models = await server.listModels();
        expect(models.length).toBeGreaterThan(0);
        const model = models.find((item) => item.isDefault) ?? models[0]!;
        const session = await server.startSession({
          sessionId: `readonly-probe-${crypto.randomUUID()}`,
          model: model.model,
          scopeKey: "readonly-install-probe"
        });
        expect(session.threadId).toBeTruthy();
        expect(session.model).toBe(model.model);
        await server.closeSession({ sessionId: session.sessionId });
        console.info("Codex read-only probe passed", {
          modelCount: models.length,
          threadStarted: true,
          closed: true
        });
      } finally {
        await server.dispose();
      }
    }
  );
});
