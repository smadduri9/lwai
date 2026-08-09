import { useToastStore } from "../store/toastStore";

/** Bottom-center toast stack (e.g. “Added to My Notebook”). */
export function ToastLayer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100001] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-enter pointer-events-auto flex items-center gap-3 rounded-full border border-ivory-300 bg-card px-4 py-2 text-sm text-ink-800 shadow-lg"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              className="text-xs font-medium text-clay-600 hover:underline"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="text-ink-400 hover:text-ink-700"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
