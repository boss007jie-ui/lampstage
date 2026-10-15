"use client";

/**
 * 管理后台 /admin
 * 4 个 tab：总览 / 用户（加额度）/ 任务 / 留资。
 * 非管理员访问任意 API 都会 403 → 页面提示无权限。
 */
import { useEffect, useState, useCallback, useRef } from "react";

type Overview = {
  users: number;
  jobs: { total: number; completed: number; failed: number };
  leads: number;
  credits_granted: number;
  credits_consumed: number;
};
type AdminUser = {
  id: string;
  email: string | null;
  credit_balance: number;
  role: string;
  created_at: string;
  job_count: number;
};
type AdminJob = {
  id: string;
  status: string;
  scene_kind: string | null;
  failure_reason: string | null;
  credit_cost: number;
  created_at: string;
  email: string | null;
  output_count: number;
};
type Lead = {
  id: string;
  source: string;
  wechat: string | null;
  phone: string | null;
  note: string | null;
  created_at: string;
  email: string | null;
};

type ToolLog = {
  id: string;
  tool: string;
  model: string | null;
  job_id: string | null;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  result_json?: string | null;
};
type ToolSummary = Record<
  string,
  { total: number; ok: number; failed: number; avgMs: number }
>;

type SceneSeedStats = {
  total: number;
  qualified: number;
  generated: number;
  by_scene: Array<{ scene_type: string; _count: { id: number } }>;
  by_group: Array<{
    scene_type: string;
    target_audience: string;
    time_of_day: string;
    _count: { id: number };
    _sum: { usage_count: number | null };
  }>;
};

type Tab = "overview" | "users" | "jobs" | "leads" | "logs" | "scenes";
type LoadState = "loading" | "ready" | "error";

