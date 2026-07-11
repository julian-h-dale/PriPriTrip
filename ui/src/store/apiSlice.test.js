// @vitest-environment node
// Node environment keeps fetch/Request/AbortController from one implementation
// (undici); under jsdom, fetchBaseQuery mixes jsdom AbortSignal with undici
// Request and throws before the request is even issued.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

// authSlice and prepareHeaders read localStorage at import/request time.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { apiSlice } = await import('./apiSlice');
const { default: authReducer } = await import('./authSlice');
const { cacheTrip, getCachedTrip } = await import('../utils/tripCache');

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(apiSlice.middleware),
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiSlice getTrip', () => {
  it('returns server data and mirrors it into the IndexedDB cache', async () => {
    const trip = { tripId: 'net-trip', tripName: 'From network', days: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(trip)));

    const store = makeStore();
    const result = await store.dispatch(apiSlice.endpoints.getTrip.initiate('net-trip'));

    expect(result.status).toBe('fulfilled');
    expect(result.data).toEqual(trip);
    await expect(getCachedTrip('net-trip')).resolves.toEqual(trip);
  });

  it('serves the cached trip when the network is unreachable', async () => {
    const cached = { tripId: 'offline-trip', tripName: 'From cache', days: [] };
    await cacheTrip(cached);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const store = makeStore();
    const result = await store.dispatch(apiSlice.endpoints.getTrip.initiate('offline-trip'));

    expect(result.status).toBe('fulfilled');
    expect(result.data).toEqual(cached);
  });

  it('propagates the error when offline with no cached copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const store = makeStore();
    const result = await store.dispatch(apiSlice.endpoints.getTrip.initiate('never-cached'));

    expect(result.status).toBe('rejected');
    expect(result.error.status).toBe('FETCH_ERROR');
  });

  it('does not fall back to cache on a server error response', async () => {
    const cached = { tripId: 'gone-trip', tripName: 'Stale copy' };
    await cacheTrip(cached);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const store = makeStore();
    const result = await store.dispatch(apiSlice.endpoints.getTrip.initiate('gone-trip'));

    expect(result.status).toBe('rejected');
    expect(result.error.status).toBe(404);
  });
});
