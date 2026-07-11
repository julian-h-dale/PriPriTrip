import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Drawer,
  IconButton,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import dayjs from '../../utils/dayjs';

const WORLD_CENTER = { lat: 20, lng: 0 };
const WORLD_ZOOM = 2;
const DETAIL_ZOOM = 15;

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

function formatDayLabel(dateStr) {
  return dayjs(dateStr).format('MMM D');
}

// ── Search autocomplete (search mode only) ────────────────────────────────────

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
        role: null,
        googleMapsUri: null,
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

// ── Map controller — imperative map actions ────────────────────────────────────

function MapController({ flyTo }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !flyTo) return;
    map.panTo(flyTo);
    map.setZoom(DETAIL_ZOOM);
  }, [map, flyTo]);
  return null;
}

// ── Main map content ───────────────────────────────────────────────────────────

function TripMapContent({ open, days, mapId }) {
  const [allMarkers, setAllMarkers] = useState([]);
  const [selectedDayId, setSelectedDayId] = useState('all');
  const [activeMarker, setActiveMarker] = useState(null); // { key, position, label, role, googleMapsUri }
  const [flyTo, setFlyTo] = useState(null);
  const [selectedSearchLocation, setSelectedSearchLocation] = useState(null);
  const geocoding = useMapsLibrary('geocoding');

  // Flatten all locations from all days, preserving day and role context
  const allLocations = useMemo(() => {
    return days.flatMap((day) =>
      (day.points ?? []).flatMap((point) =>
        (point.locations ?? []).map((loc) => ({
          ...loc,
          dayId: day.dayId,
          dayDate: day.date,
        }))
      )
    );
  }, [days]);

  const hasInputLocations = allLocations.some(
    (loc) => resolveLatLng(loc) || placeIdFromLocation(loc)
  );
  const mode = hasInputLocations ? 'locations' : 'search';

  // Geocode all locations when drawer opens
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

    const resolveAll = async () => {
      const resolved = await Promise.all(
        allLocations.map(async (loc, index) => {
          const latLng = resolveLatLng(loc);
          const finalPos = latLng ?? (placeIdFromLocation(loc) ? await geocodeByPlaceId(placeIdFromLocation(loc)) : null);
          if (!finalPos) return null;

          return {
            key: loc.locationId ?? `loc_${index}`,
            label: labelFromLocation(loc),
            position: finalPos,
            role: loc.role ?? null,
            googleMapsUri: loc.googleMapsUri ?? null,
            dayId: loc.dayId,
          };
        })
      );

      if (!cancelled) setAllMarkers(resolved.filter(Boolean));
    };

    resolveAll();
    return () => { cancelled = true; };
  }, [geocoding, allLocations, mode, open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSelectedDayId('all');
      setActiveMarker(null);
      setFlyTo(null);
      setSelectedSearchLocation(null);
    }
  }, [open]);

  // Filtered markers based on day selection
  const markers = useMemo(() => {
    if (mode === 'search') {
      return selectedSearchLocation ? [selectedSearchLocation] : [];
    }
    if (selectedDayId === 'all') return allMarkers;
    return allMarkers.filter((m) => m.dayId === selectedDayId);
  }, [mode, allMarkers, selectedDayId, selectedSearchLocation]);

  const handleMarkerClick = (marker) => {
    setActiveMarker(marker);
    setFlyTo({ ...marker.position, _t: Date.now() }); // _t forces effect re-run for same position
  };

  const ROLE_LABELS = {
    origin: 'Origin',
    destination: 'Destination',
    waypoint: 'Waypoint',
    venue: 'Venue',
  };

  return (
    <>
      {/* Toolbar */}
      <Box sx={{ p: 2, pb: 1 }}>
        {mode === 'search' ? (
          <SearchAutocomplete onSelect={(loc) => { setSelectedSearchLocation(loc); setFlyTo({ ...loc.position, _t: Date.now() }); }} />
        ) : (
          <Select
            size="small"
            fullWidth
            value={selectedDayId}
            onChange={(e) => {
              setSelectedDayId(e.target.value);
              setActiveMarker(null);
            }}
          >
            <MenuItem value="all">All Days</MenuItem>
            {days.map((day) => (
              <MenuItem key={day.dayId} value={day.dayId}>
                {formatDayLabel(day.date)}
              </MenuItem>
            ))}
          </Select>
        )}
      </Box>

      {/* Map */}
      <Box sx={{ flex: 1 }}>
        <Map
          defaultZoom={WORLD_ZOOM}
          defaultCenter={WORLD_CENTER}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapId={mapId}
          style={{ width: '100%', height: '100%' }}
          onClick={() => setActiveMarker(null)}
        >
          <MapController flyTo={flyTo} />

          {markers.map((marker) => (
            <AdvancedMarker
              key={marker.key}
              position={marker.position}
              title={marker.label}
              onClick={() => handleMarkerClick(marker)}
            />
          ))}

          {activeMarker && (
            <InfoWindow
              position={activeMarker.position}
              onCloseClick={() => setActiveMarker(null)}
              headerDisabled
            >
              <Stack spacing={0.5} sx={{ minWidth: 160, maxWidth: 240, p: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                  {activeMarker.label}
                </Typography>
                {activeMarker.role && (
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {ROLE_LABELS[activeMarker.role] ?? activeMarker.role}
                  </Typography>
                )}
                {activeMarker.googleMapsUri && (
                  <Link
                    href={activeMarker.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="caption"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}
                  >
                    Open in Google Maps
                    <OpenInNewIcon sx={{ fontSize: 12 }} />
                  </Link>
                )}
              </Stack>
            </InfoWindow>
          )}
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
  days = [],
}) {
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
        <Typography variant="h6">Map View</Typography>
        <IconButton aria-label="Close map view" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      {mapsApiKey ? (
        <APIProvider apiKey={mapsApiKey} libraries={['places', 'geocoding']}>
          <TripMapContent open={open} days={days} mapId={mapsMapId} />
        </APIProvider>
      ) : (
        <Box sx={{ p: 2 }}>
          <Alert severity="warning">Map cannot load without a Maps API key.</Alert>
        </Box>
      )}
    </Drawer>
  );
}
