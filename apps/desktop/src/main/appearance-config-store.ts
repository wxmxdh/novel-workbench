import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AppearanceSettingsSchema,
  AppearanceSettingsSnapshotSchema,
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@deepwrite/contracts";

interface DiskAppearanceSettings {
  version: 1;
  mode: AppearanceSettings["mode"];
  light: AppearanceSettings["light"];
  dark: AppearanceSettings["dark"];
  uiFontFamily?: AppearanceSettings["uiFontFamily"];
  editorFontFamily?: AppearanceSettings["editorFontFamily"];
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function toPublicSettings(raw: unknown): AppearanceSettings {
  return AppearanceSettingsSchema.parse(raw);
}

function migrateLegacyDefaultLightBackground(
  settings: AppearanceSettings
): AppearanceSettings {
  const light = settings.light;
  const isFactoryPreset = light.preset === "codex" || light.preset === "claude";
  const colors = [
    light.accent.toUpperCase(),
    light.background.toUpperCase(),
    light.foreground.toUpperCase()
  ].join(":");
  const matchesLegacyFactory =
    isFactoryPreset &&
    (colors === "#339CFF:#FFFFFF:#1A1C1F" ||
      colors === "#339CFF:#FAF9F5:#1A1C1F");
  if (!matchesLegacyFactory) return settings;

  return {
    ...settings,
    light: {
      ...light,
      preset: "claude",
      accent: "#B85B44",
      background: "#F2EEE7",
      foreground: "#2D2924"
    }
  };
}

export class AppearanceConfigStore {
  readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "appearance.json");
  }

  async list(): Promise<AppearanceSettingsSnapshot> {
    await this.writeChain;
    try {
      const raw = JSON.parse(
        await readFile(this.settingsPath, "utf8")
      ) as unknown;
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !("version" in raw) ||
        (raw as { version?: unknown }).version !== 1
      ) {
        return AppearanceSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultAppearanceSettings()
        });
      }
      const candidate = raw as DiskAppearanceSettings;
      const previousSettings = toPublicSettings({
        mode: candidate.mode,
        light: candidate.light,
        dark: candidate.dark,
        uiFontFamily: candidate.uiFontFamily,
        editorFontFamily: candidate.editorFontFamily
      });
      const settings = migrateLegacyDefaultLightBackground(previousSettings);
      if (settings !== previousSettings) return await this.save(settings);
      return AppearanceSettingsSnapshotSchema.parse({
        persisted: true,
        settings
      });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) {
        return AppearanceSettingsSnapshotSchema.parse({
          persisted: false,
          settings: createDefaultAppearanceSettings()
        });
      }
      throw error;
    }
  }

  async save(
    rawInput: AppearanceSettings
  ): Promise<AppearanceSettingsSnapshot> {
    const settings = AppearanceSettingsSchema.parse(rawInput);
    let saved: AppearanceSettingsSnapshot | undefined;
    const operation = this.writeChain.then(async () => {
      const disk: DiskAppearanceSettings = {
        version: 1,
        mode: settings.mode,
        light: settings.light,
        dark: settings.dark,
        uiFontFamily: settings.uiFontFamily,
        editorFontFamily: settings.editorFontFamily
      };
      await atomicWriteJson(this.settingsPath, disk);
      saved = AppearanceSettingsSnapshotSchema.parse({
        persisted: true,
        settings
      });
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }
}
