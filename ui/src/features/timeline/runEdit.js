/**
 * Resolve a dispatched edit thunk to `{ ok }` or the server's
 * `{ detail, errors }`, the shape every edit form's `onSave` expects.
 */
export async function runEdit(dispatch, thunk) {
  const result = await dispatch(thunk);
  return result.meta.requestStatus === "fulfilled"
    ? { ok: true }
    : { ok: false, ...(result.payload ?? { detail: "Couldn’t save", errors: [] }) };
}
