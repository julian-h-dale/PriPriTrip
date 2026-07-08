import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import {
  getTrip,
  verifyTrip,
} from '../api/tripImportService';
import TravelForm from '../components/Forms/TravelForm';

function hasTravelIssue(travel) {
  const missingDates = !(travel.departureDateTime && travel.arrivalDateTime);
  const roles = new Set((travel.locations ?? []).map((loc) => loc.role));
  const missingLocations = !(roles.has('origin') && roles.has('destination'));
  return { missingDates, missingLocations, hasIssue: missingDates || missingLocations };
}

export default function TripWorkflowPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  const travelSteps = useMemo(() => {
    const travels = trip?.travels ?? [];
    return travels.filter((travel) => hasTravelIssue(travel).hasIssue);
  }, [trip]);

  const current = travelSteps[stepIndex] || null;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Requirement: run verify first when entering the workflow.
        await verifyTrip(tripId);
        const t = await getTrip(tripId);
        if (!active) return;
        setTrip(t);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.detail ?? 'Could not load trip workflow.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [tripId]);

  useEffect(() => {
    if (current) {
      setEditorOpen(true);
    }
  }, [current?.travelDetailId]);

  async function handleStepSaved() {
    setError(null);
    setRefreshing(true);
    try {
      // Re-run verification after each step save.
      await verifyTrip(tripId);
      const refreshed = await getTrip(tripId);
      setTrip(refreshed);

      const nextSteps = (refreshed.travels ?? []).filter((travel) => hasTravelIssue(travel).hasIssue);
      if (nextSteps.length === 0) {
        navigate(`/trip-inspection/${tripId}`);
        return;
      }

      const updatedIndex = Math.min(stepIndex, nextSteps.length - 1);
      setStepIndex(updatedIndex);
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not save this workflow step.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
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
          <Alert severity="error">{error || 'Trip not found.'}</Alert>
        </Container>
      </AppLayout>
    );
  }

  if (travelSteps.length === 0) {
    navigate(`/trip-inspection/${tripId}`);
    return null;
  }

  return (
    <AppLayout title="Trip Workflow">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Trip workflow
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Step {stepIndex + 1} of {travelSteps.length}: fix incomplete travel details.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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

              {refreshing ? (
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
          onSaved={handleStepSaved}
        />
      </Container>
    </AppLayout>
  );
}
