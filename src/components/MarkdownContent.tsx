import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Renders LLM markdown output with chat-bubble-friendly styling. */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="leading-relaxed">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-fg-strong">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-teal underline underline-offset-2 hover:text-teal-dim"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="ml-4 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed [&>ul]:mt-1 [&>ol]:mt-1">
              {children}
            </li>
          ),
          h1: ({ children }) => (
            <h1 className="mt-3 text-base font-bold text-fg-strong">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 text-base font-bold text-fg-strong">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 text-sm font-bold text-fg-strong">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-2 text-sm font-semibold text-fg-strong">
              {children}
            </h4>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-')
            return isBlock ? (
              <code className="block overflow-x-auto rounded-lg bg-ink/70 p-3 font-mono text-xs text-teal">
                {children}
              </code>
            ) : (
              <code className="rounded bg-ink/60 px-1.5 py-0.5 font-mono text-xs text-teal">
                {children}
              </code>
            )
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-teal/50 pl-3 text-slate-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-ink/50 px-2 py-1.5 text-left font-semibold text-fg-strong">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1.5">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
