import { useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AppLayout from '../components/AppLayout';
import { aiImportDocument, saveImportedTrip } from '../api/tripImportService';
import { fetchTrips } from '../store/tripSlice';

const ACCEPT = '.xlsx,.pdf,.docx';

export default function ImportTripPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [fileName, setFileName] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | analyzing | saving
  const [error, setError] = useState(null);

  const busy = status === 'analyzing' || status === 'saving';

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setStatus('analyzing');
    try {
      const draft = await aiImportDocument(file);
      setStatus('saving');
      await saveImportedTrip(draft);
      dispatch(fetchTrips());
      navigate(`/import-summary/${draft.tripId}`, {
        state: {
          trip: draft,
          fileName: file.name,
        },
      });
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not import the document. Please try again.');
      setStatus('idle');
    }
  }

  return (
    <AppLayout title="Import Trip">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Import from a document
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Upload your itinerary (Excel, PDF, or Word). We will extract it and save your trip automatically.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
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
          {busy ? (
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography color="text.secondary">
                {status === 'analyzing'
                  ? `Analyzing ${fileName}…`
                  : 'Saving trip and preparing summary…'}
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
      </Container>
    </AppLayout>
  );
}
