import { isValidElement, memo, useCallback, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyText } from "./clip";

function isWebUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <span>{children}</span>;
  if (!isWebUrl(href)) {
    // Relative paths, anchors, and non-web schemes stay inert so a model
    // cannot trigger navigation outside the browser.
    return <code className="md-inline md-link-path">{children}</code>;
  }
  return (
    <a
      href={href}
      title={href}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        openUrl(href).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

function MdCode({ children }: { className?: string; children?: ReactNode }) {
  return <code className="md-inline">{children}</code>;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  // A fenced block arrives as a single <code> element; recurse into it.
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function blockLanguage(children: ReactNode): string {
  const kids = Array.isArray(children) ? children : [children];
  const first = kids[0];
  if (isValidElement<{ className?: string }>(first)) {
    const m = /language-([\w+-]+)/.exec(first.props.className ?? "");
    if (m) return m[1];
  }
  return "code";
}

function MdPre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    // Fenced blocks carry one trailing newline; drop it from the copy.
    const text = textOf(children).replace(/\n$/, "");
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [children]);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{blockLanguage(children)}</span>
        <button type="button" className="md-copy" aria-label="Copy code" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function MdTable({ children }: { children?: ReactNode }) {
  return (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  );
}

const components: Components = { a: MdLink, pre: MdPre, code: MdCode, table: MdTable };

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
