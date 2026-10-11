import { createHash, randomUUID } from "node:crypto";
import {
  LongStageSourceImportInputSchema,
  LongStageSourceImportResultSchema,
  type LongStageSourceImportInput,
  type LongStageSourceImportResult
} from "@deepwrite/contracts";

interface Registration {
  owner: number;
  expiresAt: number;
  bytes: number;
  input: LongStageSourceImportInput;
  busy: boolean;
}

/** A preview holds author-selected text only. It never reads a supplied path. */
export class SourceImportPreviewRegistry {
  private readonly entries = new Map<string, Registration>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30 * 60 * 1_000
  ) {}

  stage(
    owner: number,
    rawInput: LongStageSourceImportInput
  ): LongStageSourceImportResult {
    const input = LongStageSourceImportInputSchema.parse(rawInput);
    const bytes = Buffer.byteLength(input.content, "utf8");
    if (!input.content.trim() || bytes > 2 * 1024 * 1024) {
      throw new Error("资料不能为空，每份资料最多 2 MB；请按文件分批导入。");
    }
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (!entry.busy && (entry.expiresAt <= now || entry.owner === owner)) {
        this.entries.delete(id);
      }
    }
    const total = [...this.entries.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0
    );
    if (this.entries.size >= 32 || total + bytes > 16 * 1024 * 1024) {
      throw new Error("待核对的资料过多，请先完成或关闭已有导入预览。");
    }
    const previewId = `source-preview-${randomUUID()}`;
    const expiresAt = now + this.ttlMs;
    this.entries.set(previewId, {
      owner,
      expiresAt,
      bytes,
      input: structuredClone(input),
      busy: false
    });
    const { expectedIndexUpdatedAt: _indexVersion, ...metadata } = input;
    return LongStageSourceImportResultSchema.parse({
      ...metadata,
      previewId,
      expiresAt: new Date(expiresAt).toISOString(),
      sourceSha256: createHash("sha256")
        .update(input.content, "utf8")
        .digest("hex")
    });
  }

  acquire(
    previewId: string,
    owner: number,
    bookId: string
  ): LongStageSourceImportInput {
    const entry = this.entries.get(previewId);
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry && !entry.busy) this.entries.delete(previewId);
      throw new Error("导入预览已失效，请重新准备资料。");
    }
    if (entry.owner !== owner || entry.input.bookId !== bookId) {
      throw new Error("导入预览不属于当前窗口或书籍，请重新准备资料。");
    }
    if (entry.busy) throw new Error("这份资料正在保存，请勿重复确认。");
    entry.busy = true;
    return structuredClone(entry.input);
  }

  finish(previewId: string, accepted: boolean): void {
    const entry = this.entries.get(previewId);
    if (accepted) this.entries.delete(previewId);
    else if (entry) entry.busy = false;
  }

  clearForWebContents(owner: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.owner === owner) this.entries.delete(id);
    }
  }
}
