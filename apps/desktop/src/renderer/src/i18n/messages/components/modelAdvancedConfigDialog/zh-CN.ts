export default {
  thisEnvironmentCannotReadTheModelSActualRequest:
    "当前环境无法读取模型实际请求容量。",
  couldNotReadTheModelSActualRequestCapacity: "读取模型实际请求容量失败。",
  enterAContextLengthBetweenValueAndValue:
    "请填写 {arg0} 到 {arg1} 之间的上下文长度。",
  enterAMaximumOutputLengthBetweenValueAndValue:
    "请填写 {arg0} 到 {arg1} 之间的最高输出长度。",
  maximumOutputLengthCannotExceedContextLength:
    "最高输出长度不能超过上下文长度。",
  leaveInputAndRuntimeCapacity:
    "上下文总量需要比最高输出至少多 8,192 token：预留 4,096 token 给系统运行，至少 4,096 token 留给输入。",
  capacityFieldsAreDifferent:
    "这是两个不同的限制：上下文总量包含输入和输出；最高输出是单次回复上限。它们不是两块可相加的内存。工作台会为运行提示预留空间，并保留至少 4,096 token 输入容量。",
  savedCapacityNeedsCorrection:
    "当前已保存的容量组合无法留出足够的输入空间。请调整后保存；旧配置仍可读取。",
  modelSettings: "模型配置",
  advancedSettings: "高级配置",
  generateASubagentDraftFor: "为「",
  defaultsMatchTheCurrentRequestSavedChangesApplyTo:
    "」设置请求容量。默认值与当前实际请求一致，保存后按修改值传输。",
  contextLength: "上下文长度",
  readingActualRequestCapacity: "正在读取实际请求容量…",
  totalTokensPerRequestIncludingInputAndOutput:
    "一次请求可容纳的总 token 数，含输入与输出。",
  maximumOutputLength: "最高输出长度",
  maximumTokensGeneratedInASingleReply: "单次回复允许生成的最大 token 数。",
  cancel: "取消",
  saving: "保存中…",
  save: "保存",
  setRequestCapacityForDefaultsMatchTheMessage:
    "为「{arg0}」设置请求容量。默认值与当前实际请求一致，保存后按修改值传输。"
};
