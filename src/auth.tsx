import { useEffect, useState } from "react";

export type AppRole = "admin";

export interface AuthSession {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  roleLabel: string;
  isLocal: boolean;
  canEdit: boolean;
  canDelete: boolean;
  signOut: () => Promise<void>;
}

const LOCAL_SESSION: AuthSession = {
  id: "local-admin",
  email: "",
  name: "本机管理员",
  role: "admin",
  roleLabel: "本机管理员",
  isLocal: true,
  canEdit: true,
  canDelete: true,
  signOut: async () => {},
};

function isLocalMode() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

async function authRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "登录失败，请稍后重试");
  return data;
}

function makeInviteSession(onSignedOut: () => void): AuthSession {
  return {
    id: "invite-member",
    email: "",
    name: "受邀成员",
    role: "admin",
    roleLabel: "邀请码成员",
    isLocal: false,
    canEdit: true,
    canDelete: true,
    signOut: async () => {
      await authRequest("/api/auth/logout", { method: "POST" });
      onSignedOut();
    },
  };
}

export function AuthGate({ children }: { children: (session: AuthSession) => React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLocalMode()) {
      setLoading(false);
      return;
    }

    let active = true;
    void authRequest("/api/auth/session")
      .then(() => {
        if (active) setAuthenticated(true);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const expire = () => setAuthenticated(false);
    window.addEventListener("inventory-auth-expired", expire);
    return () => {
      active = false;
      window.removeEventListener("inventory-auth-expired", expire);
    };
  }, []);

  if (isLocalMode()) return <>{children(LOCAL_SESSION)}</>;
  if (loading) return <AuthLoading />;
  if (authenticated) {
    return <>{children(makeInviteSession(() => setAuthenticated(false)))}</>;
  }

  return (
    <InviteCodeScreen
      error={error}
      onLogin={async (code) => {
        setError("");
        try {
          await authRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ code }),
          });
          setAuthenticated(true);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "邀请码不正确");
        }
      }}
    />
  );
}

function AuthLoading() {
  return (
    <div className="auth-page">
      <div className="auth-card auth-loading">
        <div className="brand-mark">酒</div>
        <p>正在确认登录状态…</p>
      </div>
    </div>
  );
}

function InviteCodeScreen({
  error,
  onLogin,
}: {
  error: string;
  onLogin: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try {
      await onLogin(code.trim());
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">酒</div>
          <div><span>WINE INVENTORY</span><h1>酒类仓库</h1></div>
        </div>
        <div className="auth-heading">
          <span>INVITATION ACCESS</span>
          <h2>邀请码登录</h2>
          <p>请输入管理员提供的邀请码进入酒库。</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            邀请码
            <input
              className="invite-code-input"
              type="password"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={16}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="请输入邀请码"
              autoFocus
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={working || !code.trim()}>
            {working ? "验证中…" : "进入酒库"}
          </button>
        </form>
        <p className="auth-invite-note">仅限受邀成员使用，请勿向无关人员分享邀请码。</p>
      </section>
    </div>
  );
}
