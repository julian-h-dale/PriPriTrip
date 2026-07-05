import client from './client';

/**
 * Upload an itinerary document (.xlsx/.pdf/.docx) and get back a draft trip
 * (TripImport shape) produced by the AI. Nothing is persisted server-side yet.
 */
export async function aiImportDocument(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await client.post('/trip/ai-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Persist a draft trip via the existing import endpoint. */
export async function saveImportedTrip(draft) {
  await client.post('/trip/import', draft);
  return draft;
}
