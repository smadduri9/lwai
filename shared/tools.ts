/**
 * The four standard tools, declared in the OpenAI JSON-schema function format.
 * The proxy runs the tool loop server-side; the client only sees normalized
 * tool_start / tool_input / tool_result SSE events.
 */

export type StandardToolName =
  | "execute_code"
  | "generate_diagram"
  | "fetch_image"
  | "fetch_url_content"
  | "web_search";

export interface ToolFunctionDef {
  type: "function";
  function: {
    name: StandardToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const STANDARD_TOOLS: ToolFunctionDef[] = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute code in a sandbox and return its stdout. Use this for ALL math and algorithmic logic — never compute results yourself. Python runs in a Pyodide (WASM) sandbox; JavaScript runs in an isolated worker. Print the values you need. The code is also shown to the user in an editable sandbox with a Run button, so write clean, self-contained, re-runnable programs (no placeholder values, no reliance on prior calls).",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["python", "javascript"],
            description: "Language to execute.",
          },
          code: {
            type: "string",
            description: "The program to run. Print results to stdout.",
          },
        },
        required: ["language", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_diagram",
      description:
        "Render a data visualization or diagram for the user as an interactive SVG. Provide STRICTLY VALID Mermaid.js source. Syntax rules (violations make the render fail): 1) start with the diagram keyword on its own line (flowchart TD, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie, timeline, mindmap, quadrantChart); 2) one statement per line; 3) wrap every node label containing spaces, punctuation, or parentheses in double quotes, e.g. A[\"Load data (CSV)\"] --> B[\"Clean rows\"]; 4) never put markdown fences (```) or prose inside the source; 5) use plain ASCII arrows (-->, ->>); 6) keep ids alphanumeric. Example: flowchart TD\\n  A[\"User input\"] --> B{\"Valid?\"}\\n  B -->|yes| C[\"Save\"]\\n  B -->|no| D[\"Show error\"]",
      parameters: {
        type: "object",
        properties: {
          mermaid: {
            type: "string",
            description: "Complete, strictly valid Mermaid.js source. No markdown fences.",
          },
          title: { type: "string", description: "Short title for the diagram." },
        },
        required: ["mermaid"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_image",
      description:
        "Use this tool to fetch one or multiple images from the web (Wikimedia Commons). You can pass an array of search terms to fetch pictures for multiple items at once — e.g. a list of birds becomes queries: [\"northern cardinal bird\", \"blue jay bird\", \"american robin bird\"]. All queries run concurrently. Returns Markdown image syntax ![title](url) for every image found; include those Markdown images directly in your reply so they render in the chat. There is no limit on how many subjects you may request — never split one request into multiple calls.",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description:
              "One search query per subject, specific and descriptive — e.g. ['karl marx portrait 1875'] or ['bald eagle', 'peregrine falcon', 'snowy owl'].",
          },
          per_query: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description:
              "Images to fetch per query (default: 1 when multiple queries, 4 for a single query).",
          },
        },
        required: ["queries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url_content",
      description:
        "Fetch a specific web page and return its readable body text. Use when you need the contents of a known URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to read." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current facts. Returns a list of results with title, url, and snippet. Cite the sources you use.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
      },
    },
  },
];
