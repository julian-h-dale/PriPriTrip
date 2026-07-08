import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import MuiTimeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineOppositeContent, {
  timelineOppositeContentClasses,
} from '@mui/lab/TimelineOppositeContent';
import dayjs from 'dayjs';
import AppLayout from '../components/AppLayout';
import {
  clearError,
  fetchTrip,
  selectTrip,
  selectTripError,
  selectTripStatus,
} from '../store/tripSlice';
import TravelForm from '../components/Forms/TravelForm';

function fmtDateTime(value) {
  if (!value) return 'No departure date';
  const d = dayjs(value);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : 'No departure date';
}

function localityLabel(location) {
  const fullAddress = location?.fullAddress;
  if (!fullAddress) return location?.name || '—';
  const parts = fullAddress
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
  }
  return parts[0] || location?.name || '—';
}

function firstLocationByRole(locations, role) {
  return (locations ?? []).find((loc) => loc.role === role) || null;
}

export default function TravelDetailsPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);
  const [editingTravel, setEditingTravel] = useState(null);

  useEffect(() => {
    if (tripId) dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const travels = useMemo(() => {
    const items = trip?.travels ?? [];
    return [...items].sort((a, b) => {
      const aTime = a?.departureDateTime && dayjs(a.departureDateTime).isValid()
        ? dayjs(a.departureDateTime).valueOf()
        : Number.MAX_SAFE_INTEGER;
      const bTime = b?.departureDateTime && dayjs(b.departureDateTime).isValid()
        ? dayjs(b.departureDateTime).valueOf()
        : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [trip]);

  const isLoading = status === 'loading';

  return (
    <AppLayout
      title={trip?.tripName ?? 'Travel Details'}
      onBack={() => navigate(`/trip/${tripId}`)}
    >
      <Container maxWidth="sm" disableGutters>
        <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5" component="h1" color="primary">
              Travel details
            </Typography>
            <IconButton
              size="small"
              aria-label="Add travel"
              onClick={() => setEditingTravel({})}
            >
              <AddIcon />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Read-only timeline ordered by departure date/time.
          </Typography>
        </Box>

        {isLoading && !trip && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {error && !trip && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error" onClose={() => dispatch(clearError())}>
              {error ?? 'Failed to load travel details.'}
            </Alert>
          </Box>
        )}

        {!!trip && travels.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="text.secondary">No travel legs found for this trip.</Typography>
            </Paper>
          </Box>
        )}

        {!!trip && travels.length > 0 && (
          <MuiTimeline
            sx={{
              [`& .${timelineOppositeContentClasses.root}`]: { flex: 0.38 },
              px: 1,
              py: 1,
              mt: 0,
            }}
          >
            {travels.map((travel, index) => {
              const origin = firstLocationByRole(travel.locations, 'origin');
              const destination = firstLocationByRole(travel.locations, 'destination');
              const isLast = index === travels.length - 1;
              return (
                <TimelineItem key={travel.travelDetailId || `${travel.name}-${index}`}>
                  <TimelineOppositeContent color="text.secondary" sx={{ fontSize: '0.8rem', pt: 2 }}>
                    {fmtDateTime(travel.departureDateTime)}
                  </TimelineOppositeContent>
                  <TimelineSeparator>
                    <TimelineDot color="primary" />
                    {!isLast && <TimelineConnector />}
                  </TimelineSeparator>
                  <TimelineContent sx={{ pb: 2 }}>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {travel.name || 'Untitled travel leg'}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label="Edit travel"
                          onClick={() => setEditingTravel(travel)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        Mode: {travel.mode || '—'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {localityLabel(origin)} - {localityLabel(destination)}
                      </Typography>
                    </Paper>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </MuiTimeline>
        )}

        {!!trip && (
          <TravelForm
            tripId={trip.tripId}
            open={!!editingTravel}
            initialValues={editingTravel || {}}
            onClose={() => setEditingTravel(null)}
            onSaved={() => {
              dispatch(fetchTrip(tripId));
              setEditingTravel(null);
            }}
          />
        )}
      </Container>
    </AppLayout>
  );
}
