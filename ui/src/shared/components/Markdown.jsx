import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/shared/utils/cn";

// react-markdown passes its AST `node` to custom components; keep it off the DOM.
function element(Tag, className, extra = {}) {
  function MarkdownElement(props) {
    const rest = { ...props };
    delete rest.node;
    return <Tag className={className} {...extra} {...rest} />;
  }
  return MarkdownElement;
}

// Raw HTML in the source is not rendered (react-markdown's default), so a
// document can't inject markup. Links open in a new tab.
const components = {
  p: element("p", "my-1.5 first:mt-0 last:mb-0"),
  ul: element("ul", "my-1.5 list-disc pl-5"),
  ol: element("ol", "my-1.5 list-decimal pl-5"),
  li: element("li", "my-0.5"),
  strong: element("strong", "font-semibold text-foreground"),
  a: element("a", "text-primary underline underline-offset-2", {
    target: "_blank",
    rel: "noopener noreferrer",
  }),
  code: element("code", "rounded-sm bg-muted px-1 font-mono text-[0.9em]"),
};

export function Markdown({ children, className }) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
