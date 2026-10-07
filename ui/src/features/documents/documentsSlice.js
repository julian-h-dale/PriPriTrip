import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { extension } from "@/features/documents/files";
import { saveToPhone } from "@/features/journal/saveToPhone";
import { apiClient } from "@/shared/services/apiClient";

/**
 * A trip's documents (GET /trips/:id/documents): files kept on the server as
 * a hard-copy fallback, for the owner and editors. Nothing is cached on the
 * phone; "Download all" saves one zip to keep there instead.
 */
export const fetchDocuments = createAsyncThunk("documents/fetch", async (tripId) => {
  const { data } = await apiClient.get(`/trips/${tripId}/documents`, { silent: true, offlineOk: true });
  return { tripId, documents: data };
});

export const uploadDocument = createAsyncThunk("documents/upload", async ({ tripId, file }) => {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post(`/trips/${tripId}/documents`, form);
  return data;
});

export const replaceDocument = createAsyncThunk("documents/replace", async ({ tripId, id, file }) => {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.put(`/trips/${tripId}/documents/${id}/file`, form);
  return data;
});

export const renameDocument = createAsyncThunk("documents/rename", async ({ tripId, id, name }) => {
  const { data } = await apiClient.patch(`/trips/${tripId}/documents/${id}`, { name });
  return data;
});

export const deleteDocument = createAsyncThunk("documents/delete", async ({ tripId, id }) => {
  await apiClient.delete(`/trips/${tripId}/documents/${id}`);
  return id;
});

/** Fetch a file with the sign-in header (a plain link can't send it), then save it. */
async function download(url, filename) {
  const { data } = await apiClient.get(url, { responseType: "blob", silent: true });
  return saveToPhone(new File([data], filename, { type: data.type || "application/octet-stream" }));
}

/** The document's file, saved as `<name>.<ext>`. */
export const downloadDocument = createAsyncThunk("documents/download", async ({ tripId, doc }) =>
  download(`/trips/${tripId}/documents/${doc.id}/file`, `${doc.name}${extension(doc.filename)}`)
);

/** Every document in one zip, `<trip name> documents.zip`. */
export const downloadAllDocuments = createAsyncThunk("documents/downloadAll", async ({ tripId, tripName }) =>
  download(`/trips/${tripId}/documents.zip`, `${tripName || "Trip"} documents.zip`)
);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const documentsSlice = createSlice({
  name: "documents",
  initialState: { tripId: null, documents: [], status: "idle" },
  reducers: {},
  extraReducers: (builder) => {
    const put = (state, action) => {
      if (state.tripId !== action.meta.arg.tripId) return;
      state.documents = [...state.documents.filter((d) => d.id !== action.payload.id), action.payload].sort(byName);
    };
    builder
      .addCase(fetchDocuments.pending, (state, action) => {
        if (state.tripId !== action.meta.arg) {
          state.tripId = action.meta.arg;
          state.documents = [];
          state.status = "loading";
        }
      })
      .addCase(fetchDocuments.fulfilled, (state, action) => {
        if (state.tripId !== action.payload.tripId) return;
        state.documents = action.payload.documents;
        state.status = "ready";
      })
      .addCase(fetchDocuments.rejected, (state, action) => {
        if (state.tripId === action.meta.arg && state.status === "loading") state.status = "failed";
      })
      .addCase(uploadDocument.fulfilled, put)
      .addCase(replaceDocument.fulfilled, put)
      .addCase(renameDocument.fulfilled, put)
      .addCase(deleteDocument.fulfilled, (state, action) => {
        state.documents = state.documents.filter((d) => d.id !== action.payload);
      });
  },
});

export default documentsSlice.reducer;
