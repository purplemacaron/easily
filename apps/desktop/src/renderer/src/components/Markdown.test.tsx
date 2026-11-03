import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, safeHref } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown renderer", () => {
  it("renders paragraphs, emphasis, lists and inline code", () => {
    const out = html("안녕 **굵게** 와 `code`\n\n- 하나\n- 둘\n\n1. a\n2. b");
    expect(out).toContain("<strong>굵게</strong>");
    expect(out).toContain("<code");
    expect(out).toContain("<ul>");
    expect(out).toContain("<ol");
    expect(out.match(/<li>/g)?.length).toBe(4);
  });

  it("renders fenced code blocks verbatim and escaped", () => {
    const out = html("```ts\nconst a = '<b>';\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("&lt;b&gt;");
    expect(out).not.toContain("<b>");
  });

  it("renders tables", () => {
    const out = html("| a | b |\n|---|---:|\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th");
    expect(out).toContain("<td");
    expect(out).toContain("text-align:right");
  });

  it("never emits raw html from the source", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\ntext <b onclick="x">bold</b>');
    // the source text survives only as escaped text, never as elements or attributes
    expect(out).not.toMatch(/<(script|img|b)[\s>]/);
    expect(out).not.toMatch(/<[^>]*\sonerror=/);
    expect(out).not.toMatch(/<[^>]*\sonclick=/);
    expect(out).toContain("&lt;script&gt;");
  });

  it("only links http(s) and drops javascript: / data: urls", () => {
    expect(html("[ok](https://example.com)")).toContain('href="https://example.com"');
    const bad = html("[x](javascript:alert(1)) [y](data:text/html;base64,AAAA) [z](file:///etc/passwd)");
    expect(bad).not.toContain("href=");
    expect(bad).toContain("x");
  });

  it("does not load images", () => {
    const out = html("![alt text](https://evil.example/pixel.png)");
    expect(out).not.toContain("<img");
    expect(out).toContain("alt text");
  });

  it("copes with an unterminated code fence while streaming", () => {
    expect(html("```js\nlet x = 1")).toContain("let x = 1");
  });
});

describe("safeHref", () => {
  it("accepts http and https only", () => {
    expect(safeHref("https://a.b/c?d=1")).toBe("https://a.b/c?d=1");
    expect(safeHref("http://a.b")).toBe("http://a.b");
    expect(safeHref("mailto:a@b.c")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});
