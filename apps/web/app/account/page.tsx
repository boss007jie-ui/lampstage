"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Key, Plus, Trash } from "@phosphor-icons/react";
import { LoginModal } from "@/components/auth/LoginModal";
import { notifySessionExpired, SESSION_CHANGE_EVENT, SESSION_LOGOUT_STORAGE_KEY } from "@/components/auth/session-events";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";
import { Dialog } from "@/components/ui/Dialog";
import { VideoJobManager } from "@/components/account/VideoJobManager";
import { VideoTemplateManager } from "@/components/account/VideoTemplateManager";
import { CharacterLibraryManager } from "@/components/account/CharacterLibraryManager";
import { AccountBilling } from "@/components/account/AccountBilling";

type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default function AccountPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauth" | "error">("loading");
  const [loginOpen, setLoginOpen] = useState(false);
  const [name, setName] = useState("WorkBuddy");
  const [newKey, setNewKey] = useState<{ id: string; secret: string } | null>(null);
  const [pending, setPending] = useState<"create" | "revoke" | "copy" | null>(null);
  const pendingRef = useRef(false);
  const sessionEpoch = useRef(0);
  const [jobsBusy, setJobsBusy] = useState(false);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [charactersBusy, setCharactersBusy] = useState(false);
  const [characterRefresh, setCharacterRefresh] = useState(0);
  const [templateRefresh, setTemplateRefresh] = useState(0);
  const accountBusy = jobsBusy || templatesBusy || charactersBusy;
  const templateSaved = useCallback(() => setTemplateRefresh(value => value + 1), []);
  const characterSaved = useCallback(() => setCharacterRefresh(value => value + 1), []);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const keysHeading = useRef<HTMLHeadingElement>(null);
  const activeKeys = keys.filter(key => !key.revoked_at);

  const resetPrivateState = useCallback(() => {
    sessionEpoch.current++; pendingRef.current = false; setPending(null);
    setKeys([]); setNewKey(null); setKeyToRevoke(null); setRevokeError(""); setNotice(null); setState("unauth");
  }, []);
  const clearSession = useCallback(() => {
    resetPrivateState();
    notifySessionExpired();
  }, [resetPrivateState]);
  useEffect(() => {
    const onSessionChange = (event: Event) => {
      if ((event as CustomEvent).detail === "expired") resetPrivateState();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_LOGOUT_STORAGE_KEY && event.newValue) resetPrivateState();
    };
    window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [resetPrivateState]);
  const jobSessionExpired = useCallback(() => {
    clearSession();
    setNotice({ text: lang === "zh" ? "登录已过期，请重新登录。" : "Your session expired. Please sign in again.", error: true });
  }, [clearSession, lang]);

  const load = useCallback(async () => {
    const epoch = sessionEpoch.current;
    setState("loading");
    try {
      const response = await fetch("/api/account/api-keys", { cache: "no-store" });
      if (epoch !== sessionEpoch.current) return;
      if (response.status === 401) { clearSession(); return; }
      if (!response.ok) throw new Error("load failed");
      const data = await response.json();
      if (epoch !== sessionEpoch.current) return;
      const loadedKeys: ApiKey[] = Array.isArray(data.keys) ? data.keys : [];
      setKeys(loadedKeys);
      setNewKey(current => current && loadedKeys.some(key => key.id === current.id && key.revoked_at) ? null : current);
      setState("ready");
    } catch { if (epoch === sessionEpoch.current) setState("error"); }
  }, [clearSession]);
  useEffect(() => { void load(); }, [load]);

  async function createKey() {
    if (pendingRef.current || accountBusy) return;
    const epoch = sessionEpoch.current;
    pendingRef.current = true; setPending("create"); setNewKey(null); setNotice(null);
    try {
      const response = await fetch("/api/account/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (epoch !== sessionEpoch.current) return;
      if (response.status === 401) {
        clearSession();
        setNotice({ text: zh ? "登录已过期，请重新登录。" : "Your session expired. Please sign in again.", error: true });
        return;
      }
      const data = await response.json();
      if (epoch !== sessionEpoch.current) return;
      if (!response.ok) throw new Error(data.error || "create_failed");
      if (typeof data.key !== "string" || typeof data.credential?.id !== "string") throw new Error("create_failed");
      setNewKey({ id: data.credential.id, secret: data.key });
      setKeys(current => [data.credential as ApiKey, ...current.filter(key => key.id !== data.credential.id)]);
      setState("ready");
      setNotice({ text: zh ? "密钥已生成，请由你复制到 WorkBuddy 支持的凭据或 secrets 配置字段，勿粘贴到聊天。" : "Key created. Copy it into WorkBuddy's supported credential or secrets field, never into chat.", error: false });
    } catch (error) {
      if (epoch !== sessionEpoch.current) return;
      setNotice({ text: error instanceof Error && error.message === "key_limit_reached" ? (zh ? "有效密钥已达到 10 个上限。" : "You have reached the limit of 10 active keys.") : (zh ? "生成失败，请稍后重试。" : "Could not create the key. Retry shortly."), error: true });
    } finally { if (epoch === sessionEpoch.current) { pendingRef.current = false; setPending(null); } }
  }

  function closeRevoke() {
    if (pendingRef.current) return;
    setKeyToRevoke(null); setRevokeError("");
  }

  async function revoke() {
    if (!keyToRevoke || pendingRef.current || accountBusy) return;
    const epoch = sessionEpoch.current;
    const id = keyToRevoke.id;
    pendingRef.current = true; setPending("revoke"); setRevokeError(""); setNotice(null);
    try {
      const response = await fetch(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (epoch !== sessionEpoch.current) return;
      if (response.status === 401) {
        clearSession();
        setNotice({ text: zh ? "登录已过期，请重新登录后再撤销密钥。" : "Your session expired. Sign in again to revoke the key.", error: true });
        return;
      }
      if (!response.ok) {
        setRevokeError(response.status === 404
          ? (zh ? "未找到该密钥，请刷新页面后重试。" : "This key could not be found. Refresh the page and try again.")
          : (zh ? "撤销失败，请稍后重试。" : "Could not revoke the key. Please try again."));
        return;
      }
      setKeys(current => current.filter(key => key.id !== id));
      setNewKey(current => current?.id === id ? null : current);
      setKeyToRevoke(null);
      setNotice({ text: zh ? "密钥已撤销。" : "Key revoked.", error: false });
      requestAnimationFrame(() => keysHeading.current?.focus());
    } catch {
      if (epoch !== sessionEpoch.current) return;
      setRevokeError(zh ? "网络连接异常，无法确认撤销结果。请重试或刷新页面核对。" : "A network error prevented confirmation. Retry or refresh the page to check the key.");
    } finally { if (epoch === sessionEpoch.current) { pendingRef.current = false; setPending(null); } }
  }

  async function copySecret() {
    if (!newKey || pendingRef.current || accountBusy) return;
    const epoch = sessionEpoch.current;
    pendingRef.current = true; setPending("copy"); setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(newKey.secret);
      if (epoch !== sessionEpoch.current) return;
      setNotice({ text: zh ? "已复制。" : "Copied.", error: false });
    } catch {
      if (epoch !== sessionEpoch.current) return;
      setNotice({ text: zh ? "复制失败，请手动选择页面中的密钥，复制到凭据配置字段，勿粘贴到聊天。" : "Copy failed. Select the displayed key manually and copy it into the credential settings, never into chat.", error: true });
    } finally { if (epoch === sessionEpoch.current) { pendingRef.current = false; setPending(null); } }
  }

  return <div className="flex min-h-screen flex-col bg-[var(--color-bg)]"><SiteHeader active="account" /><main className="page-container flex-1 py-10 md:py-16">
    <section className="mx-auto max-w-3xl"><span className="section-kicker">{zh ? "账户中心" : "YOUR ACCOUNT"}</span><h1 className="page-heading mt-3">{zh ? "余额、任务与 API 密钥" : "Balance, tasks & API keys"}</h1><p className="page-description mt-3">{zh ? "管理云端视频任务，连接你的 WorkBuddy Expert。每个账号拥有独立额度和密钥。" : "Manage your cloud video tasks and connect your WorkBuddy Expert. Each account has its own capacity and keys."}</p>
      {state === "ready" && <><nav aria-label={zh ? "账户区域" : "Account sections"} className="mt-5 flex flex-wrap gap-4 text-sm"><a className="underline underline-offset-4" href="#billing">{zh ? "余额与充值" : "Balance & recharge"}</a><a className="underline underline-offset-4" href="#video-jobs">{zh ? "视频任务" : "Video tasks"}</a><a className="underline underline-offset-4" href="#characters">{zh ? "人物库" : "Characters"}</a><a className="underline underline-offset-4" href="#video-templates">{zh ? "私人模板" : "Private templates"}</a><a className="underline underline-offset-4" href="#api-keys">{zh ? "API 密钥" : "API keys"}</a></nav><AccountBilling onSessionExpired={jobSessionExpired} /><VideoJobManager onSessionExpired={jobSessionExpired} disabled={pending !== null || keyToRevoke !== null || templatesBusy || charactersBusy} onBusyChange={setJobsBusy} onTemplateSaved={templateSaved} onCharacterSaved={characterSaved} /><CharacterLibraryManager onSessionExpired={jobSessionExpired} disabled={pending !== null || keyToRevoke !== null || jobsBusy || templatesBusy} onBusyChange={setCharactersBusy} refreshKey={characterRefresh} /><VideoTemplateManager onSessionExpired={jobSessionExpired} disabled={pending !== null || keyToRevoke !== null || jobsBusy || charactersBusy} onBusyChange={setTemplatesBusy} refreshKey={templateRefresh} /></>}
      <h2 id="api-keys" className="mt-8 text-xl font-semibold">{zh ? "API 密钥" : "API keys"}</h2>
      {notice && <p role={notice.error ? "alert" : "status"} className={`mt-4 text-sm ${notice.error ? "text-[var(--color-danger)]" : "text-[var(--color-body)]"}`}>{notice.text}</p>}
      {state === "loading" && <div className="surface mt-8 p-7">{zh ? "正在加载…" : "Loading…"}</div>}
      {state === "unauth" && <div className="surface mt-8 p-7 text-center"><Key size={34} className="mx-auto text-[var(--color-accent)]" /><p className="mt-4 text-[var(--color-muted)]">{zh ? "登录后查看视频任务，生成和管理 API 密钥。" : "Sign in to view video tasks and manage API keys."}</p><button className="btn btn-primary mt-5" type="button" onClick={() => setLoginOpen(true)}>{zh ? "登录 / 注册" : "Sign in / Register"}</button></div>}
      {state === "error" && <div className="surface mt-8 p-7">{zh ? "暂时无法加载，请重试。" : "Could not load your keys. Retry shortly."}<button type="button" className="btn btn-outline ml-3" onClick={() => void load()}>{zh ? "重试" : "Retry"}</button></div>}
      {state === "ready" && <>
        <div className="surface mt-8 p-7"><h2 className="text-lg font-semibold">{zh ? "生成新密钥" : "Create a key"}</h2><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className="input min-w-0 flex-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label={zh ? "密钥名称" : "Key name"} /><button className="btn btn-primary" type="button" onClick={() => void createKey()} disabled={pending !== null || accountBusy}><Plus size={18} />{pending === "create" ? "…" : (zh ? "生成 API 密钥" : "Create API key")}</button></div>{newKey && <div className="mt-5 rounded-xl border border-[var(--color-success-border)] bg-[var(--color-success-bg)] p-4"><p className="text-sm font-semibold">{zh ? "只显示这一次" : "Shown once"}</p><code className="mt-2 block break-all text-xs text-[var(--color-success)]">{newKey.secret}</code><button type="button" className="btn btn-outline mt-3 !min-h-0 !py-2" onClick={() => void copySecret()} disabled={pending !== null || accountBusy}><Copy size={16} />{zh ? "复制密钥" : "Copy key"}</button></div>}</div>
        <div className="mt-6 space-y-3">
          <h2 ref={keysHeading} tabIndex={-1} className="text-lg font-semibold">{zh ? "有效密钥" : "Active keys"} ({activeKeys.length})</h2>
          <p className="text-sm text-[var(--color-muted)]">{zh ? "已撤销的密钥不再显示，也不能继续用于调用。" : "Revoked keys are hidden from this list and can no longer be used for API calls."}</p>
          {activeKeys.length === 0 && <div className="surface p-7 text-sm text-[var(--color-muted)]">{zh ? "暂无有效 API 密钥。" : "No active API keys."}</div>}
          {activeKeys.map(key => <div className="surface flex flex-wrap items-center justify-between gap-4 p-5" key={key.id}><div className="min-w-0"><p className="break-words font-semibold">{key.name}</p><code className="break-all text-xs text-[var(--color-muted)]">{key.prefix}••••••••</code><p className="mt-1 text-xs text-[var(--color-muted)]">{zh ? "创建于" : "Created"} {new Date(key.created_at).toLocaleString(zh ? "zh-CN" : "en-US")}{key.last_used_at ? ` · ${zh ? "最近使用" : "Last used"} ${new Date(key.last_used_at).toLocaleString(zh ? "zh-CN" : "en-US")}` : ""}</p></div><button type="button" className="btn btn-outline !min-h-0 !py-2 !text-[var(--color-danger)]" disabled={pending !== null || accountBusy} onClick={() => { if (!pendingRef.current && !accountBusy) { setKeyToRevoke(key); setRevokeError(""); } }}><Trash size={16} />{zh ? "撤销" : "Revoke"}</button></div>)}
        </div>
      </>}
    </section></main><SiteFooter /><LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSignedIn={() => { setLoginOpen(false); setNotice(null); void load(); }} />
    <Dialog open={keyToRevoke !== null} onClose={closeRevoke} titleId="revoke-key-title">
      <h2 id="revoke-key-title" className="text-xl font-semibold">{zh ? "撤销 API 密钥？" : "Revoke API key?"}</h2>
      <p className="mt-4 break-words font-semibold">{keyToRevoke?.name}</p>
      <p className="mt-3 text-sm text-[var(--color-muted)]">{zh ? "撤销后，使用此密钥的应用将无法继续调用 API。此操作无法恢复，之后可生成新密钥。" : "Applications using this key will lose API access. This cannot be undone; you can create a new key later."}</p>
      {revokeError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{revokeError}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" className="btn btn-outline" onClick={closeRevoke} disabled={pending !== null || accountBusy}>{zh ? "保留密钥" : "Keep key"}</button>
        <button type="button" className="btn btn-outline !border-[var(--color-danger-border)] !text-[var(--color-danger)]" onClick={() => void revoke()} disabled={pending !== null || accountBusy} aria-busy={pending === "revoke"}>{pending === "revoke" ? (zh ? "撤销中…" : "Revoking…") : (zh ? "确认撤销" : "Revoke key")}</button>
      </div>
    </Dialog></div>;
}
