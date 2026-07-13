import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
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
import {
  aiImportDocument,
  aiImportTripDocument,
} from '../../api/tripImportService';
import {
  apiSlice,
  useImportTripMutation,
  useLazyVerifyTripQuery,
  useSaveAiDocumentRecordsMutation,
  useSaveTripHeaderMutation,
} from '../../store/apiSlice';
import { getErrorMessage } from '../../utils/errors';
import {
  choiceFromMessage,
  formFromMessage,
  listChatMessages,
  sendChatMessage,
  submitChatChoice,
  submitChatForm,
} from '../../api/chatService';
import ChatChoiceCard from './ChatChoiceCard';
import ChatFormCard from './ChatFormCard';

/** Trip data the chat may have changed behind RTK Query's back. */
function tripCacheTags(tripId) {
  return ['Trips', { type: 'Trip', id: tripId }, { type: 'Verify', id: tripId }];
}

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

/**
 * The trip chat. Used two ways:
 *   - Trips page: workflowName="trip:new_trip", no tripId — builds a new trip.
 *   - Trip page:  workflowName="trip:manage", tripId set — edits the open trip.
 */
export default function TripChatOverlay({
  open,
  onClose,
  tripId,
  workflowName,
  title = 'Trip Chat',
  emptyPrompt = "Tell me about your trip — when, where, how you're getting there. Or upload an itinerary.",
  onTripIdChange,
  onComplete,
}) {
  const dispatch = useDispatch();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState(null);
  // formId/choiceId -> what was saved, so a submitted card collapses to a receipt.
  const [savedForms, setSavedForms] = useState({});
  const [savedChoices, setSavedChoices] = useState({});

  const messagesEndRef = useRef(null);
  const sendAbortRef = useRef(null);
  const requestIdRef = useRef(null);
  const busy = loading || uploading;

  const [saveTripHeader] = useSaveTripHeaderMutation();
  const [importTrip] = useImportTripMutation();
  const [saveAiDocumentRecords] = useSaveAiDocumentRecordsMutation();
  const [triggerVerify] = useLazyVerifyTripQuery();

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

  // Keep the newest message (and streaming text) in view (review.md 2C-3).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  // Don't leave a stream running against a closed overlay.
  useEffect(() => {
    if (!open) sendAbortRef.current?.abort();
  }, [open]);

  useEffect(() => () => sendAbortRef.current?.abort(), []);

  // What kind of document is this? The entry point decides — not the trip's
  // status. This used to be `!tripSnapshot || tripSnapshot.status === 'new'`,
  // which meant a hotel confirmation uploaded to a trip that happened to still
  // be `status: "new"` was run through the *itinerary* parser. The user knows
  // which kind of document they have; the app should learn it from where they
  // clicked, not infer it from a database column.
  //
  //   trip:new_trip  → "I have the whole trip in a file."
  //   trip:manage    → "Here's my hotel booking."
  const isItineraryUpload = workflowName === 'trip:new_trip';

  async function handleSend() {
    const text = draft.trim();
    if (!text || busy) return; // Enter-to-send must respect the same guard as the button
    const userTempId = `temp-user-${Date.now()}`;
    const botTempId = `temp-bot-${Date.now()}`;

    // Idempotency key (review.md 3D-5). A retry of the *same* failed message
    // reuses the key, so if the turn actually landed server-side and only the
    // response was lost, the retry replays that reply instead of running the
    // model again and duplicating stays/travels. Editing the text before
    // retrying makes it a genuinely new request, so it gets a new key.
    if (requestIdRef.current?.message !== text) {
      requestIdRef.current = { id: crypto.randomUUID(), message: text };
    }
    const requestId = requestIdRef.current.id;

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
        message: '',
        // A real flag, not a magic '...' string — a user typing "..." used to
        // render as a typing indicator (review.md 2C-3).
        isPending: true,
        isBot: true,
      },
    ]);
    setLoading(true);
    setError(null);

    const patchBotTemp = (patch) => {
      setMessages((prev) => prev.map((message) => (
        message.messageId === botTempId ? { ...message, ...patch(message) } : message
      )));
    };

    const controller = new AbortController();
    sendAbortRef.current = controller;

    try {
      const response = await sendChatMessage({
        tripId,
        workflowName,
        message: text,
        requestId,
        context: {
          // Where the user is chatting from — the assistant sees this.
          page: tripId ? 'trip' : 'trips',
          selectedTripId: tripId || null,
          workflowName,
        },
      }, {
        signal: controller.signal,
        onStatus: (status) => {
          patchBotTemp(() => ({ statusLabel: status.label }));
        },
        onDelta: (chunk) => {
          patchBotTemp((message) => ({
            message: message.message + chunk,
            isPending: false, // first token arrived — swap the dots for text
            statusLabel: null,
          }));
        },
      });
      requestIdRef.current = null; // answered — the next send is a new request
      // The assistant just wrote to the trip; the page underneath is stale.
      dispatch(apiSlice.util.invalidateTags(tripCacheTags(response.tripId)));
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
      // An abort is us closing the overlay, not a failure worth reporting.
      if (err?.name !== 'AbortError') {
        setError(err?.detail ?? err?.response?.data?.detail ?? 'Could not send message.');
        setDraft(text); // don't lose what they typed (and keep requestIdRef for the retry)
      }
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null;
      setLoading(false);
    }
  }

  /**
   * Save a form the assistant attached (review.md 3F-2). This is not a chat
   * turn — the backend applies the values through the executor with no model
   * call, so it returns immediately and costs nothing.
   */
  async function handleFormSubmit(form, values) {
    const response = await submitChatForm({
      tripId,
      workflowName,
      requestId: crypto.randomUUID(),
      formId: form.formId,
      target: form.target,
      recordId: form.recordId ?? null,
      values,
    });

    dispatch(apiSlice.util.invalidateTags(tripCacheTags(response.tripId)));

    // Collapse the form into a receipt, then append the exchange.
    const [userMessage, botMessage] = response.messages ?? [];
    // The receipt stays short — the appended messages below already show
    // exactly what was saved.
    setSavedForms((prev) => ({ ...prev, [form.formId]: 'Saved.' }));
    setMessages((prev) => [...prev, userMessage, botMessage].filter(Boolean));
    if (response.complete) onComplete?.(response);
  }

  /**
   * Apply a place the user picked (review.md 3F-5). Not a chat turn: the
   * chosen place id goes straight onto the location, no model call.
   */
  /**
   * `picked` is either one of the places we offered ({ optionId }) or one the
   * user found through the card's Places search ({ placeId }). The backend
   * takes it from there — either way there is no model call.
   */
  async function handleChoiceSubmit(choice, picked) {
    const response = await submitChatChoice({
      tripId,
      workflowName,
      requestId: crypto.randomUUID(),
      choiceId: choice.choiceId,
      optionId: picked.optionId ?? null,
      placeId: picked.placeId ?? null,
    });

    dispatch(apiSlice.util.invalidateTags(tripCacheTags(response.tripId)));
    setSavedChoices((prev) => ({ ...prev, [choice.choiceId]: `Using ${picked.label}.` }));
    const [userMessage, botMessage] = response.messages ?? [];
    setMessages((prev) => [...prev, userMessage, botMessage].filter(Boolean));
  }

  async function handleDocumentUpload(file) {
    if (!file || busy) return;
    setUploading(true);
    setError(null);
    try {
      // The itinerary path chains four calls; say which one we're on rather
      // than showing a static "Uploading…" for a minute (review.md 2C-3).
      if (isItineraryUpload) {
        let targetTripId = tripId;
        if (!targetTripId) {
          setUploadStep('Creating your trip…');
          const today = new Date().toISOString().slice(0, 10);
          targetTripId = crypto.randomUUID();
          await saveTripHeader({
            tripId: targetTripId,
            tripName: 'New Trip Draft',
            startDate: today,
            endDate: today,
          }).unwrap();
          onTripIdChange?.(targetTripId);
        }

        setUploadStep(`Reading ${file.name}…`);
        const imported = await aiImportDocument(file, { tripId: targetTripId });
        const draftTrip = {
          ...imported,
          tripId: targetTripId,
        };

        setUploadStep('Saving your itinerary…');
        const saveResult = await importTrip(draftTrip).unwrap();

        setUploadStep('Checking for gaps…');
        const verify = await triggerVerify(saveResult.tripId).unwrap();
        onComplete?.({
          tripId: saveResult.tripId,
          tripName: draftTrip.tripName,
          verify,
          complete: true,
        });
        return;
      }

      if (!tripId) {
        throw new Error('Trip is not ready for detail document import yet.');
      }

      setUploadStep(`Reading ${file.name}…`);
      const extraction = await aiImportTripDocument(tripId, file, 'detail_import');

      setUploadStep('Saving the records…');
      const result = await saveAiDocumentRecords({
        documentId: extraction.documentId,
        tripId,
        stays: extraction.stays,
        travels: extraction.travels,
      }).unwrap();
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
      // Detail may come from RTK Query (err.data) or axios (err.response.data).
      const detail = err?.data?.detail ?? err?.response?.data?.detail;
      if (detail?.errorCode === 'ITINERARY_REIMPORT_BLOCKED') {
        setError('Itinerary import is already locked for this trip. Continue in inspection or upload detail documents.');
      } else {
        setError(getErrorMessage(err, err?.message ?? 'Could not import that document into the trip.'));
      }
    } finally {
      setUploading(false);
      setUploadStep(null);
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
            {title}
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
                    {emptyPrompt}
                  </Typography>
                </Paper>
              </Box>
            )}
            {messages.map((message) => {
              const form = message.isBot ? formFromMessage(message) : null;
              const choice = message.isBot ? choiceFromMessage(message) : null;
              // Form/choice submissions are recorded as "[form] …" / "[choice] …" —
              // show what was chosen, not the marker.
              const text = message.message?.replace(/^\[(form|choice)\] /, '');
              return (
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
                    maxWidth: form || choice ? '95%' : '85%',
                    minWidth: form || choice ? '85%' : undefined,
                    bgcolor: message.isBot ? 'grey.100' : 'primary.main',
                    color: message.isBot ? 'text.primary' : 'primary.contrastText',
                  }}
                >
                  {message.isPending && !message.message ? (
                    <TypingBubble />
                  ) : (
                    <MarkdownBubble text={text} isBot={message.isBot} />
                  )}
                  {form && (
                    <ChatFormCard
                      form={form}
                      disabled={busy}
                      savedSummary={savedForms[form.formId] ?? null}
                      onSubmit={(values) => handleFormSubmit(form, values)}
                    />
                  )}
                  {choice && (
                    <ChatChoiceCard
                      choice={choice}
                      disabled={busy}
                      savedSummary={savedChoices[choice.choiceId] ?? null}
                      onSubmit={(option) => handleChoiceSubmit(choice, option)}
                    />
                  )}
                  {message.statusLabel && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}
                    >
                      {message.statusLabel}
                    </Typography>
                  )}
                </Paper>
              </Box>
              );
            })}
            {loading && messages.length === 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {uploadStep && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 0.5 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  {uploadStep}
                </Typography>
              </Box>
            )}
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
            {/* Scroll anchor — keeps the newest message in view. */}
            <Box ref={messagesEndRef} />
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
            {/* The label says which kind of document this button wants, because
                that is exactly what the app used to have to guess. */}
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} disabled={busy}>
              {uploading
                ? 'Uploading…'
                : isItineraryUpload
                  ? 'Upload an itinerary'
                  : 'Upload a booking confirmation'}
              <input
                hidden
                type="file"
                accept=".xlsx,.pdf,.docx"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  handleDocumentUpload(selected);
                  e.target.value = '';
                }}
              />
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Gate Enter on `busy` too, or keyboard users can fire
                  // overlapping sends while the button is disabled (2C-3).
                  if (!busy) handleSend();
                }
              }}
              label="Message"
              multiline
              minRows={2}
              maxRows={5}
              fullWidth
            />
            <Button variant="contained" onClick={handleSend} disabled={busy || !draft.trim()}>
              Send
            </Button>
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
