import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Container,
  Snackbar,
  Toolbar,
  Typography,
} from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import Timeline from '../components/Timeline/Timeline';
import {
  fetchTrip,
  clearError,
  selectTrip,
  selectTripStatus,
  selectTripError,
} from '../store/tripSlice';
import { useOnlineStatus } from '../utils/useOnlineStatus';

export default function HomePage() {
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);
  const isOnline = useOnlineStatus();

  const [expandedDayId, setExpandedDayId] = useState(null);

  useEffect(() => {
    dispatch(fetchTrip());
  }, [dispatch]);

  const isLoading = status === 'loading';
  const isError = status === 'error';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <ExploreIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            PriPriTrip
          </Typography>
          {!isOnline && (
            <Chip
              icon={<WifiOffIcon sx={{ fontSize: 14 }} />}
              label="Offline"
              size="small"
              sx={{
                height: 22,
                fontSize: '0.7rem',
                bgcolor: 'rgba(255,255,255,0.15)',
                color: 'inherit',
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          )}
        </Toolbar>
      </AppBar>

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
    </Box>
  );
}