const fmt = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });
function LoadNotice({ state, retry }: { state: LoadState; retry: () => void }) {
  if (state === "ready") return null;
  return <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]" role={state === "error" ? "alert" : "status"}>
    {state === "loading" ? "加载中…" : <>加载失败，请检查网络后重试。<button type="button" onClick={retry} className="ml-3 rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 font-medium text-[var(--color-accent)] hover:bg-[var(--color-hover)]">重试</button></>}
  </div>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [forbidden, setForbidden] = useState(false);
  const onForbidden = useCallback(() => setForbidden(true), []);

  return (
    <main className="page-container min-h-screen py-8 text-[var(--color-text)] md:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Lampstage 管理后台
        </h1>
        <a href="/" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
          ← 返回首页
        </a>
      </div>

      {forbidden ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-[15px] font-medium text-[var(--color-text)]">无权限访问</p>
          <p className="mt-2 text-[13px] text-[var(--color-muted)]">请使用有管理员权限的账号登录。</p>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="管理后台栏目" className="mb-6 flex max-w-full gap-1 overflow-x-auto border-b border-[var(--color-border)]">
            {(
              [
                ["overview", "总览"],
                ["users", "用户"],
                ["jobs", "任务"],
                ["leads", "留资"],
                ["logs", "调用日志"],
                ["scenes", "Scenes"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-[14px] font-medium transition-colors ${
                  tab === k
                    ? "border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab onForbidden={onForbidden} />}
          {tab === "users" && <UsersTab onForbidden={onForbidden} />}
          {tab === "jobs" && <JobsTab onForbidden={onForbidden} />}
          {tab === "leads" && <LeadsTab onForbidden={onForbidden} />}
          {tab === "logs" && <LogsTab onForbidden={onForbidden} />}
          {tab === "scenes" && <ScenesTab onForbidden={onForbidden} />}
        </>
      )}
    </main>
  );
}

function OverviewTab({ onForbidden }: { onForbidden: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await fetch("/api/admin/overview", { cache: "no-store" });
      if (r.status === 403) { onForbidden(); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (typeof d.users !== "number" || !d.jobs) throw new Error("Invalid response");
      setData(d);
      setState("ready");
    } catch { setState("error"); }
  }, [onForbidden]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state !== "ready" || !data) return <LoadNotice state={state} retry={() => void load()} />;
  const cards = [
    ["注册用户", data.users],
    ["生成任务", data.jobs.total],
    ["成功", data.jobs.completed],
    ["失败", data.jobs.failed],
    ["留资数", data.leads],
    ["累计发放额度", data.credits_granted],
    ["累计消耗额度", data.credits_consumed],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map(([label, val]) => (
        <div
          key={label}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
        >
          <div className="text-[12px] text-[var(--color-muted)]">{label}</div>
          <div className="mt-1 text-[28px] font-semibold tracking-tight">
            {val}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersTab({ onForbidden }: { onForbidden: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const requestNo = useRef(0);

  const load = useCallback(
    async (query: string) => {
      const current = ++requestNo.current;
      setState("loading");
      try {
        const r = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (r.status === 403) { onForbidden(); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!Array.isArray(d.users)) throw new Error("Invalid response");
        if (current !== requestNo.current) return;
        setUsers(d.users);
        setState("ready");
      } catch { if (current === requestNo.current) setState("error"); }
    },
    [onForbidden],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const adjust = async (userId: string, amount: number) => {
    const note = window.prompt(
      `给该用户${amount > 0 ? "增加" : "扣减"} ${Math.abs(amount)} 次额度，备注：`,
      amount > 0 ? "付费充值" : "手动扣减",
    );
    if (note === null) return;
    setBusy(userId);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, amount, note }),
      });
      if (r.ok) void load(q);
      else {
        if (r.status === 403) onForbidden();
        const d = await r.json().catch(() => ({}));
        alert("操作失败：" + (d.error || r.status));
      }
    } catch { alert("操作失败：网络错误"); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load(q)}
          placeholder="按邮箱搜索…"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--color-accent)] sm:max-w-64"
        />
        <button
          onClick={() => void load(q)}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-[14px] font-medium text-[var(--color-on-accent)]"
        >
          搜索
        </button>
      </div>
      {state !== "ready" && <div className="mb-4"><LoadNotice state={state} retry={() => void load(q)} /></div>}
      {state === "ready" && (
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="min-w-[760px] w-full text-[13px]">
          <thead className="bg-[var(--color-raised)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3">邮箱</th>
              <th className="px-4 py-3">额度</th>
              <th className="px-4 py-3">任务数</th>
              <th className="px-4 py-3">注册时间</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3">{u.email || "—"}</td>
                <td className="px-4 py-3 font-semibold">{u.credit_balance}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{u.job_count}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{fmt(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    {[10, 50, 100].map((n) => (
                      <button
                        key={n}
                        disabled={busy === u.id}
                        onClick={() => adjust(u.id, n)}
                        className="rounded bg-[var(--color-raised)] px-2 py-1 text-[12px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-50"
                      >
                        +{n}
                      </button>
                    ))}
                    <button
                      disabled={busy === u.id}
                      onClick={() => adjust(u.id, -10)}
                      className="rounded bg-[var(--color-danger-bg)] px-2 py-1 text-[12px] font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] disabled:opacity-50"
                    >
                      −10
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  无用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>)}
    </div>
  );
}

function JobsTab({ onForbidden }: { onForbidden: () => void }) {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [filter, setFilter] = useState("all");
  const [state, setState] = useState<LoadState>("loading");
  const requestNo = useRef(0);
  const load = useCallback(async () => {
    const current = ++requestNo.current;
    setState("loading");
    try {
      const r = await fetch(`/api/admin/jobs?status=${filter}`, { cache: "no-store" });
      if (r.status === 403) { onForbidden(); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d.jobs)) throw new Error("Invalid response");
      if (current !== requestNo.current) return;
      setJobs(d.jobs);
      setState("ready");
    } catch { if (current === requestNo.current) setState("error"); }
  }, [filter, onForbidden]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["all", "全部"],
          ["completed", "成功"],
          ["failed", "失败"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              filter === k
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                : "bg-[var(--color-raised)] text-[var(--color-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {state !== "ready" && <div className="mb-4"><LoadNotice state={state} retry={() => void load()} /></div>}
      {state === "ready" && <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="min-w-[800px] w-full text-[13px]">
          <thead className="bg-[var(--color-raised)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">出图</th>
              <th className="px-4 py-3">失败原因</th>
              <th className="px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3">{j.email || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[12px] ${
                      j.status === "completed"
                        ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
                        : j.status === "failed"
                          ? "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
                          : "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{j.scene_kind || "—"}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{j.output_count}</td>
                <td className="px-4 py-3 text-[var(--color-danger)]">
                  {j.failure_reason || "—"}
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{fmt(j.created_at)}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  无任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

function LeadsTab({ onForbidden }: { onForbidden: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await fetch("/api/admin/leads", { cache: "no-store" });
      if (r.status === 403) { onForbidden(); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d.leads)) throw new Error("Invalid response");
      setLeads(d.leads);
      setState("ready");
    } catch { setState("error"); }
  }, [onForbidden]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state !== "ready") return <LoadNotice state={state} retry={() => void load()} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="min-w-[800px] w-full text-[13px]">
        <thead className="bg-[var(--color-raised)] text-left text-[var(--color-muted)]">
          <tr>
            <th className="px-4 py-3">邮箱</th>
            <th className="px-4 py-3">微信</th>
            <th className="px-4 py-3">电话</th>
            <th className="px-4 py-3">来源</th>
            <th className="px-4 py-3">备注</th>
            <th className="px-4 py-3">时间</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="border-t border-[var(--color-border)]">
              <td className="px-4 py-3">{l.email || "—"}</td>
              <td className="px-4 py-3">{l.wechat || "—"}</td>
              <td className="px-4 py-3">{l.phone || "—"}</td>
              <td className="px-4 py-3 text-[var(--color-muted)]">{l.source}</td>
              <td className="px-4 py-3 text-[var(--color-muted)]">{l.note || "—"}</td>
              <td className="px-4 py-3 text-[var(--color-muted)]">{fmt(l.created_at)}</td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">
                暂无留资
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}


function ScenesTab({ onForbidden }: { onForbidden: () => void }) {
  const [data, setData] = useState<SceneSeedStats | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await fetch("/api/scenes/seed", { cache: "no-store" });
      if (r.status === 403) { onForbidden(); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d.by_scene) || !Array.isArray(d.by_group)) throw new Error("Invalid response");
      setData(d);
      setState("ready");
    } catch { setState("error"); }
  }, [onForbidden]);

  useEffect(() => {
    void load();
  }, [load]);

  const runWeekly = async () => {
    setRunning(true);
    setResult("");
    try {
      const r = await fetch("/api/cron/weekly-scenes", { method: "POST" });
      if (r.status === 403) onForbidden();
      const d = await r.json().catch(() => ({}));
      setResult(JSON.stringify(r.ok ? d : { error: "运行失败", status: r.status, ...d }, null, 2));
      if (r.ok) void load();
    } catch { setResult("运行失败：网络错误"); }
    finally { setRunning(false); }
  };

  if (state !== "ready" || !data) return <LoadNotice state={state} retry={() => void load()} />;
  const cards = [
    ["Total seeds", data.total],
    ["Qualified", data.qualified],
    ["Generated", data.generated],
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="text-[12px] text-[var(--color-muted)]">{label}</div>
              <div className="mt-1 text-[24px] font-semibold tracking-tight">{value}</div>
            </div>
          ))}
        </div>
        <button
          onClick={runWeekly}
          disabled={running}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-[var(--color-on-accent)] disabled:opacity-50"
        >
          {running ? "Running..." : "Run weekly generation"}
        </button>
      </div>

      {result && (
        <pre className="mb-4 max-h-64 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-raised)] p-3 text-[11px] text-[var(--color-body)]">
          {result}
        </pre>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.by_scene.map((row) => (
          <div key={row.scene_type} className="rounded-xl border border-[var(--color-border)] p-4">
            <div className="text-[12px] text-[var(--color-muted)]">{row.scene_type}</div>
            <div className="mt-1 text-[20px] font-semibold tracking-tight">{row._count.id}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="min-w-[680px] w-full text-[13px]">
          <thead className="bg-[var(--color-raised)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3">Scene</th>
              <th className="px-4 py-3">Audience</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Qualified</th>
              <th className="px-4 py-3">Usage</th>
            </tr>
          </thead>
          <tbody>
            {data.by_group.map((row) => (
              <tr key={row.scene_type + "-" + row.target_audience + "-" + row.time_of_day} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3">{row.scene_type}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{row.target_audience}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{row.time_of_day}</td>
                <td className="px-4 py-3 font-semibold">{row._count.id}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{row._sum.usage_count ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  lamp_profile: "识图（产品卡）",
  prompt_planner: "提示词规划",
  "nano-banana": "生图（gemini）",
  "gpt-image-2": "生图（gpt-image）",
};

function LogsTab({ onForbidden }: { onForbidden: () => void }) {
  const [logs, setLogs] = useState<ToolLog[]>([]);
  const [summary, setSummary] = useState<ToolSummary>({});
  const [tool, setTool] = useState("all");
  const [status, setStatus] = useState("all");
  const [state, setState] = useState<LoadState>("loading");
  const requestNo = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestNo.current;
    setState("loading");
    try {
      const r = await fetch(`/api/admin/tool-logs?tool=${tool}&status=${status}`, { cache: "no-store" });
      if (r.status === 403) { onForbidden(); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d.logs) || !d.summary24h) throw new Error("Invalid response");
      if (current !== requestNo.current) return;
      setLogs(d.logs);
      setSummary(d.summary24h);
      setState("ready");
    } catch { if (current === requestNo.current) setState("error"); }
  }, [tool, status, onForbidden]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      {state !== "ready" && <div className="mb-4"><LoadNotice state={state} retry={() => void load()} /></div>}
      {/* 最近 24h 健康度汇总 */}
      {state === "ready" && <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(summary).map(([t, st]) => {
          const rate = st.total ? Math.round((st.ok / st.total) * 100) : 0;
          return (
            <div key={t} className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="text-[12px] text-[var(--color-muted)]">
                {TOOL_LABELS[t] || t}
              </div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight">
                {rate}%
                <span className="ml-1 text-[12px] font-normal text-[var(--color-muted)]">
                  成功
                </span>
              </div>
              <div className="mt-1 text-[12px] text-[var(--color-muted)]">
                {st.total} 次 · 失败 {st.failed} · 均 {st.avgMs}ms
              </div>
            </div>
          );
        })}
        {Object.keys(summary).length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-[13px] text-[var(--color-muted)]">
            最近 24 小时暂无调用记录
          </div>
        )}
      </div>

      {/* 筛选 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["all", "全部工具"],
          ["lamp_profile", "识图"],
          ["prompt_planner", "规划"],
          ["nano-banana", "生图gemini"],
          ["gpt-image-2", "生图gpt"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTool(k)}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              tool === k ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "bg-[var(--color-raised)] text-[var(--color-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 w-px bg-[var(--color-border)]" />
        {[
          ["all", "全部状态"],
          ["ok", "成功"],
          ["failed", "失败"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={`rounded-md px-3 py-1.5 text-[13px] ${
              status === k
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                : "bg-[var(--color-raised)] text-[var(--color-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="min-w-[1050px] w-full text-[13px]">
          <thead className="bg-[var(--color-raised)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-3">工具</th>
              <th className="px-4 py-3">模型</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">HTTP</th>
              <th className="px-4 py-3">耗时</th>
              <th className="px-4 py-3">错误</th>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">提示词</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3">{TOOL_LABELS[l.tool] || l.tool}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{l.model || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[12px] ${
                      l.status === "ok"
                        ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
                        : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
                    }`}
                  >
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{l.http_status ?? "—"}</td>
                <td className="px-4 py-3 text-[var(--color-muted)]">
                  {l.duration_ms != null ? `${l.duration_ms}ms` : "—"}
                </td>
                <td
                  className="max-w-[280px] truncate px-4 py-3 text-[var(--color-danger)]"
                  title={l.error || ""}
                >
                  {l.error || "—"}
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{fmt(l.created_at)}</td>
                <td className="px-4 py-3">
                  {l.tool === "prompt_planner" &&
                  l.status === "ok" &&
                  l.result_json ? (
                    <PlannerResultCell json={l.result_json} />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  无调用记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div></>}
    </div>
  );
}

function PlannerResultCell({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  let plan: { reasoning?: string; shots?: Array<{ scene_type?: string; time_of_day?: string; light_state?: string; prompt?: string }> } | null = null;
  try {
    plan = JSON.parse(json);
  } catch {
    plan = null;
  }

  if (!plan) {
    return <span className="text-[var(--color-muted)]">(解析失败)</span>;
  }

  return (
    <div className="max-w-[360px]">
      <span className="text-[12px] text-[var(--color-muted)]">
        {plan.reasoning?.slice(0, 80) || "—"}
      </span>
      <button
        onClick={() => setOpen(!open)}
        className="ml-2 text-[11px] text-[var(--color-accent)] hover:underline"
      >
        {open ? "收起 ↑" : "展开 ↓"}
      </button>
      {open && (
        <div className="mt-2 max-h-[360px] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-raised)] p-3 text-[11px] leading-relaxed">
          {plan.shots?.map((shot, i) => (
            <div key={i} className="mb-3 border-b border-[var(--color-border)] pb-3 last:mb-0 last:border-b-0 last:pb-0">
              <div className="font-semibold text-[var(--color-text)]">
                Shot {i + 1}: {shot.scene_type} · {shot.time_of_day} · {shot.light_state}
              </div>
              <div className="mt-1 whitespace-pre-wrap font-mono text-[var(--color-body)]">
                {shot.prompt}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
