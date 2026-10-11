import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import type {
  OtterCreateProjectInput,
  OtterMapImportInput,
  OtterReadingContextInput,
  OtterSaveIdeaInput,
  OtterStorySpaceInput
} from "@deepwrite/contracts";
import {
  OtterProjectAdapter,
  type OtterProjectDocument
} from "./project-adapter";

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const MAX_MAP_BYTES = 10_000_000;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const IMAGE_TYPES = {
  ".png": {
    mediaType: "image/png",
    signature: (b: Buffer) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  },
  ".jpg": {
    mediaType: "image/jpeg",
    signature: (b: Buffer) =>
      b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  },
  ".jpeg": {
    mediaType: "image/jpeg",
    signature: (b: Buffer) =>
      b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  },
  ".webp": {
    mediaType: "image/webp",
    signature: (b: Buffer) =>
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP"
  }
} as const;

export interface OtterStudioOptions {
  workspaceRoot: string;
  adapter: OtterProjectAdapter;
  /** Calls the actual V1 `register` CLI; project policy/validation stays in V1. */
  registerWithV1: (
    projectRelativePath: string,
    input: Record<string, unknown>
  ) => Promise<void>;
  readCurrentContext?: () => Promise<unknown | null>;
  chooseMapFile?: () => Promise<{ path: string } | null>;
  makeMapPreview?: (bytes: Buffer, mediaType: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeSlug(title: string): string {
  const slug = title
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug || slug === "." || slug === ".." || RESERVED.test(slug))
    throw new Error("作品名不能生成安全的文件夹名称，请换一个名称。");
  return slug;
}
function posix(value: string) {
  return value.split(sep).join("/");
}
function inside(base: string, target: string) {
  const rel = relative(base, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
function markdownTitle(value: string) {
  return value.replace(/[\r\n#]/g, " ").trim();
}
function safeMarkdownPath(path: string) {
  return path.replace(/\\/g, "/").replace(/[\r\n<>]/g, "");
}

export class OtterProjectStudio {
  private readonly workspaceRoot: string;
  constructor(private readonly options: OtterStudioOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
  }

  async readingContext(input: OtterReadingContextInput = {}) {
    const projects = await this.options.adapter.listProjects();
    const candidates: Array<{
      projectId: string | null;
      projectRelativePath: string | null;
      projectTitle: string;
      volume: string | null;
      chapter: string | null;
      activeDocumentPath: string | null;
      annotationEntryPath: string | null;
    }> = [];
    const currentContext = await this.options
      .readCurrentContext?.()
      .catch(() => null);
    let recent: (typeof candidates)[number] | null = null;
    if (isRecord(currentContext)) {
      const workspace = await realpath(this.workspaceRoot);
      const rawRoot =
        typeof currentContext.root === "string" ? currentContext.root : null;
      const rawActive =
        isRecord(currentContext.activeFile) &&
        typeof currentContext.activeFile.path === "string"
          ? currentContext.activeFile.path
          : null;
      let projectAbsolute: string | null = null;
      if (rawRoot && isAbsolute(rawRoot)) projectAbsolute = resolve(rawRoot);
      else if (rawActive && isAbsolute(rawActive))
        projectAbsolute = dirname(resolve(rawActive));
      if (projectAbsolute && inside(workspace, projectAbsolute)) {
        let safeDirectory = true;
        let cursor = workspace;
        for (const part of relative(workspace, projectAbsolute)
          .split(sep)
          .filter(Boolean)) {
          cursor = join(cursor, part);
          const stat = await lstat(cursor).catch(() => null);
          if (!stat?.isDirectory() || stat.isSymbolicLink()) {
            safeDirectory = false;
            break;
          }
        }
        if (!safeDirectory) projectAbsolute = null;
      }
      if (projectAbsolute && inside(workspace, projectAbsolute)) {
        const projectRelativePath = posix(relative(workspace, projectAbsolute));
        const catalogEntry = projects.find(
          (project) => project.relativePath === projectRelativePath
        );
        const activeRelative =
          rawActive && inside(projectAbsolute, resolve(rawActive))
            ? posix(relative(projectAbsolute, resolve(rawActive)))
            : null;
        const annotationAbsolute =
          typeof currentContext.annotationEntry === "string" &&
          isAbsolute(currentContext.annotationEntry)
            ? resolve(currentContext.annotationEntry)
            : null;
        recent = {
          projectId: catalogEntry?.id ?? null,
          projectRelativePath,
          projectTitle:
            catalogEntry?.title ??
            (typeof currentContext.project === "string"
              ? currentContext.project
              : basename(projectAbsolute)),
          volume:
            typeof currentContext.volume === "string"
              ? currentContext.volume
              : null,
          chapter:
            typeof currentContext.chapter === "string"
              ? currentContext.chapter
              : null,
          activeDocumentPath: activeRelative,
          annotationEntryPath:
            annotationAbsolute && inside(projectAbsolute, annotationAbsolute)
              ? posix(relative(projectAbsolute, annotationAbsolute))
              : null
        };
        candidates.push(recent);
      }
    }
    const saved = input.savedProjectId
      ? projects.find((project) => project.id === input.savedProjectId)
      : null;
    const savedCandidate = saved
      ? {
          projectId: saved.id,
          projectRelativePath: saved.relativePath,
          projectTitle: saved.title,
          volume: null,
          chapter: null,
          activeDocumentPath: null,
          annotationEntryPath: null
        }
      : null;
    const conflict = Boolean(
      savedCandidate && recent && savedCandidate.projectId !== recent.projectId
    );
    if (
      savedCandidate &&
      !candidates.some(
        (candidate) => candidate.projectId === savedCandidate.projectId
      )
    )
      candidates.push(savedCandidate);
    const selected = conflict
      ? null
      : savedCandidate &&
          recent &&
          savedCandidate.projectId === recent.projectId
        ? recent
        : (savedCandidate ?? recent);
    return {
      current: {
        projectId: selected?.projectId ?? null,
        projectRelativePath: selected?.projectRelativePath ?? null,
        volume: selected?.volume ?? null,
        chapter: selected?.chapter ?? null,
        activeDocumentPath: selected?.activeDocumentPath ?? null,
        annotationEntryPath: selected?.annotationEntryPath ?? null,
        conflict
      },
      candidates
    };
  }

  async storySpace(input: OtterStorySpaceInput) {
    const view = await this.options.adapter.openProject(input.projectId);
    const docs = view.documents;
    const maps = [] as Array<{
      document: OtterProjectDocument;
      previewDataUrl: string | null;
    }>;
    for (const document of docs.filter(
      (item) =>
        item.category === "map" && /\.(?:png|jpe?g|webp)$/i.test(item.path)
    )) {
      let previewDataUrl: string | null = null;
      if (this.options.makeMapPreview) {
        try {
          const resolved = await this.options.adapter.resolveProject(
            input.projectId
          );
          const abs = await this.safeProjectFile(
            resolved.projectRoot,
            document.path,
            MAX_MAP_BYTES
          );
          const bytes = await readFile(abs);
          const media = this.detectImage(document.path, bytes);
          previewDataUrl = this.options.makeMapPreview(bytes, media.mediaType);
          if (
            previewDataUrl.length > 750_000 ||
            !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
              previewDataUrl
            )
          )
            previewDataUrl = null;
        } catch {
          /* invalid/missing map references stay listed without a preview */
        }
      }
      maps.push({ document, previewDataUrl });
    }
    return {
      project: view.project,
      people: docs.filter((doc) => doc.category === "character"),
      relationships: docs.filter((doc) => doc.category === "relationship"),
      concepts: docs.filter((doc) => doc.category === "concept"),
      world: docs.filter((doc) => doc.category === "world"),
      maps,
      documents: docs
    };
  }

  async createProject(input: OtterCreateProjectInput) {
    if (!input.title.trim() || input.title.length > 120)
      throw new Error("作品名称无效。");
    const workspace = await realpath(this.workspaceRoot);
    const central = await this.assertExistingDirectoryPath(
      workspace,
      "00_创作项目/项目"
    );
    const root = join(central, safeSlug(input.title));
    await mkdir(root); // exclusive: an existing title/path is never overwritten
    try {
      const canonRelative = "001_正典/项目正典.md";
      const canon =
        "# 项目正典入口\n\n> 空白框架：目前没有登记任何作品事实。请按本项目规则与 V1 流程逐项确认后再补充。\n\n## 已确认事实\n\n（尚无）\n";
      const canonHash = sha256(canon);
      const profile = `# ${markdownTitle(input.title)}：项目资料入口\n\n当前正典来源：\`${canonRelative}\`\n来源 SHA-256：\`${canonHash}\`\n\n此文件仅用于 V1 来源登记，不代表新增人物、剧情或世界设定。\n`;
      await mkdir(join(root, "001_正典"), { recursive: true });
      await mkdir(join(root, "004_写作中"), { recursive: true });
      await mkdir(join(root, ".novel"), { recursive: true });
      await writeFile(join(root, canonRelative), canon, {
        flag: "wx",
        encoding: "utf8"
      });
      await writeFile(join(root, "project-profile.md"), profile, {
        flag: "wx",
        encoding: "utf8"
      });
      await writeFile(
        join(root, "AGENTS.md"),
        `# ${markdownTitle(input.title)}\n\n本项目从空白构想开始。正式章节、人物和设定按工作区 V1 协议与本项目当前有效来源处理。\n`,
        { flag: "wx", encoding: "utf8" }
      );
      const manifest = {
        schema_version: 1,
        project: input.title.trim(),
        canon: { source: canonRelative, version: "1", hash: canonHash },
        active_source: "project-profile.md",
        entry_sources: ["AGENTS.md", "project-profile.md"],
        derived_registry: ".novel/derived-registry.json"
      };
      const projectRelativePath = posix(relative(workspace, root));
      await this.options.registerWithV1(projectRelativePath, manifest);
      const refreshed = await this.options.adapter.listProjects();
      const created = refreshed.find(
        (project) => project.relativePath === projectRelativePath
      );
      if (!created)
        throw new Error(
          "V1登记完成，但工作区目录索引尚未识别新作品；请刷新项目列表。"
        );
      return {
        projectId: created.id,
        relativePath: created.relativePath,
        title: created.title
      };
    } catch (error) {
      throw new Error(
        `新作品文件夹已创建但初始化未完成，请保留并检查：${root}。${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  saveConcept(input: OtterSaveIdeaInput) {
    return this.saveCandidate(input, "concept");
  }
  saveWorldNote(input: OtterSaveIdeaInput) {
    return this.saveCandidate(input, "world");
  }
  saveMapNote(input: OtterSaveIdeaInput) {
    return this.saveCandidate(input, "map");
  }

  private async saveCandidate(
    input: OtterSaveIdeaInput,
    kind: "concept" | "world" | "map"
  ) {
    const project = await this.options.adapter.resolveProject(input.projectId);
    const related: string[] = [];
    for (const path of input.relatedPaths ?? []) {
      if (path.startsWith("workspace:"))
        throw new Error("构想关联必须来自当前作品内部。");
      await this.options.adapter.readDocument(input.projectId, path);
      related.push(path);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir =
      kind === "concept"
        ? ".novel/notes/concepts"
        : kind === "map"
          ? ".novel/notes/maps"
          : ".novel/notes/world";
    await this.ensureProjectDirectory(project.projectRoot, dir);
    const file = `${safeSlug(input.title)}-${timestamp}-${randomUUID().slice(0, 8)}.md`;
    const path = `${dir}/${file}`;
    const marker =
      kind === "concept"
        ? "未定情节构想"
        : kind === "map"
          ? "地图说明候选"
          : "世界观参考候选";
    const body = `# ${markdownTitle(input.title)}\n\n状态：${marker}；待作者确认\n类型：候选材料，不是正典事实\n${related.length ? `关联资料：${related.map((p) => `\`${safeMarkdownPath(p)}\``).join("、")}\n` : ""}\n---\n\n${input.content.trim()}\n`;
    const absolute = join(project.projectRoot, path);
    await this.assertStillWritable(input.projectId, project.projectRoot);
    await writeFile(absolute, body, { flag: "wx", encoding: "utf8" });
    return {
      path,
      title: input.title.trim(),
      status: "candidate" as const,
      hash: sha256(body)
    };
  }

  async importMap(input: OtterMapImportInput) {
    if (!this.options.chooseMapFile) return null;
    const selected = await this.options.chooseMapFile();
    if (!selected) return null;
    const project = await this.options.adapter.resolveProject(input.projectId);
    const selectedInfo = await lstat(selected.path);
    if (selectedInfo.isSymbolicLink())
      throw new Error("不能导入符号链接图片，请选择原始图片文件。");
    const source = await realpath(selected.path);
    const stat = await lstat(source);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > MAX_MAP_BYTES
    )
      throw new Error("地图图片需为普通文件，且不超过 10 MB。");
    const bytes = await readFile(source);
    const ext = extname(source).toLowerCase() as keyof typeof IMAGE_TYPES;
    const type = IMAGE_TYPES[ext];
    if (!type || !type.signature(bytes))
      throw new Error("只支持内容有效的 PNG、JPG 或 WebP 图片。");
    const directory = ".novel/notes/maps/references";
    const title = input.title?.trim() || basename(source, extname(source));
    const destination = `${safeSlug(title)}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}${ext}`;
    const relativePath = `${directory}/${destination}`;
    const absolute = join(project.projectRoot, relativePath);
    const dataUrl = this.options.makeMapPreview?.(bytes, type.mediaType) ?? "";
    if (
      dataUrl.length > 750_000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)
    )
      throw new Error("地图图片无法安全生成预览；请换用较小或有效的图片。");
    await this.ensureProjectDirectory(project.projectRoot, directory);
    await this.assertStillWritable(input.projectId, project.projectRoot);
    await writeFile(absolute, bytes, { flag: "wx" });
    const note = `${absolute}.reference.md`;
    await writeFile(
      note,
      `# ${markdownTitle(title)}\n\n状态：参考图候选；待作者确认\n类型：导入图片，不自动确认为世界观或地理事实\n`,
      { flag: "wx", encoding: "utf8" }
    );
    return {
      path: relativePath,
      title,
      mediaType: type.mediaType,
      bytes: bytes.length,
      dataUrl
    };
  }

  private async assertExistingDirectoryPath(root: string, path: string) {
    if (
      !path ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
    )
      throw new Error("工作区目录路径无效。");
    let cursor = root;
    for (const part of path.split(/[\\/]/)) {
      cursor = join(cursor, part);
      const info = await lstat(cursor).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink())
        throw new Error("当前工作区的项目入口不存在或含符号链接。");
    }
    return cursor;
  }

  private detectImage(path: string, bytes: Buffer) {
    const type =
      IMAGE_TYPES[extname(path).toLowerCase() as keyof typeof IMAGE_TYPES];
    if (!type || !type.signature(bytes)) throw new Error("地图文件格式无效。");
    return type;
  }

  private async safeProjectFile(
    projectRoot: string,
    path: string,
    maxBytes: number
  ) {
    if (
      !path ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === ".." || part === ".")
    )
      throw new Error("地图图片路径无效。");
    const absolute = resolve(projectRoot, path);
    if (!inside(projectRoot, absolute))
      throw new Error("地图图片越出作品目录。");
    const realRoot = await realpath(projectRoot);
    let cursor = projectRoot;
    for (const part of path.split(/[\\/]/)) {
      cursor = join(cursor, part);
      const component = await lstat(cursor);
      if (component.isSymbolicLink())
        throw new Error("地图图片路径包含符号链接。");
    }
    const realFile = await realpath(absolute);
    if (!inside(realRoot, realFile))
      throw new Error("地图图片链接越出作品目录。");
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
      throw new Error("地图图片类型或大小无效。");
    return absolute;
  }

  private async ensureProjectDirectory(projectRoot: string, relPath: string) {
    if (
      !relPath ||
      isAbsolute(relPath) ||
      relPath
        .split(/[\\/]/)
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("作品内目录路径无效。");
    let cursor = projectRoot;
    for (const part of relPath.split(/[\\/]/)) {
      cursor = join(cursor, part);
      const prior = await lstat(cursor).catch(() => null);
      if (!prior) {
        await mkdir(cursor);
        continue;
      }
      if (!prior.isDirectory() || prior.isSymbolicLink())
        throw new Error(`拒绝写入非普通目录：${cursor}`);
    }
  }

  private async assertStillWritable(
    projectId: string,
    expectedProjectRoot: string
  ): Promise<void> {
    const current = await this.options.adapter.resolveProject(projectId);
    if (resolve(current.projectRoot) !== resolve(expectedProjectRoot))
      throw new Error("小说项目路径在保存期间发生变化，拒绝继续写入。");
  }
}
