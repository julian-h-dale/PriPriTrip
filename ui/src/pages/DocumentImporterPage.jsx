import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import AppLayout from '../components/AppLayout';
import { aiImportTripDocument } from '../api/tripImportService';

const ACCEPT = '.xlsx,.pdf,.docx';

export default function DocumentImporterPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | extracting
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);

  const busy = status !== 'idle';

  async function handleFile(file) {
    if (!file || !tripId) return;
    setError(null);
    setFileName(file.name);
    setStatus('extracting');
    try {
      const extraction = await aiImportTripDocument(tripId, file);
      navigate(`/trip/${tripId}/document-import/review`, {
        state: {
          extraction,
          fileName: file.name,
        },
      });
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not extract details from this document.');
      setStatus('idle');
    }
  }

  return (
    <AppLayout
      title="Document Importer"
      onBack={() => navigate(`/trip/${tripId}`)}
    >
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          Add stay and travel from a document
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Upload a reservation or ticket PDF, DOCX, or XLSX. We will extract stay and travel details.
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
                Extracting records from {fileName}...
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1} alignItems="center">
              <DescriptionIcon fontSize="large" color="action" />
              <Typography fontWeight={600}>Choose a document</Typography>
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
