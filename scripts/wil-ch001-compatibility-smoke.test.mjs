import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWhatIsLoveChapterOneSmoke,
  removeWhatIsLoveSmoke
} from "./wil-ch001-compatibility-smoke.mjs";

const sourceProject = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "00_创作项目",
  "项目",
  "What Is Love"
);
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("What Is Love 第001章V1兼容回归使用新Context并保持真实项目只读", (t) => {
  const state = JSON.parse(
    fs.readFileSync(
      path.join(sourceProject, ".novel", "chapter-state.json"),
      "utf8"
    )
  );
  const chapter = state.chapters.find(
    (x) => Number(x.chapter) === 1 && x.volume === "第一卷"
  );
  const sourceDraft = path.join(
    sourceProject,
    "004_写作中",
    "第001章_正文草稿_gpt-6.1-sol_v2.2_修订01.md"
  );
  const selectedOutline = path.join(
    sourceProject,
    chapter.selected_outline.path
  );
  const protectedBefore = new Map(
    [
      ".novel/project.json",
      ".novel/chapter-state.json",
      ".novel/derived-registry.json",
      "canon/active-source.md"
    ].map((rel) => [rel, hash(path.join(sourceProject, rel))])
  );
  const draftHashBefore = hash(sourceDraft);
  const outlineHashBefore = hash(selectedOutline);
  const fixture = createWhatIsLoveChapterOneSmoke();
  t.after(() => removeWhatIsLoveSmoke(fixture));
  assert.ok(["PASS", "WARN"].includes(fixture.status));
  assert.equal(fixture.sourceContextUsed, false);
  assert.equal(
    fixture.contextPath.startsWith(".novel/context/CTX-WIL-CH001-OTTER-"),
    true
  );
  assert.equal(fixture.selectedOutline.path, chapter.selected_outline.path);
  assert.equal(fixture.selectedOutline.hash, chapter.selected_outline.hash);
  const newPack = JSON.parse(
    fs.readFileSync(path.join(fixture.projectRoot, fixture.contextPath), "utf8")
  );
  assert.equal(newPack.context_id.startsWith("CTX-WIL-CH001-OTTER-"), true);
  assert.deepEqual(newPack.selected_outline, {
    path: chapter.selected_outline.path,
    hash: chapter.selected_outline.hash,
    chapter: 1,
    volume: "第一卷"
  });
  assert.ok(
    newPack.sources.some(
      (source) =>
        source.path === "characters/宋子凡.md" && source.role === "character"
    )
  );
  assert.ok(
    newPack.sources.some(
      (source) =>
        source.path === "relationships/宋子凡-王天一.md" &&
        source.role === "relationship"
    )
  );
  assert.ok(
    newPack.sources.some(
      (source) =>
        source.path === "timeline/knowledge.jsonl" &&
        source.role === "knowledge"
    )
  );
  for (const [rel, before] of protectedBefore)
    assert.equal(
      hash(path.join(sourceProject, rel)),
      before,
      `${rel} must remain unchanged`
    );
  assert.equal(hash(sourceDraft), draftHashBefore);
  assert.equal(hash(selectedOutline), outlineHashBefore);
});
