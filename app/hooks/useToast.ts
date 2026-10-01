"use client";

import { createContext, useContext, useCallback, useState, type ReactNode } from "react";
import { createElement } from "react";

export interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (message: string, type?: ToastItem["type"]) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const MAX_TOASTS = 5;

  const toast = useCallback((message: string, type: ToastItem["type"] = "info") => {
    const id = `toast-${++counter}-${Date.now()}`;
    setToasts((prev) => {
      // Deduplicate: skip if same message+type already visible
      if (prev.some((t) => t.message === message && t.type === type)) return prev;
      // Cap at MAX_TOASTS — remove oldest first
      const updated = [...prev, { id, message, type }];
      return updated.length > MAX_TOASTS ? updated.slice(-MAX_TOASTS) : updated;
    });
    // UX WP-10 (UI-1): timing is per type in the toast itself (components/ui/Toast.tsx
    // TOAST_DURATION_MS): an error stays until it is dismissed.
  }, []);

  return createElement(
    ToastContext.Provider,
    { value: { toasts, toast, dismiss } },
    children,
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return { toast: ctx.toast, toasts: ctx.toasts };
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
  return ctx;
}
