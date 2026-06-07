import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { APIProvider, Map, AdvancedMarker, useMapsLibrary } from '@vis.gl/react-google-maps';

const WORLD_CENTER = { lat: 20, lng: 0 };
const WORLD_ZOOM = 2;

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveLatLng(location) {
  const lat = asNumber(location?.lat);
  const lng = asNumber(location?.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function placeIdFromLocation(location) {
  return location?.googlePlaceId?.trim() || null;
}

function labelFromLocation(location) {
  return location?.name?.trim() || location?.fullAddress?.trim() || 'Location';
}

function SearchAutocomplete({ onSelect }) {
  const places = useMapsLibrary('places');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!places || !inputRef.current) return undefined;

    const autocomplete = new places.Autocomplete(inputRef.current, {
      fields: ['geometry', 'name', 'formatted_address', 'place_id'],
    });
    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      onSelect({
        key: place.place_id ?? `${loc.lat()}_${loc.lng()}`,
        label: place.name || place.formatted_address || 'Selected location',
        position: { lat: loc.lat(), lng: loc.lng() },
      });
    });

    return () => {
      if (window.google?.maps?.event && listener) {
        window.google.maps.event.removeListener(listener);
      }
    };
  }, [onSelect, places]);

  return (
    <TextField
      label="Search location"
      placeholder="Type a place name or address"
      size="small"
      fullWidth
      inputRef={inputRef}
    />
  );
}

function TripMapContent({ open, locations, mapId }) {
  const [resolvedLocations, setResolvedLocations] = useState([]);
  const [selectedSearchLocation, setSelectedSearchLocation] = useState(null);
  const geocoding = useMapsLibrary('geocoding');
  const hasInputLocations = useMemo(
    () => locations.some((loc) => resolveLatLng(loc) || placeIdFromLocation(loc)),
    [locations]
  );
  const mode = hasInputLocations ? 'locations' : 'search';
  const markers = mode === 'locations'
    ? resolvedLocations
    : selectedSearchLocation
      ? [selectedSearchLocation]
      : [];
  const center = markers[0]?.position ?? WORLD_CENTER;

  useEffect(() => {
    if (!open || mode !== 'search') return;
    setSelectedSearchLocation(null);
  }, [mode, open]);

  useEffect(() => {
    if (!open || mode !== 'locations' || !geocoding) return undefined;

    let cancelled = false;
    const geocoder = new window.google.maps.Geocoder();

    const geocodeByPlaceId = (placeId) =>
      new Promise((resolve) => {
        geocoder.geocode({ placeId }, (results, status) => {
          if (status !== 'OK' || !results?.[0]?.geometry?.location) {
            resolve(null);
            return;
          }
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        });
      });

    const resolveMarkers = async () => {
      const values = await Promise.all(
        locations.map(async (loc, index) => {
          const latLng = resolveLatLng(loc);
          if (latLng) {
            return {
              key: loc.locationId ?? `location_${index}`,
              label: labelFromLocation(loc),
              position: latLng,
            };
          }

          const placeId = placeIdFromLocation(loc);
          if (!placeId) return null;
          const geocoded = await geocodeByPlaceId(placeId);
          if (!geocoded) return null;

          return {
            key: loc.locationId ?? placeId,
            label: labelFromLocation(loc),
            position: geocoded,
          };
        })
      );

      if (!cancelled) setResolvedLocations(values.filter(Boolean));
    };

    resolveMarkers();
    return () => { cancelled = true; };
  }, [geocoding, locations, mode, open]);

  return (
    <>
      <Box sx={{ p: 2, pb: 1 }}>
        {mode === 'search' ? (
          <SearchAutocomplete onSelect={setSelectedSearchLocation} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {markers.length} location{markers.length === 1 ? '' : 's'} on map
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1 }}>
        <Map
          defaultZoom={WORLD_ZOOM}
          center={center}
          gestureHandling="greedy"
          disableDefaultUI
          mapId={mapId}
          style={{ width: '100%', height: '100%' }}
        >
          {markers.map((marker) => (
            <AdvancedMarker
              key={marker.key}
              position={marker.position}
              title={marker.label}
            />
          ))}
        </Map>
      </Box>
    </>
  );
}

export default function TripMapModal({
  open,
  onClose,
  mapsApiKey,
  mapsMapId = 'DEMO_MAP_ID',
  locations = [],
}) {
  const hasInputLocations = useMemo(
    () => locations.some((loc) => resolveLatLng(loc) || placeIdFromLocation(loc)),
    [locations]
  );
  const mode = hasInputLocations ? 'locations' : 'search';

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 0,
        },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 0.5, flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'grey.300' }} />
      </Box>

      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="h6">Map View</Typography>
          <Typography variant="body2" color="text.secondary">
            {mode === 'locations' ? 'Showing trip locations' : 'Search for a location'}
          </Typography>
        </Stack>
        <IconButton aria-label="Close map view" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      {mapsApiKey ? (
        <APIProvider apiKey={mapsApiKey} libraries={['places', 'geocoding']}>
          <TripMapContent open={open} locations={locations} mapId={mapsMapId} />
        </APIProvider>
      ) : (
        <Box sx={{ p: 2 }}>
          <Alert severity="warning">Map cannot load without a Maps API key.</Alert>
        </Box>
      )}
    </Drawer>
  );
}
