import { useId, useState } from "react";
import { useDispatch } from "react-redux";
import { changePassword } from "@/features/auth/authSlice";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { PasswordInput } from "@/shared/components/ui/password-input";
import { notify } from "@/shared/notificationSlice";

const MIN = 8;

/**
 * Current password, new password, and the new one again. Used for the forced
 * change (after an invite or a reset) and from the drawer. The server has the
 * final say (wrong current password, a default-looking new one).
 *
 * `knownCurrent`: the current password when the app already has it (typed at
 * this sign-in), so the field is left out and it's sent as is.
 */
export function ChangePasswordForm({
  onDone,
  onCancel,
  knownCurrent = null,
  currentLabel = "Current password",
  submitLabel = "Change password",
}) {
  const dispatch = useDispatch();
  const ids = useId();
  const [current, setCurrent] = useState(knownCurrent ?? "");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (next.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (next !== again) return setError("The new passwords don’t match.");
    setBusy(true);
    setError(null);
    const result = await dispatch(changePassword({ currentPassword: current, newPassword: next }));
    setBusy(false);
    if (changePassword.fulfilled.match(result)) {
      dispatch(notify({ type: "success", message: "Password changed" }));
      onDone?.();
    } else {
      setError(result.payload?.message ?? "Couldn’t change the password.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {knownCurrent == null && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-current`}>{currentLabel}</Label>
          <PasswordInput
            id={`${ids}-current`}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-new`}>New password</Label>
        <PasswordInput
          id={`${ids}-new`}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoFocus={knownCurrent != null}
        />
        <p className="text-xs text-muted-foreground">At least {MIN} characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-again`}>New password again</Label>
        <PasswordInput id={`${ids}-again`} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy || !current || !next || !again}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
