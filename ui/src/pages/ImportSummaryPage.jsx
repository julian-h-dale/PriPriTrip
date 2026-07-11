import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
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
import DescriptionIcon from '@mui/icons-material/Description';
import dayjs from 'dayjs';
import { parseWallClock } from '../utils/dayjs';
import AppLayout from '../components/AppLayout';
import { useGetTripQuery, useLazyVerifyTripQuery } from '../store/apiSlice';
import { getErrorMessage } from '../utils/errors';

function fmtDate(dateStr) {
  return dayjs(dateStr).format('MMM D, YYYY');
}

function fmtDateTime(dateTimeStr) {
  if (!dateTimeStr) return '—';
  const dt = parseWallClock(dateTimeStr);
  return dt.isValid() ? dt.format('MMM D, YYYY h:mm A') : '—';
}

function fmtDateRange(startStr, endStr) {
  const start = startStr ? parseWallClock(startStr) : null;
  const end = endStr ? parseWallClock(endStr) : null;
  const startText = start?.isValid() ? start.format('MMM D, YYYY') : '—';
  const endText = end?.isValid() ? end.format('MMM D, YYYY') : '—';
  return `${startText} - ${endText}`;
}

function localityLabel(location) {
  const fullAddress = location?.fullAddress;
  if (!fullAddress) return location?.name || '—';
  const parts = fullAddress
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
  return parts[0] || location?.name || '—';
}

function firstLocationByRole(locations, role) {
  return (locations ?? []).find((l) => l.role === role) || null;
}

export default function ImportSummaryPage() {
  const { tripId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // A freshly imported trip arrives via navigation state; otherwise load it.
  const stateTrip = location.state?.trip || null;
  const fileName = location.state?.fileName || null;
  const {
    data: fetchedTrip,
    isLoading: loading,
    error: loadError,
  } = useGetTripQuery(tripId, { skip: !tripId || !!stateTrip });
  const trip = stateTrip ?? fetchedTrip ?? null;

  const [triggerVerify] = useLazyVerifyTripQuery();
  const [continuing, setContinuing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const error = actionError
    ?? (loadError ? getErrorMessage(loadError, 'Could not load import summary.') : null);

  async function handleContinue() {
    if (!tripId) return;
    setContinuing(true);
    setActionError(null);
    try {
      const result = await triggerVerify(tripId).unwrap();
      navigate(`/trip-inspection/${tripId}`, {
        state: {
          verify: result,
          tripName: trip?.tripName,
        },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not run trip inspection.'));
      setContinuing(false);
    }
  }

  const pointCount = useMemo(
    () => (trip?.days ?? []).reduce((n, d) => n + (d.points?.length ?? 0), 0),
    [trip]
  );
  const travelCount = trip?.travels?.length ?? 0;
  const stayCount = trip?.stays?.length ?? 0;

  return (
    <AppLayout title="Import Summary">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Import summary
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Review what was imported before continuing to inspection.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading || !trip ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography color="text.secondary">Loading summary…</Typography>
            </Stack>
          </Paper>
        ) : (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <DescriptionIcon color="action" fontSize="small" />
                <Typography variant="body2" color="text.secondary">
                  {fileName ? `From ${fileName}` : 'Saved import'}
                </Typography>
              </Stack>
              <Typography variant="h6" fontWeight={700}>
                {trip.tripName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {fmtDate(trip.startDate)} - {fmtDate(trip.endDate)}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip size="small" label={`${trip.days?.length ?? 0} days`} />
                <Chip size="small" label={`${pointCount} points`} />
                <Chip size="small" label={`${travelCount} travel legs`} />
                <Chip size="small" label={`${stayCount} accommodations`} />
              </Stack>
            </Paper>

            <Paper variant="outlined">
              <List disablePadding>
                <ListItem>
                  <ListItemText
                    primary="Travel Legs"
                    secondary={`${travelCount} total`}
                    primaryTypographyProps={{ fontWeight: 700 }}
                  />
                </ListItem>
                {(trip.travels ?? []).map((travel, i) => {
                  const origin = firstLocationByRole(travel.locations, 'origin');
                  const destination = firstLocationByRole(travel.locations, 'destination');
                  return (
                    <Box key={travel.travelDetailId || `${travel.name}-${i}`}>
                      <Divider />
                      <ListItem alignItems="flex-start">
                        <ListItemText
                          primary={travel.name || 'Untitled travel leg'}
                          secondary={
                            <>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                {fmtDateTime(travel.departureDateTime)}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                Mode: {travel.mode || '—'}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                Departure: {localityLabel(origin)}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                Destination: {localityLabel(destination)}
                              </Typography>
                            </>
                          }
                        />
                      </ListItem>
                    </Box>
                  );
                })}
                {(trip.travels ?? []).length === 0 && (
                  <>
                    <Divider />
                    <ListItem>
                      <ListItemText secondary="No travel legs found." />
                    </ListItem>
                  </>
                )}
              </List>
            </Paper>

            <Paper variant="outlined">
              <List disablePadding>
                <ListItem>
                  <ListItemText
                    primary="Stays"
                    secondary={`${stayCount} total`}
                    primaryTypographyProps={{ fontWeight: 700 }}
                  />
                </ListItem>
                {(trip.stays ?? []).map((stay, i) => {
                  const venue = firstLocationByRole(stay.locations, 'venue') || (stay.locations ?? [])[0] || null;
                  return (
                    <Box key={stay.stayDetailId || `${stay.name}-${i}`}>
                      <Divider />
                      <ListItem alignItems="flex-start">
                        <ListItemText
                          primary={stay.name || 'Untitled stay'}
                          secondary={
                            <>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                {fmtDateRange(stay.checkIn, stay.checkOut)}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                {localityLabel(venue)}
                              </Typography>
                            </>
                          }
                        />
                      </ListItem>
                    </Box>
                  );
                })}
                {(trip.stays ?? []).length === 0 && (
                  <>
                    <Divider />
                    <ListItem>
                      <ListItemText secondary="No stays found." />
                    </ListItem>
                  </>
                )}
              </List>
            </Paper>

            <Paper variant="outlined">
              <List disablePadding>
                {(trip.days ?? []).map((day, i) => (
                  <Box key={day.dayId || i}>
                    {i > 0 && <Divider />}
                    <ListItem alignItems="flex-start">
                      <ListItemText
                        primary={day.title}
                        secondary={
                          <>
                            {day.description && (
                              <Typography variant="body2" color="text.secondary" component="span" display="block">
                                {day.description}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary">
                              {(day.points ?? []).length} points
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                  </Box>
                ))}
              </List>
            </Paper>

            <Button
              variant="contained"
              fullWidth
              onClick={handleContinue}
              disabled={continuing}
              startIcon={continuing ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {continuing ? 'Inspecting…' : 'Continue'}
            </Button>
          </Stack>
        )}
      </Container>
    </AppLayout>
  );
}
