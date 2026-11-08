// SCNet 平台 API 客户端
// 实现与 SCNet 客户端主进程完全一致的协议：
//   - 登录：POST /ac/api/auth/loginDesktopClient.action（账号密码 + 图形验证码）
//   - 平台会话：返回的 Cookie 中的 Token（acToken）+ myCookie
//   - API key：POST /acx/llm/api-key/createActivityApiKey（平台会话认证，返回 sk- 开头的 key）
//   - 模型列表：GET /acx/llm/api/console/model（平台会话认证）
//   - LLM 网关：https://api.scnet.cn/api/llm/v1（OpenAI 兼容，Bearer <sk-key>）

export const PLATFORM_BASE = "https://www.scnet.cn";
export const API_BASE = "https://www.scnet.cn";
export const LLM_BASE = "https://api.scnet.cn/api/llm/v1";

const CAPTCHA_URL = "/sso/captcha.action";

// —— 客户端身份头（与 SCNet 客户端保持一致，服务端据此识别客户端流量） ——
// 对照客户端主进程（app.asar dist-electron/main/index.js）：
//   - axios 实例默认头 {"Content-Type": "...", source: "Electron", version: app.getVersion()}
//     拦截器还会在每个请求上重设 version 头
//   - 客户端网络层包装对 SCNet 请求显式设 User-Agent: "SCNet-Client"
// version 取自客户端 resources/app.asar 内 package.json（4.1.0）
export const SCNET_CLIENT_UA = "SCNet-Client";
export const SCNET_CLIENT_VERSION = "4.1.0";
const CLIENT_HEADERS = {
  "User-Agent": SCNET_CLIENT_UA,
  source: "Electron",
  version: SCNET_CLIENT_VERSION,
};

// 密码 RSA 加密（与 SCNet 客户端同款：1024 位 PKCS1，base64 输出）
import { createPublicKey, publicEncrypt, constants } from "node:crypto";

