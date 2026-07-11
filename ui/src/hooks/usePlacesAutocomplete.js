import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { fetchPlaceDetails, fetchPlaceSuggestions } from '../api/placesService';
import { selectMapsApiKey } from '../store/authSlice';

const DEBOUNCE_MS = 300;

/**
 * Debounced Google Places autocomplete (review.md 2C-2).
 *
 * The version this replaces (duplicated in LocationForm and ProfilePage) had
 * three bugs, all fixed here:
 *
 * 1. The debounce timer was never cleared on unmount, so a late-firing timer
 *    called setState on a dead component.
 * 2. `try/finally` with no `catch`: a failing request became an unhandled
 *    promise rejection inside a timer, and the input just silently stopped
 *    suggesting.
 * 3. No stale-response guard: type "par", pause, type "is" — the slower "par"
 *    response could land after "paris" and overwrite the suggestions. Each
 *    request now carries a sequence number and only the newest one may write.
 *
 * Returns { suggestions, loading, error, onInputChange, resolvePlace, reset }.
 * `resolvePlace(suggestion)` fetches full details and returns them (or null).
 */
export function usePlacesAutocomplete() {
  const mapsApiKey = useSelector(selectMapsApiKey);

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(debounceRef.current);
      // Invalidate anything in flight so it cannot write after unmount.
      requestIdRef.current += 1;
    };
  }, []);

  const reset = useCallback(() => {
    clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setSuggestions([]);
    setLoading(false);
    setError(null);
  }, []);

  const search = useCallback(
    (query) => {
      clearTimeout(debounceRef.current);

      if (!query.trim()) {
        reset();
        return;
      }

      debounceRef.current = setTimeout(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError(null);
        try {
          const results = await fetchPlaceSuggestions(query, mapsApiKey);
          // A newer keystroke started after this one — discard the result.
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setSuggestions(results);
        } catch (err) {
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          setSuggestions([]);
          setError(err);
        } finally {
          if (mountedRef.current && requestId === requestIdRef.current) {
            setLoading(false);
          }
        }
      }, DEBOUNCE_MS);
    },
    [mapsApiKey, reset],
  );

  /** MUI Autocomplete's onInputChange signature: (event, value) => void */
  const onInputChange = useCallback((_event, value) => search(value ?? ''), [search]);

  const resolvePlace = useCallback(
    async (suggestion) => {
      if (!suggestion?.placeId) return null;
      try {
        return await fetchPlaceDetails(suggestion.placeId, mapsApiKey);
      } catch (err) {
        if (mountedRef.current) setError(err);
        return null;
      }
    },
    [mapsApiKey],
  );

  return { suggestions, loading, error, search, onInputChange, resolvePlace, reset };
}

export default usePlacesAutocomplete;
