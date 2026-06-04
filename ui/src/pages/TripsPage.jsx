import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Container,
  Toolbar,
  Typography,
} from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import {
  fetchTrips,
  selectTrips,
  selectTripsStatus,
} from '../store/tripSlice';

export default function TripsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const trips = useSelector(selectTrips);
  const status = useSelector(selectTripsStatus);

  useEffect(() => {
    dispatch(fetchTrips());
  }, [dispatch]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <ExploreIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="h6" component="div">
            PriPriTrip
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ pt: 3, pb: 4 }}>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
          Your Trips
        </Typography>

        {status === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {status !== 'loading' && trips.length === 0 && (
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
                  {trip.startDate} – {trip.endDate}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Container>
    </Box>
  );
}
