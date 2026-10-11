import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

const REDIRECTS = 3;
const URL_LIMIT = 2048;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 150 * 1024 * 1024;
type Address = { address: string; family: 4 | 6 };

function isPublicAddress(input: string): boolean {
  const value = input.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
  if (net.isIPv4(value)) {
    const p = value.split(".").map(Number);
    if (p.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return !(p[0] === 0 || p[0] === 10 || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 127 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && (p[1] === 0 || p[1] === 168) || p[0] === 192 && p[1] === 0 && p[2] === 2 || p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51) || p[0] === 203 && p[1] === 0 && p[2] === 113 || p[0] >= 224);
  }
  if (!net.isIPv6(value)) return false;
  return value !== "::" && value !== "::1" && !value.startsWith("fc") && !value.startsWith("fd") && !/^fe[89ab]/.test(value) && !value.startsWith("ff") && !value.startsWith("100:") && !value.startsWith("2001:2:") && !value.startsWith("2001:10:") && !value.startsWith("2001:db8:") && !value.startsWith("3fff:");
}

async function checked(value: string) {
  if (typeof value !== "string" || value.length > URL_LIMIT) throw new Error("source_url is too long");
  let url: URL; try { url = new URL(value); } catch { throw new Error("source_url must be a valid http(s) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("source_url must be a public http(s) URL");
  const records = (await dns.lookup(url.hostname, { all: true, verbatim: true })) as Address[];
  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) throw new Error("source_url must resolve to a public address");
  return { url, records };
}

function pinnedFetch(url: URL, records: Address[]) {
  const dispatcher = new Agent({ connect: { lookup: (_hostname: string, options: { all?: boolean; family?: number }, callback: (error: Error | null, address?: string | Address[], family?: number) => void) => {
    const selected = options?.family === 4 || options?.family === 6 ? records.filter((record) => record.family === options.family) : records;
    const pinned = selected.map((record) => ({ address: record.address, family: record.family }));
    if (options?.all) callback(null, pinned);
    else callback(null, pinned[0]?.address, pinned[0]?.family);
  } } } as never);
  const close = () => { void dispatcher.close().catch(() => undefined); };
  const request = fetch(url, { redirect: "manual", dispatcher, signal: AbortSignal.timeout(60_000) } as RequestInit & { dispatcher: Agent }).catch((error) => { void close(); throw error; });
  return { request, close };
}

export async function downloadMcpSource(sourceUrl: string, kind: "image" | "video") {
  let checkedUrl = await checked(sourceUrl); let response: Response | undefined; let close: () => void = () => undefined;
  for (let i = 0; i <= REDIRECTS; i += 1) {
    const request = pinnedFetch(checkedUrl.url, checkedUrl.records); close = request.close;
    try { response = await request.request; } catch { close(); throw new Error("Unable to read source_url"); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    close();
    if (!location || i === REDIRECTS) throw new Error("source_url redirected too many times");
    checkedUrl = await checked(new URL(location, checkedUrl.url).toString());
  }
  try {
    if (!response?.ok || !response.body) throw new Error(`Unable to read source_url (${response?.status ?? 0})`);
    const limit = kind === "video" ? VIDEO_LIMIT : IMAGE_LIMIT;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new Error("source_url file is too large");
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
    while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > limit) { await reader.cancel(); throw new Error("source_url file is too large"); } chunks.push(Buffer.from(part.value)); }
    const mime = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    const fallback = kind === "video" ? "video/mp4" : "image/jpeg";
    return { bytes: Buffer.concat(chunks), mime: mime || fallback, filename: kind === "video" ? "asset.mp4" : "asset.jpg" };
  } finally { close(); }
}

export const mcpDownloadInternals = { isPublicAddress };
