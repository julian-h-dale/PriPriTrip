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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { aiImportTripDocument, saveAiDocumentRecords } from '../../api/tripImportService';
import { listChatMessages, sendChatMessage } from '../../api/chatService';

function MarkdownBubble({ text, isBot }) {
  return (
    <Box
      sx={{
        typography: 'body2',
        whiteSpace: 'pre-wrap',
        color: isBot ? 'text.primary' : 'inherit',
        '& p': { m: 0, mb: 0.75 },
        '& p:last-child': { mb: 0 },
        '& ul, & ol': { pl: 2.5, mt: 0, mb: 0.75 },
        '& li': { mb: 0.25 },
        '& a': { color: 'inherit', textDecoration: 'underline' },
        '& strong': { color: isBot ? 'text.primary' : 'inherit' },
        '& code': {
          fontFamily: 'monospace',
          fontSize: '0.9em',
          bgcolor: isBot ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)',
          px: 0.5,
          borderRadius: 0.5,
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </Box>
  );
}

function TypingBubble() {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.4,
        minHeight: 22,
        '& span': {
          width: 5,
          height: 5,
          borderRadius: '50%',
          bgcolor: 'text.secondary',
          opacity: 0.25,
          animation: 'typingPulse 1.5s ease-in-out infinite',
        },
        '& span:nth-of-type(2)': {
          animationDelay: '0.2s',
        },
        '& span:nth-of-type(3)': {
          animationDelay: '0.4s',
        },
        '@keyframes typingPulse': {
          '0%, 80%, 100%': {
            opacity: 0.25,
            transform: 'translateY(0)',
          },
          '40%': {
            opacity: 1,
            transform: 'translateY(-1px)',
          },
        },
      }}
    >
      <Box component="span" />
      <Box component="span" />
      <Box component="span" />
    </Box>
  );
}

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
    const userTempId = `temp-user-${Date.now()}`;
    const botTempId = `temp-bot-${Date.now()}`;
    setDraft('');
    setMessages((prev) => [
      ...prev,
      {
        messageId: userTempId,
        tripId: tripId || 'pending',
        workflowName,
        message: text,
        isBot: false,
      },
      {
        messageId: botTempId,
        tripId: tripId || 'pending',
        workflowName,
        message: '...',
        isBot: true,
      },
    ]);
    setLoading(true);
    setError(null);
    try {
      const response = await sendChatMessage({
        tripId,
        workflowName,
        message: text,
      });
      onTripIdChange?.(response.tripId);
      const [userMessage, botMessage] = response.messages ?? [];
      setMessages((prev) => prev.map((message) => {
        if (message.messageId === userTempId && userMessage) return userMessage;
        if (message.messageId === botTempId && botMessage) return botMessage;
        return message;
      }));
      if (response.complete) {
        onComplete?.(response);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message.messageId !== botTempId));
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
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Paper
                  sx={{
                    px: 1.5,
                    py: 1,
                    maxWidth: '85%',
                    bgcolor: 'grey.100',
                    color: 'text.primary',
                  }}
                >
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    Let&apos;s get ready to go! Tell me about your trip! When, where, how we get there etc. Or upload an itinerary
                  </Typography>
                </Paper>
              </Box>
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
                  {message.message === '...' ? (
                    <TypingBubble />
                  ) : (
                    <MarkdownBubble text={message.message} isBot={message.isBot} />
                  )}
                </Paper>
              </Box>
            ))}
            {loading && messages.length === 0 && (
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
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
