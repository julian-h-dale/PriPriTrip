import { lazy, Suspense, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Fab,
  IconButton,
  Snackbar,
} from '@mui/material';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import ChatIcon from '@mui/icons-material/Chat';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import HouseIcon from '@mui/icons-material/House';
import DescriptionIcon from '@mui/icons-material/Description';
import AppLayout from '../components/AppLayout';
import TripChatOverlay from '../components/Chat/TripChatOverlay';
import Timeline from '../components/Timeline/Timeline';
import { useGetTripQuery } from '../store/apiSlice';
import { selectMapsApiKey } from '../store/authSlice';
import { getErrorMessage } from '../utils/errors';
import { useOnlineStatus } from '../utils/useOnlineStatus';

// Loaded on demand so the Google Maps SDK stays out of the page chunk.
const TripMapModal = lazy(() => import('../components/Map/TripMapModal'));

export default function HomePage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const mapsApiKey = useSelector(selectMapsApiKey);
  const isOnline = useOnlineStatus();

  const {
    data: trip,
    isLoading,
    error,
  } = useGetTripQuery(tripId, { skip: !tripId });
  const errorMessage = getErrorMessage(error, 'Failed to load trip.');

  const [expandedDayId, setExpandedDayId] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [snackDismissed, setSnackDismissed] = useState(false);

  useEffect(() => {
    setSnackDismissed(false);
  }, [error]);

  return (
    <AppLayout
      title={trip?.tripName ?? 'PriPriTrip'}
      onOpenMapView={() => setMapOpen(true)}
      actions={
        <>
          {!isOnline && (
            <Chip
              icon={<WifiOffIcon sx={{ fontSize: 14 }} />}
              label="Offline"
              size="small"
              sx={{
                mr: 1,
                height: 22,
                fontSize: '0.7rem',
                bgcolor: 'rgba(255,255,255,0.15)',
                color: 'inherit',
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          )}
          <IconButton
            color="inherit"
            aria-label="Document importer"
            onClick={() => navigate(`/trip/${tripId}/document-import`)}
          >
            <DescriptionIcon />
          </IconButton>
          <IconButton
            color="inherit"
            aria-label="Stay details"
            onClick={() => navigate(`/trip/${tripId}/stays`)}
          >
            <HouseIcon />
          </IconButton>
          <IconButton
            color="inherit"
            aria-label="Travel details"
            onClick={() => navigate(`/trip/${tripId}/travels`)}
          >
            <FlightTakeoffIcon />
          </IconButton>
        </>
      }
    >
      <Container maxWidth="sm" disableGutters>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {!!error && !trip && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error">{errorMessage}</Alert>
          </Box>
        )}
        {trip && (
          <Timeline
            tripId={tripId}
            trip={trip}
            expandedDayId={expandedDayId}
            onExpandedDayChange={setExpandedDayId}
          />
        )}
      </Container>

      {/* Chat about the trip you're looking at. The assistant edits it in
          place; the overlay invalidates the cache so this timeline updates. */}
      {trip && isOnline && (
        <Fab
          color="primary"
          aria-label="Open trip chat"
          onClick={() => setChatOpen(true)}
          sx={{ position: 'fixed', right: 24, bottom: 24 }}
        >
          <ChatIcon />
        </Fab>
      )}

      {trip && (
        <TripChatOverlay
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          tripId={tripId}
          workflowName="trip:manage"
          title={trip.tripName ?? 'Trip Chat'}
          emptyPrompt={`Ask me to change anything about ${trip.tripName ?? 'this trip'} — add a stay, fix a flight time, fill in a confirmation number.`}
        />
      )}

      <Snackbar
        open={!!error && !!trip && !snackDismissed}
        autoHideDuration={5000}
        onClose={() => setSnackDismissed(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => setSnackDismissed(true)}
          sx={{ width: '100%' }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>

      {mapOpen && (
        <Suspense fallback={null}>
          <TripMapModal
            open={mapOpen}
            onClose={() => setMapOpen(false)}
            mapsApiKey={mapsApiKey}
            days={trip?.days ?? []}
          />
        </Suspense>
      )}
    </AppLayout>
  );
}
