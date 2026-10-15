"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Key, Plus, Trash } from "@phosphor-icons/react";
import { LoginModal } from "@/components/auth/LoginModal";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";

type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default function AccountPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauth" | "error">("loading");
  const [loginOpen, setLoginOpen] = useState(false);
  const [name, setName] = useState("WorkBuddy");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/account/api-keys", { cache: "no-store" });
      if (response.status === 401) { setState("unauth"); return; }
      if (!response.ok) throw new Error("load failed");
      const data = await response.json();
      setKeys(Array.isArray(data.keys) ? data.keys : []); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createKey() {
    setBusy(true); setSecret(""); setMessage("");
    try {
      const response = await fetch("/api/account/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "create_failed");
      setSecret(data.key); setMessage(zh ? "密钥已生成，请立即复制并粘贴到 WorkBuddy 的 Expert 密钥配置。" : "Key created. Copy it now and bind it to the Expert secret."); await load();
    } catch (error) { setMessage(error instanceof Error && error.message === "key_limit_reached" ? (zh ? "有效密钥已达到 10 个上限。" : "You have reached the limit of 10 active keys.") : (zh ? "生成失败，请稍后重试。" : "Could not create the key. Retry shortly.")); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (!window.confirm(zh ? "撤销后，使用这枚密钥的 Expert 会立即停止调用。继续？" : "Revoke this key? The connected Expert will stop working immediately.")) return;
    await fetch(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }); await load();
  }
  async function copySecret() { if (secret) { await navigator.clipboard?.writeText(secret); setMessage(zh ? "已复制。" : "Copied."); } }

  return <div className="flex min-h-screen flex-col bg-[var(--color-bg)]"><SiteHeader active="account" /><main className="page-container flex-1 py-10 md:py-16">
    <section className="mx-auto max-w-3xl"><span className="section-kicker">{zh ? "API 接入" : "API ACCESS"}</span><h1 className="page-heading mt-3">{zh ? "连接你的 WorkBuddy Expert" : "Connect your WorkBuddy Expert"}</h1><p className="page-description mt-3">{zh ? "每个账号拥有独立额度和密钥。Expert 使用这里生成的密钥调用创境 API；供应商凭据和任务记录由网站服务端管理。" : "Each account has its own credits and keys. The Expert uses a key from this page while provider credentials and task records stay on the platform server."}</p>
      {state === "loading" && <div className="surface mt-8 p-7">{zh ? "正在加载…" : "Loading…"}</div>}
      {state === "unauth" && <div className="surface mt-8 p-7 text-center"><Key size={34} className="mx-auto text-[var(--color-accent)]" /><p className="mt-4 text-[var(--color-muted)]">{zh ? "登录后生成和管理 API 密钥。" : "Sign in to create and manage API keys."}</p><button className="btn btn-primary mt-5" type="button" onClick={() => setLoginOpen(true)}>{zh ? "登录 / 注册" : "Sign in / Register"}</button></div>}
      {state === "error" && <div className="surface mt-8 p-7">{zh ? "暂时无法加载，请重试。" : "Could not load your keys. Retry shortly."}<button type="button" className="btn btn-outline ml-3" onClick={() => void load()}>{zh ? "重试" : "Retry"}</button></div>}
      {state === "ready" && <>
        <div className="surface mt-8 p-7"><h2 className="text-lg font-semibold">{zh ? "生成新密钥" : "Create a key"}</h2><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className="input flex-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label={zh ? "密钥名称" : "Key name"} /><button className="btn btn-primary" type="button" onClick={() => void createKey()} disabled={busy}><Plus size={18} />{busy ? "…" : (zh ? "生成 API 密钥" : "Create API key")}</button></div>{secret && <div className="mt-5 rounded-xl border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-4"><p className="text-sm font-semibold">{zh ? "只显示这一次" : "Shown once"}</p><code className="mt-2 block break-all text-xs text-[var(--color-success)]">{secret}</code><button type="button" className="btn btn-outline mt-3 !min-h-0 !py-2" onClick={() => void copySecret()}><Copy size={16} />{zh ? "复制密钥" : "Copy key"}</button></div>}{message && <p className="mt-3 text-sm text-[var(--color-muted)]">{message}</p>}</div>
        <div className="mt-6 space-y-3">{keys.length === 0 && <div className="surface p-7 text-sm text-[var(--color-muted)]">{zh ? "还没有 API 密钥。" : "No API keys yet."}</div>}{keys.map((key) => <div className="surface flex flex-wrap items-center justify-between gap-4 p-5" key={key.id}><div><p className="font-semibold">{key.name}</p><code className="text-xs text-[var(--color-muted)]">{key.prefix}••••••••</code><p className="mt-1 text-xs text-[var(--color-muted)]">{zh ? "创建于" : "Created"} {new Date(key.created_at).toLocaleString(zh ? "zh-CN" : "en-US")}{key.last_used_at ? ` · ${zh ? "最近使用" : "Last used"} ${new Date(key.last_used_at).toLocaleString(zh ? "zh-CN" : "en-US")}` : ""}</p></div><button type="button" className="btn btn-outline !min-h-0 !py-2 !text-[var(--color-danger)]" onClick={() => void revoke(key.id)}><Trash size={16} />{zh ? "撤销" : "Revoke"}</button></div>)}</div>
      </>}
    </section></main><SiteFooter /><LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSignedIn={() => { setLoginOpen(false); void load(); }} /></div>;
}
