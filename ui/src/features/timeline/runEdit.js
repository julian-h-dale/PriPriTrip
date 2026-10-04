/**
 * Resolve a dispatched edit thunk to `{ ok }` or the server's
 * `{ detail, errors }`, the shape every edit form's `onSave` expects.
 * `{ reloaded: true }`: someone else changed or removed the entry, the trip
 * was reloaded and a warning shown, so the form just closes.
 */
export async function runEdit(dispatch, thunk) {
  const result = await dispatch(thunk);
  return result.meta.requestStatus === "fulfilled"
    ? { ok: true }
    : { ok: false, ...(result.payload ?? { detail: "Couldn’t save", errors: [] }) };
}
