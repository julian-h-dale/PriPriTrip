import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Container,
  Snackbar,
  Toolbar,
  Typography,
} from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import SaveIcon from '@mui/icons-material/Save';
import Timeline from '../components/Timeline/Timeline';
import {
  fetchTrip,
  saveTrip,
  clearError,
  selectTrip,
  selectTripStatus,
  selectTripError,
} from '../store/tripSlice';

export default function HomePage() {
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const status = useSelector(selectTripStatus);
  const error = useSelector(selectTripError);

  useEffect(() => {
    dispatch(fetchTrip());
  }, [dispatch]);

  const isSaving = status === 'saving';
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
          <Button
            size="small"
            color="inherit"
            startIcon={
              isSaving
                ? <CircularProgress size={14} color="inherit" />
                : <SaveIcon sx={{ fontSize: 16 }} />
            }
            onClick={() => dispatch(saveTrip())}
            disabled={isSaving || isLoading || !trip}
            sx={{ textTransform: 'none', minWidth: 72 }}
          >
            Save
          </Button>
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
        {trip && <Timeline />}
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
          {error ?? 'Failed to save trip.'}
        </Alert>
      </Snackbar>
    </Box>
  );
}
