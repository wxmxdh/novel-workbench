import { readWriteClawLongSource } from "../write-claw-long-archive";
import { createWriteClawLongImportPlan } from "./create-plan";
import type {
  CreateWriteClawLongImportPlanOptions,
  WriteClawLongImportPlan
} from "./types";

export async function readWriteClawLongImportPlan(
  path: string,
  options: CreateWriteClawLongImportPlanOptions = {}
): Promise<WriteClawLongImportPlan> {
  const source = await readWriteClawLongSource(path);
  return createWriteClawLongImportPlan(source, options);
}
