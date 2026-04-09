/**
 * Add more mappings here to expand the “friendly app name” list.
 * Keys are lowercase exe names (with `.exe`).
 */
export const EXE_FRIENDLY_NAMES: Record<string, string> = {
  // Microsoft Office
  "winword.exe": "Microsoft Word",
  "excel.exe": "Microsoft Excel",
  "powerpnt.exe": "Microsoft PowerPoint",
  "outlook.exe": "Microsoft Outlook",
  "onenote.exe": "Microsoft OneNote",
  "msaccess.exe": "Microsoft Access",
  "mspub.exe": "Microsoft Publisher",
};

function officeNameFromExe(exeName: string | undefined | null): string | null {
  const exe = (exeName ?? "").trim().toLowerCase();
  if (exe in EXE_FRIENDLY_NAMES) return EXE_FRIENDLY_NAMES[exe]!;
  return null;
}

/**
 * Normalize Windows app labels across the dashboard.
 *
 * - Prefers friendly Microsoft Office names (Word/Excel/PowerPoint/...)
 * - Falls back to `appDisplay`, then `exeName`, then "—"
 */
export function prettyAppLabel(opts: {
  exeName?: string | null;
  appDisplay?: string | null;
}): string {
  const fromExe = officeNameFromExe(opts.exeName);
  if (fromExe) return fromExe;

  const display = (opts.appDisplay ?? "").trim();
  if (display) return display;

  const exe = (opts.exeName ?? "").trim();
  if (exe) return exe;

  return "—";
}

