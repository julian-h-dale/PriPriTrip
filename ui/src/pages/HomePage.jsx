import { lazy, Suspense, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
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
import IosShareIcon from '@mui/icons-material/IosShare';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AppLayout from '../components/AppLayout';
import TripChatOverlay from '../components/Chat/TripChatOverlay';
import Timeline from '../components/Timeline/Timeline';
import TripGapsBanner from '../components/Trip/TripGapsBanner';
import ShareTripDialog from '../components/Trip/ShareTripDialog';
import TripStatusMenu from '../components/Trip/TripStatusMenu';
import WhatsNextView from '../components/WhatsNext/WhatsNextView';
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
  const [shareOpen, setShareOpen] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState(null);
  const [snackDismissed, setSnackDismissed] = useState(false);
  // While active, you can still drop into the full itinerary — it is one tap
  // away, not a different URL, so share links and the back button keep working.
  const [showItinerary, setShowItinerary] = useState(false);

  useEffect(() => {
    setSnackDismissed(false);
  }, [error]);

  // `active` is the ONLY status the UI treats specially. `new` and `draft` both
  // mean "still being planned" and both go to the timeline, so a status added
  // later can never strand you on a blank screen (docs/active_trip_plan.md).
  const isActive = trip?.status === 'active';
  const showWhatsNext = isActive && !showItinerary;

  // Coming back to a trip you're on should land on What's Next, not wherever you
  // left the toggle.
  useEffect(() => {
    setShowItinerary(false);
  }, [tripId]);

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
          {/* No "on this trip" chip here on purpose: the What's Next screen is
              itself the signal, and the chip crowded the trip name down to an
              ellipsis. It earns its place in the trips list, where the trips are
              otherwise indistinguishable. */}
          <IconButton
            color="inherit"
            aria-label="Trip status"
            onClick={(e) => setStatusAnchor(e.currentTarget)}
          >
            <MoreVertIcon />
          </IconButton>
          <IconButton
            color="inherit"
            aria-label="Share trip"
            onClick={() => setShareOpen(true)}
          >
            <IosShareIcon />
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
        {trip && showWhatsNext && (
          <WhatsNextView
            tripId={tripId}
            trip={trip}
            offline={!isOnline}
            onViewItinerary={() => setShowItinerary(true)}
          />
        )}

        {trip && !showWhatsNext && (
          <>
            {/* What's missing, fixable in one tap without a model call. Not while
                you're on the trip — mid-trip you want what's next, not a chore
                list. Offline it would only offer forms that cannot be submitted. */}
            {isOnline && !isActive && (
              <Box sx={{ px: 2, pt: 2 }}>
                <TripGapsBanner tripId={tripId} />
              </Box>
            )}
            {isActive && (
              <Box sx={{ px: 2, pt: 2 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<FlightTakeoffIcon />}
                  onClick={() => setShowItinerary(false)}
                >
                  Back to what&apos;s next
                </Button>
              </Box>
            )}
            <Timeline
              tripId={tripId}
              trip={trip}
              expandedDayId={expandedDayId}
              onExpandedDayChange={setExpandedDayId}
            />
          </>
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
          emptyPrompt={`Ask me to change anything about ${trip.tripName ?? 'this trip'} — add a stay, fix a flight time, fill in a confirmation number. Or upload a booking confirmation and I'll read it in.`}
        />
      )}

      {trip && (
        <ShareTripDialog
          tripId={tripId}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}

      {trip && (
        <TripStatusMenu
          trip={trip}
          anchorEl={statusAnchor}
          onClose={() => setStatusAnchor(null)}
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
