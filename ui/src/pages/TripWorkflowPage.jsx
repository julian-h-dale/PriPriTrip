import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import AppLayout from '../components/AppLayout';
import { useGetTripQuery, useVerifyTripQuery } from '../store/apiSlice';
import { getErrorMessage } from '../utils/errors';
import TravelForm from '../components/Forms/TravelForm';

function hasTravelIssue(travel) {
  const missingDates = !(travel.departureDateTime && travel.arrivalDateTime);
  const roles = new Set((travel.locations ?? []).map((loc) => loc.role));
  const missingLocations = !(roles.has('origin') && roles.has('destination'));
  return { missingDates, missingLocations, hasIssue: missingDates || missingLocations };
}

export default function TripWorkflowPage() {
  const { tripId } = useParams();

  // Requirement: run verify when entering the workflow. Saving a travel leg
  // invalidates both tags, so the trip and verification refresh automatically.
  useVerifyTripQuery(tripId, { skip: !tripId });
  const {
    data: trip,
    isLoading,
    isFetching,
    error,
  } = useGetTripQuery(tripId, { skip: !tripId });

  const [editorOpen, setEditorOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const travelSteps = useMemo(() => {
    const travels = trip?.travels ?? [];
    return travels.filter((travel) => hasTravelIssue(travel).hasIssue);
  }, [trip]);

  // Clamp the step when the list shrinks after a save.
  const current = travelSteps[Math.min(stepIndex, Math.max(travelSteps.length - 1, 0))] || null;
  useEffect(() => {
    if (stepIndex > 0 && stepIndex > travelSteps.length - 1) {
      setStepIndex(Math.max(travelSteps.length - 1, 0));
    }
  }, [stepIndex, travelSteps.length]);

  const currentTravelDetailId = current?.travelDetailId;
  useEffect(() => {
    if (currentTravelDetailId) {
      setEditorOpen(true);
    }
  }, [currentTravelDetailId]);

  if (isLoading) {
    return (
      <AppLayout title="Trip Workflow">
        <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
          <Stack spacing={2} alignItems="center" sx={{ pt: 10 }}>
            <CircularProgress />
            <Typography color="text.secondary">Loading workflow…</Typography>
          </Stack>
        </Container>
      </AppLayout>
    );
  }

  if (!trip) {
    return (
      <AppLayout title="Trip Workflow">
        <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
          <Alert severity="error">
            {getErrorMessage(error, 'Trip not found.')}
          </Alert>
        </Container>
      </AppLayout>
    );
  }

  if (travelSteps.length === 0) {
    return <Navigate to={`/trip-inspection/${tripId}`} replace />;
  }

  return (
    <AppLayout title="Trip Workflow">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Trip workflow
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Step {Math.min(stepIndex, travelSteps.length - 1) + 1} of {travelSteps.length}: fix incomplete travel details.
        </Typography>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle2" color="text.secondary">
                Travel leg
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {current.name || 'Untitled travel leg'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Mode: {current.mode || '—'}
              </Typography>

              {isFetching ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    Re-checking and preparing next step…
                  </Typography>
                </Stack>
              ) : (
                <Button variant="contained" onClick={() => setEditorOpen(true)}>
                  Open edit form
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>

        <TravelForm
          tripId={tripId}
          open={Boolean(current) && editorOpen}
          initialValues={current || {}}
          requireLocations
          onClose={() => setEditorOpen(false)}
          onSaved={() => setEditorOpen(false)}
        />
      </Container>
    </AppLayout>
  );
}
