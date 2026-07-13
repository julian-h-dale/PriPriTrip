import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AppLayout from '../components/AppLayout';
import { useSaveAiDocumentRecordsMutation } from '../store/apiSlice';
import { getErrorMessage } from '../utils/errors';
import { firstLocationByRole, placeLabel } from '../utils/format';

export default function DocumentImportReviewPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [saveAiDocumentRecords] = useSaveAiDocumentRecordsMutation();

  const extraction = location.state?.extraction || null;
  const fileName = location.state?.fileName || extraction?.filename || null;

  const initialStaySelection = useMemo(
    () => new Set((extraction?.stays ?? []).map((s) => s.stayDetailId)),
    [extraction]
  );
  const initialTravelSelection = useMemo(
    () => new Set((extraction?.travels ?? []).map((t) => t.travelDetailId)),
    [extraction]
  );

  const [selectedStays, setSelectedStays] = useState(initialStaySelection);
  const [selectedTravels, setSelectedTravels] = useState(initialTravelSelection);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggleStay(id) {
    setSelectedStays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTravel(id) {
    setSelectedTravels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!extraction?.documentId) return;
    setSaving(true);
    setError(null);
    try {
      const stays = (extraction.stays ?? []).filter((stay) => selectedStays.has(stay.stayDetailId));
      const travels = (extraction.travels ?? []).filter((travel) => selectedTravels.has(travel.travelDetailId));
      await saveAiDocumentRecords({
        documentId: extraction.documentId,
        tripId,
        stays,
        travels,
      }).unwrap();
      navigate(`/trip/${tripId}`);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save extracted records.'));
      setSaving(false);
    }
  }

  if (!extraction) {
    return (
      <AppLayout title="Document Import Review" onBack={() => navigate(`/trip/${tripId}/document-import`)}>
        <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
          <Alert severity="warning">
            No extracted document data found. Please upload the document again.
          </Alert>
        </Container>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Document Import Review" onBack={() => navigate(`/trip/${tripId}/document-import`)}>
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Review extracted records
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {fileName ? `From ${fileName}. ` : ''}Select which stays and travel legs to save.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2}>
          <Paper variant="outlined">
            <List disablePadding>
              <ListItem>
                <ListItemText
                  primary="Travel Legs"
                  secondary={`${extraction.travels?.length ?? 0} extracted`}
                  primaryTypographyProps={{ fontWeight: 700 }}
                />
              </ListItem>
              {(extraction.travels ?? []).map((travel, i) => {
                const origin = firstLocationByRole(travel.locations, 'origin');
                const destination = firstLocationByRole(travel.locations, 'destination');
                return (
                  <ListItem key={travel.travelDetailId || `${travel.name}-${i}`} alignItems="flex-start">
                    <Box sx={{ width: '100%' }}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={selectedTravels.has(travel.travelDetailId)}
                            onChange={() => toggleTravel(travel.travelDetailId)}
                          />
                        )}
                        label={travel.name || 'Untitled travel leg'}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {travel.departureDateTime || '—'} to {travel.arrivalDateTime || '—'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {placeLabel(origin)} to {placeLabel(destination)}
                      </Typography>
                    </Box>
                  </ListItem>
                );
              })}
              {(extraction.travels ?? []).length === 0 && (
                <ListItem>
                  <ListItemText secondary="No travel legs detected in this document." />
                </ListItem>
              )}
            </List>
          </Paper>

          <Paper variant="outlined">
            <List disablePadding>
              <ListItem>
                <ListItemText
                  primary="Stays"
                  secondary={`${extraction.stays?.length ?? 0} extracted`}
                  primaryTypographyProps={{ fontWeight: 700 }}
                />
              </ListItem>
              {(extraction.stays ?? []).map((stay, i) => {
                const venue = firstLocationByRole(stay.locations, 'venue') || (stay.locations ?? [])[0] || null;
                return (
                  <ListItem key={stay.stayDetailId || `${stay.name}-${i}`} alignItems="flex-start">
                    <Box sx={{ width: '100%' }}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={selectedStays.has(stay.stayDetailId)}
                            onChange={() => toggleStay(stay.stayDetailId)}
                          />
                        )}
                        label={stay.name || 'Untitled stay'}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {stay.checkIn || '—'} to {stay.checkOut || '—'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {placeLabel(venue)}
                      </Typography>
                    </Box>
                  </ListItem>
                );
              })}
              {(extraction.stays ?? []).length === 0 && (
                <ListItem>
                  <ListItemText secondary="No stays detected in this document." />
                </ListItem>
              )}
            </List>
          </Paper>

          <Button
            variant="contained"
            fullWidth
            disabled={saving}
            onClick={handleSave}
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {saving ? 'Saving selected records...' : 'Save selected records'}
          </Button>
        </Stack>
      </Container>
    </AppLayout>
  );
}
