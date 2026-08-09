/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { llmProxy } from "./vite-plugin-llm-proxy.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), llmProxy()],
  // Pyodide resolves its own .wasm/stdlib assets relative to its module URL —
  // pre-bundling would break those paths (it runs inside the sandbox worker).
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
