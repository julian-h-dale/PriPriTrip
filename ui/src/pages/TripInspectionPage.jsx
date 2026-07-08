import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AppLayout from '../components/AppLayout';
import { verifyTrip } from '../api/tripImportService';

export default function TripInspectionPage() {
  const { tripId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [result, setResult] = useState(location.state?.verify || null);
  const [tripName] = useState(location.state?.tripName || null);
  const [loading, setLoading] = useState(!location.state?.verify);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadVerify() {
      if (result) return;
      setLoading(true);
      setError(null);
      try {
        const data = await verifyTrip(tripId);
        if (active) setResult(data);
      } catch (err) {
        if (active) setError(err?.response?.data?.detail ?? 'Could not run trip inspection.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadVerify();
    return () => {
      active = false;
    };
  }, [result, tripId]);

  const issues = result?.issues ?? [];
  const errorCount = useMemo(
    () => issues.filter((i) => i.severity === 'error').length,
    [issues]
  );
  const warningCount = useMemo(
    () => issues.filter((i) => i.severity === 'warning').length,
    [issues]
  );
  const travelIssueCount = useMemo(
    () =>
      issues.filter(
        (i) => i.code === 'TRAVEL_INCOMPLETE_DATES' || i.code === 'TRAVEL_INCOMPLETE_LOCATIONS'
      ).length,
    [issues]
  );

  return (
    <AppLayout title="Trip Inspection">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Trip inspection
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {tripName ? `Verification results for ${tripName}.` : 'Verification results for your imported trip.'}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading || !result ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography color="text.secondary">Inspecting trip…</Typography>
            </Stack>
          </Paper>
        ) : (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Chip
                  size="small"
                  color={result.ok ? 'success' : 'warning'}
                  label={result.ok ? 'No blocking issues' : 'Inspection issues found'}
                />
                <Chip size="small" label={`${result.daysChecked ?? 0} days checked`} />
                <Chip size="small" label={`${errorCount} errors`} />
                <Chip size="small" label={`${warningCount} warnings`} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Continue to your trip to fix issues directly in the timeline and details.
              </Typography>
            </Paper>

            <Paper variant="outlined">
              <List disablePadding>
                {issues.length === 0 ? (
                  <ListItem>
                    <ListItemText
                      primary="No verification issues found"
                      secondary="Your imported trip passed all current inspection checks."
                    />
                  </ListItem>
                ) : (
                  issues.map((issue, i) => (
                    <div key={`${issue.code}-${issue.dayId || issue.date}-${i}`}>
                      {i > 0 && <Divider />}
                      <ListItem alignItems="flex-start">
                        <ListItemText
                          primary={`${issue.code} • ${issue.severity.toUpperCase()}`}
                          secondary={
                            <>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                {issue.message}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" component="span" display="block">
                                Date: {issue.date}{issue.dayId ? ` • Day ID: ${issue.dayId}` : ''}
                              </Typography>
                            </>
                          }
                        />
                      </ListItem>
                    </div>
                  ))
                )}
              </List>
            </Paper>

            <Button variant="contained" fullWidth onClick={() => navigate(`/trip/${tripId}`)}>
              Open trip
            </Button>

            {travelIssueCount > 0 && (
              <Button variant="outlined" fullWidth onClick={() => navigate(`/trip/${tripId}/workflow`)}>
                Start trip workflow
              </Button>
            )}
          </Stack>
        )}
      </Container>
    </AppLayout>
  );
}
