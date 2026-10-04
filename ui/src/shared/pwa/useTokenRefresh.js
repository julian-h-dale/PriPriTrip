import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { refreshToken } from "@/features/auth/authSlice";

/**
 * Keep the sign-in sliding: on app start and whenever the app returns to the
 * foreground, swap the token for a fresh one if it's over a day old (the
 * thunk's own condition decides). Online only; nothing happens offline.
 */
export function useTokenRefresh() {
  const dispatch = useDispatch();
  const signedIn = useSelector((s) => Boolean(s.auth.token));
  const online = useSelector((s) => s.network?.online ?? true);

  useEffect(() => {
    if (!signedIn || !online) return undefined;
    dispatch(refreshToken());
    function onVisible() {
      if (document.visibilityState === "visible") dispatch(refreshToken());
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [dispatch, signedIn, online]);
}
