import { useRegisterSW } from "virtual:pwa-register/react";
import { UpdatePrompt } from "@/shared/pwa/UpdatePrompt";

/** Registers the service worker (production builds) and offers waiting updates. */
export function PwaUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  return (
    <UpdatePrompt
      needRefresh={needRefresh}
      onReload={() => updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    />
  );
}
