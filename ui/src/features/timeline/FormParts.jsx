import { Label } from "@/shared/components/ui/label";

/** A labelled form field with an inline error (or a hint when there's none). */
export function Field({ id, label, error, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Server problems that didn't map onto a field. */
export function FormProblems({ problems }) {
  if (!problems) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/60 p-3 text-sm">
      <p className="font-medium text-destructive">{problems.detail}</p>
      {problems.errors.map((err, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          <code className="font-mono text-foreground">{err.path}</code> {err.message}
        </p>
      ))}
    </div>
  );
}
