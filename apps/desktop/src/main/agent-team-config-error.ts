export function invalidAgentTeamConfig(issue?: {
  path: PropertyKey[];
  message: string;
}): Error {
  return new Error(
    `智能体团队配置内容无效，已停止加载以避免覆盖原文件${
      issue ? `：${issue.path.join(".") || "root"} ${issue.message}` : "。"
    }`
  );
}
