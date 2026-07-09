import client from './client';

/**
 * Upload an itinerary document (.xlsx/.pdf/.docx) and get back a draft trip
 * (TripImport shape) produced by the AI. Nothing is persisted server-side yet.
 * This runs the structure pass only — call enhanceTrip separately to enrich it.
 */
export async function aiImportDocument(file, options = {}) {
  const form = new FormData();
  form.append('file', file);
  if (options.tripId) {
    form.append('tripId', options.tripId);
  }
  const { data } = await client.post('/trip/ai-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function saveTripHeader(payload) {
  const { data } = await client.post('/trips', payload);
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

/** Update one travel detail record. */
export async function patchTravelDetail(tripId, travelDetailId, payload) {
  const { data } = await client.patch(`/trips/${tripId}/travel-details/${travelDetailId}`, payload);
  return data;
}

/** Extract records from a document for an existing trip or itinerary workflow mode. */
export async function aiImportTripDocument(tripId, file, workflowMode = 'detail_import') {
  const form = new FormData();
  form.append('tripId', tripId);
  form.append('workflowMode', workflowMode);
  form.append('file', file);
  const { data } = await client.post('/trip/ai-document', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Save selected extracted stay/travel records from an AI document extraction. */
export async function saveAiDocumentRecords(documentId, payload) {
  const { data } = await client.post(`/trip/ai-document/${documentId}/save`, payload);
  return data;
}

export async function listAiDocuments(tripId) {
  const { data } = await client.get(`/trips/${tripId}/ai-documents`);
  return data;
}

export async function getAiDocumentExtraction(documentId) {
  const { data } = await client.get(`/trip/ai-document/${documentId}`);
  return data;
}

export async function regenAiDocumentExtraction(documentId) {
  const { data } = await client.post(`/trip/ai-document/${documentId}/regen`);
  return data;
}
