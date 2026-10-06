import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A value to send someone (a trip code, a temporary password), with a copy button. */
export function CopyField({ value, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the value is on screen to copy by hand.
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
      <span className="min-w-0 flex-1 break-all font-mono text-sm">{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="rounded-sm p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
