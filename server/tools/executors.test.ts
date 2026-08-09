import { describe, expect, it } from "vitest";
import { htmlToReadableText, parseDuckDuckGoHtml, runStandardTool } from "./executors";

describe("runStandardTool", () => {
  it("rejects invalid JSON input", async () => {
    const r = await runStandardTool("execute_code", "{nope");
    expect(r.status).toBe("error");
  });

  it("executes JavaScript in an isolated worker and captures console output", async () => {
    const r = await runStandardTool(
      "execute_code",
      JSON.stringify({ language: "javascript", code: "console.log('sum', 2 + 2); 40 + 2" }),
    );
    expect(r.status).toBe("done");
    expect(r.output).toContain("sum 4");
    expect(r.output).toContain("42");
  });

  it("reports JavaScript errors without throwing", async () => {
    const r = await runStandardTool(
      "execute_code",
      JSON.stringify({ language: "javascript", code: "throw new Error('kaboom')" }),
    );
    expect(r.status).toBe("error");
    expect(r.output).toContain("kaboom");
  });

  it("validates and echoes mermaid diagrams", async () => {
    const good = await runStandardTool(
      "generate_diagram",
      JSON.stringify({ mermaid: "flowchart LR\n  A --> B" }),
    );
    expect(good.status).toBe("done");
    expect(good.output).toContain("A --> B");

    const bad = await runStandardTool(
      "generate_diagram",
      JSON.stringify({ mermaid: "not a diagram" }),
    );
    expect(bad.status).toBe("error");
  });

  it("rejects non-http URLs for fetch_url_content", async () => {
    const r = await runStandardTool(
      "fetch_url_content",
      JSON.stringify({ url: "file:///etc/passwd" }),
    );
    expect(r.status).toBe("error");
  });

  it("returns an error for unknown tools", async () => {
    const r = await runStandardTool("format_disk", "{}");
    expect(r.status).toBe("error");
  });
});

describe("htmlToReadableText", () => {
  it("prefers article content and strips chrome", () => {
    const html = `
      <html><head><style>.x{}</style><script>evil()</script></head>
      <body>
        <nav>Menu Menu</nav>
        <article><h1>Title</h1><p>First para.</p><p>Second &amp; last.</p></article>
        <footer>Footer junk</footer>
      </body></html>`;
    const text = htmlToReadableText(html);
    expect(text).toContain("Title");
    expect(text).toContain("First para.");
    expect(text).toContain("Second & last.");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("Menu Menu");
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("extracts titles, decoded urls, and snippets", () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example <b>Page</b></a>
      <a class="result__snippet">A snippet about the page.</a>
      <a class="result__a" href="https://direct.example.org/x">Direct</a>
      <a class="result__snippet">Second snippet.</a>`;
    const hits = parseDuckDuckGoHtml(html);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      title: "Example Page",
      url: "https://example.com/page",
      snippet: "A snippet about the page.",
    });
    expect(hits[1].url).toBe("https://direct.example.org/x");
  });
});

describe("generate_diagram hardening", () => {
  it("strips markdown fences instead of failing", async () => {
    const r = await runStandardTool(
      "generate_diagram",
      JSON.stringify({ mermaid: "```mermaid\nflowchart TD\n  A --> B\n```" }),
    );
    expect(r.status).toBe("done");
    expect(r.output).toBe("flowchart TD\n  A --> B");
  });

  it("rejects unbalanced brackets with a corrective hint", async () => {
    const r = await runStandardTool(
      "generate_diagram",
      JSON.stringify({ mermaid: 'flowchart TD\n  A["Load data --> B' }),
    );
    expect(r.status).toBe("error");
    expect(r.output).toMatch(/unbalanced/i);
  });

  it("rejects sources that do not start with a diagram keyword", async () => {
    const r = await runStandardTool(
      "generate_diagram",
      JSON.stringify({ mermaid: "here is your diagram:\nflowchart TD\n A-->B" }),
    );
    expect(r.status).toBe("error");
    expect(r.output).toMatch(/diagram keyword/i);
  });
});

describe("fetch_image input handling", () => {
  it("errors cleanly when no queries are provided", async () => {
    const r = await runStandardTool("fetch_image", JSON.stringify({ queries: [] }));
    expect(r.status).toBe("error");
    expect(r.output).toMatch(/queries/i);
  });

  it("errors cleanly on missing input", async () => {
    const r = await runStandardTool("fetch_image", "{}");
    expect(r.status).toBe("error");
  });
});
