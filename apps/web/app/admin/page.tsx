"use client";

/**
 * 管理后台 /admin
 * 4 个 tab：总览 / 用户（加额度）/ 任务 / 留资。
 * 非管理员访问任意 API 都会 403 → 页面提示无权限。
 */
import { useEffect, useState, useCallback } from "react";

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

type Tab = "overview" | "users" | "jobs" | "leads" | "logs";

const fmt = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [forbidden, setForbidden] = useState(false);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Lampstage 管理后台
        </h1>
        <a href="/" className="text-[13px] text-[#533afd] hover:underline">
          ← 返回首页
        </a>
      </div>

      {forbidden ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-8 text-center">
          <p className="text-[15px] font-medium text-red-700">无权限访问</p>
          <p className="mt-2 text-[13px] text-red-500">
            当前账号不是管理员。请用管理员邮箱登录（在 Vercel 环境变量
            ADMIN_EMAILS 中配置）。
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 flex gap-1 border-b border-[#eee]">
            {(
              [
                ["overview", "总览"],
                ["users", "用户"],
                ["jobs", "任务"],
                ["leads", "留资"],
                ["logs", "调用日志"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-4 py-2.5 text-[14px] font-medium transition-colors ${
                  tab === k
                    ? "border-b-2 border-[#533afd] text-[#533afd]"
                    : "text-[#888] hover:text-[#171717]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab onForbidden={() => setForbidden(true)} />}
          {tab === "users" && <UsersTab onForbidden={() => setForbidden(true)} />}
          {tab === "jobs" && <JobsTab onForbidden={() => setForbidden(true)} />}
          {tab === "leads" && <LeadsTab onForbidden={() => setForbidden(true)} />}
          {tab === "logs" && <LogsTab onForbidden={() => setForbidden(true)} />}
        </>
      )}
    </main>
  );
}

function OverviewTab({ onForbidden }: { onForbidden: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => {
        if (r.status === 403) {
          onForbidden();
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => undefined);
  }, [onForbidden]);

  if (!data) return <p className="text-[13px] text-[#888]">加载中…</p>;
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
          className="rounded-xl border border-[#eee] bg-white p-5"
        >
          <div className="text-[12px] text-[#888]">{label}</div>
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

  const load = useCallback(
    async (query: string) => {
      const r = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`);
      if (r.status === 403) return onForbidden();
      const d = await r.json();
      setUsers(d.users || []);
    },
    [onForbidden],
  );

  useEffect(() => {
    load("");
  }, [load]);

  const adjust = async (userId: string, amount: number) => {
    const note = window.prompt(
      `给该用户${amount > 0 ? "增加" : "扣减"} ${Math.abs(amount)} 次额度，备注：`,
      amount > 0 ? "付费充值" : "手动扣减",
    );
    if (note === null) return;
    setBusy(userId);
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, amount, note }),
    });
    setBusy(null);
    if (r.ok) load(q);
    else {
      const d = await r.json().catch(() => ({}));
      alert("操作失败：" + (d.error || r.status));
    }
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
          placeholder="按邮箱搜索…"
          className="w-64 rounded-md border border-[#e5edf5] px-3 py-2 text-[14px] outline-none focus:border-[#533afd]"
        />
        <button
          onClick={() => load(q)}
          className="rounded-md bg-[#533afd] px-4 py-2 text-[14px] font-medium text-white"
        >
          搜索
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#eee]">
        <table className="w-full text-[13px]">
          <thead className="bg-[#fafafa] text-left text-[#888]">
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
              <tr key={u.id} className="border-t border-[#f0f0f0]">
                <td className="px-4 py-3">{u.email || "—"}</td>
                <td className="px-4 py-3 font-semibold">{u.credit_balance}</td>
                <td className="px-4 py-3 text-[#888]">{u.job_count}</td>
                <td className="px-4 py-3 text-[#888]">{fmt(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    {[10, 50, 100].map((n) => (
                      <button
                        key={n}
                        disabled={busy === u.id}
                        onClick={() => adjust(u.id, n)}
                        className="rounded bg-[#ede9ff] px-2 py-1 text-[12px] font-medium text-[#533afd] hover:bg-[#ddd6ff] disabled:opacity-50"
                      >
                        +{n}
                      </button>
                    ))}
                    <button
                      disabled={busy === u.id}
                      onClick={() => adjust(u.id, -10)}
                      className="rounded bg-[#fee] px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-[#fdd] disabled:opacity-50"
                    >
                      −10
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[#aaa]">
                  无用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobsTab({ onForbidden }: { onForbidden: () => void }) {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch(`/api/admin/jobs?status=${filter}`)
      .then((r) => {
        if (r.status === 403) {
          onForbidden();
          return null;
        }
        return r.json();
      })
      .then((d) => d && setJobs(d.jobs || []))
      .catch(() => undefined);
  }, [filter, onForbidden]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
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
                ? "bg-[#533afd] text-white"
                : "bg-[#f3f3f3] text-[#666]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#eee]">
        <table className="w-full text-[13px]">
          <thead className="bg-[#fafafa] text-left text-[#888]">
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
              <tr key={j.id} className="border-t border-[#f0f0f0]">
                <td className="px-4 py-3">{j.email || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[12px] ${
                      j.status === "completed"
                        ? "bg-green-50 text-green-700"
                        : j.status === "failed"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#888]">{j.scene_kind || "—"}</td>
                <td className="px-4 py-3 text-[#888]">{j.output_count}</td>
                <td className="px-4 py-3 text-[#c00]">
                  {j.failure_reason || "—"}
                </td>
                <td className="px-4 py-3 text-[#888]">{fmt(j.created_at)}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#aaa]">
                  无任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadsTab({ onForbidden }: { onForbidden: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    fetch("/api/admin/leads")
      .then((r) => {
        if (r.status === 403) {
          onForbidden();
          return null;
        }
        return r.json();
      })
      .then((d) => d && setLeads(d.leads || []))
      .catch(() => undefined);
  }, [onForbidden]);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#eee]">
      <table className="w-full text-[13px]">
        <thead className="bg-[#fafafa] text-left text-[#888]">
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
            <tr key={l.id} className="border-t border-[#f0f0f0]">
              <td className="px-4 py-3">{l.email || "—"}</td>
              <td className="px-4 py-3">{l.wechat || "—"}</td>
              <td className="px-4 py-3">{l.phone || "—"}</td>
              <td className="px-4 py-3 text-[#888]">{l.source}</td>
              <td className="px-4 py-3 text-[#888]">{l.note || "—"}</td>
              <td className="px-4 py-3 text-[#888]">{fmt(l.created_at)}</td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-[#aaa]">
                暂无留资
              </td>
            </tr>
          )}
        </tbody>
      </table>
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

  const load = useCallback(() => {
    fetch(`/api/admin/tool-logs?tool=${tool}&status=${status}`)
      .then((r) => {
        if (r.status === 403) {
          onForbidden();
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setLogs(d.logs || []);
        setSummary(d.summary24h || {});
      })
      .catch(() => undefined);
  }, [tool, status, onForbidden]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {/* 最近 24h 健康度汇总 */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(summary).map(([t, st]) => {
          const rate = st.total ? Math.round((st.ok / st.total) * 100) : 0;
          return (
            <div key={t} className="rounded-xl border border-[#eee] p-4">
              <div className="text-[12px] text-[#888]">
                {TOOL_LABELS[t] || t}
              </div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight">
                {rate}%
                <span className="ml-1 text-[12px] font-normal text-[#aaa]">
                  成功
                </span>
              </div>
              <div className="mt-1 text-[12px] text-[#888]">
                {st.total} 次 · 失败 {st.failed} · 均 {st.avgMs}ms
              </div>
            </div>
          );
        })}
        {Object.keys(summary).length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[#eee] p-6 text-center text-[13px] text-[#aaa]">
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
              tool === k ? "bg-[#533afd] text-white" : "bg-[#f3f3f3] text-[#666]"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 w-px bg-[#eee]" />
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
                ? "bg-[#533afd] text-white"
                : "bg-[#f3f3f3] text-[#666]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#eee]">
        <table className="w-full text-[13px]">
          <thead className="bg-[#fafafa] text-left text-[#888]">
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
              <tr key={l.id} className="border-t border-[#f0f0f0]">
                <td className="px-4 py-3">{TOOL_LABELS[l.tool] || l.tool}</td>
                <td className="px-4 py-3 text-[#888]">{l.model || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[12px] ${
                      l.status === "ok"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#888]">{l.http_status ?? "—"}</td>
                <td className="px-4 py-3 text-[#888]">
                  {l.duration_ms != null ? `${l.duration_ms}ms` : "—"}
                </td>
                <td
                  className="max-w-[280px] truncate px-4 py-3 text-[#c00]"
                  title={l.error || ""}
                >
                  {l.error || "—"}
                </td>
                <td className="px-4 py-3 text-[#888]">{fmt(l.created_at)}</td>
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
                <td colSpan={8} className="px-4 py-8 text-center text-[#aaa]">
                  无调用记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    return <span className="text-[#888]">(解析失败)</span>;
  }

  return (
    <div className="max-w-[360px]">
      <span className="text-[12px] text-[#666]">
        {plan.reasoning?.slice(0, 80) || "—"}
      </span>
      <button
        onClick={() => setOpen(!open)}
        className="ml-2 text-[11px] text-[#533afd] hover:underline"
      >
        {open ? "收起 ↑" : "展开 ↓"}
      </button>
      {open && (
        <div className="mt-2 max-h-[360px] overflow-y-auto rounded border border-[#eee] bg-[#fafafa] p-3 text-[11px] leading-relaxed">
          {plan.shots?.map((shot, i) => (
            <div key={i} className="mb-3 border-b border-[#eee] pb-3 last:mb-0 last:border-b-0 last:pb-0">
              <div className="font-semibold text-[#333]">
                Shot {i + 1}: {shot.scene_type} · {shot.time_of_day} · {shot.light_state}
              </div>
              <div className="mt-1 whitespace-pre-wrap font-mono text-[#555]">
                {shot.prompt}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
