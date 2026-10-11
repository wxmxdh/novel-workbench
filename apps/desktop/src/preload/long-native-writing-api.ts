import {
  LongNativeWritingListInputSchema,
  LongNativeWritingListResultSchema,
  LongNativeWritingSaveInputSchema,
  LongNativeWritingSaveResultSchema,
  LongNativeWritingSelectInputSchema,
  LongNativeWritingSelectResultSchema,
  LongNativeWritingReadInputSchema,
  LongNativeWritingReadResultSchema,
  createEnvelope,
  type DeepWriteApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const nativeWritingApi: Pick<DeepWriteApi["long"], "listNativeWriting" | "saveNativeWriting" | "selectNativeWriting" | "readNativeWriting"> = {
  async listNativeWriting(raw) {
    const input = LongNativeWritingListInputSchema.parse(raw);
    const id = browserId("cmd_long_writing_list");
    return LongNativeWritingListResultSchema.parse(await invokeCommand(
      createEnvelope("long.nativeWritingList", input, { id, correlationId: id, context: { resourceId: input.bookId } })
    ));
  },
  async saveNativeWriting(raw) {
    const input = LongNativeWritingSaveInputSchema.parse(raw);
    const id = browserId("cmd_long_writing_save");
    return LongNativeWritingSaveResultSchema.parse(await invokeCommand(
      createEnvelope("long.nativeWritingSave", input, { id, correlationId: id, context: { resourceId: input.bookId } })
    ));
  },
  async selectNativeWriting(raw) {
    const input = LongNativeWritingSelectInputSchema.parse(raw);
    const id = browserId("cmd_long_writing_select");
    return LongNativeWritingSelectResultSchema.parse(await invokeCommand(
      createEnvelope("long.nativeWritingSelect", input, { id, correlationId: id, context: { resourceId: input.bookId } })
    ));
  },
  async readNativeWriting(raw) {
    const input = LongNativeWritingReadInputSchema.parse(raw);
    const id = browserId("cmd_long_writing_read");
    return LongNativeWritingReadResultSchema.parse(await invokeCommand(
      createEnvelope("long.nativeWritingRead", input, { id, correlationId: id, context: { resourceId: input.bookId } })
    ));
  }
};
