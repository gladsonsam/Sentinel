import { useState, useCallback } from "react";
import type { FlashbarProps } from "@cloudscape-design/components/flashbar";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface NotificationItem extends FlashbarProps.MessageDefinition {
  id: string;
}

let notificationIdCounter = 0;

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const addNotification = useCallback(
    (
      type: NotificationType,
      header: string,
      content?: string,
      options?: {
        dismissible?: boolean;
        dismissLabel?: string;
        autoDismiss?: boolean;
        autoDismissTimeout?: number;
        action?: FlashbarProps.MessageDefinition["action"];
      }
    ) => {
      const id = `notification-${++notificationIdCounter}`;
      const notification: NotificationItem = {
        id,
        type,
        header,
        content,
        dismissible: options?.dismissible ?? true,
        dismissLabel: options?.dismissLabel ?? "Dismiss",
        action: options?.action,
        onDismiss: () => removeNotification(id),
      };

      setNotifications((prev) => [...prev, notification]);

      if (options?.autoDismiss !== false) {
        const timeout = options?.autoDismissTimeout ?? 5000;
        setTimeout(() => {
          removeNotification(id);
        }, timeout);
      }

      return id;
    },
    []
  );

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const success = useCallback(
    (header: string, content?: string, options?: Parameters<typeof addNotification>[3]) => {
      return addNotification("success", header, content, options);
    },
    [addNotification]
  );

  const error = useCallback(
    (header: string, content?: string, options?: Parameters<typeof addNotification>[3]) => {
      return addNotification("error", header, content, options);
    },
    [addNotification]
  );

  const warning = useCallback(
    (header: string, content?: string, options?: Parameters<typeof addNotification>[3]) => {
      return addNotification("warning", header, content, options);
    },
    [addNotification]
  );

  const info = useCallback(
    (header: string, content?: string, options?: Parameters<typeof addNotification>[3]) => {
      return addNotification("info", header, content, options);
    },
    [addNotification]
  );

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
    success,
    error,
    warning,
    info,
  };
}
