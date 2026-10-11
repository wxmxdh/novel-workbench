import {
  describe,
  expect,
  it,
  longTools,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";
import { createHash } from "node:crypto";
import {
  LongWorkspaceIndexSnapshotSchema,
  fixtureIndex,
  NOW
} from "./long-agent-tools.test-support";

describe("query imported long sources", () => {
  const original = "# New book foundation\nAuthor-supplied source text.";
  const file = {
    id: "file_source-test",
    path: "long/sources/source-test.md",
    updatedAt: NOW
  };
  const sourceSha256 = createHash("sha256")
    .update(original, "utf8")
    .digest("hex");

  function indexWithSource() {
    const value = fixtureIndex();
    return LongWorkspaceIndexSnapshotSchema.parse({
      ...value,
      importedSources: [
        {
          id: "source_test",
          title: "New book foundation",
          sourceName: "foundation.md",
          sourcePath: "Author-selected text file: foundation.md",
          purpose: "foundation",
          authority: "candidate",
          sourceSha256,
          importedAt: NOW,
          file
        }
      ]
    });
  }

  it("lists source metadata without reading or injecting its full contents", async () => {
    const index = indexWithSource();
    const tool = toolByName(
      longTools({
        index,
        executor: async (command) => {
          if (command.type === "long.getWorkspaceIndex") {
            return {
              status: "accepted",
              requestId: command.id,
              payload: { bookId: index.bookId, workspaceIndex: index }
            };
          }
          throw new Error("Listing should not read source contents.");
        }
      }),
      "query_imported_sources"
    );
    const result = await tool.execute("list-sources", {});
    const output = JSON.parse(resultText(result)) as {
      imported_sources: Array<Record<string, unknown>>;
    };
    expect(output.imported_sources[0]).toMatchObject({
      source_name: "foundation.md",
      purpose: "foundation",
      authority: "candidate",
      source_sha256: sourceSha256,
      file_id: file.id
    });
    expect(resultText(result)).not.toContain(original);
  });

  it("reads only a listed file id and verifies its source hash", async () => {
    const index = indexWithSource();
    const tool = toolByName(
      longTools({
        index,
        executor: async (command) => {
          if (command.type === "long.getWorkspaceIndex") {
            return {
              status: "accepted",
              requestId: command.id,
              payload: { bookId: index.bookId, workspaceIndex: index }
            };
          }
          if (command.type === "long.readDocument") {
            return {
              status: "accepted",
              requestId: command.id,
              payload: {
                bookId: index.bookId,
                file,
                content: original,
                offset: command.payload.offset,
                totalCharacters: Array.from(original).length,
                nextOffset: null
              }
            };
          }
          throw new Error(`Unexpected command ${command.type}`);
        }
      }),
      "query_imported_sources"
    );
    const result = await tool.execute("read-source", { file_id: file.id });
    expect(resultText(result)).toContain(`已核对 SHA-256：${sourceSha256}`);
    expect(resultText(result)).toContain(original);
    await expect(
      tool.execute("unknown-source", { file_id: "some-other-book-file" })
    ).rejects.toThrow("不属于当前书");
  });
  it("uses the accepted book/run bridge for connected files and rejects another book's response", async () => {
    const index = indexWithSource();
    let wrongBook = false;
    const tool = toolByName(
      longTools({
        index,
        executor: async (command) => {
          if (command.type === "long.getWorkspaceIndex")
            return {
              status: "accepted",
              requestId: command.id,
              payload: { bookId: index.bookId, workspaceIndex: index }
            };
          expect(command.type).toBe("long.querySourceFolder");
          expect(command.context).toMatchObject({
            sessionId: "session_tools",
            runId: "run_tools",
            resourceId: index.bookId
          });
          expect(command.payload).toEqual({
            bookId: index.bookId,
            sourceId: "selected-source",
            fileId: "selected-file"
          });
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              bookId: wrongBook ? "longbook_other" : index.bookId,
              folders: [],
              document: {
                fileId: "selected-file",
                relativePath: "人物.md",
                sha256: sourceSha256,
                content: original
              }
            }
          };
        }
      }),
      "query_imported_sources"
    );
    expect(
      JSON.parse(
        resultText(
          await tool.execute("connected-read", {
            source_id: "selected-source",
            connected_file_id: "selected-file"
          })
        )
      ).document.content
    ).toBe(original);
    wrongBook = true;
    await expect(
      tool.execute("cross-book", {
        source_id: "selected-source",
        connected_file_id: "selected-file"
      })
    ).rejects.toThrow("书籍");
    await expect(
      tool.execute("unscoped", { connected_file_id: "selected-file" })
    ).rejects.toThrow("source_id");
  });
});
