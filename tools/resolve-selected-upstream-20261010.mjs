import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const audit = resolve(
  "../../我的小说工作台/施工记录/20261010_技能积累版本/上游比较"
);
for (const path of [
  "apps/desktop/src/renderer/src/composables/useConversationComposer.ts",
  "apps/desktop/src/renderer/src/components/ConversationComposer.vue",
  "apps/desktop/src/renderer/src/components/SettingsPage.vue"
]) {
  const merged = readFileSync(resolve(audit, path + ".merge"), "utf8").replace(
    /^<<<<<<<[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[^\n]*\n/gm,
    (_match, local, incoming) =>
      path.endsWith("SettingsPage.vue")
        ? incoming.replace(
            /      \},\n      \{\n        id: "official-models",[\s\S]*?        icon: "model"\n      \},\n      \{\n        id: "voice",/u,
            '      },\n      {\n        id: "voice",'
          )
        : local + incoming
  );
  if (/^<<<<<<<|^=======|^>>>>>>>/m.test(merged))
    throw new Error("Unresolved " + path);
  writeFileSync(path, merged);
}
