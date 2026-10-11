import { test, expect } from "vitest";
import {
  syncErrorMessage,
  stableSyncJson,
  syncKey
} from "@deepwrite/contracts";
import {
  connect,
  device as baseDevice,
  item,
  MemoryDav
} from "./sync-test-support";
function device(...args: Parameters<typeof baseDevice>) {
  const client = baseDevice(...args);
  const fingerprint = () =>
    client.options.runtime.hash(stableSyncJson([...client.workspace]));
  client.options.workspace.initialization = {
    inspect: async () => ({
      fingerprint: fingerprint(),
      itemCount: client.workspace.size
    }),
    replace: async (items, metadata, expected, signal) => {
      if (signal.aborted) throw new Error("同步已取消。");
      if (fingerprint() !== expected)
        throw new Error("本机数据已变化，请重新下载预览后确认。");
      client.workspace.clear();
      for (const item of items)
        client.workspace.set(syncKey(item), structuredClone(item));
      await client.options.metadata.write(metadata);
    }
  };
  return client;
}

async function setup() {
  const dav = new MemoryDav();
  const pc = device("pc", dav, [
    item("电脑正文"),
    item("电脑第二篇", "book_second")
  ]);
  const phone = device("phone", dav, [
    item("手机未上传的改写"),
    item("手机独有作品", "book_phone_only")
  ]);
  const space = await connect(pc);
  await pc.service.sync([], true);
  await connect(phone, space);
  const source = pc.metadata()?.deviceId ?? "";
  return { dav, pc, phone, source, space };
}

test("预览只下载；确认后清除本地独有项并重建基线，不上传删除远端", async () => {
  const { dav, pc, phone, source } = await setup();
  const before = [...phone.workspace];
  const metadata = phone.metadata();
  const remote = [...dav.files];
  const preview = await phone.service.previewInitialization(source);
  expect(preview).toMatchObject({
    itemCount: 2,
    localItemCount: 2,
    fileCount: 4,
    deviceId: source
  });
  expect([...phone.workspace]).toEqual(before);
  expect(phone.metadata()).toEqual(metadata);
  const result = await phone.service.initializeFromRemote(preview.token);
  expect([...phone.workspace]).toEqual([...pc.workspace]);
  expect([...dav.files]).toEqual(remote);
  expect(result.firstSyncConfirmed).toBe(true);
  expect(
    result.items.every((entry) => !entry.dirty && !entry.remoteDirty)
  ).toBe(true);
  expect(result.issues).toEqual([]);
  expect(result.history).toEqual([]);
  expect(result.progress.phase).toBe("complete");
  expect(result.config).toEqual({ ...metadata?.config, excludedKeys: [] });
  const repeated = await phone.service.sync();
  expect(repeated.progress.completed).toBe(0);
  expect(
    phone.metadata()?.published?.items["book:book_phone_only"]
  ).toBeUndefined();
  phone.workspace.set("book:book_example", item("初始化后修改"));
  expect(
    (await phone.service.status()).items
      .filter((entry) => entry.dirty)
      .map((entry) => entry.key)
  ).toEqual(["book:book_example"]);
});

test("本地损坏项不影响初始化，仍须全量验证远端", async () => {
  const { phone, source } = await setup();
  phone.options.workspace.list = async () => ({
    items: [],
    issues: [{ key: "book:broken", title: "损坏项", message: "本机结构无效" }]
  });
  const preview = await phone.service.previewInitialization(source);
  expect(preview.itemCount).toBe(2);
  phone.options.workspace.validate = async () => {
    throw new Error("private implementation detail");
  };
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "远端作品不完整"
  );
});

test("远端空空间或选到本机不会清除本地", async () => {
  const { phone } = await setup();
  await expect(
    phone.service.previewInitialization(phone.metadata()?.deviceId ?? "")
  ).rejects.toThrow("选择另一台");
  expect(phone.workspace.size).toBe(2);
  const dav = new MemoryDav();
  const empty = device("empty", dav);
  const local = device("local", dav, [item()]);
  const space = await connect(empty);
  await empty.service.sync([], true);
  await connect(local, space);
  await expect(
    local.service.previewInitialization(empty.metadata()?.deviceId ?? "")
  ).rejects.toThrow("没有可下载");
  expect(local.workspace.size).toBe(1);
});

test("任何远端文件缺失或结构校验失败，整次初始化拒绝且本地不变", async () => {
  const { dav, phone, source } = await setup();
  const before = [...phone.workspace];
  const object = [...dav.files.keys()].find((path) =>
    path.includes("/objects/")
  );
  if (!object) throw new Error("missing fixture");
  dav.files.delete(object);
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "远端作品不完整"
  );
  expect([...phone.workspace]).toEqual(before);
  await expect(
    phone.service.initializeFromRemote("invalid_preview")
  ).rejects.toThrow("预览已过期");
});

test("远端有未被来源电脑合并的修改时拒绝初始化", async () => {
  const { dav, pc, phone, source, space } = await setup();
  const third = device("third", dav);
  await connect(third, space);
  await third.service.sync([], true);
  third.workspace.set("book:book_example", item("另一端的修改"));
  await third.service.sync();
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "未合并"
  );
  await pc.service.sync();
  expect((await phone.service.previewInitialization(source)).itemCount).toBe(2);
});

test("预览后远端或本机改变，必须重新预览；过期和重复令牌拒绝", async () => {
  const { phone, pc, source } = await setup();
  const first = await phone.service.previewInitialization(source);
  pc.workspace.set("book:book_example", item("电脑新版本"));
  await pc.service.sync();
  await expect(phone.service.initializeFromRemote(first.token)).rejects.toThrow(
    "远端数据已更新"
  );
  const second = await phone.service.previewInitialization(source);
  phone.workspace.set("book:book_example", item("预览后的手机编辑"));
  await expect(
    phone.service.initializeFromRemote(second.token)
  ).rejects.toThrow("本机数据已变化");
  expect(phone.workspace.get("book:book_example")?.files["draft.md"]).toBe(
    "预览后的手机编辑"
  );
  const third = await phone.service.previewInitialization(source);
  phone.options.runtime.now = () => "2026-09-08T02:00:00.000Z";
  await expect(phone.service.initializeFromRemote(third.token)).rejects.toThrow(
    "预览已过期"
  );
});

test("下载中取消不生成可确认的预览，不修改本地", async () => {
  const { dav, phone, source } = await setup();
  const get = dav.get.bind(dav);
  dav.get = async (path) => {
    if (path.includes("/objects/")) phone.service.cancel();
    return get(path);
  };
  const before = [...phone.workspace];
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "同步已取消"
  );
  expect([...phone.workspace]).toEqual(before);
  expect((await phone.service.status()).progress.phase).toBe("cancelled");
});

test("初始化错误可诊断但不回显底层私密请求", () => {
  expect(
    syncErrorMessage(new Error("远端数据已更新，请重新下载预览后确认。"))
  ).toContain("远端数据已更新");
  expect(
    syncErrorMessage(
      new Error("https://user:invalid-password@example.test/private")
    )
  ).not.toContain("invalid-password");
});
