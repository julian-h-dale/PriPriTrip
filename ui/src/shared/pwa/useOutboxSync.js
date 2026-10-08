import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectPendingMemories, syncOutbox } from "@/features/journal/journalSlice";
import { syncPacking } from "@/features/packing/packingSlice";
import { selectOnline } from "@/shared/networkSlice";

const RETRY_MS = 30_000;

/**
 * Send the phone's outbox (memories written offline) and packing changes
 * (Run stage 21) whenever they might go
 * through: on sign-in/app start, when the connection comes back, when the app
 * returns to the foreground, and every 30 s while anything is waiting. iOS
 * has no background sync for web apps, so this runs while the app is open —
 * which is exactly when someone who just landed opens it.
 */
export function useOutboxSync() {
  const dispatch = useDispatch();
  const token = useSelector((s) => s.auth.token);
  const online = useSelector(selectOnline);
  const waiting = useSelector(selectPendingMemories);

  useEffect(() => {
    if (token && online) {
      dispatch(syncOutbox());
      dispatch(syncPacking());
    }
  }, [dispatch, token, online]);

  useEffect(() => {
    if (!token) return undefined;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      dispatch(syncOutbox());
      dispatch(syncPacking());
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [dispatch, token]);

  useEffect(() => {
    if (!token || !online || waiting === 0) return undefined;
    const timer = setInterval(() => dispatch(syncOutbox()), RETRY_MS);
    return () => clearInterval(timer);
  }, [dispatch, token, online, waiting]);
}
