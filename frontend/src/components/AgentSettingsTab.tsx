import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { RetentionPolicy } from "../lib/types";
import { api } from "../lib/api";
import {
  daysToField,
  fieldToDays,
  fmtRetentionBrief,
  RETENTION_INPUT_CLASS,
} from "../lib/retentionForm";

interface Props {
  agentId: string;
  agentName: string;
}

/**
 * Per-computer retention overrides (Settings tab on an agent).
 */
export function AgentSettingsTab({ agentId, agentName }: Props) {
  const [agKey, setAgKey] = useState("");
  const [agWin, setAgWin] = useState("");
  const [agUrl, setAgUrl] = useState("");
  const [agGlobal, setAgGlobal] = useState<RetentionPolicy | null>(null);
  const [localUiGlobalSet, setLocalUiGlobalSet] = useState(false);
  const [localUiOverride, setLocalUiOverride] = useState<{
    password_set: boolean;
  } | null>(null);
  const [localUiPwd, setLocalUiPwd] = useState("");
  const [localUiPwd2, setLocalUiPwd2] = useState("");
  const [load, setLoad] = useState(true);
  const [save, setSave] = useState(false);
  const [localUiSave, setLocalUiSave] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [localUiErr, setLocalUiErr] = useState<string | null>(null);
  const [localUiOk, setLocalUiOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad(true);
    setErr(null);
    setOk(null);
    setLocalUiErr(null);
    setLocalUiOk(null);
    Promise.all([
      api.retentionAgentGet(agentId),
      api.localUiPasswordAgentGet(agentId),
    ])
      .then(([{ global, override }, localUi]) => {
        if (cancelled) return;
        setAgGlobal(global);
        const o = override ?? {
          keylog_days: null,
          window_days: null,
          url_days: null,
        };
        setAgKey(daysToField(o.keylog_days));
        setAgWin(daysToField(o.window_days));
        setAgUrl(daysToField(o.url_days));
        setLocalUiGlobalSet(localUi.global.password_set);
        setLocalUiOverride(localUi.override);
        setLocalUiPwd("");
        setLocalUiPwd2("");
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const saveOverrides = () => {
    setErr(null);
    setOk(null);
    let body: RetentionPolicy;
    try {
      body = {
        keylog_days: fieldToDays(agKey),
        window_days: fieldToDays(agWin),
        url_days: fieldToDays(agUrl),
      };
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setSave(true);
    api
      .retentionAgentPut(agentId, body)
      .then(({ global, override }) => {
        setAgGlobal(global);
        const o = override ?? {
          keylog_days: null,
          window_days: null,
          url_days: null,
        };
        setAgKey(daysToField(o.keylog_days));
        setAgWin(daysToField(o.window_days));
        setAgUrl(daysToField(o.url_days));
        setOk("Saved.");
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setSave(false));
  };

  const clearOverrides = () => {
    setErr(null);
    setOk(null);
    setSave(true);
    api
      .retentionAgentDelete(agentId)
      .then(({ global, override }) => {
        setAgGlobal(global);
        const o = override ?? {
          keylog_days: null,
          window_days: null,
          url_days: null,
        };
        setAgKey(daysToField(o.keylog_days));
        setAgWin(daysToField(o.window_days));
        setAgUrl(daysToField(o.url_days));
        setOk("This computer now follows the defaults from Preferences.");
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setSave(false));
  };

  const saveLocalUiOverride = () => {
    setLocalUiErr(null);
    setLocalUiOk(null);
    const a = localUiPwd.trim();
    const b = localUiPwd2.trim();
    if (a !== b) {
      setLocalUiErr("Passwords do not match.");
      return;
    }
    if (a.length > 0 && a.length < 4) {
      setLocalUiErr("Use at least 4 characters, or leave both empty for an open window.");
      return;
    }
    setLocalUiSave(true);
    api
      .localUiPasswordAgentPut(agentId, { password: a.length ? a : null })
      .then((s) => {
        setLocalUiGlobalSet(s.global.password_set);
        setLocalUiOverride(s.override);
        setLocalUiPwd("");
        setLocalUiPwd2("");
        setLocalUiOk(
          s.override?.password_set
            ? "Saved. This agent will receive the new lock password when connected."
            : "Saved. This PC’s settings window will stay open (override), unless you set a password above.",
        );
      })
      .catch((e) => setLocalUiErr(String(e)))
      .finally(() => setLocalUiSave(false));
  };

  const clearLocalUiOverride = () => {
    setLocalUiErr(null);
    setLocalUiOk(null);
    setLocalUiSave(true);
    api
      .localUiPasswordAgentDelete(agentId)
      .then((s) => {
        setLocalUiGlobalSet(s.global.password_set);
        setLocalUiOverride(s.override);
        setLocalUiPwd("");
        setLocalUiPwd2("");
        setLocalUiOk("This computer now follows the global default from Preferences.");
      })
      .catch((e) => setLocalUiErr(String(e)))
      .finally(() => setLocalUiSave(false));
  };

  return (
    <div className="max-w-lg flex flex-col gap-8">
      <div>
        <h2 className="text-base font-semibold text-primary">Retention overrides</h2>
        <p className="text-sm text-muted mt-1">
          <span className="text-primary font-medium">{agentName}</span> — optional
          rules that apply only to this computer. Leave a field blank to use the
          default you set under Preferences.
        </p>
      </div>

      {load ? (
        <div className="flex items-center gap-2 text-sm text-muted py-6">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {agGlobal && (
            <div className="rounded-lg border border-border bg-bg/30 px-4 py-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">
                Defaults (from Preferences)
              </div>
              <ul className="text-muted space-y-1 text-sm">
                <li>
                  Keylogs:{" "}
                  <span className="text-primary">
                    {fmtRetentionBrief(agGlobal.keylog_days)}
                  </span>
                </li>
                <li>
                  Windows &amp; activity:{" "}
                  <span className="text-primary">
                    {fmtRetentionBrief(agGlobal.window_days)}
                  </span>
                </li>
                <li>
                  URLs:{" "}
                  <span className="text-primary">
                    {fmtRetentionBrief(agGlobal.url_days)}
                  </span>
                </li>
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-primary">Keylogs</span>
              <span className="text-xs text-muted">Days to keep, or blank to match default</span>
              <input
                type="text"
                inputMode="numeric"
                className={RETENTION_INPUT_CLASS}
                value={agKey}
                onChange={(e) => setAgKey(e.target.value)}
                disabled={save}
                placeholder="Same as default"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-primary">Windows &amp; activity</span>
              <span className="text-xs text-muted">
                How long to keep focus history and AFK/active events for this PC
              </span>
              <input
                type="text"
                inputMode="numeric"
                className={RETENTION_INPUT_CLASS}
                value={agWin}
                onChange={(e) => setAgWin(e.target.value)}
                disabled={save}
                placeholder="Same as default"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-primary">URLs</span>
              <span className="text-xs text-muted">Days to keep, or blank to match default</span>
              <input
                type="text"
                inputMode="numeric"
                className={RETENTION_INPUT_CLASS}
                value={agUrl}
                onChange={(e) => setAgUrl(e.target.value)}
                disabled={save}
                placeholder="Same as default"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveOverrides}
              disabled={save}
              className="px-4 py-2 rounded-md text-sm font-medium border border-accent bg-accent/10 text-primary hover:bg-accent/20 disabled:opacity-50"
            >
              {save ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={clearOverrides}
              disabled={save}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted hover:text-primary hover:bg-border/30 disabled:opacity-50"
            >
              Use defaults only
            </button>
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}
          {ok && <p className="text-sm text-ok">{ok}</p>}
        </>
      )}

      {!load && (
        <div className="border-t border-border pt-8 flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-primary">
              Local settings window password
            </h2>
            <p className="text-sm text-muted mt-1">
              <span className="text-primary font-medium">{agentName}</span> — lock for the
              Windows agent’s <strong>on-machine</strong> Sentinel settings window (not this
              dashboard). Overrides the global default from Preferences for this PC only.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-bg/30 px-4 py-3 text-sm space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Global default (Preferences)
            </div>
            <p className="text-muted">
              {localUiGlobalSet
                ? "Password required for the local settings window."
                : "No password — local settings open by default."}
            </p>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold pt-2">
              This computer
            </div>
            <p className="text-muted">
              {localUiOverride === null
                ? "Follows the global default above."
                : localUiOverride.password_set
                  ? "Override: password set for this PC."
                  : "Override: no password (open) for this PC."}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-primary">New password (override)</span>
              <span className="text-xs text-muted">
                Set a password for this PC only, or leave both fields empty and save to force an
                open window on this machine.
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className={RETENTION_INPUT_CLASS}
                value={localUiPwd}
                onChange={(e) => setLocalUiPwd(e.target.value)}
                disabled={localUiSave}
                placeholder="••••••••"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-primary">Confirm</span>
              <input
                type="password"
                autoComplete="new-password"
                className={RETENTION_INPUT_CLASS}
                value={localUiPwd2}
                onChange={(e) => setLocalUiPwd2(e.target.value)}
                disabled={localUiSave}
                placeholder="••••••••"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveLocalUiOverride}
              disabled={localUiSave}
              className="px-4 py-2 rounded-md text-sm font-medium border border-accent bg-accent/10 text-primary hover:bg-accent/20 disabled:opacity-50"
            >
              {localUiSave ? "Saving…" : "Save override"}
            </button>
            <button
              type="button"
              onClick={clearLocalUiOverride}
              disabled={localUiSave || localUiOverride === null}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted hover:text-primary hover:bg-border/30 disabled:opacity-50"
              title={
                localUiOverride === null
                  ? "No per-PC override is set"
                  : "Use the global default from Preferences"
              }
            >
              Use global default only
            </button>
          </div>

          {localUiErr && <p className="text-sm text-danger">{localUiErr}</p>}
          {localUiOk && <p className="text-sm text-ok">{localUiOk}</p>}
        </div>
      )}
    </div>
  );
}
