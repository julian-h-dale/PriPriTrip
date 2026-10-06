import { useId, useState } from "react";
import { useDispatch } from "react-redux";
import { inviteUser } from "@/features/admin/adminSlice";
import { CopyField } from "@/shared/components/CopyField";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { notify } from "@/shared/notificationSlice";

/**
 * Admins: make an account for someone. The server picks a random temporary
 * password, shown here once to send them; they choose their own when they
 * first sign in. Then they join a trip with its code, as anyone does.
 */
export function InviteUserDialog({ open, onClose }) {
  const dispatch = useDispatch();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState(null); // { user, temporaryPassword }

  function close() {
    setEmail("");
    setName("");
    setError(null);
    setInvited(null);
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.includes("@")) return setError("Enter their email address.");
    setBusy(true);
    setError(null);
    const result = await dispatch(inviteUser({ email: email.trim(), name: name.trim() }));
    setBusy(false);
    if (inviteUser.fulfilled.match(result)) {
      setInvited(result.payload);
      dispatch(notify({ type: "success", message: "Account created" }));
    } else {
      setError(result.payload?.message ?? "Couldn’t create the account.");
    }
  }

  if (invited) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Send them this"
        description={`${invited.user.email} signs in with this temporary password, then chooses their own. It won’t be shown again.`}
      >
        <div className="flex flex-col gap-4">
          <CopyField value={invited.temporaryPassword} label="Copy temporary password" />
          <p className="text-xs text-muted-foreground">
            To follow a trip, they’ll also need its view code (Share trip, on the trip).
          </p>
          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={() => !busy && close()} title="Invite someone" description="Make an account for them.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-email`}>Email</Label>
          <Input
            id={`${ids}-email`}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-name`}>Name (optional)</Label>
          <Input id={`${ids}-name`} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
