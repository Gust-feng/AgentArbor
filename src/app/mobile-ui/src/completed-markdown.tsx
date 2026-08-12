import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function CompletedMarkdownContent({ text }: { readonly text: string }) {
  return (
    <div className="aa-mobile-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ children, href }) => href === undefined || href.length === 0
            ? <span>{children}</span>
            : <a href={href} rel="noreferrer" target="_blank">{children}</a>,
          table: ({ children }) => <div className="aa-mobile-markdown-table"><table>{children}</table></div>,
        }}
      >
        {text.replace(/\r\n/gu, "\n")}
      </ReactMarkdown>
    </div>
  );
}

function safeMarkdownUrl(value: string): string {
  return /^(https?:|mailto:)/iu.test(value) ? value : "";
}
