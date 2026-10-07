import { apiClient } from "@/shared/services/apiClient";

let pending = null;

/** Runtime config for the signed-in client (GET /config), fetched once. */
export function getClientConfig() {
  if (!pending) {
    pending = apiClient
      .get("/config", { silent: true, offlineOk: true })
      .then(({ data }) => data)
      .catch((err) => {
        pending = null; // let a later call retry
        throw err;
      });
  }
  return pending;
}
