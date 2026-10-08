import { cn } from "@/shared/utils/cn";

/**
 * An on/off switch (`role="switch"`), hand-rolled in the shadcn shape like
 * the dialog. Label it with a `<label htmlFor={id}>` beside it.
 */
export function Switch({ id, checked, onChange, disabled = false, className, ...props }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        checked ? "bg-primary" : "bg-muted",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 rounded-full transition-transform",
          checked ? "translate-x-6 bg-primary-foreground" : "translate-x-1 bg-muted-foreground",
        )}
      />
    </button>
  );
}
