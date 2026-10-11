import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const WINDOW_FRAME_COMMAND_CHANNEL = "deepwrite:window-frame:command";
export const WINDOW_FRAME_EVENT_CHANNEL = "deepwrite:window-frame:event";
export const WindowFrameActionSchema = z.enum([
  "state",
  "minimize",
  "toggleMaximize",
  "close",
  "quit",
  "toggleFullscreen"
]);
export type WindowFrameAction = z.infer<typeof WindowFrameActionSchema>;
export const WindowFrameCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("windowFrame.command"),
  payload: z.object({ action: WindowFrameActionSchema }).strict()
});
export const WindowFrameStateSchema = z
  .object({
    customTitlebar: z.boolean(),
    maximized: z.boolean(),
    fullscreen: z.boolean()
  })
  .strict();
export type WindowFrameState = z.infer<typeof WindowFrameStateSchema>;
export const WindowFrameEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal("windowFrame.state"),
  payload: WindowFrameStateSchema
});
export interface WindowFrameApi {
  command(action: WindowFrameAction): Promise<WindowFrameState>;
  subscribe(listener: (state: WindowFrameState) => void): () => void;
}
