// Preloaded only by the desktop launcher. No retries of billable requests.
if (process.env.LAMP_LOCAL_PROFILE === "1") {
  const proxy = process.env.LOCAL_HTTPS_PROXY || process.env.https_proxy || process.env.HTTPS_PROXY;
  if (proxy) {
    const parsed = new URL(proxy);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid local HTTPS proxy protocol.");
    const { EnvHttpProxyAgent, setGlobalDispatcher } = require("undici");
    const bypass = ["localhost", "127.0.0.1", "[::1]", process.env.no_proxy || process.env.NO_PROXY || ""].filter(Boolean).join(",");
    setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy: bypass }));
  }
}
