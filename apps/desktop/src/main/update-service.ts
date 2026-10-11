import { app } from "electron";
import { UpdateStateSchema, type UpdateState } from "@deepwrite/contracts";

type UpdateStateListener = (state: UpdateState) => void;

const DISABLED_MESSAGE = "此本地定制版本未启用自动更新。";

export class UpdateService {
  private readonly listeners = new Set<UpdateStateListener>();

  constructor(_requestInstall: () => void) {}

  getState(): UpdateState {
    return UpdateStateSchema.parse({
      status: "unsupported",
      currentVersion: app.getVersion(),
      releaseNotes: [],
      mandatory: false,
      canDownload: false,
      canInstall: false,
      message: DISABLED_MESSAGE
    });
  }

  subscribe(listener: UpdateStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<UpdateState> {
    return this.getState();
  }

  async download(): Promise<UpdateState> {
    throw new Error(DISABLED_MESSAGE);
  }

  install(): void {
    throw new Error(DISABLED_MESSAGE);
  }

  quitAndInstall(): void {
    // The local fork has no updater; keep shutdown callers harmless.
  }
}
