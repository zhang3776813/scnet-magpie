// SCNet x magpie 供应商插件
// 让 Magpie 网关出现 SCNet（超算互联网）模型服务，各 Agent（Claude Code、
// Codex、Gemini CLI、OpenCode…）直接用超算互联网账号使用模型。
//
// 协议实现完全对照 SCNet 客户端主进程（D:\install_path\scnet-client）：
//   - 平台登录：POST /ac/api/auth/loginDesktopClient.action（账号密码 + 图形验证码）
//   - 平台会话：Cookie 里的 Token（acToken）+ myCookie
//   - API key：POST /acx/llm/api-key/createActivityApiKey（优先），失败走
//     团队 key 流程（/llm/api-key/query + /llm/api-key/create），与客户端一致
//   - 聊天：OpenAI 兼容 chat/completions → https://api.scnet.cn/api/llm/v1
//     （Magpie 网关自动完成 Anthropic 等协议互转），Authorization: Bearer <sk-key>
//   - 401 = key 失效：自动换新 key 重试一次（与客户端 createScnetModelStream 一致）
//   - auth.refresh：key 到期/失效时由 magpie 定期调起换新
//   - 模型列表：登录后 GET /acx/llm/api/console/model 实时拉取
//
// 凭证只存本机 magpie 的 plugin-auth.json，每个用户登录自己的账号，不共享。

import {
  PLATFORM_BASE,
  LLM_BASE,
  SCNET_CLIENT_UA,
  fetchCaptcha,
  loginWithPassword,
  fetchCurrentUser,
  obtainApiKey,
  fetchModels,
  ScnetError,
} from "./src/api.mjs";
import { staticModelList, STATIC_MODELS } from "./src/models.mjs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

// —— 验证码展示（本地 HTTP + 文件双保险） ——
// magpie 登录页把 instructions 按纯文本渲染，data URL 图片会显示成满屏 base64，
// 所以验证码改为：本机临时 HTTP 服务直接返回图片（url 字段让浏览器打开），
// 同时写一份 PNG 到临时目录兜底。10 分钟无请求自动关闭服务。
let captchaView = null;

async function serveCaptcha(imageBase64) {
  // 重复登录：先关旧服务
  if (captchaView) {
    try { captchaView.close(); } catch { /* 已关 */ }
    captchaView = null;
  }
  const m = /^data:(image\/[a-z]+);/i.exec(imageBase64 ?? "");
  const mime = m ? m[1].toLowerCase() : "image/png";
  const b64 = imageBase64.includes(",") ? imageBase64.slice(imageBase64.indexOf(",") + 1) : imageBase64;
  const buf = Buffer.from(b64, "base64");
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const file = join(tmpdir(), `scnet-captcha-${Date.now()}.${ext}`);
  try { writeFileSync(file, buf); } catch { /* 落盘失败不影响 HTTP 展示 */ }

  const server = createServer((req, res) => {
    res.writeHead(200, {
      "content-type": mime,
      "cache-control": "no-store",
    });
    res.end(buf);
  });
  server.on("error", () => { /* 端口被占等：文件兜底仍可用 */ });

  const view = { url: `file:///${file.replace(/\\/g, "/")}`, file, close: () => {} };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = server.address()?.port ?? 0;
    if (port) view.url = `http://127.0.0.1:${port}/captcha`;
  } catch { /* HTTP 起不来：file:// 兜底 */ }

  const close = () => {
    clearTimeout(timer);
    try { server.close(); } catch { /* 已关 */ }
    if (captchaView?.close === close) captchaView = null;
  };
  const timer = setTimeout(close, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  if (server.unref) server.unref(); // 不拖住宿主进程退出；host 活着时服务照常可用
  view.close = close;

  captchaView = { close, port: server.address()?.port ?? 0 };
  return view;
}

const PROVIDER = "scnet";
const PROVIDER_NAME = "超算互联网 SCNet";
const NPM = "@ai-sdk/openai-compatible";
const DEFAULT_MODEL_ID = "SCNet-Max";

// —— 登录态形状 ——
//   token     平台会话 Token（acToken，Cookie 的 Token= 值）
//   myCookie  其余平台 Cookie
//   api_key   LLM API key（sk- 开头，发给网关）
//   accountId 账号 id（卡片显示名）

