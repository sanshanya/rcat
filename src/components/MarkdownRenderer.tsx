import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

interface MarkdownRendererProps {
  content: string;
  className?: string; // Additional classes
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  return (
    <button 
      className={clsx("code-copy-btn", copied ? "copied" : "")}
      onClick={handleCopy}
      aria-label="Copy code"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={clsx("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: { node: any, inline?: boolean, className?: string, children?: React.ReactNode } & any) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            
            return !inline && match ? (
              <div className="code-block-wrapper">
                <div className="code-header">
                  <span className="code-lang">{match[1]}</span>
                  <CopyButton text={codeString} />
                </div>
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0 0 6px 6px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className={clsx("inline-code", className)} {...props}>
                {children}
              </code>
            );
          },
          // Customizing other elements for "Pro" feel
          a: ({ node, ...props }: any) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="md-link" />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
