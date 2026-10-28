import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Learning texts and catalog descriptions. Raw HTML is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="ag-md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
