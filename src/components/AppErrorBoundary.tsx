import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Last-resort boundary around the whole app: a render crash shows a recoverable
 * card instead of a blank page. Chat/notebook state lives in IndexedDB, so a
 * reload loses nothing.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-ivory-50 p-6">
        <div className="max-w-md rounded-xl border border-ivory-300 bg-card p-6 text-center shadow-sm">
          <h1 className="mb-2 font-serif text-lg font-semibold text-ink-800">
            Something went wrong
          </h1>
          <p className="mb-4 text-sm text-ink-500">
            The app hit an unexpected error. Your chats and notes are saved locally — reloading
            will restore them.
          </p>
          <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-ivory-100 p-2 text-left font-mono text-[11px] text-ink-600">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-ink-800 px-4 py-2 text-sm font-medium text-ivory-50 transition-colors hover:bg-ink-700"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
