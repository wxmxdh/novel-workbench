import {
  createEnvelope,
  CommandEnvelopeSchema,
  HiddenBookSchema,
  HiddenBooksSchema,
  BookManagementResultSchema,
  BookManagementCommandSchemas
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
const invoke = (type: Parameters<typeof createEnvelope>[0], payload: unknown) =>
  invokeCommand(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id: browserId("cmd_books") })
    )
  );
export const books = {
  async hidden() {
    return HiddenBooksSchema.parse(await invoke("books.hidden", {}));
  },
  async describeExternal(input: { projectId: string }) {
    return HiddenBookSchema.parse(
      await invoke(
        "books.describeExternal",
        BookManagementCommandSchemas[2].shape.payload.parse(input)
      )
    );
  },
  async restore(input: import("@deepwrite/contracts").RestoreBookInput) {
    return BookManagementResultSchema.parse(
      await invoke(
        "books.restore",
        BookManagementCommandSchemas[1].shape.payload.parse(input)
      )
    );
  },
  async removeExternal(
    input: import("@deepwrite/contracts").ExternalBookManagementInput
  ) {
    return BookManagementResultSchema.parse(
      await invoke(
        "books.removeExternal",
        BookManagementCommandSchemas[3].shape.payload.parse(input)
      )
    );
  }
};
