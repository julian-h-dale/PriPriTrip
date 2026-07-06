import { useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
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
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DescriptionIcon from '@mui/icons-material/Description';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import dayjs from 'dayjs';
import AppLayout from '../components/AppLayout';
import { aiImportDocument, enhanceTrip, saveImportedTrip } from '../api/tripImportService';
import { fetchTrips } from '../store/tripSlice';

const ACCEPT = '.xlsx,.pdf,.docx';

function fmtDate(dateStr) {
  return dayjs(dateStr).format('MMM D, YYYY');
}

export default function ImportTripPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [fileName, setFileName] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | analyzing | review | enhancing | saving
  const [draft, setDraft] = useState(null);
  const [enhanced, setEnhanced] = useState(false);
  const [error, setError] = useState(null);

  const busy = status === 'analyzing' || status === 'saving' || status === 'enhancing';

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setDraft(null);
    setEnhanced(false);
    setFileName(file.name);
    setStatus('analyzing');
    try {
      const result = await aiImportDocument(file);
      setDraft(result);
      setStatus('review');
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not analyze the document. Please try again.');
      setStatus('idle');
    }
  }

  async function handleEnhance() {
    if (!draft) return;
    setStatus('enhancing');
    setError(null);
    try {
      const result = await enhanceTrip(draft);
      setDraft(result);
      setEnhanced(true);
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not enhance the trip. Please try again.');
    } finally {
      setStatus('review');
    }
  }

  async function handleSave() {
    if (!draft) return;
    setStatus('saving');
    setError(null);
    try {
      await saveImportedTrip(draft);
      dispatch(fetchTrips());
      navigate(`/trip/${draft.tripId}`);
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Failed to save the trip. Please try again.');
      setStatus('review');
    }
  }

  function handleReset() {
    setDraft(null);
    setFileName(null);
    setEnhanced(false);
    setError(null);
    setStatus('idle');
  }

  const pointCount = (draft?.days ?? []).reduce((n, d) => n + (d.points?.length ?? 0), 0);

  return (
    <AppLayout title="Import Trip">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Import from a document
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Upload your itinerary (Excel, PDF, or Word) and we'll turn it into a trip you can review and edit.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {status !== 'review' && (
          <Paper
            variant="outlined"
            sx={{
              p: 4,
              textAlign: 'center',
              borderStyle: 'dashed',
              cursor: busy ? 'default' : 'pointer',
            }}
            onClick={() => !busy && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {status === 'analyzing' ? (
              <Stack spacing={2} alignItems="center">
                <CircularProgress />
                <Typography color="text.secondary">
                  Analyzing {fileName}…
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1} alignItems="center">
                <UploadFileIcon fontSize="large" color="action" />
                <Typography fontWeight={600}>Choose a file</Typography>
                <Typography variant="body2" color="text.secondary">
                  .xlsx, .pdf, or .docx
                </Typography>
              </Stack>
            )}
          </Paper>
        )}

        {status === 'review' && draft && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <DescriptionIcon color="action" fontSize="small" />
                <Typography variant="body2" color="text.secondary">
                  From {fileName}
                </Typography>
              </Stack>
              <Typography variant="h6" fontWeight={700}>
                {draft.tripName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {fmtDate(draft.startDate)} – {fmtDate(draft.endDate)}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Chip size="small" label={`${draft.days?.length ?? 0} days`} />
                <Chip size="small" label={`${pointCount} points`} />
              </Stack>
            </Paper>

            <Paper variant="outlined">
              <List disablePadding>
                {(draft.days ?? []).map((day, i) => (
                  <Box key={day.dayId}>
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

            <Stack direction="row" spacing={2}>
              <Button variant="outlined" fullWidth onClick={handleReset} disabled={busy}>
                Start over
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={handleEnhance}
                disabled={busy}
                startIcon={status === 'enhancing' ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
              >
                {status === 'enhancing' ? 'Enhancing…' : enhanced ? 'Enhance again' : 'Enhance'}
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={handleSave}
                disabled={busy}
                startIcon={status === 'saving' ? <CircularProgress size={18} color="inherit" /> : null}
              >
                {status === 'saving' ? 'Saving…' : 'Save trip'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              {enhanced
                ? 'Descriptions enhanced. You can fine-tune every detail with the editing forms after saving.'
                : 'Optionally enhance to add vivid day summaries. You can also fine-tune every detail after saving.'}
            </Typography>
          </Stack>
        )}
      </Container>
    </AppLayout>
  );
}
