// src/components/MarkdownRenderer.tsx
import { useMemo } from 'react';

interface MarkdownRendererProps {
    content: string;
}

/**
 * Simple Markdown renderer for AI responses.
 * Supports: bold, italic, code blocks, inline code, and line breaks.
 */
const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
    const html = useMemo(() => {
        if (!content) return '';

        let result = content
            // Escape HTML entities
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // Code blocks (```code```)
            .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
                return `<pre class="code-block" data-lang="${lang}"><code>${code.trim()}</code></pre>`;
            })
            // Inline code (`code`)
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            // Bold (**text**)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // Italic (*text*)
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // Line breaks
            .replace(/\n/g, '<br/>');

        return result;
    }, [content]);

    return (
        <span
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
};

export default MarkdownRenderer;
