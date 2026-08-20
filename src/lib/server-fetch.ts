// 服务端统一的 fetch：配置了代理（HTTPS_PROXY / HTTP_PROXY / ALL_PROXY）就走代理。
// 大陆直连 YouTube / OpenAI 会超时，但浏览器有系统代理（Clash / Surge 等），
// Node 进程默认不读系统代理，所以这里显式给 fetch 塞一个 undici ProxyAgent。
// 代理地址写在 .env.local（Next.js 会加载进 process.env），例如：
//   HTTPS_PROXY=http://127.0.0.1:7897
// 不配就退回直接连接，不影响没代理的环境。
//
// 注意：必须用 undici 自带的 fetch（而不是全局 fetch）。全局 fetch 是 Node 内建的
// 另一份 undici，跟 npm 里这个 ProxyAgent 不是同一个实例，直接传 dispatcher 会报
// UND_ERR_INVALID_ARG；用同一包的 fetch + ProxyAgent 才配对。

import { fetch as undiciFetch, ProxyAgent } from "undici";

// 把 undici 的 fetch 当全局 fetch 用（类型对齐），这样 serverFetch 的签名能跟全局
// fetch 完全一致，也方便直接传给 youtube-transcript 的 config.fetch。
const undiciFetchAsGlobal = undiciFetch as unknown as typeof fetch;

let agent: ProxyAgent | null | undefined;

function proxyAgent(): ProxyAgent | null {
  if (agent !== undefined) return agent;
  const proxy =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim();
  agent = proxy ? new ProxyAgent({ uri: proxy }) : null;
  return agent;
}

/** 带代理支持的 fetch，签名和全局 fetch 一致，可直接传给 youtube-transcript 等。 */
export const serverFetch: typeof fetch = (input, init) => {
  const a = proxyAgent();
  if (!a) return undiciFetchAsGlobal(input, init);
  return undiciFetchAsGlobal(input, { ...init, dispatcher: a } as RequestInit);
};
