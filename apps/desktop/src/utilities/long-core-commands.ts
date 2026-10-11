import {
  LongApplyOperationsResultSchema,
  LongApplyLegacySyncResultSchema,
  LongCommitChapterResultSchema,
  LongDeleteLedgerCommitResultSchema,
  LongImportPortableResultSchema,
  LongImportContinuationResultSchema,
  LongPreviewContinuationImportAtPathResultSchema,
  LongPreviewLegacySyncAtPathResultSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  LongPreviewOperationsResultSchema,
  LongReadDocumentResultSchema,
  LongReadAgentsMdResultSchema,
  LongRemoveBookResultSchema,
  LongSearchResultSchema,
  LongWorkspaceIndexResultSchema,
  LongWriteChapterResultSchema,
  LongWriteDocumentResultSchema,
  LongWriteAgentsMdResultSchema,
  LongImportSourceResultSchema,
  LongNativeWritingListResultSchema,
  LongNativeWritingSaveResultSchema,
  LongNativeWritingSelectResultSchema,
  LongNativeWritingReadResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "./long-workspace-service";
import { resolveLongWorkspaceConflicts } from "./long-workspace-recovery";
import { prepareLoveCodexReview } from "./love-codex-review-packager";
import {
  prepareLoveReviewCore,
  submitLoveReviewCore
} from "./love-review-core";
import { readNativeComparisonEvidence } from "./native-comparison-evidence";
import { runLoveChapterWorkflowCore } from "./love-chapter-workflow-core";
import {
  prepareNovelLoveLocalRevision,
  applyNovelLoveLocalRevision
} from "./love-local-revision-store";
import {
  prepareNovelComparisonDraft,
  deliverNovelComparisonDraft,
  comparisonDraftCardId
} from "./novel-writing-store";
export async function handleLongCoreCommand(
  service: LongWorkspaceService,
  command: CommandEnvelope,
  userDataPath?: string
): Promise<CommandResult | undefined> {
  if (command.type === "long.loveChapterWorkflow") {
    if (!userDataPath) throw new Error("Core 缺少本地配置路径。");
    let nativeEvidence: string | undefined;
    if (
      command.payload.action === "prepare" ||
      command.payload.action === "redraft_context"
    ) {
      try {
        const { workspaceIndex } = await service.getWorkspaceIndex({
          bookId: command.payload.bookId
        });
        nativeEvidence = await readNativeComparisonEvidence(
          service,
          workspaceIndex
        );
      } catch (error) {
        if (command.payload.action === "redraft_context") throw error;
        nativeEvidence = undefined;
      }
    }
    return {
      status: "accepted",
      requestId: command.id,
      payload: await runLoveChapterWorkflowCore(
        userDataPath,
        command.payload,
        nativeEvidence
      )
    };
  }
  if (
    command.type === "long.prepareLoveLocalRevision" ||
    command.type === "long.applyLoveLocalRevision"
  ) {
    if (!userDataPath) throw new Error("Core 缺少本地配置路径。");
    const { workspaceIndex } = await service.getWorkspaceIndex({
      bookId: command.payload.bookId
    });
    const nativeEvidence = await readNativeComparisonEvidence(
      service,
      workspaceIndex
    );
    return {
      status: "accepted",
      requestId: command.id,
      payload:
        command.type === "long.prepareLoveLocalRevision"
          ? await prepareNovelLoveLocalRevision(userDataPath, command.payload, {
              nativeEvidence
            })
          : await applyNovelLoveLocalRevision(userDataPath, command.payload, {
              nativeEvidence
            })
    };
  }
  if (
    command.type === "long.prepareComparisonDraft" ||
    command.type === "long.deliverComparisonDraft"
  ) {
    if (!userDataPath) throw new Error("Core 缺少本地配置路径。");
    const payload = command.payload;
    const { workspaceIndex: index } = await service.getWorkspaceIndex({
      bookId: payload.bookId
    });
    const cardId =
      command.type === "long.prepareComparisonDraft"
        ? command.payload.chapterCardId
        : comparisonDraftCardId(
            command.payload.preparationId,
            payload.authorizationId
          );
    const card = index.plot.chapterCards.find(({ id }) => id === cardId);
    const entry = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === cardId
    );
    const volume = index.plot.volumes.find(({ id }) => id === card?.volumeId);
    if (!card || !entry || !volume) throw new Error("当前卷卡或章卡不存在。");
    let document = await service.readDocument({
      bookId: payload.bookId,
      fileId: entry.card.id,
      offset: 0,
      maxCharacters: 32_768
    });
    if (document.totalCharacters > 500_000)
      throw new Error("章卡过大，请缩小资料范围。");
    let cardContent = document.content;
    while (document.nextOffset !== null) {
      const offset = document.nextOffset;
      const next = await service.readDocument({
        bookId: payload.bookId,
        fileId: entry.card.id,
        offset,
        maxCharacters: 32_768
      });
      if (
        next.totalCharacters !== document.totalCharacters ||
        (next.nextOffset !== null && next.nextOffset <= offset)
      )
        throw new Error("分页读取版本或游标发生变化。");
      cardContent += next.content;
      document = next;
    }
    const nativeEvidence = await readNativeComparisonEvidence(service, index);
    if (command.type === "long.prepareComparisonDraft")
      return {
        status: "accepted",
        requestId: command.id,
        payload: await prepareNovelComparisonDraft(userDataPath, command.payload, {
          cardTitle: card.title,
          cardContent,
          chapterCardId: cardId,
          volumeId: volume.id,
          volumeLabel: volume.title,
          volumeContent: volume.summary,
          nativeEvidence
        })
      };

    const delivered = await deliverNovelComparisonDraft(userDataPath, command.payload, {
      chapterCardId: cardId,
      cardContent,
      volumeContent: volume.summary,
      nativeEvidence
    });
    let nativeVersion: { path: string; hash: string; deduplicated: boolean } | undefined;
    let nativeVersionWarning: string | undefined;
    if (command.payload.content.length > 100_000) {
      nativeVersionWarning = "正文已成功交付；超过原生版本面板的单稿上限，未截断或登记。不要重跑交付，可在工作台查看正式交付文件。";
    } else {
      try {
        const fallbackTitle = card.title.length <= 120 ? card.title : "本章稿件";
        const requestedTitle = command.payload.title?.trim();
        const title = requestedTitle && requestedTitle.length <= 120 ? requestedTitle : fallbackTitle;
        const saved = await service.saveNativeWriting({
          bookId: command.payload.bookId,
          chapterCardId: cardId,
          role: "candidate",
          source: "pasted",
          origin: "cli-delivery",
          content: command.payload.content,
          title,
          model: delivered.model,
          version: `交付-${delivered.sha256.slice(0, 12)}`,
          changeSummary: `正式 CLI 交付来源：${delivered.path}；Receipt：${delivered.deliveryRecord}`
        });
        nativeVersion = { path: saved.path, hash: saved.hash, deduplicated: saved.deduplicated };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "未知错误";
        nativeVersionWarning = `正文已成功交付，但未登记到原生章节版本面板：${reason}。不要重跑交付；可从正式交付文件手动登记。`;
      }
    }
    return {
      status: "accepted",
      requestId: command.id,
      payload: {
        ...delivered,
        ...(nativeVersion ? { nativeVersion } : {}),
        ...(nativeVersionWarning ? { nativeVersionWarning } : {})
      }
    };
  }
  if (command.type === "long.prepareCodexReview") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: await prepareLoveCodexReview({
        ...command.payload,
        sessionId: command.context.sessionId ?? ""
      })
    };
  }
  if (
    command.type === "long.prepareLoveReview" ||
    command.type === "long.submitLoveReview"
  ) {
    if (!userDataPath) throw new Error("Core 缺少本地配置路径。");
    const sessionId = command.context.sessionId ?? "";
    const payload =
      command.type === "long.prepareLoveReview"
        ? await prepareLoveReviewCore(
            service,
            userDataPath,
            sessionId,
            command.payload
          )
        : {
            coverage: await submitLoveReviewCore(
              service,
              userDataPath,
              sessionId,
              command.payload
            )
          };
    return { status: "accepted", requestId: command.id, payload };
  }
  if (command.type === "long.connectSourceFolderAtPath")
    return {
      status: "accepted",
      requestId: command.id,
      payload: await service.connectSourceFolder(command.payload)
    };
  if (command.type === "long.querySourceFolder")
    return {
      status: "accepted",
      requestId: command.id,
      payload: await service.querySourceFolder(command.payload)
    };
  if (command.type === "long.disconnectSourceFolder")
    return {
      status: "accepted",
      requestId: command.id,
      payload: await service.disconnectSourceFolder(command.payload)
    };
  if (command.type === "long.resolveConflicts") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: await resolveLongWorkspaceConflicts(service, command.payload)
    };
  }
  if (command.type === "long.list") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongListBooksResultSchema.parse(await service.list())
    };
  }
  if (command.type === "long.createBookAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.create(
          command.payload.parentDirectory,
          command.payload.input
        )
      )
    };
  }
  if (command.type === "long.duplicateBook") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.duplicateBook(command.payload)
      )
    };
  }
  if (command.type === "long.previewLegacySyncAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewLegacySyncAtPathResultSchema.parse(
        await service.previewLegacySync(command.payload.sourcePath)
      )
    };
  }
  if (command.type === "long.applyLegacySyncAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongApplyLegacySyncResultSchema.parse(
        await service.applyLegacySync(command.payload)
      )
    };
  }
  if (command.type === "long.previewContinuationImportAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewContinuationImportAtPathResultSchema.parse(
        await service.previewContinuationImport(command.payload.sourcePath)
      )
    };
  }
  if (command.type === "long.importContinuationAtPath") {
    const imported = await service.importContinuationBook(command.payload);
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongImportContinuationResultSchema.parse({
        book: imported.book,
        summary: imported.summary,
        importedVolumeCount: imported.importedVolumeCount,
        importedChapterCount: imported.importedChapterCount,
        checkpointCount: imported.checkpointCount,
        pendingChapterCardId: imported.pendingChapterCardId,
        warnings: imported.warnings
      })
    };
  }
  if (command.type === "long.importPortableAtPath") {
    const imported = await service.importPortableBundle(
      command.payload.parentDirectory,
      command.payload.sourcePath
    );
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongImportPortableResultSchema.parse({
        book: imported.book,
        summary: imported.summary,
        exportedAt: imported.exportedAt
      })
    };
  }
  if (command.type === "long.openAtPath") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.openAtPath(command.payload.projectDirectory)
      )
    };
  }
  if (command.type === "long.open") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.open(command.payload)
      )
    };
  }
  if (command.type === "long.rename") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.renameBook(command.payload)
      )
    };
  }
  if (command.type === "long.updateBindings") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongOpenBookResultSchema.parse(
        await service.updateBindings(command.payload)
      )
    };
  }
  if (command.type === "long.getWorkspaceIndex") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWorkspaceIndexResultSchema.parse(
        await service.getWorkspaceIndex(command.payload)
      )
    };
  }
  if (command.type === "long.nativeWritingList") {
    return { status: "accepted", requestId: command.id, payload: LongNativeWritingListResultSchema.parse(await service.listNativeWriting(command.payload)) };
  }
  if (command.type === "long.nativeWritingSave") {
    return { status: "accepted", requestId: command.id, payload: LongNativeWritingSaveResultSchema.parse(await service.saveNativeWriting(command.payload)) };
  }
  if (command.type === "long.nativeWritingSelect") {
    return { status: "accepted", requestId: command.id, payload: LongNativeWritingSelectResultSchema.parse(await service.selectNativeWriting(command.payload)) };
  }
  if (command.type === "long.nativeWritingRead") {
    return { status: "accepted", requestId: command.id, payload: LongNativeWritingReadResultSchema.parse(await service.readNativeWriting(command.payload)) };
  }
  if (command.type === "long.importSource") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongImportSourceResultSchema.parse(
        await service.importSource(command.payload)
      )
    };
  }
  if (command.type === "long.readDocument") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongReadDocumentResultSchema.parse(
        await service.readDocument(command.payload)
      )
    };
  }
  if (command.type === "long.readAgentsMd") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongReadAgentsMdResultSchema.parse(
        await service.readAgentsMd(command.payload)
      )
    };
  }
  if (command.type === "long.search") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongSearchResultSchema.parse(
        await service.search(command.payload)
      )
    };
  }
  if (command.type === "long.writeDocument") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteDocumentResultSchema.parse(
        await service.writeDocument(command.payload)
      )
    };
  }
  if (command.type === "long.writeAgentsMd") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteAgentsMdResultSchema.parse(
        await service.writeAgentsMd(command.payload)
      )
    };
  }
  if (command.type === "long.previewOperations") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongPreviewOperationsResultSchema.parse(
        await service.previewOperations(command.payload)
      )
    };
  }
  if (command.type === "long.applyOperations") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongApplyOperationsResultSchema.parse(
        await service.applyOperations(command.payload)
      )
    };
  }
  if (command.type === "long.writeChapter") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongWriteChapterResultSchema.parse(
        await service.writeChapter(command.payload)
      )
    };
  }
  if (command.type === "long.commitChapter") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongCommitChapterResultSchema.parse(
        await service.commitChapter(command.payload)
      )
    };
  }
  if (command.type === "long.deleteLedgerCommit") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongDeleteLedgerCommitResultSchema.parse(
        await service.deleteLedgerCommit(command.payload)
      )
    };
  }
  if (command.type === "long.unregister") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongRemoveBookResultSchema.parse(
        await service.unregister(command.payload)
      )
    };
  }
  if (command.type === "long.delete") {
    return {
      status: "accepted",
      requestId: command.id,
      payload: LongRemoveBookResultSchema.parse(
        await service.delete(command.payload)
      )
    };
  }
  return undefined;
}
