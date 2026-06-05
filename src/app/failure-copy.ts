export function friendlyFailureCopy(value: string): string {
  const text = value.trim();
  const sdkNoBody = /^(\d{3})\s+status code \(no body\)$/i.exec(text);
  if (sdkNoBody !== null) {
    return `HTTP ${sdkNoBody[1]}`;
  }
  if (/openai-compatible provider stream response could not be parsed/i.test(text)) {
    return "模型服务的流式返回格式不兼容，已改用非流式方式重试；如果仍失败，请在设置中关闭该模型的流式输出。";
  }
  return text;
}
