import { describe, expect, it, vi } from "vitest";
import { ipcRenderer } from "electron";
import {
  createEnvelope,
  TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
  TEXT_CONTEXT_MENU_EVENT_CHANNEL,
  type TextContextMenuCommand
} from "@deepwrite/contracts";
import { textContextMenu } from "../preload/text-context-menu-api";

vi.mock("electron", () => ({
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}));

describe("text menu preload validation", () => {
  it("validates outgoing replies and rejects arbitrary payloads", () => {
    const command = createEnvelope(
      "textContextMenu.reply",
      { phase: "cancel" as const },
      { id: "test_reply", correlationId: "test_menu" }
    );
    textContextMenu.reply(command);
    expect(ipcRenderer.send).toHaveBeenCalledWith(
      TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
      command
    );
    expect(() =>
      textContextMenu.reply({
        ...command,
        protocolVersion: 99
      } as unknown as TextContextMenuCommand)
    ).toThrow();
    expect(ipcRenderer.send).toHaveBeenCalledTimes(1);
  });
  it("filters invalid inbound events and removes subscriptions", () => {
    const listener = vi.fn();
    const dispose = textContextMenu.subscribe(listener);
    const handler = vi.mocked(ipcRenderer.on).mock.lastCall![1];
    handler({} as Electron.IpcRendererEvent, {
      type: "textContextMenu.event",
      payload: { phase: "prepare" }
    });
    expect(listener).not.toHaveBeenCalled();
    const event = createEnvelope(
      "textContextMenu.event",
      { phase: "prepare" },
      { id: "test_menu" }
    );
    handler({} as Electron.IpcRendererEvent, event);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    dispose();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      TEXT_CONTEXT_MENU_EVENT_CHANNEL,
      handler
    );
  });
});
