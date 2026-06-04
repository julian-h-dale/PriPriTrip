import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Container,
  IconButton,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import dayjs from 'dayjs';
import {
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

  useEffect(() => {
    dispatch(fetchTrips());
  }, [dispatch]);

  return (
    <AppLayout
      title="PriPriTrip"
      actions={
        <IconButton color="inherit" edge="end" onClick={() => navigate('/new-trip')} aria-label="New trip">
          <AddIcon />
        </IconButton>
      }
    >
      <Container maxWidth="sm" sx={{ pt: 3, pb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
          Your Trips
        </Typography>

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
            <CardActionArea onClick={() => navigate(`/trip/${trip.tripId}`)}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {trip.tripName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {fmtDate(trip.startDate)} – {fmtDate(trip.endDate)}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Container>
    </AppLayout>
  );
}
