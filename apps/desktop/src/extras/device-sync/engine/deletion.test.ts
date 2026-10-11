import { expect, test } from "vitest";
import { syncKey, type SyncItem } from "@deepwrite/contracts";
import { MemoryDav, connect, device, item } from "./sync-test-support";

const library: SyncItem = {
  id: "skill_example",
  kind: "skill-library",
  title: "测试技能库",
  files: { "deepwrite.json": JSON.stringify({ id: "skill_example" }) }
};
const group: SyncItem = {
  id: "group_example",
  kind: "skill-group",
  title: "测试技能组",
  files: {
    "deepwrite.json": JSON.stringify({
      id: "group_example",
      members: { general: library.id }
    })
  }
};
const book: SyncItem = {
  ...item(),
  files: {
    ...item().files,
    "deepwrite.json": JSON.stringify({
      id: "book_example",
      linkedSkillIdsByKind: { general: [library.id] }
    })
  }
};

async function pair(initial: SyncItem[]) {
  const dav = new MemoryDav();
  const pc = device("pc", dav, initial);
  const phone = device("phone", dav);
  const space = await connect(pc);
  expect((await pc.service.sync([], true)).issues).toEqual([]);
  await connect(phone, space);
  expect((await phone.service.sync([], true)).issues).toEqual([]);
  return { pc, phone };
}

test.each([false, true])(
  "批量采用远端删除时先删引用者再删资料（包含作品：%s）",
  async (includeBook) => {
    // Libraries are registered first, as they are in the workspace inventory.
    const initial = includeBook ? [library, group, book] : [library, group];
    const { pc, phone } = await pair(initial);
    pc.workspace.clear();
    expect((await pc.service.sync()).issues).toEqual([]);
    expect((await phone.service.sync()).issues).toHaveLength(initial.length);
    const result = await phone.service.sync([], false, "both", {
      side: "remote",
      keys: initial.map(syncKey)
    });
    expect(result.issues).toEqual([]);
    expect(phone.workspace.size).toBe(0);
    expect((await phone.service.sync()).issues).toEqual([]);
    expect((await pc.service.sync()).issues).toEqual([]);
    expect(pc.workspace.size).toBe(0);
  }
);

test.each([group, book])(
  "未选择删除的引用者仍被保留，提示指出具体来源：$title",
  async (dependent) => {
    const { pc, phone } = await pair([library, dependent]);
    pc.workspace.clear();
    await pc.service.sync();
    const result = await phone.service.sync([], false, "both", {
      side: "remote",
      keys: [syncKey(library)]
    });
    expect(phone.workspace.get(syncKey(library))).toEqual(library);
    expect(phone.workspace.get(syncKey(dependent))).toEqual(dependent);
    expect(result.issues).toEqual([
      expect.objectContaining({
        key: syncKey(library),
        reason: "unsupported",
        message: expect.stringContaining(dependent.title)
      })
    ]);
    expect(result.issues[0]?.message).toContain(
      dependent.kind === "skill-group" ? "技能组" : "作品"
    );
  }
);

test("引用方删除失败时保留资料，不提前当作已解除引用", async () => {
  const { pc, phone } = await pair([library, group]);
  pc.workspace.clear();
  await pc.service.sync();
  const apply = phone.options.workspace.apply;
  phone.options.workspace.apply = async (...args) => {
    if (args[0] === syncKey(group)) throw new Error("test write failure");
    return apply(...args);
  };
  const result = await phone.service.sync([], false, "both", {
    side: "remote",
    keys: [syncKey(library), syncKey(group)]
  });
  expect(result.issues).toEqual([
    expect.objectContaining({ key: syncKey(group), reason: "failed" }),
    expect.objectContaining({ key: syncKey(library), reason: "unsupported" })
  ]);
  expect(phone.workspace.get(syncKey(library))).toEqual(library);
  expect(phone.workspace.get(syncKey(group))).toEqual(group);
});

test("同轮同步先解除技能组成员引用后可删除资料", async () => {
  const { pc, phone } = await pair([library, group]);
  pc.workspace.delete(syncKey(library));
  const emptyGroup = {
    ...group,
    files: {
      "deepwrite.json": JSON.stringify({ id: group.id, members: {} })
    }
  };
  pc.workspace.set(syncKey(group), emptyGroup);
  expect((await pc.service.sync()).issues).toEqual([]);
  const result = await phone.service.sync([], false, "both", {
    side: "remote",
    keys: [syncKey(library), syncKey(group)]
  });
  expect(result.issues).toEqual([]);
  expect(phone.workspace.has(syncKey(library))).toBe(false);
  expect(phone.workspace.get(syncKey(group))).toEqual(emptyGroup);
});
