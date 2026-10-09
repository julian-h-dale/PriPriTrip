import { useEffect, useId, useState } from "react";
import { useSelector } from "react-redux";
import { UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select } from "@/shared/components/ui/select";
import { apiClient } from "@/shared/services/apiClient";
import { selectOnline } from "@/shared/networkSlice";

const ROLE_HINT = {
  viewer: "Sees the plan, the map and the memories you mark public. No confirmation numbers.",
  editor: "Can also change days, activities, stays and travel, and sees every memory. Only you can delete the trip or remove people.",
};

function inviteError(err) {
  const status = err?.response?.status;
  if (status === 404) return "No account with that email. An admin can make one.";
  if (status === 409) return "That’s you: you own this trip.";
  if (status === 422) return "Enter their email address.";
  return "Couldn’t add them. Try again.";
}

/** Add someone by their account's email, as a viewer or an editor. */
function InviteForm({ tripId, online, onAdded }) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.includes("@")) return setError("Enter their email address.");
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post(
        `/trips/${tripId}/members`,
        { email: email.trim(), role },
        { silent: true }
      );
      setEmail("");
      onAdded(data);
    } catch (err) {
      setError(inviteError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Invite" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-email`}>Email</Label>
        <Input
          id={`${ids}-email`}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-error` : undefined}
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${ids}-role`}>Can</Label>
          <Select id={`${ids}-role`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">View</option>
            <option value="editor">Edit</option>
          </Select>
        </div>
        <Button type="submit" disabled={busy || !online || !email.trim()} title={online ? undefined : "You’re offline"}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {busy ? "Adding…" : "Invite"}
        </Button>
      </div>
      {error ? (
        <p id={`${ids}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
      )}
    </form>
  );
}

/**
 * The owner's Share screen: invite someone by email (they need an account),
 * then who's on the trip, each with their role (changeable) and Remove.
 * The trip shows on their trips list the next time it loads.
 */
export function ShareTripDialog({ trip, open, onClose }) {
  const online = useSelector(selectOnline);
  const [members, setMembers] = useState(null); // null while loading
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(null); // userId awaiting a second tap

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setFailed(false);
    apiClient
      .get(`/trips/${trip.id}/members`, { silent: true, offlineOk: true })
      .then(({ data }) => live && setMembers(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, trip.id]);

  // An invite of someone already on the trip changes their role in place.
  function added(member) {
    setMembers((list) =>
      list?.some((m) => m.userId === member.userId)
        ? list.map((m) => (m.userId === member.userId ? member : m))
        : [...(list ?? []), member]
    );
  }

  async function changeRole(member, role) {
    const before = member.role;
    setMembers((list) => list.map((m) => (m.userId === member.userId ? { ...m, role } : m)));
    try {
      await apiClient.patch(`/trips/${trip.id}/members/${member.userId}`, { role }, { silent: true });
    } catch {
      setMembers((list) => list.map((m) => (m.userId === member.userId ? { ...m, role: before } : m)));
    }
  }

  async function remove(userId) {
    if (confirming !== userId) {
      setConfirming(userId);
      return;
    }
    setConfirming(null);
    await apiClient.delete(`/trips/${trip.id}/members/${userId}`, { silent: true });
    setMembers((list) => list.filter((m) => m.userId !== userId));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share trip"
      description="Add someone by the email they sign in with."
    >
      <div className="flex flex-col gap-4">
        <InviteForm tripId={trip.id} online={online} onAdded={added} />
        <section aria-label="Shared with" className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared with</h3>
          {failed ? (
            <p className="text-sm text-muted-foreground">
              {online ? "Couldn’t load who’s on the trip." : "Who’s on the trip shows when you’re online."}
            </p>
          ) : members === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5">
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-sm">{m.name || m.email}</span>
                    {m.name && <span className="block truncate text-xs text-muted-foreground">{m.email}</span>}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      disabled={!online}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="h-9 w-[7.5rem]"
                    >
                      <option value="viewer">Can view</option>
                      <option value="editor">Can edit</option>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!online}
                      onClick={() => remove(m.userId)}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      aria-label={confirming === m.userId ? `Confirm removing ${m.email}` : `Remove ${m.email}`}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden="true" />
                      {confirming === m.userId ? "Confirm" : "Remove"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
