import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "../utilities/long-workspace-service";
import { prepareLoveApprovedVoiceContext } from "./love-approved-voice-context";
import publicBundle from "./love-approved-voice-bundle";

const LOVE_BOOK_ID = "longbook_9a146bbe";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "approved-voice-context-public-"));
  roots.push(root);
  const service = new LongWorkspaceService({
    userDataPath: join(root, "profile")
  });
  await mkdir(join(root, "books"));
  const created = await service.store.createBook(join(root, "books"), {
    id: LOVE_BOOK_ID,
    title: "测试作品",
    genre: "测试"
  });
  await service.openAtPath(created.projectDirectory);
  const request = async (command: CommandEnvelope): Promise<CommandResult> => {
    if (command.type !== "long.getWorkspaceIndex")
      throw new Error(`Unexpected Core command: ${command.type}`);
    return {
      status: "accepted",
      requestId: command.id,
      payload: await service.getWorkspaceIndex({ bookId: LOVE_BOOK_ID })
    };
  };
  return request;
}

const contextFor = (bookId: string): WorkspaceRuntimeContext =>
  ({ longWorkspace: { bookId } }) as WorkspaceRuntimeContext;

describe("public repository approved voice context", () => {
  it("ships no private sample and fails closed when a required package is missing", async () => {
    expect(publicBundle.files).toEqual([]);
    expect(publicBundle.files).toEqual([]);
    const request = await fixture();
    await expect(
      prepareLoveApprovedVoiceContext(contextFor(LOVE_BOOK_ID), request, {
        required: true
      })
    ).rejects.toThrow(/缺失/u);
  });

  it("never queries a different book or trusts renderer-supplied package data", async () => {
    let queried = false;
    const otherBook = {
      longWorkspace: {
        bookId: "another-book",
        approvedVoicePackage: { packageId: "renderer-forgery" }
      }
    } as unknown as WorkspaceRuntimeContext;
    const isolated = await prepareLoveApprovedVoiceContext(
      otherBook,
      async () => {
        queried = true;
        throw new Error("must not query another book");
      },
      { required: true }
    );
    expect(queried).toBe(false);
    expect(isolated?.longWorkspace?.approvedVoicePackage).toBeUndefined();
  });
});
