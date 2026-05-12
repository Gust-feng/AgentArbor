export async function requestJson(url, options) {
  const init = options || {};
  const response = await fetch(url, {
    method: init.method || "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text || "响应解析失败。" };
  }
  if (!response.ok) {
    throw new Error(body.error && body.error.message ? body.error.message : body.message || "请求失败。");
  }
  return body;
}
