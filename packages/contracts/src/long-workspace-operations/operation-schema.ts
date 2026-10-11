import { z } from "zod";
import { LongWorkspaceStoryOperationSchemas } from "./operation-schema-story";
import { LongWorkspaceVolumeChapterOperationSchemas } from "./operation-schema-volume-chapter";
import { LongWorkspaceWorldCharacterOperationSchemas } from "./operation-schema-world-character";

export {
  LongProvisionalIdSchema,
  type LongProvisionalId
} from "./schema-helpers";

export const LongWorkspaceOperationSchema = z.discriminatedUnion("type", [
  ...LongWorkspaceWorldCharacterOperationSchemas,
  ...LongWorkspaceVolumeChapterOperationSchemas,
  ...LongWorkspaceStoryOperationSchemas
]);
export type LongWorkspaceOperation = z.infer<
  typeof LongWorkspaceOperationSchema
>;
