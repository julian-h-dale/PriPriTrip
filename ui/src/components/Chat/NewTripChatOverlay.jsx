import { useEffect, useState } from 'react';
import {
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { aiImportTripDocument, saveAiDocumentRecords } from '../../api/tripImportService';
import { listChatMessages, sendChatMessage } from '../../api/chatService';

export default function NewTripChatOverlay({
  open,
  onClose,
  tripId,
  workflowName,
  onTripIdChange,
  onComplete,
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadMessages() {
      if (!open || !tripId) {
        if (active) setMessages([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await listChatMessages(tripId, workflowName);
        if (active) setMessages(data);
      } catch (err) {
        if (active) setError(err?.response?.data?.detail ?? 'Could not load chat messages.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadMessages();
    return () => {
      active = false;
    };
  }, [open, tripId, workflowName]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const response = await sendChatMessage({
        tripId,
        workflowName,
        message: text,
      });
      onTripIdChange?.(response.tripId);
      setMessages((prev) => [...prev, ...(response.messages ?? [])]);
      setDraft('');
      if (response.complete) {
        onComplete?.(response);
      }
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not send message.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDocumentUpload(file) {
    if (!file) return;
    if (!tripId) {
      setError('Send your first message to create the trip shell before uploading a document.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const extraction = await aiImportTripDocument(tripId, file);
      const result = await saveAiDocumentRecords(extraction.documentId, {
        stays: extraction.stays,
        travels: extraction.travels,
      });
      setMessages((prev) => [
        ...prev,
        {
          messageId: `local-upload-${Date.now()}`,
          tripId,
          workflowName,
          isBot: true,
          message: `Imported ${result.travelsSaved} travel and ${result.staysSaved} stay records from ${file.name}.`,
        },
      ]);
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not import that document into the trip.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} fullScreen onClose={onClose}>
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            New Trip Chat
          </Typography>
          <IconButton onClick={onClose} aria-label="Close chat">
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          <Stack spacing={1.5}>
            {messages.length === 0 && !loading && (
              <Typography color="text.secondary">
                Start the conversation and we will create your new trip shell on the first message.
              </Typography>
            )}
            {messages.map((message) => (
              <Box
                key={message.messageId}
                sx={{
                  display: 'flex',
                  justifyContent: message.isBot ? 'flex-start' : 'flex-end',
                }}
              >
                <Paper
                  sx={{
                    px: 1.5,
                    py: 1,
                    maxWidth: '85%',
                    bgcolor: message.isBot ? 'grey.100' : 'primary.main',
                    color: message.isBot ? 'text.primary' : 'primary.contrastText',
                  }}
                >
                  <Typography variant="body2">{message.message}</Typography>
                </Paper>
              </Box>
            ))}
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            p: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} disabled={uploading || loading}>
              {uploading ? 'Uploading…' : 'Upload document'}
              <input hidden type="file" accept=".xlsx,.pdf,.docx" onChange={(e) => handleDocumentUpload(e.target.files?.[0])} />
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              label="Message"
              multiline
              minRows={2}
              maxRows={5}
              fullWidth
            />
            <Button variant="contained" onClick={handleSend} disabled={loading || !draft.trim()}>
              Send
            </Button>
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
