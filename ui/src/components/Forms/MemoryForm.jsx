import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMemory, updateMemory } from '../../store/memoriesSlice';
import { selectTrip } from '../../store/tripSlice';

const EMPTY = {
  title: '',
  date: '',
  time: '',
  location: '',
  notes: '',
  linkedItemId: '',
};

export default function MemoryForm({ open, memory, onClose }) {
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const [form, setForm] = useState(EMPTY);
  const [previewNotes, setPreviewNotes] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreviewNotes(false);
    if (memory) {
      setForm({
        title: memory.title ?? '',
        date: memory.date ?? '',
        time: memory.time ?? '',
        location: memory.location ?? '',
        notes: memory.notes ?? '',
        linkedItemId: memory.linkedItemId ?? '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, memory]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    if (!form.title.trim() || !form.date) return;
    const payload = {
      title: form.title.trim(),
      date: form.date,
      time: form.time.trim() || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      linkedItemId: form.linkedItemId || null,
    };
    if (memory) {
      await dispatch(updateMemory({ ...memory, ...payload }));
    } else {
      await dispatch(createMemory(payload));
    }
    onClose();
  };

  // Groups for the optional "link to itinerary" selector
  const groups = (trip?.items ?? [])
    .filter((i) => i.kind === 'group')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const legs = (trip?.items ?? [])
    .filter((i) => i.kind === 'leg')
    .sort((a, b) => {
      if (a.parentItemId !== b.parentItemId) return 0;
      return a.sortOrder - b.sortOrder;
    });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{memory ? 'Edit Memory' : 'Capture a Memory'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Title"
            value={form.title}
            onChange={set('title')}
            required
            fullWidth
            size="small"
            autoFocus
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Date"
              type="date"
              value={form.date}
              onChange={set('date')}
              required
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Time"
              type="time"
              value={form.time}
              onChange={set('time')}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            label="Location"
            value={form.location}
            onChange={set('location')}
            fullWidth
            size="small"
            placeholder="e.g. Männlichen, Switzerland"
          />

          {/* Notes with preview toggle */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">Notes</Typography>
              <Button size="small" onClick={() => setPreviewNotes((p) => !p)}>
                {previewNotes ? 'Edit' : 'Preview'}
              </Button>
            </Box>
            {previewNotes ? (
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                  minHeight: 100,
                  typography: 'body2',
                  color: 'text.secondary',
                  '& p': { m: 0, mb: 1 },
                  '& p:last-child': { mb: 0 },
                  '& ul, & ol': { pl: 2.5, mt: 0, mb: 1 },
                  '& li': { mb: 0.25 },
                  '& strong': { color: 'text.primary' },
                  '& code': { fontFamily: 'monospace', fontSize: '0.85em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
                }}
              >
                {form.notes.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.notes}</ReactMarkdown>
                ) : (
                  <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                    Nothing to preview
                  </Typography>
                )}
              </Box>
            ) : (
              <TextField
                value={form.notes}
                onChange={set('notes')}
                multiline
                minRows={4}
                fullWidth
                size="small"
                placeholder="Write anything... Markdown supported."
              />
            )}
          </Box>

          {/* Optional link to an itinerary item */}
          {trip && (
            <TextField
              select
              label="Link to itinerary (optional)"
              value={form.linkedItemId}
              onChange={set('linkedItemId')}
              fullWidth
              size="small"
              slotProps={{ select: { native: true } }}
            >
              <option value="">— none —</option>
              {groups.map((g) => (
                <optgroup key={g.itemId} label={g.title}>
                  {legs
                    .filter((l) => l.parentItemId === g.itemId)
                    .map((l) => (
                      <option key={l.itemId} value={l.itemId}>
                        {l.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!form.title.trim() || !form.date}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
