/** Human-friendly label from a selection / quote (strips JSON noise). */
export function quoteLabel(text: string | undefined | null, max = 40): string {
  if (!text) return "Selection";
  let t = text.trim().replace(/\s+/g, " ");
  // Strip leading JSON/object noise like `{"cortical neuron count`
  t = t.replace(/^[{[\s"']+/, "");
  t = t.replace(/["'\s]+$/, "");
  if (!t) return "Selection";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
