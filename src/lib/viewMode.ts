/** Whether the current (or given) URL is the Notebook view. */
export function isNotebookView(search = window.location.search): boolean {
  const p = new URLSearchParams(
    search.startsWith("?") || search === "" ? search : `?${search}`,
  );
  return p.get("view") === "note";
}
