import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  CircularProgress,
  Container,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import AppLayout from '../components/AppLayout';
import {
  aiImportTripDocument,
  getAiDocumentExtraction,
  listAiDocuments,
  regenAiDocumentExtraction,
} from '../api/tripImportService';

const ACCEPT = '.xlsx,.pdf,.docx';

export default function DocumentImporterPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | extracting
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [workingDocumentId, setWorkingDocumentId] = useState(null);

  const busy = status !== 'idle';

  useEffect(() => {
    let active = true;

    async function loadDocuments() {
      if (!tripId) return;
      setLoadingDocs(true);
      try {
        const data = await listAiDocuments(tripId);
        if (active) setDocuments(data);
      } catch (err) {
        if (active) {
          setError(err?.response?.data?.detail ?? 'Could not load previous documents.');
        }
      } finally {
        if (active) setLoadingDocs(false);
      }
    }

    loadDocuments();
    return () => {
      active = false;
    };
  }, [tripId]);

  async function refreshDocuments() {
    if (!tripId) return;
    const data = await listAiDocuments(tripId);
    setDocuments(data);
  }

  async function handleFile(file) {
    if (!file || !tripId) return;
    setError(null);
    setFileName(file.name);
    setStatus('extracting');
    try {
      const extraction = await aiImportTripDocument(tripId, file);
      await refreshDocuments();
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

  async function handleReview(documentId) {
    setError(null);
    setWorkingDocumentId(documentId);
    try {
      const extraction = await getAiDocumentExtraction(documentId);
      navigate(`/trip/${tripId}/document-import/review`, {
        state: {
          extraction,
          fileName: extraction.filename,
        },
      });
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not load extracted details.');
      setWorkingDocumentId(null);
    }
  }

  async function handleRegen(documentId) {
    setError(null);
    setWorkingDocumentId(documentId);
    try {
      const extraction = await regenAiDocumentExtraction(documentId);
      await refreshDocuments();
      navigate(`/trip/${tripId}/document-import/review`, {
        state: {
          extraction,
          fileName: extraction.filename,
        },
      });
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not regenerate extracted details.');
      setWorkingDocumentId(null);
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

        <Paper variant="outlined" sx={{ mt: 3 }}>
          <List disablePadding>
            <ListItem>
              <ListItemText
                primary="Previous documents"
                secondary="Stored extracted uploads for this trip"
                primaryTypographyProps={{ fontWeight: 700 }}
              />
            </ListItem>
            {loadingDocs && (
              <ListItem>
                <ListItemText secondary="Loading documents..." />
              </ListItem>
            )}
            {!loadingDocs && documents.length === 0 && (
              <ListItem>
                <ListItemText secondary="No previous documents yet." />
              </ListItem>
            )}
            {!loadingDocs && documents.map((doc) => (
              <ListItem
                key={doc.documentId}
                secondaryAction={(
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() => handleReview(doc.documentId)}
                      disabled={workingDocumentId === doc.documentId}
                    >
                      Review
                    </Button>
                    <Button
                      size="small"
                      onClick={() => handleRegen(doc.documentId)}
                      disabled={workingDocumentId === doc.documentId}
                    >
                      Regen details
                    </Button>
                  </Stack>
                )}
              >
                <ListItemText
                  primary={doc.filename}
                  secondary={`${doc.travelsExtracted} travel, ${doc.staysExtracted} stays`}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Container>
    </AppLayout>
  );
}
