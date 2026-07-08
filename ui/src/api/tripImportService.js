import client from './client';

/**
 * Upload an itinerary document (.xlsx/.pdf/.docx) and get back a draft trip
 * (TripImport shape) produced by the AI. Nothing is persisted server-side yet.
 * This runs the structure pass only — call enhanceTrip separately to enrich it.
 */
export async function aiImportDocument(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await client.post('/trip/ai-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/**
 * Run the AI enhance pass on a draft trip: expands day narratives and adds
 * concise point/location descriptions. IDs and factual fields are preserved.
 */
export async function enhanceTrip(draft) {
  const { data } = await client.post('/trip/ai-enhance', draft);
  return data;
}

/** Persist a draft trip via the existing import endpoint. */
export async function saveImportedTrip(draft) {
  const { data } = await client.post('/trip/import', draft);
  return data;
}

/** Load a persisted trip by id. */
export async function getTrip(tripId) {
  const { data } = await client.get(`/trips/${tripId}`);
  return data;
}

/** Run deterministic trip verification checks. */
export async function verifyTrip(tripId) {
  const { data } = await client.get(`/trips/${tripId}/verify`);
  return data;
}