function sessionOf(auth) {
  if (!auth || typeof auth !== "object") return null;
  // type:"api" 由 host 的 save() 写成 { type, key, metadata }；
  // type:"oauth" 是密码登录写的形状（key 在 refresh/api_key）
  const apiKey =
    typeof auth.key === "string" && auth.key.trim()
      ? auth.key.trim()
      : typeof auth.api_key === "string" && auth.api_key.trim()
        ? auth.api_key.trim()
        : typeof auth.refresh === "string" && auth.refresh.startsWith("sk-")
          ? auth.refresh
          : undefined;
  return {
    token: typeof auth.token === "string" ? auth.token : undefined,
    myCookie: typeof auth.myCookie === "string" ? auth.myCookie : undefined,
    cookie: typeof auth.cookie === "string" ? auth.cookie : undefined,
    apiKey,
    accountId: typeof auth.accountId === "string" ? auth.accountId : undefined,
    metadata: auth.metadata ?? undefined,
    userInfo: auth.userInfo ?? undefined,
    type: typeof auth.type === "string" ? auth.type : undefined,
  };
}

function accountLabel(auth) {
  const s = sessionOf(auth);
  if (!s) return "";
  // api key 登录：备注就是显示名（host 存在 metadata.label）
  const note = s.metadata?.label;
  if (typeof note === "string" && note.trim()) return note.trim();
  const u = s.userInfo;
  if (u && typeof u === "object") {
    return (
      u.fullName ||
      u.userName ||
      u.email ||
      u.mobilephoneNum ||
      s.accountId ||
      "SCNet 账号"
    );
  }
  return s.accountId || "SCNet 账号";
}

// —— 插件主体 ——

