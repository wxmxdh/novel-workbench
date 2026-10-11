import {
  LongStageSourceImportInputSchema,
  LongStageSourceImportResultSchema,
  LongConfirmSourceImportInputSchema,
  LongImportSourceResultSchema,
  createEnvelope,
  type LongStageSourceImportInput,
  type LongConfirmSourceImportInput
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export async function stageSourceImport(rawInput: LongStageSourceImportInput) {
  const input = LongStageSourceImportInputSchema.parse(rawInput);
  const id = browserId("cmd_long_source_preview");
  return LongStageSourceImportResultSchema.parse(
    await invokeCommand(
      createEnvelope("long.stageSourceImport", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}

export async function confirmSourceImport(
  rawInput: LongConfirmSourceImportInput
) {
  const input = LongConfirmSourceImportInputSchema.parse(rawInput);
  const id = browserId("cmd_long_source_confirm");
  return LongImportSourceResultSchema.parse(
    await invokeCommand(
      createEnvelope("long.confirmSourceImport", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}
