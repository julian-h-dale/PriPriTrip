import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectPendingMemories, syncOutbox } from "@/features/journal/journalSlice";

const RETRY_MS = 30_000;

/**
 * Send the phone's outbox (memories written offline) whenever it might go
 * through: on sign-in/app start, when the connection comes back, when the app
 * returns to the foreground, and every 30 s while anything is waiting. iOS
 * has no background sync for web apps, so this runs while the app is open —
 * which is exactly when someone who just landed opens it.
 */
export function useOutboxSync() {
  const dispatch = useDispatch();
  const token = useSelector((s) => s.auth.token);
  const online = useSelector((s) => s.network?.online ?? true);
  const waiting = useSelector(selectPendingMemories);

  useEffect(() => {
    if (token && online) dispatch(syncOutbox());
  }, [dispatch, token, online]);

  useEffect(() => {
    if (!token) return undefined;
    function onVisible() {
      if (document.visibilityState === "visible") dispatch(syncOutbox());
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
