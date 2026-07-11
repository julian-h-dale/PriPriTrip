import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  cacheTrip,
  cacheTripList,
  getCachedTrip,
  getCachedTripList,
} from './tripCache';

describe('tripCache', () => {
  it('stores and retrieves a trip keyed by tripId', async () => {
    const trip = { tripId: 'trip-1', tripName: 'Rome', days: [] };
    await cacheTrip(trip);
    await expect(getCachedTrip('trip-1')).resolves.toEqual(trip);
  });

  it('keeps multiple trips cached independently', async () => {
    await cacheTrip({ tripId: 'trip-a', tripName: 'A' });
    await cacheTrip({ tripId: 'trip-b', tripName: 'B' });
    await expect(getCachedTrip('trip-a')).resolves.toMatchObject({ tripName: 'A' });
    await expect(getCachedTrip('trip-b')).resolves.toMatchObject({ tripName: 'B' });
  });

  it('overwrites an existing trip on re-cache', async () => {
    await cacheTrip({ tripId: 'trip-c', tripName: 'Before' });
    await cacheTrip({ tripId: 'trip-c', tripName: 'After' });
    await expect(getCachedTrip('trip-c')).resolves.toMatchObject({ tripName: 'After' });
  });

  it('returns null for a missing trip or missing id', async () => {
    await expect(getCachedTrip('nope')).resolves.toBeNull();
    await expect(getCachedTrip(undefined)).resolves.toBeNull();
  });

  it('ignores trips without a tripId instead of corrupting the store', async () => {
    await expect(cacheTrip({ tripName: 'No id' })).resolves.toBeUndefined();
  });

  it('stores and retrieves the trips list under its own key', async () => {
    const trips = [
      { tripId: 'trip-x', tripName: 'Rome' },
      { tripId: 'trip-y', tripName: 'Kyoto' },
    ];
    await cacheTripList(trips);
    await expect(getCachedTripList()).resolves.toEqual(trips);
    // Caching the list does not create per-trip entries.
    await expect(getCachedTrip('trip-y')).resolves.toBeNull();
  });

  it('ignores non-array values passed to cacheTripList', async () => {
    const before = await getCachedTripList();
    await cacheTripList(null);
    await expect(getCachedTripList()).resolves.toEqual(before);
  });
});
