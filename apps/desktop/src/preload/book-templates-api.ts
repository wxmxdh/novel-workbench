import {
  BookSchema,
  BookTemplateListSchema,
  BookTemplateSchema,
  SaveBookTemplateInputSchema,
  BookTemplateTargetSchema,
  BookTemplateDeletedSchema,
  CreateBookFromTemplateInputSchema,
  createEnvelope,
  type BookTemplatesApi,
  type CreateBookFromTemplate
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
function identity() {
  const id = browserId("cmd_book_templates");
  return { id, correlationId: id };
}
export const bookTemplates: BookTemplatesApi = {
  async list() {
    return BookTemplateListSchema.parse(
      await invokeCommand(createEnvelope("bookTemplates.list", {}, identity()))
    );
  },
  async save(input) {
    return BookTemplateSchema.parse(
      await invokeCommand(
        createEnvelope(
          "bookTemplates.save",
          SaveBookTemplateInputSchema.parse(input),
          identity()
        )
      )
    );
  },
  async delete(input) {
    BookTemplateDeletedSchema.parse(
      await invokeCommand(
        createEnvelope(
          "bookTemplates.delete",
          BookTemplateTargetSchema.parse(input),
          identity()
        )
      )
    );
  }
};
export const createBookFromTemplate: CreateBookFromTemplate = async (input) =>
  BookSchema.nullable().parse(
    await invokeCommand(
      createEnvelope(
        "catalog.createBookFromTemplate",
        CreateBookFromTemplateInputSchema.parse(input),
        identity()
      )
    )
  );
