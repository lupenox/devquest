import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Lightbulb } from "lucide-react";
import { Lexer, type Token, type Tokens } from "marked";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-regex";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-vim";

// React owns the DOM. Only use Prism's tokenizer.
Prism.manual = true;

function inline(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "codespan":
        return <code key={i} className="inline-code">{token.text}</code>;
      case "strong":
        // An unquoted Python __dunder__ name is also valid Markdown emphasis.
        if (/^__\w+__$/.test(token.raw)) return token.raw;
        return <strong key={i}>{inline(token.tokens ?? [])}</strong>;
      case "em":
        return <em key={i}>{inline(token.tokens ?? [])}</em>;
      case "br":
        return <br key={i} />;
      default:
        // Keep unsupported Markdown, HTML tags and backslashes literal in technical prose.
        return token.raw;
    }
  });
}

export function RichText({ text }: { text: string }) {
  return <>{inline(Lexer.lexInline(text))}</>;
}

function lessonParagraph(tokens: Token[]) {
  // Mask inline code and emphasis so punctuation inside them cannot cut a sentence in two.
  const source = tokens.map((token) => token.raw).join("");
  const prose = tokens.map((token) => token.type === "text" ? token.raw : "x".repeat(token.raw.length)).join("");
  const advice = /(?:^|(?<=[.!?])\s+)(?:Always\b|Never\b|Watch out\b|Prefer\b|Note:)[\s\S]*?(?:[.!?](?=\s|$)|$)/gi;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of prose.matchAll(advice)) {
    const start = match.index!;
    const end = start + match[0].length;
    const before = source.slice(offset, start).trim();
    if (before) parts.push(<p key={offset}><RichText text={before} /></p>);
    parts.push(
      <aside key={`tip-${start}`} className="zy-callout">
        <span className="zy-callout-label"><Lightbulb size={15} aria-hidden="true" /> Key takeaway</span>
        <p><RichText text={source.slice(start, end).trim()} /></p>
      </aside>
    );
    offset = end;
  }
  if (!parts.length) return <p>{inline(tokens)}</p>;
  const tail = source.slice(offset).trim();
  if (tail) parts.push(<p key={offset}><RichText text={tail} /></p>);
  return parts;
}

function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "space":
        return null;
      case "paragraph":
        return <Fragment key={i}>{lessonParagraph(token.tokens ?? [])}</Fragment>;
      case "text":
        return <Fragment key={i}>{inline(token.tokens ?? [token])}</Fragment>;
      case "list": {
        const items = token.items.map((item: Tokens.ListItem, index: number) => <li key={index}>{blocks(item.tokens)}</li>);
        return token.ordered ? <ol key={i} start={Number(token.start)}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case "code":
        return <pre key={i}><code>{token.text}</code></pre>;
      default:
        return <p key={i}><RichText text={token.raw} /></p>;
    }
  });
}

export function ZySectionBody({ text }: { text: string }) {
  return <div className="zy-body">{blocks(Lexer.lex(text))}</div>;
}

const languages: Record<string, [string, string]> = {
  python: ["python", "Python"],
  fastapi: ["python", "Python"],
  javascript: ["javascript", "JavaScript"],
  typescript: ["typescript", "TypeScript"],
  react: ["jsx", "JSX"],
  playwright: ["typescript", "TypeScript"],
  cpp: ["cpp", "C++"],
  bash: ["bash", "Bash"],
  git: ["bash", "Shell"],
  debugging: ["bash", "Debugger commands"],
  neovim: ["vim", "Neovim"],
  css: ["css", "CSS"],
  html: ["markup", "HTML"],
  xml: ["markup", "XML"],
  json: ["json", "JSON"],
  sql: ["sql", "SQL"],
  regex: ["regex", "Regex"],
};

const tokenStyles: Record<string, string> = {
  keyword: "kw", tag: "kw", boolean: "kw", null: "kw", important: "kw",
  string: "str", char: "str", "attr-value": "str", regex: "str",
  number: "num", constant: "num",
  comment: "cmt", prolog: "cmt", doctype: "cmt",
  builtin: "type", "class-name": "type", selector: "type", "attr-name": "type", property: "type",
  function: "fn", decorator: "fn", annotation: "fn",
  operator: "op", quantifier: "op", escape: "op",
};

function renderSyntax(token: Prism.TokenStream): ReactNode {
  if (typeof token === "string") return token;
  if (Array.isArray(token)) {
    return token.map((part, i) => <Fragment key={i}>{renderSyntax(part)}</Fragment>);
  }
  const names = [token.type].concat(token.alias || []);
  const style = names.map((name) => tokenStyles[name]).find(Boolean);
  const content = renderSyntax(token.content);
  return style ? <span className={`tok-${style}`}>{content}</span> : content;
}

interface CodeProps {
  code: string;
  lang: string;
}

export function HighlightedLines({ code, lang }: CodeProps) {
  const children = useMemo(() => {
    const language = languages[lang]?.[0];
    return language ? renderSyntax(Prism.tokenize(code, Prism.languages[language])) : code;
  }, [code, lang]);
  return <>{children}</>;
}

export function HighlightedCode({ code, lang }: CodeProps) {
  const [copyState, setCopyState] = useState<"Copy" | "Copied!" | "Select and copy">("Copy");
  const sourceRef = useRef<HTMLElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("Copied!");
    } catch {
      // An insecure context or denied permission can still allow copying a user selection.
      const selection = window.getSelection();
      if (selection && sourceRef.current) {
        const range = document.createRange();
        range.selectNodeContents(sourceRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const copied = Boolean(selection?.toString() === code && document.execCommand?.("copy"));
      setCopyState(copied ? "Copied!" : "Select and copy");
    }
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopyState("Copy"), 2200);
  }

  const label = languages[lang]?.[1] || "Code";
  const lineNumbers = code.split("\n").map((_, i) => i + 1).join("\n");
  return (
    <div className="code-viewer">
      <div className="code-viewer-header">
        <span className="code-language">{label}</span>
        <button type="button" className="code-copy" onClick={copyCode}>
          {copyState === "Copied!" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span aria-live="polite">{copyState}</span>
        </button>
      </div>
      <div className="code-scroll" role="region" aria-label={`${label} example`} tabIndex={0}>
        <pre className="code-gutter" aria-hidden="true">{lineNumbers}</pre>
        <pre className="code-source"><code ref={sourceRef}><HighlightedLines code={code} lang={lang} /></code></pre>
      </div>
    </div>
  );
}
