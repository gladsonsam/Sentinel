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
  const [load, setLoad] = useState(true);
  const [save, setSave] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad(true);
    setErr(null);
    setOk(null);
    api
      .retentionAgentGet(agentId)
      .then(({ global, override }) => {
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

  return (
    <div className="max-w-lg flex flex-col gap-5">
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
    </div>
  );
}
