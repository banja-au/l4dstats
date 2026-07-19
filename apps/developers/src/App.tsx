import { BookOpen, Copy, KeyRound, LogOut } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { captureDeveloperEvent } from "./analytics";

type Account = {
  id: string;
  email: string;
  requestsUsed: number;
  requestsLimit: number;
  resetAt: string;
};
type ApiKey = {
  id: string;
  prefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};
type LogEntry = {
  id: string;
  method: string;
  path: string;
  status: number;
  createdAt: string;
  requestId: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/developer-api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState("");
  const [revealedKey, setRevealedKey] = useState("");

  const refresh = async () => {
    const me = await api<{
      account: Account | null;
      keys: ApiKey[];
      logs: LogEntry[];
    }>("/me");
    setAccount(me.account);
    setKeys(me.keys);
    setLogs(me.logs);
  };
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    captureDeveloperEvent("developer_auth_started", { mode });
    try {
      await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      await refresh();
      captureDeveloperEvent("developer_auth_finished", {
        mode,
        outcome: "succeeded",
      });
    } catch (cause) {
      captureDeveloperEvent("developer_auth_finished", {
        mode,
        outcome: "failed",
      });
      setError(
        cause instanceof Error ? cause.message : "Authentication failed",
      );
    }
  }

  async function createKey() {
    setError("");
    try {
      const result = await api<{ key: string }>("/keys", {
        method: "POST",
        body: JSON.stringify({ name: "Default" }),
      });
      setRevealedKey(result.key);
      await refresh();
      captureDeveloperEvent("developer_api_key_created");
    } catch (cause) {
      captureDeveloperEvent("developer_api_key_create_failed");
      setError(cause instanceof Error ? cause.message : "Could not create key");
    }
  }

  async function revokeKey(id: string) {
    setError("");
    try {
      await api(`/keys/${id}`, { method: "DELETE" });
      await refresh();
      captureDeveloperEvent("developer_api_key_revoked");
    } catch (cause) {
      captureDeveloperEvent("developer_api_key_revoke_failed");
      setError(cause instanceof Error ? cause.message : "Could not revoke key");
    }
  }

  return (
    <div className="min-h-screen bg-ink text-stone-100">
      <header className="border-b border-white/10 bg-black/20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <a href="/" className="brand text-xl font-black tracking-[-.05em]">
            L4D<span>STATS</span> <small>/ DEVELOPERS</small>
          </a>
          <a
            href="https://l4dstats.gg"
            className="text-sm text-stone-400 transition hover:text-acid"
          >
            Back to L4DStats ↗
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-12">
        {!account ? (
          <section className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:items-start">
            <div>
              <p className="eyebrow">L4DSTATS API</p>
              <h1 className="mt-4 text-4xl font-black tracking-[-.04em] md:text-5xl">
                Developer API
              </h1>
              <p className="mt-5 max-w-2xl leading-7 text-stone-400">
                Upload up to 10 L4D2 demos per batch and retrieve their parser
                results. Accounts are limited to 100 API requests per UTC day.
              </p>
              <a className="pill mt-7 inline-flex" href="#openapi">
                <BookOpen size={16} /> API reference
              </a>
            </div>
            <form onSubmit={authenticate} className="panel p-7">
              <p className="eyebrow">
                {mode === "register" ? "REGISTER" : "SIGN IN"}
              </p>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  minLength={12}
                  required
                />
              </label>
              {error && (
                <p role="alert" className="mt-4 text-sm text-red-300">
                  {error}
                </p>
              )}
              <button className="primary mt-5 w-full" type="submit">
                {mode === "register" ? "Create account" : "Sign in"}
              </button>
              <button
                className="mt-4 w-full text-sm text-stone-400 hover:text-white"
                type="button"
                onClick={() =>
                  setMode(mode === "register" ? "login" : "register")
                }
              >
                {mode === "register"
                  ? "Already have an account? Sign in"
                  : "Need an account? Register"}
              </button>
            </form>
          </section>
        ) : (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="eyebrow">DEVELOPER CONSOLE</p>
                <h1 className="mt-2 text-4xl font-black tracking-tight">
                  Account
                </h1>
                <p className="mt-2 break-all text-stone-400">{account.email}</p>
              </div>
              <button
                className="pill"
                onClick={async () => {
                  await api("/auth/logout", { method: "POST", body: "{}" });
                  captureDeveloperEvent("developer_signed_out");
                  setAccount(null);
                }}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
            <div className="mt-9 grid gap-5 lg:grid-cols-3">
              <article className="panel min-w-0 p-6">
                <p className="eyebrow">DAILY USAGE</p>
                <p className="mt-4 text-4xl font-black">
                  {account.requestsUsed}
                  <span className="text-stone-600">
                    {" "}
                    / {account.requestsLimit}
                  </span>
                </p>
                <div className="meter mt-5">
                  <i
                    style={{ width: `${Math.min(100, account.requestsUsed)}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-stone-500">
                  Resets at {new Date(account.resetAt).toLocaleString()}
                </p>
              </article>
              <article className="panel min-w-0 p-6 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="eyebrow">API KEYS</p>
                    <p className="mt-2 text-sm text-stone-400">
                      Keys are shown once and stored as a one-way hash.
                    </p>
                  </div>
                  <button className="primary" onClick={createKey}>
                    <KeyRound size={15} /> Create key
                  </button>
                </div>
                {revealedKey && (
                  <div className="key mt-4">
                    <code>{revealedKey}</code>
                    <button
                      aria-label="Copy API key"
                      onClick={() => navigator.clipboard.writeText(revealedKey)}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {keys.map((key) => (
                    <div
                      className="flex flex-wrap justify-between gap-2 border-t border-white/8 pt-3 text-sm"
                      key={key.id}
                    >
                      <code className="break-all">{key.prefix}••••••••</code>
                      <span className="flex items-center gap-4 text-stone-500">
                        {key.name}
                        <button
                          className="text-xs text-stone-500 hover:text-red-300"
                          onClick={() => revokeKey(key.id)}
                        >
                          Revoke
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            </div>
            <article className="panel mt-5 overflow-hidden">
              <div className="border-b border-white/10 p-6">
                <p className="eyebrow">RECENT REQUESTS</p>
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Request</th>
                      <th>Status</th>
                      <th>Request ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length ? (
                      logs.map((log) => (
                        <tr key={log.id}>
                          <td>{new Date(log.createdAt).toLocaleString()}</td>
                          <td>
                            <code>
                              {log.method} {log.path}
                            </code>
                          </td>
                          <td>{log.status}</td>
                          <td>
                            <code>{log.requestId}</code>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="text-stone-500">
                          No API requests yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}
        <section id="openapi" className="mt-20 border-t border-white/10 pt-12">
          <p className="eyebrow">API REFERENCE</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-4xl font-black tracking-tight">Endpoints</h2>
            <a
              className="pill"
              href="/openapi.json"
              onClick={() => captureDeveloperEvent("openapi_opened")}
            >
              <BookOpen size={16} /> OpenAPI JSON
            </a>
          </div>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            <Endpoint
              method="POST"
              path="/v1/batches"
              text="Create a batch containing 1–10 demo uploads."
            />
            <Endpoint
              method="PUT"
              path="/v1/uploads/{id}"
              text="Upload one raw or supported compressed demo."
            />
            <Endpoint
              method="GET"
              path="/v1/jobs/{id}"
              text="Read job state and the parser result when complete."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function Endpoint({
  method,
  path,
  text,
}: {
  method: string;
  path: string;
  text: string;
}) {
  return (
    <article className="panel p-5">
      <span className="method">{method}</span>
      <code className="mt-4 block break-all text-sm">{path}</code>
      <p className="mt-4 text-sm leading-6 text-stone-400">{text}</p>
    </article>
  );
}
