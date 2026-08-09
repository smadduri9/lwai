import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

/** Persisted theme choice; defaults to the OS preference on first visit. */
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: systemTheme(),
      toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
    }),
    { name: "subchat-theme" },
  ),
);

applyTheme(useThemeStore.getState().theme);
useThemeStore.subscribe((s) => applyTheme(s.theme));