export const ScnetPlugin = async () => ({
  config: async (cfg) => {
    cfg.provider ??= {};
    cfg.provider[PROVIDER] ??= {
      name: PROVIDER_NAME,
      npm: NPM,
      api: LLM_BASE,
      models: STATIC_MODELS,
    };
  },

  auth: {
    provider: PROVIDER,

    methods: [
      // ① 账号密码登录（含图形验证码），与 SCNet 客户端登录一致
      //    流程（对照 OpenCode/magpie host）：
      //    prompts 收集 用户名/密码 → authorize() 取验证码、内嵌图片并
      //    返回 method:"code" → callback(验证码) 完成登录。
      {
        type: "oauth",
        label: "通过 SCNet 账号密码登录",
        prompts: [
          {
            type: "text",
            key: "username",
            message: "SCNet 账号",
            placeholder: "手机号 / 用户名",
            validate: (v) =>
              typeof v !== "string" || !v.trim() ? "请输入 SCNet 账号" : undefined,
          },
          {
            type: "password",
            key: "password",
            message: "密码",
            placeholder: "登录密码",
            validate: (v) =>
              typeof v !== "string" || !v.trim() ? "请输入密码" : undefined,
          },
        ],
        async authorize(inputs = {}) {
          const username = String(inputs?.username ?? "").trim();
          const password = String(inputs?.password ?? "");
          if (!username || !password) {
            return { type: "failed", error: "缺少用户名或密码" };
          }
          // 取验证码（含 captchaKey cookie，callback 时回传）
          let captcha;
          try {
            captcha = await fetchCaptcha();
          } catch {
            return { type: "failed", error: "连不上 SCNet 服务器，请检查网络后重试" };
          }
          const captchaStep = { image: captcha.imageBase64, cookie: captcha.cookie };
          // 验证码展示：本地临时 HTTP 服务（浏览器直接看到图片）+ 落盘文件兜底。
          // 不能用 data URL 内嵌 instructions——magpie 登录页按纯文本渲染，会满屏 base64。
          const view = await serveCaptcha(captchaStep.image);
          captchaStep.closeView = view.close;
          return {
            url: view.url,
            instructions:
              `验证码图片已在本机打开：${view.url}\n` +
              `请输入图中 4 位验证码。若浏览器没有自动打开，请手动访问上面的地址；\n` +
              `也可打开文件查看：${view.file}`,
            method: "code",
            async callback(code, { signal } = {}) {
              try {
                const captchaText = String(code ?? "").trim();
                if (!captchaText) {
                  return { type: "failed", error: "请输入验证码" };
                }
                try {
                  return await doPasswordLogin(
                    username,
                    password,
                    captchaText,
                    captchaStep.cookie
                  );
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "登录失败";
                  const captchaHint = /验证码|validate|captha|captcha/i.test(msg)
                    ? "\n（验证码错误或过期，请重试）"
                    : "";
                  return { type: "failed", error: msg + captchaHint };
                }
              } finally {
                view.close();
              }
            },
          };
        },
      },

      // ② API key 直接粘贴（在 SCNet 控制台 / 客户端创建）
      //    契约（对照 OpenCode/magpie host 的 apiKey handler）：
      //    - magpie 用 type:"api" + placeholder 自己显示 key 输入框；
      //    - prompts 是它接着问的问题，authorize(inputs) 里做校验；
      //    - key 由 host 收走并写进 save()，authorize 不返回 key，
      //      存的形状是 { type:"api", key, metadata }。
      {
        type: "api",
        label: "SCNet API Key",
        placeholder: "sk-...",
        prompts: [
          {
            type: "text",
            key: "label",
            message: "账号备注 · 每个账号请使用不同名称（同名登录会更新原账号）",
            placeholder: "例如：主账号 / 团队 key / 活动套餐",
            validate: (value) =>
              typeof value !== "string" ||
              !value.trim() ||
              value.trim().length > 60 ||
              /[\x00-\x1f\x7f]/.test(value)
                ? "请输入 1–60 字的账号备注，不要填写 API Key"
                : undefined,
          },
          {
            type: "select",
            key: "scope",
            message: "可用模型范围 · 以该 Key 在控制台的授权为准",
            options: [
              { label: "全部模型（跟随控制台授权）", value: "all" },
              { label: "只暴露默认模型 SCNet-Max", value: "default", hint: "SCNet-Max" },
            ],
          },
        ],
        async authorize(inputs = {}) {
          // 兼容：host 有时会把 key 放进 inputs（旧版 CLI / 测试脚本）
          const fromInputs =
            typeof inputs === "string"
              ? inputs.trim()
              : String(inputs?.key ?? inputs?.apiKey ?? inputs?.api_key ?? "").trim();
          const label = String(inputs?.label ?? "").trim();
          if (inputs?.label !== undefined && (!label || label.length > 60)) {
            return { type: "failed", error: "请输入 1–60 字的账号备注，不要填写 API Key" };
          }
          const scope = inputs?.scope === "default" ? "default" : "all";
          if (inputs?.scope !== undefined && !["all", "default"].includes(inputs.scope)) {
            return { type: "failed", error: "请选择模型范围" };
          }
          const result = {
            type: "success",
            metadata: {
              label: label || "SCNet API Key",
              scope,
            },
          };
          // 旧 CLI 把 key 传进来时才代写，正常由 host 的 save() 落库
          if (fromInputs) result.key = fromInputs;
          return result;
        },
      },
    ],

    // 每个请求：注入 Bearer <sk-key>；401 时自动换新 key 重试一次
    async loader(getAuth) {
      const auth = await getAuth();
      if (!auth) return {};
      const s = sessionOf(auth);
      if (!s?.apiKey) return {};
      return {
        baseURL: LLM_BASE,
        async fetch(input, init) {
          const headers = new Headers(init?.headers);
          const authNow = await getAuth();
          const sNow = sessionOf(authNow);
          const key = sNow?.apiKey ?? s.apiKey;
          if (!key) return fetch(input, init);
          if (!headers.has("authorization")) {
            headers.set("Authorization", `Bearer ${key}`);
          }
          // 与 SCNet 客户端一致：网关请求也带客户端 UA
          if (!headers.has("user-agent")) {
            headers.set("User-Agent", SCNET_CLIENT_UA);
          }
          let res = await fetch(input, { ...init, headers });
          if (res.status !== 401) return res;
          // key 失效 → 轮换刷新（与客户端 createScnetModelStream 一致）
          res.body?.cancel().catch(() => {});
          try {
            // 用保存的平台会话向平台换新 key（新 key 会经 auth.refresh 写回存储）
            const freshAuth = await getAuth();
            const s2 = sessionOf(freshAuth);
            const session = {
              token: s2?.token ?? s.token,
              myCookie: s2?.myCookie ?? s.myCookie,
              cookie: s2?.cookie ?? s.cookie,
              accountId: s2?.accountId ?? s.accountId,
            };
            if (!session.token && !session.myCookie && !session.cookie) {
              throw new ScnetError("缺少平台会话");
            }
            const newKey = await obtainApiKey(session, { rejectedKey: key });
            if (newKey && newKey !== key) {
              _bumpKey(newKey); // 模块级最新 key，供 refresh 返回
            }
          } catch {
            // 换 key 失败：重登信号
            const out = new Headers(res.headers);
            out.set("X-Magpie-Sign-In", "expired");
            out.set("content-type", "application/json");
            return new Response(JSON.stringify({ error: { message: "SCNet 登录已失效，请重新登录" } }), {
              status: 401,
              statusText: res.statusText,
              headers: out,
            });
          }
          const retryKey = _latestKey() || key;
          const retryHeaders = new Headers(headers);
          retryHeaders.set("Authorization", `Bearer ${retryKey}`);
          if (!retryHeaders.has("user-agent")) {
            retryHeaders.set("User-Agent", SCNET_CLIENT_UA);
          }
          const retry = await fetch(input, { ...init, headers: retryHeaders });
          if (retry.status === 401) {
            const out = new Headers(retry.headers);
            out.set("X-Magpie-Sign-In", "expired");
            out.set("content-type", "application/json");
            return new Response(JSON.stringify({ error: { message: "SCNet 登录已失效，请重新登录" } }), {
              status: 401,
              statusText: retry.statusText,
              headers: out,
            });
          }
          return retry;
        },
      };
    },

    // 定期刷新：用平台会话换新 key（key 轮换机制）
    async refresh(auth) {
      const s = sessionOf(auth);
      if (!s?.token && !s?.myCookie && !s?.cookie) return undefined;
      try {
        const newKey = await obtainApiKey({
          token: s.token,
          myCookie: s.myCookie,
          cookie: s.cookie,
          accountId: s.accountId,
        });
        if (!newKey) return undefined;
        const label = accountLabel(auth);
        return {
          type: "success",
          access: s.token,
          refresh: newKey,
          token: s.token,
          myCookie: s.myCookie,
          cookie: s.cookie,
          api_key: newKey,
          accountId: s.accountId,
          accountName: label,
          userInfo: s.userInfo,
        };
      } catch (err) {
        if (err?.statusCode === 401 || err?.code === "auth.session_expired") {
          return undefined; // 平台会话也失效 → magpie 标记需重登
        }
        return undefined; // 网络等暂时错误：保留旧 key
      }
    },
  },

  // 登录后拉取该账号真实模型列表；API key 登录时按 metadata.scope 收敛
  provider: {
    id: PROVIDER,
    async models(provider, { auth } = {}) {
      const modelBase = provider.models ?? {};
      const s = sessionOf(auth);
      // 仅 API key 登录（无平台会话）时按备注里选的范围收敛
      if (s && !s.token && !s.myCookie && !s.cookie) {
        if (s.metadata?.scope === "default" && DEFAULT_MODEL_ID in modelBase) {
          return { ...modelBase, [DEFAULT_MODEL_ID]: modelBase[DEFAULT_MODEL_ID] };
        }
      }
      if (!auth) return provider.models;
      if (!s?.token && !s?.myCookie && !s?.cookie) return provider.models;
      const session = {
        token: s.token,
        myCookie: s.myCookie,
        cookie: s.cookie,
        accountId: s.accountId,
      };
      let list;
      try {
        list = await fetchModels(session);
      } catch (err) {
        if (err?.statusCode === 401 || err?.code === "auth.session_expired") {
          throw Object.assign(new Error("SCNet 登录已失效，请重新登录"), { signIn: "expired" });
        }
        return provider.models;
      }
      if (!list.length) return provider.models;
      const base = modelBase;
      const out = {};
      for (const m of list) {
        const prev = base[m.id] ?? {};
        const vision =
          m.modalities?.input?.includes("image") ||
          m.inputModalities?.includes("image") ||
          m.vision === true;
        out[m.id] = {
          ...prev,
          id: m.id,
          name: m.name ?? prev.name ?? m.id,
          limit: prev.limit ?? (m.contextWindow
            ? { context: m.contextWindow, output: m.maxTokens ?? 64000 }
            : { context: 1048576, output: 64000 }),
          reasoning: prev.reasoning ?? (m.reasoning ?? true),
          tool_call: prev.tool_call ?? true,
          modalities: vision
            ? { input: ["text", "image"] }
            : (prev.modalities ?? { input: ["text"] }),
          cost: prev.cost,
        };
      }
      return Object.keys(out).length ? out : provider.models;
    },
  },
});

