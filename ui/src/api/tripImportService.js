import client from './client';

/**
 * AI document endpoints that stay on axios: multipart uploads and one-shot
 * extraction workflows aren't cache-shaped, so they don't live in the RTK
 * Query api slice. Trip CRUD, import, verify, and the ai-documents list have
 * moved to src/store/apiSlice.js.
 */

/**
 * Upload an itinerary document (.xlsx/.pdf/.docx) and get back a draft trip
 * (TripImport shape) produced by the AI. Nothing is persisted server-side yet.
 */
export async function aiImportDocument(file, options = {}) {
  const form = new FormData();
  form.append('file', file);
  const url = options.tripId ? `/trips/${options.tripId}/ai-import` : '/trips/ai-import';
  const { data } = await client.post(url, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Extract records from a document for an existing trip or itinerary workflow mode. */
export async function aiImportTripDocument(tripId, file, workflowMode = 'detail_import') {
  const form = new FormData();
  form.append('workflowMode', workflowMode);
  form.append('file', file);
  const { data } = await client.post(`/trips/${tripId}/ai-documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getAiDocumentExtraction(documentId) {
  const { data } = await client.get(`/ai-documents/${documentId}`);
  return data;
}

export async function regenAiDocumentExtraction(documentId) {
  const { data } = await client.post(`/ai-documents/${documentId}/regen`);
  return data;
}
