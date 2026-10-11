import dns from "node:dns/promises";
import net from "node:net";

const REDIRECTS = 3;
const URL_LIMIT = 2048;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 150 * 1024 * 1024;
const privateAddress = (input: string) => {
  const value = input.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) return privateAddress(value.slice(7));
  if (net.isIPv4(value)) { const p = value.split(".").map(Number); return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168); }
  if (net.isIPv6(value)) return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
  return true;
};
async function checked(value: string) {
  if (typeof value !== "string" || value.length > URL_LIMIT) throw new Error("source_url is too long");
  let url: URL; try { url = new URL(value); } catch { throw new Error("source_url must be a valid http(s) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("source_url must be a public http(s) URL");
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => privateAddress(address))) throw new Error("source_url must resolve to a public address");
  return url;
}
export async function downloadMcpSource(sourceUrl: string, kind: "image" | "video") {
  let url = await checked(sourceUrl); let response: Response | undefined;
  for (let i = 0; i <= REDIRECTS; i += 1) {
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || i === REDIRECTS) throw new Error("source_url redirected too many times");
    url = await checked(new URL(location, url).toString());
  }
  if (!response?.ok || !response.body) throw new Error(`Unable to read source_url (${response?.status ?? 0})`);
  const limit = kind === "video" ? VIDEO_LIMIT : IMAGE_LIMIT;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("source_url file is too large");
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
  while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > limit) { await reader.cancel(); throw new Error("source_url file is too large"); } chunks.push(Buffer.from(part.value)); }
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  const fallback = kind === "video" ? "video/mp4" : "image/jpeg";
  return { bytes: Buffer.concat(chunks), mime: mime || fallback, filename: kind === "video" ? "asset.mp4" : "asset.jpg" };
}
