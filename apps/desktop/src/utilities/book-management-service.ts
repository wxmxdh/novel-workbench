import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  HiddenBooksSchema,
  OtterSettingsSchema,
  type HiddenBook,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { OtterProjectAdapter } from "../extras/otter/project-adapter";
import { readNoFollowFile } from "./long-project-store/io";
import type { LongWorkspaceService } from "./long-workspace-service";
import { withExternalProjectLock } from "./external-project-operations";

const EXTERNAL_MANIFEST = ".novel/project.json";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DELETE_MARKER_BYTES = 16 * 1024;
const DELETE_MARKER_SUFFIX = ".deepwrite-delete-marker.json";

interface ExternalDeleteMarker {
  schemaVersion: 1;
  projectId: string;
  projectDirectory: string;
  quarantineDirectory: string;
  identitySha256: string;
  device: string;
  inode: string;
}

export interface BookManagementFileOperations {
  replaceFile(tempPath: string, targetPath: string): Promise<void>;
  renameDirectory(sourcePath: string, targetPath: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

const DEFAULT_FILE_OPERATIONS: BookManagementFileOperations = {
  replaceFile: rename,
  renameDirectory: rename,
  removeDirectory: (path) => rm(path, { recursive: true, force: false }),
  removeFile: (path) => rm(path, { force: true })
};

export async function readHiddenBooks(
  userDataPath: string
): Promise<HiddenBook[]> {
  try {
    return HiddenBooksSchema.parse(
      JSON.parse(
        await readFile(
          join(userDataPath, "config", "hidden-books.json"),
          "utf8"
        )
      )
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Core is the sole writer; Main may read this display registry. */
export class BookManagementService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private userDataPath: string,
    private long: LongWorkspaceService,
    private removeHistory: (id: string) => Promise<void> = async () => {},
    fileOperations: Partial<BookManagementFileOperations> = {}
  ) {
    this.fileOperations = { ...DEFAULT_FILE_OPERATIONS, ...fileOperations };
  }

  private readonly fileOperations: BookManagementFileOperations;

  private async save(books: HiddenBook[]) {
    const path = join(this.userDataPath, "config", "hidden-books.json");
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    const bytes = Buffer.from(
      JSON.stringify(HiddenBooksSchema.parse(books), null, 2),
      "utf8"
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600
      );
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.fileOperations.replaceFile(temp, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async external(projectId: string) {
    const settings = OtterSettingsSchema.parse(
      JSON.parse(
        await readFile(
          join(this.userDataPath, "config", "otter-workspace.json"),
          "utf8"
        )
      )
    );
    if (!settings.workspaceRoot) throw new Error("小说工作区尚未连接。");
    const workspaceRoot = await realpath(settings.workspaceRoot);
    const rootInfo = await lstat(workspaceRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
      throw new Error("小说工作区必须是真实目录。");
    const adapter = new OtterProjectAdapter(workspaceRoot, this.userDataPath);
    const project = (await adapter.listProjects()).find(
      (item) => item.id === projectId
    );
    if (!project) throw new Error("该书不属于当前登记的小说工作区。");
    const projectDirectory = resolve(workspaceRoot, project.relativePath);
    await assertProjectBoundary(workspaceRoot, projectDirectory);
    const identitySha256 = await projectManifestIdentity(
      projectDirectory,
      true
    );
    return {
      ...(identitySha256 ? { identitySha256 } : {}),
      id: project.id,
      kind: "external" as const,
      title: project.title,
      projectDirectory,
      workspaceRoot,
      hiddenAt: new Date().toISOString()
    };
  }

  async handle(command: CommandEnvelope): Promise<CommandResult | undefined> {
    if (
      !command.type.startsWith("books.") &&
      command.type !== "long.unregister" &&
      command.type !== "long.delete"
    )
      return;
    const operation = this.queue.then(() => this.perform(command));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async perform(command: CommandEnvelope): Promise<CommandResult> {
    let payload: unknown;
    const hidden = await readHiddenBooks(this.userDataPath);
    if (command.type === "books.hidden") payload = hidden;
    else if (command.type === "books.describeExternal")
      payload = await this.external(command.payload.projectId);
    else if (command.type === "books.restore") {
      const input = command.payload;
      const item = hidden.find(
        (book) =>
          book.id === input.id &&
          book.kind === input.kind &&
          samePath(book.projectDirectory, input.expectedProjectDirectory) &&
          (!input.workspaceRoot ||
            (book.workspaceRoot &&
              samePath(book.workspaceRoot, input.workspaceRoot)))
      );
      if (!item) throw new Error("隐藏记录与确认时的书籍路径不一致。");
      if (item.deletePending)
        throw new Error(
          "本书正在永久删除，不能恢复；请在隐藏列表重试删除清理。"
        );
      if (item.kind === "native") {
        const inspected = await this.long.store.openBook(item.projectDirectory);
        if (inspected.book.id !== item.id)
          throw new Error("目录中的书籍身份已经变化，不能按旧记录恢复。");
        const opened = await this.long.openAtPath(item.projectDirectory);
        if (opened.book.id !== item.id)
          throw new Error("目录中的书籍身份已经变化，不能按旧记录恢复。");
      } else {
        if (!item.workspaceRoot)
          throw new Error("外部项目缺少原工作区身份，不能恢复。");
        if (
          input.workspaceRoot &&
          !samePath(item.workspaceRoot, input.workspaceRoot)
        )
          throw new Error("外部项目工作区与确认时不一致。");
        await assertProjectBoundary(item.workspaceRoot, item.projectDirectory);
        const current = await this.external(item.id);
        if (
          !samePath(current.workspaceRoot, item.workspaceRoot) ||
          !samePath(current.projectDirectory, item.projectDirectory) ||
          current.identitySha256 !== item.identitySha256
        ) {
          throw new Error(
            "外部项目身份已变化，或登记路径不一致，不能按旧记录恢复。"
          );
        }
        if (item.identitySha256) {
          if (input.expectedIdentitySha256 !== item.identitySha256)
            throw new Error("外部项目身份与确认时不一致，不能恢复旧记录。");
          if (
            (await projectManifestIdentity(item.projectDirectory)) !==
            input.expectedIdentitySha256
          ) {
            throw new Error("外部项目内容身份已变化，不能按旧记录恢复。");
          }
        } else if (input.expectedIdentitySha256) {
          throw new Error("外部项目身份与确认时不一致，不能恢复旧记录。");
        }
        const projectRelativePath = relative(
          item.workspaceRoot,
          item.projectDirectory
        )
          .split(sep)
          .join("/");
        const derivedId = `otter_${createHash("sha256").update(projectRelativePath).digest("hex").slice(0, 16)}`;
        if (derivedId !== item.id)
          throw new Error("外部项目路径身份与隐藏记录不一致。");
      }
      await this.save(hidden.filter((book) => book !== item));
      payload = { bookId: item.id, removed: false, action: "restore" };
    } else if (command.type === "long.unregister") {
      const opened = await this.long.catalog.open(command.payload.bookId);
      const item: HiddenBook = {
        id: opened.book.id,
        kind: "native",
        title: opened.book.title,
        projectDirectory: opened.projectDirectory,
        hiddenAt: new Date().toISOString()
      };
      await this.save([
        ...hidden.filter(
          (book) => !(book.id === item.id && book.kind === item.kind)
        ),
        item
      ]);
      try {
        payload = await this.long.unregister(command.payload);
      } catch (error) {
        await this.save(hidden);
        throw error;
      }
    } else if (command.type === "long.delete") {
      payload = await this.long.delete(command.payload);
      await this.save(
        hidden.filter(
          (book) =>
            !(book.id === command.payload.bookId && book.kind === "native")
        )
      );
    } else if (command.type === "books.removeExternal") {
      const input = command.payload;
      const expectedPath = resolve(input.expectedProjectDirectory);
      const pending = hidden.find(
        (book) =>
          book.kind === "external" &&
          book.id === input.projectId &&
          book.deletePending &&
          samePath(book.projectDirectory, expectedPath) &&
          (!input.workspaceRoot ||
            (book.workspaceRoot &&
              samePath(book.workspaceRoot, input.workspaceRoot)))
      );
      if (pending && input.action !== "delete")
        throw new Error("本书已删除文件，需先完成历史清理。");
      const item: HiddenBook =
        pending ?? (await this.external(input.projectId));
      if (!samePath(input.expectedProjectDirectory, item.projectDirectory))
        throw new Error("书籍路径与确认时不一致，请重新核对。");
      if (
        input.workspaceRoot &&
        (!item.workspaceRoot ||
          !samePath(input.workspaceRoot, item.workspaceRoot))
      )
        throw new Error("书籍工作区与确认时不一致，请重新核对。");

      if (input.action === "hide") {
        if (item.deletePending)
          throw new Error("本书正在永久删除，不能仅隐藏。");
        const retained = hidden.filter((book) => !sameHiddenBook(book, item));
        await this.save([...retained, item]);
      } else {
        if (
          !input.expectedIdentitySha256 ||
          !item.identitySha256 ||
          input.expectedIdentitySha256 !== item.identitySha256
        ) {
          throw new Error(
            "未确认本书独立项目身份，不能彻底删除；可以从列表隐藏。"
          );
        }
        let pendingItem: HiddenBook;
        if (item.deletePending) {
          if (!item.deleteQuarantineDirectory) {
            const originalExists = await pathExists(item.projectDirectory);
            if (!originalExists)
              throw new Error(
                "旧版删除记录缺少隔离目录位置；为保护资料，保留记录并停止自动清理。"
              );
            if (
              (await projectManifestIdentity(item.projectDirectory)) !==
              item.identitySha256
            )
              throw new Error("待删除项目身份已变化，保留记录并停止自动清理。");
            pendingItem = {
              ...item,
              deleteQuarantineDirectory: await createQuarantinePath(
                item.projectDirectory
              )
            };
            await this.save(
              hidden.map((book) => (book === item ? pendingItem : book))
            );
          } else pendingItem = item;
        } else {
          await assertProjectBoundary(
            item.workspaceRoot!,
            item.projectDirectory
          );
          await assertNoLinks(item.projectDirectory);
          const previous = hidden.find((book) => sameHiddenBook(book, item));
          pendingItem = {
            ...item,
            ...(previous?.hiddenAt ? { hiddenAt: previous.hiddenAt } : {}),
            deletePending: true,
            deleteQuarantineDirectory: await createQuarantinePath(
              item.projectDirectory
            )
          };
          await this.save([
            ...hidden.filter((book) => !sameHiddenBook(book, item)),
            pendingItem
          ]);
        }
        await withExternalProjectLock(
          pendingItem.projectDirectory,
          async () => {
            const currentHidden = await readHiddenBooks(this.userDataPath);
            const persistedPending = currentHidden.find(
              (book) =>
                sameHiddenBook(book, pendingItem) &&
                book.kind === "external" &&
                book.deletePending
            );
            if (
              !persistedPending ||
              persistedPending.identitySha256 !== pendingItem.identitySha256 ||
              persistedPending.deleteQuarantineDirectory !==
                pendingItem.deleteQuarantineDirectory
            ) {
              throw new Error(
                "待删除记录在清理期间发生变化，保留资料并停止删除。"
              );
            }
            await this.completeExternalDeletion(persistedPending);
            await this.removeHistory(item.id);
            const latestHidden = await readHiddenBooks(this.userDataPath);
            await this.save(
              latestHidden.filter(
                (book) => !sameHiddenBook(book, persistedPending)
              )
            );
          }
        );
      }
      payload = { bookId: item.id, removed: true, action: input.action };
    }
    return { status: "accepted", requestId: command.id, payload };
  }

  private async completeExternalDeletion(item: HiddenBook): Promise<void> {
    if (
      item.kind !== "external" ||
      !item.deletePending ||
      !item.workspaceRoot ||
      !item.identitySha256 ||
      !item.deleteQuarantineDirectory
    ) {
      throw new Error("外部删除缺少可恢复的身份或隔离目录状态。");
    }
    const original = resolve(item.projectDirectory);
    const quarantine = resolve(item.deleteQuarantineDirectory);
    assertQuarantineSibling(original, quarantine);
    await assertProjectBoundary(item.workspaceRoot, dirname(original), {
      allowRoot: true
    });
    await assertProjectBoundary(item.workspaceRoot, quarantine, {
      allowMissingTarget: true
    });
    const markerPath = `${quarantine}${DELETE_MARKER_SUFFIX}`;
    const originalExists = await pathExists(original);
    const quarantineExists = await pathExists(quarantine);

    if (originalExists && !quarantineExists) {
      if ((await projectManifestIdentity(original)) !== item.identitySha256)
        throw new Error("原路径上的项目身份已变化，保留待删除记录。");
      await assertNoLinks(original);
      await ensureDeleteMarker(item, markerPath, original);
      await this.fileOperations.renameDirectory(original, quarantine);
    }

    if (await pathExists(quarantine)) {
      await assertProjectBoundary(item.workspaceRoot, quarantine);
      const marker = await readDeleteMarker(markerPath);
      if (!marker || !markerMatchesItem(marker, item))
        throw new Error("隔离目录缺少匹配的持久删除凭据，拒绝递归清理。");
      const info = await lstat(quarantine, { bigint: true });
      if (
        info.isSymbolicLink() ||
        !info.isDirectory() ||
        info.dev.toString() !== marker.device ||
        info.ino.toString() !== marker.inode
      ) {
        throw new Error("隔离目录身份与删除凭据不一致，拒绝递归清理。");
      }
      const currentIdentity = await projectManifestIdentity(quarantine, true);
      if (currentIdentity && currentIdentity !== item.identitySha256)
        throw new Error("隔离目录中的项目身份已变化，拒绝递归清理。");
      await assertNoLinks(quarantine);
      await this.fileOperations.removeDirectory(quarantine);
      if (await pathExists(quarantine))
        throw new Error("外部项目隔离目录清理未完成；可在隐藏列表重试。");
    }

    await this.fileOperations.removeFile(markerPath);
  }
}

async function createQuarantinePath(projectDirectory: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const path = join(
      dirname(projectDirectory),
      `.deepwrite-delete-${randomUUID()}`
    );
    if (
      !(await pathExists(path)) &&
      !(await pathExists(`${path}${DELETE_MARKER_SUFFIX}`))
    )
      return path;
  }
  throw new Error("无法为删除操作分配安全隔离目录。");
}

async function ensureDeleteMarker(
  item: HiddenBook,
  markerPath: string,
  sourceDirectory: string
): Promise<void> {
  if (
    !item.workspaceRoot ||
    !item.deleteQuarantineDirectory ||
    !item.identitySha256 ||
    item.kind !== "external"
  ) {
    throw new Error("缺少外部删除身份信息。");
  }
  const info = await lstat(sourceDirectory, { bigint: true });
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("待删除项目必须是真实目录。");
  const expected: ExternalDeleteMarker = {
    schemaVersion: 1,
    projectId: item.id,
    projectDirectory: resolve(item.projectDirectory),
    quarantineDirectory: resolve(item.deleteQuarantineDirectory),
    identitySha256: item.identitySha256,
    device: info.dev.toString(),
    inode: info.ino.toString()
  };
  const existing = await readDeleteMarker(markerPath, true);
  if (existing) {
    if (!markerEquals(existing, expected))
      throw new Error("删除凭据与待删除项目不一致。");
    return;
  }
  if (!samePath(sourceDirectory, item.projectDirectory))
    throw new Error("缺少删除凭据的隔离目录不能自动清理。");
  const handle = await open(
    markerPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    await handle.writeFile(`${JSON.stringify(expected)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(markerPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

async function readDeleteMarker(
  path: string,
  optional = false
): Promise<ExternalDeleteMarker | undefined> {
  try {
    const { bytes } = await readNoFollowFile(
      path,
      MAX_DELETE_MARKER_BYTES,
      "外部删除凭据",
      dirname(path)
    );
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    if (!isDeleteMarker(parsed)) throw new Error("外部删除凭据格式无效。");
    return parsed;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return undefined;
    throw error;
  }
}

function isDeleteMarker(value: unknown): value is ExternalDeleteMarker {
  if (value === null || typeof value !== "object") return false;
  const marker = value as Record<string, unknown>;
  return (
    marker.schemaVersion === 1 &&
    typeof marker.projectId === "string" &&
    typeof marker.projectDirectory === "string" &&
    typeof marker.quarantineDirectory === "string" &&
    typeof marker.identitySha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(marker.identitySha256) &&
    typeof marker.device === "string" &&
    typeof marker.inode === "string"
  );
}

function markerMatchesItem(
  marker: ExternalDeleteMarker,
  item: HiddenBook
): boolean {
  return (
    marker.projectId === item.id &&
    samePath(marker.projectDirectory, item.projectDirectory) &&
    Boolean(
      item.deleteQuarantineDirectory &&
      samePath(marker.quarantineDirectory, item.deleteQuarantineDirectory)
    ) &&
    marker.identitySha256 === item.identitySha256
  );
}

function markerEquals(
  left: ExternalDeleteMarker,
  right: ExternalDeleteMarker
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.projectId === right.projectId &&
    samePath(left.projectDirectory, right.projectDirectory) &&
    samePath(left.quarantineDirectory, right.quarantineDirectory) &&
    left.identitySha256 === right.identitySha256 &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

async function projectManifestIdentity(
  projectDirectory: string,
  allowMissing = false
): Promise<string | undefined> {
  const manifestPath = join(projectDirectory, EXTERNAL_MANIFEST);
  try {
    const { bytes } = await readNoFollowFile(
      manifestPath,
      MAX_MANIFEST_BYTES,
      "小说项目 manifest",
      projectDirectory
    );
    return createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
      return undefined;
    throw error;
  }
}

async function assertProjectBoundary(
  root: string,
  target: string,
  options: { allowMissingTarget?: boolean; allowRoot?: boolean } = {}
): Promise<void> {
  const canonicalRoot = await realpath(root);
  const resolvedTarget = resolve(target);
  const within = relative(canonicalRoot, resolvedTarget);
  if (!within) {
    if (options.allowRoot) return;
    throw new Error("不能操作工作区根或越界目录。");
  }
  if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`))
    throw new Error("不能操作工作区根或越界目录。");
  let current = canonicalRoot;
  const parts = within.split(sep);
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (
        options.allowMissingTarget &&
        index === parts.length - 1 &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("不操作目录联接中的书籍。");
    if (index < parts.length - 1 || info.isDirectory()) {
      if (!info.isDirectory()) throw new Error("书籍路径包含非目录节点。");
    }
    const canonical = await realpath(current);
    const offset = relative(canonicalRoot, canonical);
    if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset))
      throw new Error("项目目录越出工作区根目录。");
    if (index === parts.length - 1 && !samePath(canonical, resolvedTarget))
      throw new Error("项目目录路径不一致。");
  }
}

async function assertNoLinks(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("本书目录必须是真实目录，不能递归删除链接。");
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    const child = await lstat(path);
    if (child.isSymbolicLink())
      throw new Error("本书目录含链接，不能递归删除；可以隐藏。");
    if (child.isDirectory()) await assertNoLinks(path);
  }
}

function assertQuarantineSibling(original: string, quarantine: string): void {
  if (
    !samePath(dirname(original), dirname(quarantine)) ||
    samePath(original, quarantine) ||
    !basename(quarantine).startsWith(".deepwrite-delete-")
  ) {
    throw new Error("外部删除隔离目录不在书籍同级安全位置。");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sameHiddenBook(left: HiddenBook, right: HiddenBook): boolean {
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.kind === "native")
    return samePath(left.projectDirectory, right.projectDirectory);
  return Boolean(
    left.workspaceRoot &&
    right.workspaceRoot &&
    samePath(left.workspaceRoot, right.workspaceRoot) &&
    samePath(left.projectDirectory, right.projectDirectory)
  );
}

function samePath(left: string, right: string): boolean {
  const leftNormalized = resolve(left).replace(/[\\/]+$/u, "");
  const rightNormalized = resolve(right).replace(/[\\/]+$/u, "");
  return process.platform === "win32"
    ? leftNormalized.toLocaleLowerCase("en-US") ===
        rightNormalized.toLocaleLowerCase("en-US")
    : leftNormalized === rightNormalized;
}
