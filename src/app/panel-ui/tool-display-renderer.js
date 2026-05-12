export function createToolDisplayNode(display) {
  if (!display || !display.kind) return undefined;
  const box = document.createElement("div");
  box.className = "tool-detail-preview";
  if (display.kind === "search_results" && Array.isArray(display.results)) {
    box.textContent = display.results.slice(0, 5).map((item) =>
      [item.title, item.url || item.refId, item.snippet].filter(Boolean).join(" · ")
    ).join("\n");
    return box;
  }
  if (display.kind === "browser_snapshot") {
    box.textContent = [display.title, display.url, display.text].filter(Boolean).join("\n");
    return box;
  }
  if (display.kind === "file_diff_preview") {
    box.textContent = [
      "变更预览",
      display.path ? "文件：" + display.path : "",
      typeof display.replacements === "number" ? "替换：" + display.replacements + " 处" : "",
      typeof display.previousLength === "number" && typeof display.nextLength === "number"
        ? "长度：" + display.previousLength + " -> " + display.nextLength + " chars"
        : ""
    ].filter(Boolean).join("\n");
    return box;
  }
  if (display.kind === "file_change_summary") {
    box.textContent = [
      display.path ? "文件：" + display.path : "",
      typeof display.bytes === "number" ? "大小：" + display.bytes + " bytes" : "",
      display.append ? "追加写入" : ""
    ].filter(Boolean).join("\n");
    return box;
  }
  if (display.kind === "command_summary") {
    box.textContent = [
      display.command ? "命令：" + [display.command].concat(display.args || []).join(" ") : "",
      typeof display.exitCode === "number" ? "退出码：" + display.exitCode : "",
      display.stdoutSummary ? "输出摘要：\n" + display.stdoutSummary : "",
      display.stderrSummary ? "错误摘要：\n" + display.stderrSummary : ""
    ].filter(Boolean).join("\n");
    return box;
  }
  if (display.kind === "generic_tool_summary") {
    box.textContent = [
      display.summary,
      Array.isArray(display.items) ? display.items.slice(0, 8).join("\n") : ""
    ].filter(Boolean).join("\n");
    return box;
  }
  return undefined;
}
