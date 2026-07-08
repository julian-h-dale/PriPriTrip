import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  Snackbar,
} from '@mui/material';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import HouseIcon from '@mui/icons-material/House';
import AppLayout from '../components/AppLayout';
import Timeline from '../components/Timeline/Timeline';
import TripMapModal from '../components/Map/TripMapModal';
import {
  fetchTrip,
  clearError,
  selectTrip,
  selectTripStatus,
  selectTripError,
} from '../store/tripSlice';
import { selectMapsApiKey } from '../store/authSlice';
import { useOnlineStatus } from '../utils/useOnlineStatus';

export default function HomePage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);
  const mapsApiKey = useSelector(selectMapsApiKey);
  const isOnline = useOnlineStatus();

  const [expandedDayId, setExpandedDayId] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const tripDays = useMemo(() => trip?.days ?? [], [trip]);

  useEffect(() => {
    if (tripId) dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const isLoading = status === 'loading';
  const isError = status === 'error';

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
        {isLoading && !trip && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {isError && !trip && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error" onClose={() => dispatch(clearError())}>
              {error ?? 'Failed to load trip.'}
            </Alert>
          </Box>
        )}
        {trip && (
          <Timeline
            tripId={tripId}
            expandedDayId={expandedDayId}
            onExpandedDayChange={setExpandedDayId}
          />
        )}
      </Container>

      <Snackbar
        open={isError && !!trip}
        autoHideDuration={5000}
        onClose={() => dispatch(clearError())}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => dispatch(clearError())}
          sx={{ width: '100%' }}
        >
          {error ?? 'Failed to load trip.'}
        </Alert>
      </Snackbar>

      <TripMapModal
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        mapsApiKey={mapsApiKey}
        days={tripDays}
      />
    </AppLayout>
  );
}
