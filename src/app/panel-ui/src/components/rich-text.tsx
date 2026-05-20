import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function RichText({ text }: { readonly text: string }): React.ReactElement {
  return (
    <div className="rich-text">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
      >
        {normalizeCollapsedMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

function normalizeCollapsedMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\s+([-*])\s+(?=(?:\*\*|__|`|["'“”‘’]|[\u{1F300}-\u{1FAFF}]))/gu, "\n$1 ")
    .replace(/([:：。.!?？；;])\s+[-*]\s+(?=\S)/gu, "$1\n- ")
    .replace(/([:：。.!?？；;])\s+(\d+[.)])\s+(?=\S)/gu, "$1\n$2 ");
}

function safeUrlTransform(value: string): string {
  if (/^(https?:|mailto:)/i.test(value)) {
    return value;
  }
  return "";
}

function codeLanguage(className: string | undefined): string | undefined {
  return /language-([A-Za-z0-9_-]+)/.exec(className ?? "")?.[1];
}

function preLanguage(children: React.ReactNode): string | undefined {
  const child = React.Children.toArray(children)[0];
  if (!React.isValidElement<{ readonly className?: string }>(child)) {
    return undefined;
  }
  return codeLanguage(child.props.className);
}

const markdownComponents = {
  a({ children, href }) {
    if (href === undefined || href.length === 0) {
      return <span>{children}</span>;
    }
    return (
      <a className="rich-link" href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote className="rich-blockquote">{children}</blockquote>;
  },
  code({ children, className }) {
    const language = codeLanguage(className);
    return (
      <code className={language === undefined ? "rich-inline-code" : className} data-language={language}>
        {children}
      </code>
    );
  },
  h1({ children }) {
    return <h2 className="rich-heading rich-heading-1">{children}</h2>;
  },
  h2({ children }) {
    return <h2 className="rich-heading rich-heading-2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="rich-heading rich-heading-3">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="rich-heading rich-heading-4">{children}</h4>;
  },
  hr() {
    return <hr className="rich-divider" />;
  },
  ol({ children }) {
    return <ol className="rich-list rich-list-ordered">{children}</ol>;
  },
  p({ children }) {
    return <p className="rich-paragraph">{children}</p>;
  },
  pre({ children }) {
    const language = preLanguage(children);
    return (
      <pre className="rich-code-block" data-language={language}>
        {children}
      </pre>
    );
  },
  table({ children }) {
    return (
      <div className="rich-table-wrap">
        <table className="rich-table">{children}</table>
      </div>
    );
  },
  ul({ children }) {
    return <ul className="rich-list rich-list-unordered">{children}</ul>;
  },
} satisfies Components;
