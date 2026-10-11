import {
  CommandEnvelopeSchema,
  createEnvelope,
  LongChooseSourceFolderInputSchema,
  LongSourceFolderPreviewSchema,
  LongConfirmSourceFolderInputSchema,
  LongConfirmSourceFolderResultSchema,
  LongQuerySourceFolderInputSchema,
  LongQuerySourceFolderResultSchema,
  LongDisconnectSourceFolderInputSchema,
  type LongConfirmSourceFolderInput,
  type LongQuerySourceFolderInput
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
const invoke = (type: Parameters<typeof createEnvelope>[0], input: unknown) =>
  invokeCommand(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, input, { id: browserId("cmd_source_folder") })
    )
  );
export const sourceFolderApi = {
  async chooseSourceFolder(input: { bookId: string }) {
    const result = await invoke(
      "long.chooseSourceFolder",
      LongChooseSourceFolderInputSchema.parse(input)
    );
    return result === null ? null : LongSourceFolderPreviewSchema.parse(result);
  },
  async confirmSourceFolder(input: LongConfirmSourceFolderInput) {
    return LongConfirmSourceFolderResultSchema.parse(
      await invoke(
        "long.confirmSourceFolder",
        LongConfirmSourceFolderInputSchema.parse(input)
      )
    );
  },
  async querySourceFolder(input: LongQuerySourceFolderInput) {
    return LongQuerySourceFolderResultSchema.parse(
      await invoke(
        "long.querySourceFolder",
        LongQuerySourceFolderInputSchema.parse(input)
      )
    );
  },
  async disconnectSourceFolder(input: { bookId: string; sourceId: string }) {
    return LongQuerySourceFolderResultSchema.parse(
      await invoke(
        "long.disconnectSourceFolder",
        LongDisconnectSourceFolderInputSchema.parse(input)
      )
    );
  }
};
