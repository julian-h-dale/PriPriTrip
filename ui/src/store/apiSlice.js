import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { logout } from './authSlice';
import {
  cacheTrip,
  cacheTripList,
  getCachedTrip,
  getCachedTripList,
} from '../utils/tripCache';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  prepareHeaders: (headers) => {
    const token = localStorage.getItem('token');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

/**
 * Base query that clears auth and redirects on 401 — except for /auth/*
 * requests, so a failed login doesn't trigger a redirect loop (review 2B-6).
 */
async function baseQueryWithAuth(args, api, extraOptions) {
  const result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === 'string' ? args : (args?.url ?? '');
  if (result.error?.status === 401 && !url.startsWith('/auth/')) {
    api.dispatch(logout());
    window.location.href = '/login';
  }
  return result;
}

/** True when the request never reached the server (offline, DNS, timeout). */
function isNetworkError(error) {
  return error?.status === 'FETCH_ERROR' || error?.status === 'TIMEOUT_ERROR';
}

/** Tags every trip-content mutation should invalidate. */
function tripContentTags(tripId) {
  return [
    { type: 'Trip', id: tripId },
    { type: 'Verify', id: tripId },
    // Any content change can open or close a gap, so the banner refetches too.
    { type: 'Gaps', id: tripId },
  ];
}

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuth,
  tagTypes: ['Trips', 'Trip', 'Verify', 'AiDocuments', 'Gaps'],
  endpoints: (builder) => ({
    // ── queries ──────────────────────────────────────────────────────────
    getTrips: builder.query({
      // Try the network, mirror successes into IndexedDB, and serve the
      // cached list when the network is unreachable (offline fallback).
      async queryFn(arg, api, extraOptions, fetchWithBQ) {
        const result = await fetchWithBQ('/trips');
        if (!result.error) {
          await cacheTripList(result.data).catch(() => {});
          return { data: result.data };
        }
        if (isNetworkError(result.error)) {
          const cached = await getCachedTripList().catch(() => null);
          if (cached) return { data: cached };
        }
        return { error: result.error };
      },
      providesTags: ['Trips'],
    }),
    getTrip: builder.query({
      async queryFn(tripId, api, extraOptions, fetchWithBQ) {
        const result = await fetchWithBQ(`/trips/${tripId}`);
        if (!result.error) {
          await cacheTrip(result.data).catch(() => {});
          return { data: result.data };
        }
        if (isNetworkError(result.error)) {
          const cached = await getCachedTrip(tripId).catch(() => null);
          if (cached) return { data: cached };
        }
        return { error: result.error };
      },
      providesTags: (result, error, tripId) => [{ type: 'Trip', id: tripId }],
    }),
    verifyTrip: builder.query({
      query: (tripId) => `/trips/${tripId}/verify`,
      providesTags: (result, error, tripId) => [{ type: 'Verify', id: tripId }],
    }),
    getAiDocuments: builder.query({
      query: (tripId) => `/trips/${tripId}/ai-documents`,
      providesTags: (result, error, tripId) => [{ type: 'AiDocuments', id: tripId }],
    }),
    getTripGaps: builder.query({
      query: (tripId) => `/trips/${tripId}/gaps`,
      providesTags: (result, error, tripId) => [{ type: 'Gaps', id: tripId }],
    }),
    submitTripGap: builder.mutation({
      // Costs no model call: the values go straight through the executor.
      query: ({ tripId, ...body }) => ({
        url: `/trips/${tripId}/gaps/submit`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),

    // ── trip-level mutations ─────────────────────────────────────────────
    saveTripHeader: builder.mutation({
      query: (payload) => ({
        url: `/trips/${payload.tripId}`,
        method: 'PUT',
        body: payload,
      }),
      invalidatesTags: (result, error, payload) => [
        'Trips',
        ...tripContentTags(payload.tripId),
      ],
    }),
    deleteTrip: builder.mutation({
      query: (tripId) => ({ url: `/trips/${tripId}`, method: 'DELETE' }),
      invalidatesTags: (result, error, tripId) => [
        'Trips',
        { type: 'Trip', id: tripId },
      ],
    }),
    importTrip: builder.mutation({
      query: (draft) => ({
        url: `/trips/${draft.tripId}/import`,
        method: 'POST',
        body: draft,
      }),
      invalidatesTags: (result, error, draft) => [
        'Trips',
        ...tripContentTags(draft.tripId),
      ],
    }),
    saveAiDocumentRecords: builder.mutation({
      query: ({ documentId, stays, travels }) => ({
        url: `/ai-documents/${documentId}/save`,
        method: 'POST',
        body: { stays, travels },
      }),
      invalidatesTags: (result, error, { tripId }) =>
        tripId
          ? [...tripContentTags(tripId), { type: 'AiDocuments', id: tripId }]
          : [],
    }),

    // ── points ───────────────────────────────────────────────────────────
    createPoint: builder.mutation({
      query: ({ tripId, point }) => ({
        url: `/trips/${tripId}/points`,
        method: 'POST',
        body: point,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    patchPoint: builder.mutation({
      query: ({ tripId, pointId, patch }) => ({
        url: `/trips/${tripId}/points/${pointId}`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    deletePoint: builder.mutation({
      query: ({ tripId, pointId }) => ({
        url: `/trips/${tripId}/points/${pointId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),

    // ── stay details ─────────────────────────────────────────────────────
    createStayDetail: builder.mutation({
      query: ({ tripId, stay }) => ({
        url: `/trips/${tripId}/stay-details`,
        method: 'POST',
        body: stay,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    patchStayDetail: builder.mutation({
      query: ({ tripId, stayDetailId, patch }) => ({
        url: `/trips/${tripId}/stay-details/${stayDetailId}`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    deleteStayDetail: builder.mutation({
      query: ({ tripId, stayDetailId }) => ({
        url: `/trips/${tripId}/stay-details/${stayDetailId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),

    // ── travel details ───────────────────────────────────────────────────
    createTravelDetail: builder.mutation({
      query: ({ tripId, travel }) => ({
        url: `/trips/${tripId}/travel-details`,
        method: 'POST',
        body: travel,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    patchTravelDetail: builder.mutation({
      query: ({ tripId, travelDetailId, patch }) => ({
        url: `/trips/${tripId}/travel-details/${travelDetailId}`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
    deleteTravelDetail: builder.mutation({
      query: ({ tripId, travelDetailId }) => ({
        url: `/trips/${tripId}/travel-details/${travelDetailId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { tripId }) => tripContentTags(tripId),
    }),
  }),
});

export const {
  useGetTripsQuery,
  useGetTripQuery,
  useVerifyTripQuery,
  useLazyVerifyTripQuery,
  useGetAiDocumentsQuery,
  useGetTripGapsQuery,
  useSubmitTripGapMutation,
  useSaveTripHeaderMutation,
  useDeleteTripMutation,
  useImportTripMutation,
  useSaveAiDocumentRecordsMutation,
  useCreatePointMutation,
  usePatchPointMutation,
  useDeletePointMutation,
  useCreateStayDetailMutation,
  usePatchStayDetailMutation,
  useDeleteStayDetailMutation,
  useCreateTravelDetailMutation,
  usePatchTravelDetailMutation,
  useDeleteTravelDetailMutation,
} = apiSlice;
