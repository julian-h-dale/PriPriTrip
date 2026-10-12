import { useEffect, useId, useState } from "react";
import { useSelector } from "react-redux";
import { RefreshCw } from "lucide-react";
import { CopyField } from "@/shared/components/CopyField";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Switch } from "@/shared/components/ui/switch";
import { selectOnline } from "@/shared/networkSlice";
import { apiClient } from "@/shared/services/apiClient";

/** The full link for a secret, on this app's own address. */
function linkUrl(secret, origin = window.location.origin) {
  return `${origin}/s/${secret}`;
}

const CONFIRM = {
  rotate: {
    title: "Make a new link?",
    description: "The current link stops working, and anyone using it will need the new one.",
    action: "Make a new link",
  },
  off: {
    title: "Turn off the link?",
    description: "The link stops working, and anyone using it is signed out.",
    action: "Turn off",
  },
};

/**
 * A trip's secret link (Run stage 31), for its owner, under who's on the
 * trip: on, it's a link anyone can open to view the trip with no account
 * (family following along). Rotate makes a new one; off ends it.
 */
export function LinkSharing({ tripId }) {
  const online = useSelector(selectOnline);
  const id = useId();
  const [link, setLink] = useState(null); // { enabled, secret }, null while loading
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null); // "rotate" | "off"

  useEffect(() => {
    let live = true;
    apiClient
      .get(`/trips/${tripId}/link`, { silent: true, offlineOk: true })
      .then(({ data }) => live && setLink(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [tripId, online]);

  async function run(request) {
    setBusy(true);
    try {
      const { data } = await request();
      setLink(data ?? { enabled: false, secret: null });
    } catch {
      // The interceptor says what went wrong; the switch stays as it was.
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const turnOn = () => run(() => apiClient.post(`/trips/${tripId}/link`));
  const rotate = () => run(() => apiClient.post(`/trips/${tripId}/link/rotate`));
  const turnOff = () => run(() => apiClient.delete(`/trips/${tripId}/link`));
  const confirm = confirming && CONFIRM[confirming];

  return (
    <section aria-label="Link sharing" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Link sharing</h3>
      {failed ? (
        <p className="text-sm text-muted-foreground">
          {online ? "Couldn’t load the link." : "The link shows when you’re online."}
        </p>
      ) : link === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor={id} className="text-sm">
                Anyone with the link can view
              </label>
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                No account needed. They see what viewers see: the plan, the map and the memories you mark public.
              </p>
            </div>
            <Switch
              id={id}
              checked={link.enabled}
              aria-describedby={`${id}-hint`}
              disabled={!online || busy}
              onChange={(on) => (on ? turnOn() : setConfirming("off"))}
            />
          </div>
          {link.enabled && link.secret && (
            <>
              <CopyField value={linkUrl(link.secret)} label="Copy link" />
              <div>
                <Button variant="outline" size="sm" disabled={!online || busy} onClick={() => setConfirming("rotate")}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Make a new link
                </Button>
              </div>
            </>
          )}
        </>
      )}
      <Dialog open={Boolean(confirm)} onClose={() => !busy && setConfirming(null)} title={confirm?.title ?? ""} description={confirm?.description}>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirming === "rotate" ? rotate : turnOff} disabled={busy}>
            {confirm?.action}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
