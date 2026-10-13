'use client';

import { useState } from "react";

/**
 * 调试表单本体。只在非生产环境被渲染（门禁在 ./page.tsx）。
 * 调用 POST /api/debug/email 直接打 Resend SDK，把真实错误暴露出来。
 */
export default function DebugEmailForm() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSend = async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch("/api/debug/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email }),
      });
      const data = await resp.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult("Error: " + String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-lg mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Resend Email Debug</h1>
      <label className="block mb-2">
        Enter email address:
        <input
          type="email"
          className="w-full mt-1 p-2 border rounded"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <button
        className="bg-indigo-600 text-white py-2 px-4 rounded disabled:opacity-50"
        disabled={loading || !email}
        onClick={onSend}
      >
        {loading ? "Sending..." : "Send test email"}
      </button>
      {result && (
        <pre className="mt-4 whitespace-pre-wrap bg-gray-100 p-3 rounded text-sm text-gray-800">
          {result}
        </pre>
      )}
    </main>
  );
}
