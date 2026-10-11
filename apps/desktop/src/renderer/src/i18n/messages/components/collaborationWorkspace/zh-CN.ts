export default {
  returnCandidate: "带回当前对话，继续审核",
  returnTooLarge:
    "候选超过对话输入容量，请先保存为候选，再让当前模型读取该文件审核。",
  saved: "已保存候选：{path}",
  saveFailed: "候选保存失败。",
  candidateSaved: "已保存为讨论候选",
  saving: "正在保存…",
  saveCandidate: "保存本次 Codex 结果为候选",
  title: "创作协作",
  close: "关闭",
  novel: "要求核对与剧情发散",
  codex: "请 Codex 讨论",
  connection: "这里与工作台连接",
  chapter: "选择需要处理的章节",
  chooseChapter: "先选择章节，再核对要求、查找前文或比较剧情方向。",
  prepareHint:
    "先读取本次作品资料，再选择 Codex 模型。资料会显示给你，并随首轮发送。",
  preparing: "正在读取…",
  prepare: "准备本次资料",
  prepared: "已读取 {count} 份资料。",
  unavailable: "当前程序尚未提供 Codex 协作入口。",
  connectionHint:
    "工作台运行时，这里的助手可以通过本机入口读取你指定的资料、调用指定模型，再取回结果。保存候选是单独动作。",
  endpoint: "连接文件：",
  connectionDetail:
    "文件包含本地连接凭证，只供这台电脑的工具读取。配置 MCP 时选择项目随附的 novel-workbench-client.mjs，并使用此连接文件。",
  sourceLabel: "{book} 本次资料",
  readFailed: "读取资料失败。",
  tooLarge: "本次资料超过 Codex 对话入口容量，请减少资料后重试。",
  wrongContext: "读取结果与当前作品或章节不一致，请重新准备资料。",
  connectionFailed: "本地协作入口暂不可用。"
};
