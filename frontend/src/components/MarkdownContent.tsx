import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
  className?: string
}

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  return (
    <div className={`markdown-content text-sm leading-7 text-[var(--text-primary)] break-words ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...props }) => <h1 className="mt-3 mb-2 text-lg font-semibold text-[var(--text-strong)]" {...props} />,
          h2: ({ ...props }) => <h2 className="mt-3 mb-2 text-base font-semibold text-[var(--text-strong)]" {...props} />,
          h3: ({ ...props }) => <h3 className="mt-2 mb-1 text-sm font-semibold text-[var(--text-strong)]" {...props} />,
          p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
          ul: ({ ...props }) => <ul className="mb-2 ml-5 list-disc space-y-1" {...props} />,
          ol: ({ ...props }) => <ol className="mb-2 ml-5 list-decimal space-y-1" {...props} />,
          li: ({ ...props }) => <li className="pl-1" {...props} />,
          blockquote: ({ ...props }) => (
            <blockquote className="mb-2 border-l-2 border-[var(--border-soft)] pl-3 text-[var(--text-muted)]" {...props} />
          ),
          a: ({ ...props }) => (
            <a className="text-[var(--brand)] underline underline-offset-2 hover:opacity-90" target="_blank" rel="noreferrer" {...props} />
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isBlock = typeof codeClassName === 'string' && codeClassName.includes('language-')
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-md border border-[var(--border-soft)] bg-[rgba(6,12,22,0.92)] p-3 text-xs leading-6 text-[#d5e8ff]" {...props}>
                  {children}
                </code>
              )
            }

            return (
              <code className="rounded px-1.5 py-0.5 text-xs bg-[rgba(8,16,29,0.72)] border border-[var(--border-soft)] text-[#d5e8ff]" {...props}>
                {children}
              </code>
            )
          },
          pre: ({ ...props }) => <pre className="mb-2" {...props} />,
          table: ({ ...props }) => (
            <div className="mb-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ ...props }) => <th className="border border-[var(--border-soft)] px-2 py-1 text-left font-semibold" {...props} />,
          td: ({ ...props }) => <td className="border border-[var(--border-soft)] px-2 py-1 align-top" {...props} />,
          hr: ({ ...props }) => <hr className="my-3 border-[var(--border-soft)]" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
