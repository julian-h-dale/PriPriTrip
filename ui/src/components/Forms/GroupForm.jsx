import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';
import { upsertItem, selectTrip } from '../../store/tripSlice';

function toDateTimeLocal(iso) {
  if (!iso) return '';
  return dayjs(iso).tz(TRIP_TZ).format('YYYY-MM-DDTHH:mm');
}

const EMPTY = { title: '', startDateTime: '', endDateTime: '', description: '' };

export default function GroupForm({ open, item, onClose }) {
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setForm({
        title: item.title ?? '',
        startDateTime: toDateTimeLocal(item.startDateTime),
        endDateTime: toDateTimeLocal(item.endDateTime),
        description: item.description ?? '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = () => {
    if (!form.title.trim()) return;
    const groups = (trip?.items ?? []).filter(
      (i) => i.parentItemId === null && i.kind === 'group',
    );
    const maxOrder = groups.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
    const payload = {
      title: form.title.trim(),
      startDateTime: form.startDateTime,
      endDateTime: form.endDateTime,
      description: form.description.trim() || null,
    };
    const next = item
      ? { ...item, ...payload }
      : {
          itemId: crypto.randomUUID(),
          parentItemId: null,
          kind: 'group',
          sortOrder: maxOrder + 1,
          ...payload,
        };
    dispatch(upsertItem(next));
    onClose(next);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{item ? 'Edit Group' : 'Add Group'}</DialogTitle>
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
          <TextField
            label="Start"
            type="datetime-local"
            value={form.startDateTime}
            onChange={set('startDateTime')}
            fullWidth
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="End"
            type="datetime-local"
            value={form.endDateTime}
            onChange={set('endDateTime')}
            fullWidth
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={set('description')}
            multiline
            minRows={2}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={!form.title.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
