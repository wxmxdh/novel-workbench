import { readHiddenBooks } from "../../utilities/book-management-service";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { dialog, nativeImage, type BrowserWindow } from "electron";
import {
  OtterSettingsSchema,
  OtterRuntimeContextSchema,
  AgentTeamCatalogSnapshotSchema,
  type CommandEnvelope,
  type CommandResult,
  type OtterContextRef,
  type OtterSaveWritingInput,
  type OtterSelectWritingInput,
  type ModelSettings,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { OtterProjectAdapter } from "./project-adapter";
import { createOtterProtocolService } from "./protocol-service";
import { createExternalHandoff } from "./external-agent";
import { OtterManualHandoffService } from "./manual-handoff";
import { OtterProjectStudio } from "./project-studio";
import { prepareProjectDiscussion } from "./discussion-service";
import { OtterTeamService } from "./team-service";
import { OtterReviewView } from "./review-view";
import { OtterRuntimeEvidenceStore } from "./runtime-evidence";
import { findAdjacentOtterWorkspace } from "./workspace-discovery";

export class OtterDesktopService {
  private workspaceRoot: string | null = null;
  private adapter: OtterProjectAdapter | undefined;
  private service: ReturnType<typeof createOtterProtocolService> | undefined;
  private studio: OtterProjectStudio | undefined;
  private manual: OtterManualHandoffService | undefined;
  private readonly teams: OtterTeamService;
  private modelReader: (() => Promise<ModelSettings>) | undefined;
  private reviewReady: (() => Promise<void>) | undefined;
  private writingSaver:
    ((input: OtterSaveWritingInput) => Promise<unknown>) | undefined;
  private writingSelector:
    ((input: OtterSelectWritingInput) => Promise<unknown>) | undefined;
  private reviewBoundsRevision = 0;
  private readonly settingsFile: string;
  private readonly reviewView = new OtterReviewView();
  private readonly runtimeEvidence: OtterRuntimeEvidenceStore;

  constructor(private readonly userDataPath: string) {
    this.settingsFile = join(userDataPath, "config", "otter-workspace.json");
    this.runtimeEvidence = new OtterRuntimeEvidenceStore(userDataPath);
    this.teams = new OtterTeamService(userDataPath, {
      adapter: () => this.requireAdapter(),
      protocol: () => this.requireProtocol(),
      catalog: async () => {
        const value = JSON.parse(
          await readFile(
            join(userDataPath, "config", "agent-team-profiles.json"),
            "utf8"
          )
        ) as Record<string, unknown>;
        delete value.version;
        return AgentTeamCatalogSnapshotSchema.parse(value);
      },
      models: () => {
        if (!this.modelReader) throw new Error("模型配置尚未准备好。");
        return this.modelReader();
      }
    });
  }

  async initialize(startPaths: string[] = []): Promise<void> {
    const saved = await readFile(this.settingsFile, "utf8").catch(() => null);
    if (saved) {
      try {
        const settings = OtterSettingsSchema.parse(JSON.parse(saved));
        if (settings.workspaceRoot) await this.attach(settings.workspaceRoot);
      } catch {
        console.warn(
          "Otter workspace configuration needs an explicit folder selection."
        );
      }
      return;
    }
    const adjacent = await findAdjacentOtterWorkspace(startPaths);
    if (adjacent) await this.attach(adjacent);
  }

  configureReview(ready: () => Promise<void>): void {
    this.reviewReady = ready;
  }
  configureModels(reader: () => Promise<ModelSettings>): void {
    this.modelReader = reader;
  }
  configureWriting(
    saver: (input: OtterSaveWritingInput) => Promise<unknown>
  ): void {
    this.writingSaver = saver;
  }
  configureWritingSelection(
    selector: (input: OtterSelectWritingInput) => Promise<unknown>
  ): void {
    this.writingSelector = selector;
  }
  reviewContentsForSmoke() {
    return this.reviewView.contentsForSmoke();
  }
  rememberRuntimeEvent(event: SystemEventEnvelope): void {
    this.runtimeEvidence.remember(this.workspaceRoot, event);
  }
  settings(): { workspaceRoot: string | null } {
    return { workspaceRoot: this.workspaceRoot };
  }
  requireWorkspace(): string {
    if (!this.workspaceRoot) throw new Error("请先选择现有小说工作区根目录。");
    return this.workspaceRoot;
  }
  requireProtocol(): ReturnType<typeof createOtterProtocolService> {
    if (!this.service) throw new Error("当前小说工作区尚未连接。");
    return this.service;
  }
  requireAdapter(): OtterProjectAdapter {
    if (!this.adapter) throw new Error("当前小说工作区尚未连接。");
    return this.adapter;
  }

  private async attach(root: string): Promise<void> {
    const workspace = resolve(root);
    const authority = await lstat(
      join(workspace, ".novel", "protocol", "authority.md")
    ).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        throw new Error(
          "请选择包含所有作品的小说工作区根目录（“小说”文件夹），不要选择单个作品文件夹。"
        );
      throw error;
    });
    if (!authority.isFile() || authority.isSymbolicLink())
      throw new Error("选定目录缺少当前 V1 协议入口。");
    this.workspaceRoot = workspace;
    this.adapter = new OtterProjectAdapter(workspace, this.userDataPath);
    this.service = createOtterProtocolService(workspace, this.adapter, {
      userDataPath: this.userDataPath
    });
    this.studio = new OtterProjectStudio({
      workspaceRoot: workspace,
      adapter: this.adapter,
      registerWithV1: async (path, input) =>
        this.requireProtocol().registerNewProject(path, input),
      readCurrentContext: async () =>
        JSON.parse(
          await readFile(
            join(
              workspace,
              "06_脚本工具",
              "小说对照工作台",
              "data",
              "current-context.json"
            ),
            "utf8"
          )
        ),
      chooseMapFile: async () => {
        const result = await dialog.showOpenDialog({
          title: "导入地图参考图",
          properties: ["openFile"],
          filters: [
            { name: "地图图片", extensions: ["png", "jpg", "jpeg", "webp"] }
          ]
        });
        return result.canceled || !result.filePaths[0]
          ? null
          : { path: result.filePaths[0] };
      },
      makeMapPreview: (bytes) => {
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty())
          throw new Error("无法读取该图片，请选择有效的 PNG、JPEG 或 WebP。");
        return `data:image/jpeg;base64,${image.resize({ width: 640 }).toJPEG(78).toString("base64")}`;
      }
    });
    this.manual = new OtterManualHandoffService(this.userDataPath, {
      resolveProject: async (id) => {
        await this.requireAdapter().listProjects();
        return this.requireAdapter().resolveProject(id);
      },
      readSource: async (id, path) =>
        this.requireAdapter().readDocument(id, path),
      resolveContext: async (ref) => this.requireProtocol().context(ref)
    });
    await this.persistSettings();
  }

  private async persistSettings(): Promise<void> {
    await mkdir(dirname(this.settingsFile), { recursive: true });
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.settings()), {
      flag: "wx"
    });
    await rename(temporary, this.settingsFile);
  }

  async chooseWorkspace(
    window: BrowserWindow
  ): Promise<{ workspaceRoot: string | null } | null> {
    const choice = await dialog.showOpenDialog(window, {
      title: "选择现有小说工作区根目录",
      properties: ["openDirectory"],
      ...(this.workspaceRoot ? { defaultPath: this.workspaceRoot } : {})
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    this.reviewView.dispose();
    await this.attach(choice.filePaths[0]);
    return this.settings();
  }

  async resolveRuntimeContext(reference: OtterContextRef) {
    const context = await this.requireProtocol().context(reference);
    return OtterRuntimeContextSchema.parse({
      projectId: reference.projectId,
      contextId: context.contextId,
      baselineHash: context.baselineHash,
      comparisonBaselineHash: context.comparisonBaselineHash,
      apiText: context.apiText
    });
  }

  async handle(
    command: CommandEnvelope,
    window: BrowserWindow
  ): Promise<CommandResult | undefined> {
    if (!command.type.startsWith("otter.")) return undefined;
    try {
      let payload: unknown;
      switch (command.type) {
        case "otter.prepareDiscussion":
          payload = await prepareProjectDiscussion(
            this.requireAdapter(),
            this.requireProtocol(),
            command.payload
          );
          break;
        case "otter.teams":
          payload = await this.teams.list();
          break;
        case "otter.saveTeams":
          payload = await this.teams.save(command.payload);
          break;
        case "otter.prepareTeam":
          payload = await this.teams.prepare(command.payload);
          break;
        case "otter.manualHandoff":
          if (!this.manual) throw new Error("请先选择小说工作区。");
          payload = await this.manual.create(command.payload);
          break;
        case "otter.manualReport":
          if (!this.manual) throw new Error("请先选择小说工作区。");
          payload = await this.manual.readReport(command.payload);
          break;
        case "otter.storySpace":
        case "otter.createProject":
        case "otter.saveConcept":
        case "otter.saveWorldNote":
        case "otter.saveMapNote":
        case "otter.importMap":
        case "otter.readingContext": {
          if (!this.studio) throw new Error("请先选择小说工作区。");
          if (command.type === "otter.storySpace")
            payload = await this.studio.storySpace(command.payload);
          else if (command.type === "otter.createProject")
            payload = await this.studio.createProject(command.payload);
          else if (command.type === "otter.saveConcept")
            payload = await this.studio.saveConcept(command.payload);
          else if (command.type === "otter.saveWorldNote")
            payload = await this.studio.saveWorldNote(command.payload);
          else if (command.type === "otter.saveMapNote")
            payload = await this.studio.saveMapNote(command.payload);
          else if (command.type === "otter.importMap")
            payload = await this.studio.importMap(command.payload);
          else payload = await this.studio.readingContext(command.payload);
          break;
        }
        case "otter.settings":
          payload = this.settings();
          break;
        case "otter.chooseWorkspace":
          payload = await this.chooseWorkspace(window);
          break;
        case "otter.projects":
          {
            const hidden = await readHiddenBooks(this.userDataPath);
            payload = (await this.requireAdapter().listProjects()).filter(
              (project) =>
                !hidden.some(
                  (item) =>
                    item.kind === "external" &&
                    item.id === project.id &&
                    item.workspaceRoot === this.workspaceRoot
                )
            );
          }
          break;
        case "otter.open":
          payload = await this.requireAdapter().openProject(
            command.payload.projectId
          );
          break;
        case "otter.read": {
          const read = await this.requireAdapter().readDocument(
            command.payload.projectId,
            command.payload.path
          );
          payload = { path: read.path, content: read.content, hash: read.hash };
          break;
        }
        case "otter.route":
          payload = {
            result: await this.requireProtocol().route(command.payload)
          };
          break;
        case "otter.workflow":
          payload = {
            result: await this.requireProtocol().workflow(command.payload)
          };
          break;
        case "otter.context": {
          const context = await this.requireProtocol().context(command.payload);
          payload = {
            contextId: context.contextId,
            baselineHash: context.baselineHash,
            comparisonBaselineHash: context.comparisonBaselineHash,
            apiText: context.apiText,
            agentText: context.agentText
          };
          break;
        }
        case "otter.stageDraft": {
          const view = await this.requireProtocol().context(command.payload);
          const evidence = await this.runtimeEvidence.forDraft({
            projectId: command.payload.projectId,
            contextId: view.contextId,
            body: command.payload.body,
            runId: command.payload.originRunId,
            workspaceRoot: this.requireWorkspace()
          });
          payload = {
            result: await this.requireProtocol().stageDraft({
              ...command.payload,
              ...(evidence ?? {})
            })
          };
          break;
        }
        case "otter.saveWriting": {
          if (!this.writingSaver) throw new Error("候选稿保存服务尚未准备好。");
          payload = await this.writingSaver(command.payload);
          break;
        }
        case "otter.selectWriting": {
          if (!this.writingSelector)
            throw new Error("候选稿选择服务尚未准备好。");
          payload = await this.writingSelector(command.payload);
          break;
        }
        case "otter.handoff": {
          const context = await this.requireProtocol().context(command.payload);
          const project = await this.requireAdapter().resolveProject(
            command.payload.projectId
          );
          payload = await createExternalHandoff(
            { userDataPath: this.userDataPath },
            project.projectRoot,
            context,
            command.payload.tool
          );
          break;
        }
        case "otter.reviewPage": {
          if (!this.reviewReady) throw new Error("页间本地协议尚未准备好。");
          await this.reviewReady();
          payload = { url: "otter-review://app/" };
          break;
        }
        case "otter.setReviewBounds": {
          const revision = ++this.reviewBoundsRevision;
          if (command.payload.bounds && this.reviewReady)
            await this.reviewReady();
          if (revision === this.reviewBoundsRevision)
            await this.reviewView.show(window, command.payload.bounds);
          payload = {};
          break;
        }
        case "otter.setReviewTheme": {
          await this.reviewView.setTheme(window, command.payload);
          payload = {};
          break;
        }
        case "otter.setReviewOverlay": {
          payload = await this.reviewView.setOverlay(
            window,
            command.payload.visible
          );
          break;
        }
        default:
          throw new Error("未知小说工作台操作。");
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "otter.operation_failed",
          message:
            error instanceof Error ? error.message : "小说工作台操作未完成。"
        }
      };
    }
  }
}
