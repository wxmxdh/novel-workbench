import {
  WorkbenchRequestSchema,
  WorkbenchResponseSchema,
  createEnvelope,
  type WorkbenchCollaborationApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
export const workbenchCollaboration: WorkbenchCollaborationApi = {
  async request(raw) {
    const payload = WorkbenchRequestSchema.parse(raw);
    const id = browserId("cmd_workbench_collaboration");
    return WorkbenchResponseSchema.parse(
      await invokeCommand(
        createEnvelope("workbenchCollaboration.request", payload, {
          id,
          correlationId: id
        })
      )
    );
  }
};
