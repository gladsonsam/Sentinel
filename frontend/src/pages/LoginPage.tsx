import { useState } from "react";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import { AuthLayout } from "../layouts/AuthLayout";
import { apiUrl } from "../lib/api";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
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
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        onLoginSuccess();
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Invalid password");
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
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={loading}
                disabled={!password.trim()}
              >
                Sign in
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {error && (
              <Alert type="error" dismissible onDismiss={() => setError(null)}>
                {error}
              </Alert>
            )}

            <FormField
              label="Password"
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.detail.value)}
                placeholder="Enter password"
                disabled={loading}
                autoFocus
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
