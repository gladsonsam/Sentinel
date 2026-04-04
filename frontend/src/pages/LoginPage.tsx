import { useEffect, useState } from "react";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import { AuthLayout } from "../layouts/AuthLayout";
import { apiUrl, setDashboardCsrfToken } from "../lib/api";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [oidcEnabled, setOidcEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/auth/config"), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.oidc_enabled === "boolean") setOidcEnabled(data.oidc_enabled);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (!password.trim()) {
      setError("Password is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(apiUrl("/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const okBody = (await response.json().catch(() => ({}))) as {
          csrf_token?: string;
        };
        if (typeof okBody.csrf_token === "string" && okBody.csrf_token.length > 0) {
          setDashboardCsrfToken(okBody.csrf_token);
        }
        onLoginSuccess();
      } else {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          attempts_remaining?: number;
          max_attempts_per_window?: number;
          retry_after_secs?: number;
        };
        const base = data.error ?? "Invalid password";
        if (response.status === 429 && typeof data.retry_after_secs === "number") {
          setError(
            `${base} Retry in about ${Math.ceil(data.retry_after_secs)}s.`
          );
        } else if (
          response.status === 401 &&
          typeof data.attempts_remaining === "number"
        ) {
          const n = data.attempts_remaining;
          const max = data.max_attempts_per_window;
          const suffix = ` ${n} attempt${n === 1 ? "" : "s"} remaining before lockout${
            typeof max === "number" ? ` (limit: ${max} wrong passwords / 15 min)` : ""
          }.`;
          setError(base + suffix);
        } else {
          setError(base);
        }
      }
    } catch (err) {
      setError("Failed to connect to server. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Box className="sentinel-auth-form-wrap">
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs" className="sentinel-auth-actions">
              {oidcEnabled && (
                <Button
                  variant="normal"
                  onClick={() => {
                    window.location.href = apiUrl("/auth/oidc/login");
                  }}
                  disabled={loading}
                >
                  Sign in with Authentik
                </Button>
              )}
              <Button
                className="sentinel-auth-submit"
                variant="primary"
                onClick={handleSubmit}
                loading={loading}
                disabled={!username.trim() || !password.trim()}
              >
                Sign in
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Box className="sentinel-auth-error-slot">
              {error && (
                <Alert type="error" dismissible onDismiss={() => setError(null)}>
                  {error}
                </Alert>
              )}
            </Box>

            {oidcEnabled && <Box padding={{ vertical: "s" }} />}

            <FormField
              label="Username"
            >
              <Input
                value={username}
                onChange={(e) => setUsername(e.detail.value)}
                placeholder="Enter username"
                disabled={loading}
                autoFocus
                onKeyDown={(e) => {
                  if (e.detail.key === "Enter") {
                    handleSubmit();
                  }
                }}
              />
            </FormField>

            <FormField
              label="Password"
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.detail.value)}
                placeholder="Enter password"
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.detail.key === "Enter") {
                    handleSubmit();
                  }
                }}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Box>
    </AuthLayout>
  );
}
