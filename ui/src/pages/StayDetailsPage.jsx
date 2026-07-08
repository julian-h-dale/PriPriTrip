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
import StayForm from '../components/Forms/StayForm';

function fmtDateTime(value) {
  if (!value) return 'No check-in date';
  const d = dayjs(value);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : 'No check-in date';
}

function fmtDateRange(checkIn, checkOut) {
  const inDate = checkIn && dayjs(checkIn).isValid() ? dayjs(checkIn).format('MMM D, YYYY') : '—';
  const outDate = checkOut && dayjs(checkOut).isValid() ? dayjs(checkOut).format('MMM D, YYYY') : '—';
  return `${inDate} - ${outDate}`;
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

export default function StayDetailsPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);
  const [editingStay, setEditingStay] = useState(null);

  useEffect(() => {
    if (tripId) dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  const stays = useMemo(() => {
    const items = trip?.stays ?? [];
    return [...items].sort((a, b) => {
      const aTime = a?.checkIn && dayjs(a.checkIn).isValid() ? dayjs(a.checkIn).valueOf() : Number.MAX_SAFE_INTEGER;
      const bTime = b?.checkIn && dayjs(b.checkIn).isValid() ? dayjs(b.checkIn).valueOf() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, [trip]);

  const isLoading = status === 'loading';

  return (
    <AppLayout
      title={trip?.tripName ?? 'Stay Details'}
      onBack={() => navigate(`/trip/${tripId}`)}
    >
      <Container maxWidth="sm" disableGutters>
        <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5" component="h1" color="primary">
              Stay details
            </Typography>
            <IconButton
              size="small"
              aria-label="Add stay"
              onClick={() => setEditingStay({})}
            >
              <AddIcon />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Read-only timeline ordered by check-in date/time.
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
              {error ?? 'Failed to load stay details.'}
            </Alert>
          </Box>
        )}

        {!!trip && stays.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="text.secondary">No stays found for this trip.</Typography>
            </Paper>
          </Box>
        )}

        {!!trip && stays.length > 0 && (
          <MuiTimeline
            sx={{
              [`& .${timelineOppositeContentClasses.root}`]: { flex: 0.38 },
              px: 1,
              py: 1,
              mt: 0,
            }}
          >
            {stays.map((stay, index) => {
              const venue = (stay.locations ?? []).find((loc) => loc.role === 'venue') || (stay.locations ?? [])[0];
              const isLast = index === stays.length - 1;
              return (
                <TimelineItem key={stay.stayDetailId || `${stay.name}-${index}`}>
                  <TimelineOppositeContent color="text.secondary" sx={{ fontSize: '0.8rem', pt: 2 }}>
                    {fmtDateTime(stay.checkIn)}
                  </TimelineOppositeContent>
                  <TimelineSeparator>
                    <TimelineDot color="primary" />
                    {!isLast && <TimelineConnector />}
                  </TimelineSeparator>
                  <TimelineContent sx={{ pb: 2 }}>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {stay.name || 'Untitled stay'}
                        </Typography>
                        <IconButton
                          size="small"
                          aria-label="Edit stay"
                          onClick={() => setEditingStay(stay)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {fmtDateRange(stay.checkIn, stay.checkOut)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {localityLabel(venue)}
                      </Typography>
                    </Paper>
                  </TimelineContent>
                </TimelineItem>
              );
            })}
          </MuiTimeline>
        )}

        {!!trip && (
          <StayForm
            tripId={trip.tripId}
            open={!!editingStay}
            initialValues={editingStay || {}}
            onClose={() => setEditingStay(null)}
            onSaved={() => {
              dispatch(fetchTrip(tripId));
              setEditingStay(null);
            }}
          />
        )}
      </Container>
    </AppLayout>
  );
}
