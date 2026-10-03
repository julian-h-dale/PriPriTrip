import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Check, Copy, UserMinus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { apiClient } from "@/shared/services/apiClient";

function CopyId({ value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the id is on screen to copy by hand.
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
      <span className="min-w-0 flex-1 break-all font-mono text-sm">{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy trip id"
        className="rounded-sm p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * The owner's Share screen: the trip's id to send (the other person pastes it
 * into "Join trip"), and who has joined, each removable.
 */
export function ShareTripDialog({ trip, open, onClose }) {
  const online = useSelector((s) => s.network?.online ?? true);
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
      description="Send this trip id. They tap Join trip on their trips list and paste it. They’ll see everything, but only you can change the trip."
    >
      <div className="flex flex-col gap-4">
        <CopyId value={trip.id} />
        <section aria-label="Shared with" className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared with</h3>
          {failed ? (
            <p className="text-sm text-muted-foreground">
              {online ? "Couldn’t load who has joined." : "Who has joined shows when you’re online."}
            </p>
          ) : members === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{m.email}</span>
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
