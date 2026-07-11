import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPlaceSuggestions } from '../api/placesService';
import authReducer from '../store/authSlice';
import { usePlacesAutocomplete } from './usePlacesAutocomplete';

vi.mock('../api/placesService', () => ({
  fetchPlaceSuggestions: vi.fn(),
  fetchPlaceDetails: vi.fn(),
}));

function wrapper({ children }) {
  const store = configureStore({ reducer: { auth: authReducer } });
  return <Provider store={store}>{children}</Provider>;
}

/** A promise we can resolve by hand, to control response ordering. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('usePlacesAutocomplete', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: one request for a burst of keystrokes', async () => {
    fetchPlaceSuggestions.mockResolvedValue([{ placeId: '1', description: 'Paris' }]);
    const { result } = renderHook(() => usePlacesAutocomplete(), { wrapper });

    act(() => {
      result.current.search('p');
      result.current.search('pa');
      result.current.search('par');
    });
    act(() => { vi.advanceTimersByTime(300); });

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(fetchPlaceSuggestions).toHaveBeenCalledTimes(1);
    // Only the last keystroke is queried.
    expect(fetchPlaceSuggestions.mock.calls[0][0]).toBe('par');
  });

  it('ignores a stale response that lands after a newer one', async () => {
    const slowFirst = deferred();
    const fastSecond = deferred();
    fetchPlaceSuggestions
      .mockReturnValueOnce(slowFirst.promise)
      .mockReturnValueOnce(fastSecond.promise);

    const { result } = renderHook(() => usePlacesAutocomplete(), { wrapper });

    act(() => { result.current.search('par'); });
    act(() => { vi.advanceTimersByTime(300); });

    act(() => { result.current.search('paris'); });
    act(() => { vi.advanceTimersByTime(300); });

    // The newer query answers first...
    await act(async () => {
      fastSecond.resolve([{ placeId: '2', description: 'Paris, France' }]);
    });
    // ...then the older, slower one comes back. It must NOT overwrite.
    await act(async () => {
      slowFirst.resolve([{ placeId: '1', description: 'Par, stale result' }]);
    });

    expect(result.current.suggestions).toEqual([{ placeId: '2', description: 'Paris, France' }]);
  });

  it('surfaces a failure instead of throwing an unhandled rejection', async () => {
    fetchPlaceSuggestions.mockRejectedValue(new Error('places down'));
    const { result } = renderHook(() => usePlacesAutocomplete(), { wrapper });

    act(() => { result.current.search('paris'); });
    act(() => { vi.advanceTimersByTime(300); });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('an empty query clears suggestions without calling the API', async () => {
    fetchPlaceSuggestions.mockResolvedValue([{ placeId: '1', description: 'Paris' }]);
    const { result } = renderHook(() => usePlacesAutocomplete(), { wrapper });

    act(() => { result.current.search('paris'); });
    act(() => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));

    act(() => { result.current.search('   '); });
    expect(result.current.suggestions).toEqual([]);
    expect(fetchPlaceSuggestions).toHaveBeenCalledTimes(1);
  });

  it('does not set state after unmount', async () => {
    const pending = deferred();
    fetchPlaceSuggestions.mockReturnValue(pending.promise);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result, unmount } = renderHook(() => usePlacesAutocomplete(), { wrapper });
    act(() => { result.current.search('paris'); });
    act(() => { vi.advanceTimersByTime(300); });

    unmount();
    await act(async () => { pending.resolve([{ placeId: '1', description: 'Paris' }]); });

    // React logs an "update on unmounted component" error if we got this wrong.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
