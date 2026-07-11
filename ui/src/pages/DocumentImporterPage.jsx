import { useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
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
  regenAiDocumentExtraction,
} from '../api/tripImportService';
import { apiSlice, useGetAiDocumentsQuery } from '../store/apiSlice';
import { getErrorMessage } from '../utils/errors';

const ACCEPT = '.xlsx,.pdf,.docx';

export default function DocumentImporterPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const inputRef = useRef(null);

  const [status, setStatus] = useState('idle'); // idle | extracting
  const [fileName, setFileName] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [workingDocumentId, setWorkingDocumentId] = useState(null);

  const {
    data: documents = [],
    isLoading: loadingDocs,
    error: docsError,
  } = useGetAiDocumentsQuery(tripId, { skip: !tripId });

  const error = actionError
    ?? (docsError ? getErrorMessage(docsError, 'Could not load previous documents.') : null);

  const busy = status !== 'idle';

  function invalidateDocuments() {
    dispatch(apiSlice.util.invalidateTags([{ type: 'AiDocuments', id: tripId }]));
  }

  async function handleFile(file) {
    if (!file || !tripId) return;
    setActionError(null);
    setFileName(file.name);
    setStatus('extracting');
    try {
      const extraction = await aiImportTripDocument(tripId, file);
      invalidateDocuments();
      navigate(`/trip/${tripId}/document-import/review`, {
        state: {
          extraction,
          fileName: file.name,
        },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not extract details from this document.'));
      setStatus('idle');
    }
  }

  async function handleReview(documentId) {
    setActionError(null);
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
      setActionError(getErrorMessage(err, 'Could not load extracted details.'));
      setWorkingDocumentId(null);
    }
  }

  async function handleRegen(documentId) {
    setActionError(null);
    setWorkingDocumentId(documentId);
    try {
      const extraction = await regenAiDocumentExtraction(documentId);
      invalidateDocuments();
      navigate(`/trip/${tripId}/document-import/review`, {
        state: {
          extraction,
          fileName: extraction.filename,
        },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not regenerate extracted details.'));
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