// —— 密码登录流程 ——

async function doPasswordLogin(username, password, captchaText, captchaCookie) {
  const first = await loginWithPassword(username, password, captchaText, {
    captchaCookie,
  });
  const session = {
    token: first.token,
    myCookie: first.myCookie,
    cookie: first.cookie,
    accountId: first.accountId,
    userInfo: first.userInfo,
  };
  let userInfo = first.userInfo;
  try {
    userInfo = await fetchCurrentUser(session);
    session.accountId = userInfo.accountId ?? first.accountId;
  } catch {
    /* 拿不到用户信息也不阻塞 */
  }
  // 获取 API key
  let apiKey;
  try {
    apiKey = await obtainApiKey(session);
  } catch (err) {
    // key 拿不到，但登录本身成功：允许只保存会话，模型请求时再补 key
    if (err?.statusCode === 401) throw err;
  }
  const accountId = session.accountId || String(userInfo?.id ?? "");
  const display = String(
    userInfo?.fullName ?? userInfo?.userName ?? userInfo?.email ?? accountId
  );
  return {
    type: "success",
    access: session.token,
    refresh: apiKey,
    token: session.token,
    myCookie: session.myCookie,
    cookie: session.cookie,
    api_key: apiKey,
    accountId,
    accountName: display,
    userInfo,
  };
}

// —— 模块级最新 key（loader 换 key 后，refresh 与后续请求用） ——

let latestKeyValue = "";

function _latestKey() {
  return latestKeyValue;
}

function _bumpKey(key) {
  if (typeof key === "string" && key) latestKeyValue = key;
}

export { _bumpKey, _latestKey };

export default ScnetPlugin;