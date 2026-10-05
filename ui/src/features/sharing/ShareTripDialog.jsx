import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Check, Copy, RefreshCw, UserMinus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { apiClient } from "@/shared/services/apiClient";

function CopyCode({ value, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
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

function CodeSection({ title, hint, children, action }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
      {action}
    </section>
  );
}

/**
 * One of the trip's two codes: loaded when the dialog opens, renewable with
 * a two-tap confirm (the old code stops working; whoever already joined
 * keeps their access).
 */
function useShareCode(tripId, kind, open) {
  const [code, setCode] = useState(null); // null while loading
  const [failed, setFailed] = useState(false);
  const [renewing, setRenewing] = useState(null); // null | "confirm" | "busy" | "done"

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setFailed(false);
    setRenewing(null);
    apiClient
      .get(`/trips/${tripId}/${kind}-code`, { silent: true, offlineOk: true })
      .then(({ data }) => live && setCode(data.code))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, tripId, kind]);

  async function renew() {
    if (renewing !== "confirm") {
      setRenewing("confirm");
      return;
    }
    setRenewing("busy");
    try {
      const { data } = await apiClient.post(`/trips/${tripId}/${kind}-code`, null, { silent: true });
      setCode(data.code);
      setRenewing("done");
    } catch {
      setRenewing(null);
    }
  }

  return { code, failed, renewing, renew };
}

const RENEWED = "New code made. The old one no longer works; anyone who already joined keeps their access.";

/** A code with its copy button and "New … code", in one Share section. */
function ShareCode({ title, hint, word, share, online }) {
  const { code, failed, renewing, renew } = share;
  return (
    <CodeSection
      title={title}
      hint={renewing === "done" ? RENEWED : hint}
      action={
        code !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={!online || renewing === "busy"}
            onClick={renew}
            aria-label={renewing === "confirm" ? `Confirm a new ${word} code` : `New ${word} code`}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {renewing === "confirm" ? "Confirm: the old code stops working" : `New ${word} code`}
          </Button>
        )
      }
    >
      {failed ? (
        <p className="text-sm text-muted-foreground">
          {online ? `Couldn’t load the ${word} code.` : `The ${word} code shows when you’re online.`}
        </p>
      ) : code === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <CopyCode value={code} label={`Copy ${word} code`} />
      )}
    </CodeSection>
  );
}

/**
 * The owner's Share screen: two codes to send (the other person pastes one
 * into "Join trip"), each a secret the owner can replace. Below, who has
 * joined and how, each removable.
 */
export function ShareTripDialog({ trip, open, onClose }) {
  const online = useSelector((s) => s.network?.online ?? true);
  const [members, setMembers] = useState(null); // null while loading
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(null); // userId awaiting a second tap
  const viewCode = useShareCode(trip.id, "view", open);
  const editCode = useShareCode(trip.id, "edit", open);

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
      description="Send one of these codes. They tap Join trip on their trips list and paste it."
    >
      <div className="flex flex-col gap-4">
        <ShareCode
          title="Can view"
          word="view"
          hint="Sees the plan, the map and the memories you mark public. No confirmation numbers."
          share={viewCode}
          online={online}
        />
        <ShareCode
          title="Can edit"
          word="edit"
          hint="Can also change days, activities, stays and travel, and sees every memory. Only you can delete the trip or remove people."
          share={editCode}
          online={online}
        />
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
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.role === "editor" ? "Can edit" : "Can view"}
                  </span>
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
