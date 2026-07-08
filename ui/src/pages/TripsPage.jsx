import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Container,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import dayjs from 'dayjs';
import {
  deleteTripById,
  fetchTrips,
  selectTrips,
  selectTripsStatus,
} from '../store/tripSlice';
import AppLayout from '../components/AppLayout';

function fmtDate(dateStr) {
  const d = dayjs(dateStr);
  const day = d.date();
  const suffix = ['th', 'st', 'nd', 'rd'][
    day % 10 < 4 && (day < 11 || day > 13) ? day % 10 : 0
  ];
  return d.format('MMMM') + ' ' + day + suffix;
}

export default function TripsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const trips = useSelector(selectTrips);
  const status = useSelector(selectTripsStatus);
  const [deletingTripId, setDeletingTripId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    dispatch(fetchTrips());
  }, [dispatch]);

  async function handleDeleteTrip(tripId) {
    setDeleteError(null);
    setDeletingTripId(tripId);
    try {
      await dispatch(deleteTripById(tripId)).unwrap();
    } catch (err) {
      setDeleteError(err?.message ?? 'Could not delete trip. Please try again.');
    } finally {
      setDeletingTripId(null);
    }
  }

  return (
    <AppLayout
      title="PriPriTrip"
      actions={
        <>
          <IconButton color="inherit" onClick={() => navigate('/import-trip')} aria-label="Import trip from file">
            <UploadFileIcon />
          </IconButton>
          <IconButton color="inherit" edge="end" onClick={() => navigate('/new-trip')} aria-label="New trip">
            <AddIcon />
          </IconButton>
        </>
      }
    >
      <Container maxWidth="sm" sx={{ pt: 3, pb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
          Your Trips
        </Typography>

        {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}

        {status === 'loading' && trips.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {status === 'loaded' && trips.length === 0 && (
          <Typography color="text.secondary">No trips found.</Typography>
        )}

        {trips.map((trip) => (
          <Card key={trip.tripId} sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/trip/${trip.tripId}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/trip/${trip.tripId}`);
                    }
                  }}
                  sx={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                >
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {trip.tripName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {fmtDate(trip.startDate)} – {fmtDate(trip.endDate)}
                </Typography>
                </Box>

                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    aria-label={`Inspect ${trip.tripName}`}
                    onClick={() => navigate(`/trip-inspection/${trip.tripId}`)}
                    sx={{ color: 'success.main' }}
                  >
                    <CheckCircleIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${trip.tripName}`}
                    onClick={() => handleDeleteTrip(trip.tripId)}
                    disabled={deletingTripId === trip.tripId}
                    sx={{ color: 'error.main' }}
                  >
                    {deletingTripId === trip.tripId ? <CircularProgress size={20} color="inherit" /> : <DeleteIcon />}
                  </IconButton>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Container>
    </AppLayout>
  );
}