export const SCNET_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALaXEnbjI6fjy+t9W9AiO/KS0q+b/OZFS
+7ykinLbiriUx9P8BcuuHnVbXNiZp5jW70eVGBtX4DhGUPzJa1YT/8CAwEAAQ==
-----END PUBLIC KEY-----`;

export function encryptPassword(password) {
  const key = createPublicKey(SCNET_PUBLIC_KEY);
  return publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(String(password), "utf8")
  ).toString("base64");
}

export class ScnetError extends Error {
  constructor(message, { statusCode, code, retryable = false } = {}) {
    super(message);
    this.name = "ScnetError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

// 解析平台接口统一响应 { code, msg, data, error, request_id, trace_id }
function parsePayload(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ScnetError("SCNet 平台返回了无效的响应");
  }
  const err = json.error && typeof json.error === "object" ? json.error : null;
  const code = String(err?.code ?? json.code ?? "");
  const msg = String(err?.message ?? json.msg ?? json.message ?? "").trim();
  if (code && code !== "0" && code !== "200") {
    const providerCode = err?.code ?? json.code;
    const scnet = new ScnetError(msg || `SCNet 平台请求失败（code=${providerCode}）`, {
      statusCode: json.status ?? null,
      code: providerCode,
      retryable: /(timeout|网络|try|later)/i.test(msg),
    });
    scnet.providerCode = providerCode;
    throw scnet;
  }
  return json.data ?? json;
}

async function requestJson(url, { method = "GET", body, headers = {}, timeoutMs = 15000, signal } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
  });
  if (!res.ok && res.status >= 500) {
    throw new ScnetError(`SCNet 服务暂不可用（HTTP ${res.status}）`, {
      statusCode: res.status,
      retryable: true,
    });
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ScnetError(`SCNet 平台返回了无法解析的响应（HTTP ${res.status}）`, {
      statusCode: res.status,
    });
  }
  if (!res.ok && res.status === 401) {
    throw new ScnetError("SCNet 登录已失效，请重新登录", { statusCode: 401, code: "auth.session_expired" });
  }
  return { json, headers: res.headers, status: res.status };
}

// —— 图形验证码 ——

// 获取验证码（与 SCNet 客户端一致）：
// GET /sso/captcha.action → { code, data: "data:image/jpeg;base64,..." }
// 响应 Set-Cookie 里的 captchaKey 要回传给登录接口。
// 返回 { image, cookie, imageBase64 }（imageBase64 兼容旧引用）
export async function fetchCaptcha({ signal } = {}) {
  const res = await fetch(`${PLATFORM_BASE}${CAPTCHA_URL}`, {
    headers: { Accept: "application/json", ...CLIENT_HEADERS },
    redirect: "manual",
    signal: signal ?? AbortSignal.timeout(15000),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ScnetError(`获取 SCNet 验证码失败（HTTP ${res.status}）`, {
      statusCode: res.status,
    });
  }
  const img = String(json?.data ?? json?.image ?? "");
  if (!img) {
    throw new ScnetError("获取 SCNet 验证码失败：接口未返回图片");
  }
  const allCookies = res.headers.getSetCookie?.() ?? [];
  const cookieHeader = res.headers.get("set-cookie");
  if (cookieHeader && !allCookies.includes(cookieHeader)) allCookies.push(cookieHeader);
  const cookie = allCookies.map((c) => String(c).split(";")[0]).join("; ");
  return {
    image: img,
    cookie,
    imageBase64: img.startsWith("data:") ? img : `data:image/png;base64,${img}`,
  };
}

// —— 密码登录 ——
// 与 SCNet 客户端主进程同一套协议：
//   POST /ac/api/auth/loginDesktopClient.action
//   Content-Type: application/x-www-form-urlencoded（客户端 axios 的默认，
//   拦截器会把 JSON data 用 qs.stringify 转表单）
//   { username, password: RSA(base64), captcha, encrypted:true,
//     isSevenDaysValidity:true, sensors_anon_id:"", captchaKey:"" }
//   + 取验证码时拿到的 Cookie
// captchaCookie 来自 fetchCaptcha().cookie
// 返回 { token, myCookie, userInfo, accountId }
export async function loginWithPassword(
  username,
  password,
  captchaText,
  { captchaCookie, signal } = {}
) {
  const form = new URLSearchParams({
    username,
    password: encryptPassword(password),
    captcha: captchaText ?? "",
    encrypted: "true",
    isSevenDaysValidity: "true",
    sensors_anon_id: "",
    captchaKey: "",
  });
  const res = await fetch(`${PLATFORM_BASE}/ac/api/auth/loginDesktopClient.action`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...CLIENT_HEADERS,
      ...(captchaCookie ? { Cookie: captchaCookie } : {}),
    },
    redirect: "manual",
    body: form.toString(),
    signal: signal ?? AbortSignal.timeout(20000),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ScnetError(`SCNet 登录响应无法解析（HTTP ${res.status}）`, {
      statusCode: res.status,
    });
  }
  const payload = parsePayload(json);
  const allCookies = res.headers.getSetCookie?.() ?? [];
  const cookieHeader = res.headers.get("set-cookie");
  if (cookieHeader && !allCookies.includes(cookieHeader)) allCookies.push(cookieHeader);
  const map = new Map();
  for (const c of allCookies) {
    const [pair] = String(c).split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const token = map.get("Token") ?? "";
  if (!token) {
    throw new ScnetError("SCNet 登录失败：平台未返回会话（请检查账号或验证码）");
  }
  // 平台接口靠全量 Cookie 认证（含 Token=xxx），实测单独 Token 头会 401。
  // cookie 字段就是整个 set-cookie 拼成的字符串，请求时原样回传。
  const myCookie = [...map.entries()]
    .filter(([k]) => k !== "Token")
    .map(([, v]) => v)
    .join("; ");
  const cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const userInfo = payload && typeof payload === "object" ? payload : {};
  const accountId = String(
    userInfo.id ?? userInfo.userId ?? userInfo.accountId ?? userInfo.user?.id ?? ""
  );
  return { token, myCookie, cookie, userInfo, accountId, cookies: map };
}

// —— 平台认证请求（带 Cookie 头） ——
// 实测：/acx/... 与 /llm/... 平台接口靠 Cookie 认证（登录 set-cookie 全量，
// 其中含 Token=xxx），Token 头会 401，X-Jwt-Access-Token 头会 1001。

function platformHeaders(session) {
  const h = { Accept: "application/json", ...CLIENT_HEADERS };
  const parts = [];
  if (session.cookie) {
    parts.push(session.cookie);
  } else {
    if (session.myCookie) parts.push(session.myCookie);
    if (session.token) parts.push(`Token=${session.token}`);
  }
  if (parts.length) h.Cookie = parts.join("; ");
  // 客户端 w() 也会设置 Token 头（accessToken），实测不影响，保留以便服务端兼容
  if (session.token) h.Token = session.token;
  return h;
}

async function platformRequest(session, path, { method = "GET", body, params, signal } = {}) {
  let url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) url += `${url.includes("?") ? "&" : "?"}${qs}`;
  }
  const { json, status } = await requestJson(url, {
    method,
    body,
    headers: platformHeaders(session),
    signal,
  });
  return parsePayload(json, status);
}

// —— 当前用户信息（确认登录态） ——

export async function fetchCurrentUser(session, { signal } = {}) {
  const data = await platformRequest(
    session,
    "/acx/user/users/current-user-info?includeToken=true&refresh=true",
    { signal }
  );
  const accountId = String(
    data?.id ?? data?.userId ?? data?.accountId ?? data?.user?.id ?? session.accountId ?? ""
  );
  return {
    ...(data && typeof data === "object" ? data : {}),
    accountId,
  };
}

// —— API key（客户端同款流程） ——

// 优先走 createActivityApiKey（一键取活动 key）；
// 服务端拒绝（API010010）时，模拟客户端：查成员 key 列表 → 复用或新建。
export async function obtainApiKey(session, { rejectedKey, signal } = {}) {
  try {
    const data = await platformRequest(session, "/acx/llm/api-key/createActivityApiKey", {
      method: "POST",
      body: {},
      signal,
    });
    const key = apiKeyOf(data);
    if (key) return key;
    throw new ScnetError("SCNet 未返回服务凭证");
  } catch (err) {
    if (err?.providerCode && String(err.providerCode) !== "API010010") throw err;
    if (err?.statusCode === 401) throw err;
    return obtainMemberApiKey(session, { rejectedKey, signal });
  }
}

function apiKeyOf(data) {
  if (!data) return "";
  if (typeof data === "string") return data.trim();
  for (const k of ["apiKey", "apikey", "key", "secret", "token"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (data.data && typeof data.data === "object") return apiKeyOf(data.data);
  return "";
}

// 团队成员 API key 流程（客户端同款）：
//   GET /user/users/cluster-user-detail → 账号/团队信息
//   POST /llm/api-key/query 分页查 key → 找到 scnet-client-member-<createUser> 且 keyStatus=100 的复用
//   没有则 POST /llm/api-key/create 新建
async function obtainMemberApiKey(session, { rejectedKey, signal } = {}) {
  const users = await platformRequest(session, "/acx/user/users/cluster-user-detail", { signal });
  const list = Array.isArray(users) ? users : [];
  if (!list.length || list.some((u) => String(u?.memberType ?? "").toLowerCase() !== "member")) {
    throw new ScnetError("SCNet 用户账号异常，请联系团队管理员");
  }
  const ids = new Set(list.map((u) => String(u?.accountId ?? "")));
  if (ids.size !== 1) {
    throw new ScnetError("当前账号关联多个团队账号，请联系团队管理员确认");
  }
  const first = list[0];
  const accountId = String(first?.accountId ?? "");
  const groupId = String(first?.groupId ?? "");
  const createUser = String(first?.userId ?? "");
  const name = `scnet-client-member-${createUser}`;
  if (!accountId || !groupId || !createUser) {
    throw new ScnetError("SCNet 团队账号信息异常，请联系团队管理员");
  }
  const records = [];
  for (let page = 1; page <= 100; page += 1) {
    const resp = await platformRequest(session, "/acx/llm/api-key/query", {
      method: "POST",
      body: { createUser, accountId, groupId, serviceType: "model", page, size: 100 },
      signal,
    });
    const recs = Array.isArray(resp)
      ? resp
      : Array.isArray(resp?.records)
        ? resp.records
        : [];
    records.push(...recs);
    if (Array.isArray(resp)) break;
    const pages = Number(resp?.pages || 1);
    if (page >= pages) break;
  }
  const mine = records.find(
    (r) =>
      String(r?.apiKeyName ?? "") === name &&
      String(r?.accountId ?? "") === accountId &&
      String(r?.createUser ?? "") === createUser &&
      String(r?.keyStatus ?? "") === "100"
  );
  if (mine && mine.id) {
    const detail = await platformRequest(session, "/acx/llm/api-key/detail", {
      params: { id: String(mine.id) },
      signal,
    });
    const key = apiKeyOf(detail);
    if (key && !key.includes("*")) {
      if (rejectedKey && key === rejectedKey) {
        throw new ScnetError("SCNet API Key 已失效，请重新登录", { code: "auth.session_expired" });
      }
      return key;
    }
    throw new ScnetError("SCNet 服务凭证不可用");
  }
  if (records.some((r) => String(r?.apiKeyName ?? "") === name && String(r?.accountId ?? "") === accountId)) {
    throw new ScnetError("SCNet API Key 已失效，请重新登录", { code: "auth.session_expired" });
  }
  const created = await platformRequest(session, "/acx/llm/api-key/create", {
    method: "POST",
    body: {
      createUser,
      apiKeyName: name,
      serviceTypes: ["model"],
      accessibleModelScope: "ALL",
      groupId,
      accountId,
    },
    signal,
  });
  const key = apiKeyOf(created);
  if (!key) throw new ScnetError("SCNet 服务凭证不可用");
  return key;
}

// —— 模型列表 ——
// 返回 [{ id, name, contextWindow, maxTokens, reasoning, modalities, description, ... }]

export async function fetchModels(session, { signal } = {}) {
  const data = await platformRequest(session, "/acx/llm/api/console/model", { signal });
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.records)
      ? data.records
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.list)
          ? data.list
          : Array.isArray(data?.models)
            ? data.models
            : [];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    // 真实字段（2026-11 实测 console/model）：
    //   modelName  = 模型 id
    //   displayName= 显示名
    //   modelType  = "LLM" | "DOC_CONVERSION" | "DOC_MIND" | "OCR" …
    //   maxToken   = 上下文窗口（KiB），乘 1024 得 token 数
    const id = String(m.modelName ?? m.modelId ?? m.id ?? "").trim();
    const type = String(m.modelType ?? "").trim().toUpperCase();
    if (!id) continue;
    // 只要语言模型；文档/OCR 等服务型条目 Magpie 用不了（它们走别的接口）
    if (type && type !== "LLM") continue;
    const kib = Number(m.maxToken ?? m.maxTokenKib);
    const ctx = Number.isFinite(kib) && kib > 0 ? Math.round(kib * 1024) : undefined;
    // 价格：SCNet 按元/百万 token 计，magpie cost 也是元/百万 token
    const price = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    const cost =
      price(m.inputPrice) !== undefined || price(m.outputPrice) !== undefined
        ? {
            input: price(m.inputPrice) ?? 0,
            output: price(m.outputPrice) ?? 0,
            ...(price(m.cachedPrice) !== undefined ? { cache_read: price(m.cachedPrice) } : {}),
          }
        : undefined;
    const inputKinds = Array.isArray(m.modalities?.input)
      ? m.modalities.input.map((k) => String(k).toLowerCase())
      : [];
    const vision = inputKinds.includes("image") || inputKinds.includes("video");
    out.push({
      id,
      name: String(m.displayName ?? m.modelName ?? id),
      ...(m.description ? { description: String(m.description) } : {}),
      ...(ctx ? { contextWindow: ctx } : {}),
      ...(cost ? { cost } : {}),
      ...(vision ? { modalities: { input: ["text", "image"] } } : {}),
    });
  }
  return out;
}

// —— 登录态保存（与客户端 scnet-credentials 相同形状） ——

export function saveApiKeyToClientStore(apiKey) {
  // 只做可选的落盘：写入 ~/.sclaw/agent/scnet-credentials 需客户端同意，
  // magpie 插件不主动写客户端目录；这里返回 void，由 auth 存储管理 key。
  void apiKey;
}

export { requestJson, platformRequest };