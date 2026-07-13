import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Fab,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChatIcon from '@mui/icons-material/Chat';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import TripChatOverlay from '../components/Chat/TripChatOverlay';
import {
  useDeleteTripMutation,
  useGetTripsQuery,
  useLazyVerifyTripQuery,
} from '../store/apiSlice';
import { getErrorMessage } from '../utils/errors';
import { formatDateOrdinal } from '../utils/format';
import AppLayout from '../components/AppLayout';

export default function TripsPage() {
  const navigate = useNavigate();
  const {
    data: trips = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useGetTripsQuery();
  const [deleteTrip] = useDeleteTripMutation();
  const [triggerVerify] = useLazyVerifyTripQuery();

  const [confirmingTrip, setConfirmingTrip] = useState(null); // trip pending delete confirmation
  const [deletingTripId, setDeletingTripId] = useState(null);
  const [inspectingTripId, setInspectingTripId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTripId, setChatTripId] = useState(null);

  async function handleDeleteConfirmed() {
    const trip = confirmingTrip;
    if (!trip) return;
    setConfirmingTrip(null);
    setActionError(null);
    setDeletingTripId(trip.tripId);
    try {
      await deleteTrip(trip.tripId).unwrap();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not delete trip. Please try again.'));
    } finally {
      setDeletingTripId(null);
    }
  }

  async function handleInspectTrip(trip) {
    setActionError(null);
    setInspectingTripId(trip.tripId);
    try {
      const verify = await triggerVerify(trip.tripId).unwrap();
      const hasTravelWorkflowIssues = (verify?.issues ?? []).some(
        (issue) => issue.code === 'TRAVEL_INCOMPLETE_DATES' || issue.code === 'TRAVEL_INCOMPLETE_LOCATIONS'
      );

      if (hasTravelWorkflowIssues) {
        navigate(`/trip/${trip.tripId}/workflow`);
        return;
      }

      navigate(`/trip-inspection/${trip.tripId}`, {
        state: { verify, tripName: trip.tripName },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not inspect trip. Please try again.'));
    } finally {
      setInspectingTripId(null);
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

        {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {isError && trips.length === 0 && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            {getErrorMessage(error, 'Could not load your trips. Check your connection and try again.')}
          </Alert>
        )}

        {!isLoading && !isError && trips.length === 0 && (
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
                  {formatDateOrdinal(trip.startDate)} – {formatDateOrdinal(trip.endDate)}
                </Typography>
                </Box>

                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    aria-label={`Inspect ${trip.tripName}`}
                    onClick={() => handleInspectTrip(trip)}
                    disabled={inspectingTripId === trip.tripId}
                    sx={{ color: 'success.main' }}
                  >
                    {inspectingTripId === trip.tripId ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${trip.tripName}`}
                    onClick={() => setConfirmingTrip(trip)}
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

      <Dialog open={!!confirmingTrip} onClose={() => setConfirmingTrip(null)}>
        <DialogTitle>Delete trip?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`"${confirmingTrip?.tripName ?? ''}" and all of its days, points, and details will be permanently deleted. This cannot be undone.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingTrip(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirmed}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Fab
        color="primary"
        aria-label="Open new trip chat"
        onClick={() => setChatOpen(true)}
        sx={{ position: 'fixed', right: 24, bottom: 24 }}
      >
        <ChatIcon />
      </Fab>

      <TripChatOverlay
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        tripId={chatTripId}
        workflowName="trip:new_trip"
        title="New Trip Chat"
        emptyPrompt="Let's get ready to go! Tell me about your trip — when, where, how you're getting there. Or upload an itinerary."
        onTripIdChange={setChatTripId}
        onComplete={(response) => {
          setChatOpen(false);
          // Land on the trip itself, whether it was built by conversation or by
          // uploading an itinerary. The gaps banner is waiting there with
          // whatever is still missing; the ✅ on the trip card still opens the
          // full inspection breakdown when you want it.
          navigate(`/trip/${response.tripId}`);
        }}
      />
    </AppLayout>
  );
}
