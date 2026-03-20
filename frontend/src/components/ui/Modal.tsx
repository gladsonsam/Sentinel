import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export function Modal({
  open,
  title,
  children,
  onClose,
  actions,
  widthClassName = "max-w-lg",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full bg-surface border border-border rounded-xl shadow-xl overflow-hidden",
          widthClassName,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-primary truncate">
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-muted hover:text-primary hover:bg-border/30 transition-colors"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {actions ? (
          <div className="px-4 py-3 border-t border-border bg-bg/20">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

