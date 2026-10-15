import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import { signOut, tokenAdopted } from "@/features/auth/authSlice";
import { Button } from "@/shared/components/ui/button";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { apiClient } from "@/shared/services/apiClient";
import { userIdFromToken } from "@/shared/utils/authToken";

function Message({ title, children }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

/** What a dead link says: rotated, turned off, or the trip deleted. */
function LinkEnded({ signedIn }) {
  return (
    <Message title="This link doesn’t work any more">
      <p className="text-sm text-muted-foreground">Ask whoever sent it for a new one.</p>
      {signedIn && (
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Your trips
        </Link>
      )}
    </Message>
  );
}

/** `/link-ended`: where a guest lands when their link stops working mid-visit. */
export function LinkEndedPage() {
  const token = useSelector((s) => s.auth.token);
  return <LinkEnded signedIn={Boolean(token)} />;
}

/**
 * `/s/:secret`, a trip's secret link (Run stage 31): signs this browser in as
 * the trip's link guest and opens its timeline, with no account needed.
 * Someone already signed in who's on the trip just goes to it; anyone else
 * signed in is asked before being switched to the guest.
 */
export function LinkPage() {
  const { secret } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const token = useSelector((s) => s.auth.token);
  const email = useSelector((s) => s.auth.user?.email);
  // loading | dead | failed | { confirm: { tripId, guestToken } }
  const [state, setState] = useState("loading");
  const started = useRef(false);

  function adopt(guestToken, tripId) {
    dispatch(tokenAdopted(guestToken));
    navigate(`/trips/${tripId}`, { replace: true });
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let session;
      try {
        ({ data: session } = await apiClient.post(`/links/${encodeURIComponent(secret)}/session`, null, {
          silent: true,
          handles: [404], // a dead link has its own page, not an error toast
        }));
      } catch (err) {
        setState(err.response?.status === 404 ? "dead" : "failed");
        return;
      }
      const { access_token: guestToken, trip_id: tripId } = session;
      if (token && userIdFromToken(token) !== userIdFromToken(guestToken)) {
        try {
          await apiClient.get(`/trips/${tripId}`, { silent: true, handles: [403, 404] });
          navigate(`/trips/${tripId}`, { replace: true }); // already on the trip
        } catch (err) {
          // Signed out meanwhile (an expired sign-in): nothing to ask.
          if (err.response?.status === 401) adopt(guestToken, tripId);
          else setState({ confirm: { tripId, guestToken } });
        }
        return;
      }
      adopt(guestToken, tripId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

  if (state === "dead") return <LinkEnded signedIn={Boolean(token)} />;
  if (state === "failed") {
    return (
      <Message title="Couldn’t open the link">
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Message>
    );
  }
  if (state.confirm) {
    const { tripId, guestToken } = state.confirm;
    return (
      <Dialog
        open
        onClose={() => navigate("/", { replace: true })}
        title="Open as a guest?"
        description={`You’ll be signed out of ${email ?? "your account"}.`}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await dispatch(signOut());
              adopt(guestToken, tripId);
            }}
          >
            Open as a guest
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }
  return <div aria-label="Opening the trip" className="h-dvh bg-background" />;
}
