import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import dayjs from 'dayjs';
import { upsertItem, selectTrip } from '../../store/tripSlice';

const TYPE_SUBTYPES = {
  travel: ['flight', 'train', 'bus', 'car', 'ferry', 'boat'],
  stay: ['hotel', 'hostel', 'airbnb', 'rental'],
  activity: ['day_trip', 'walk', 'hike', 'museum', 'restaurant', 'tour', 'activity'],
};

function toDateTimeLocal(iso) {
  if (!iso) return '';
  return dayjs(iso).format('YYYY-MM-DDTHH:mm');
}

const EMPTY = {
  title: '',
  parentItemId: '',
  type: 'travel',
  subtype: 'flight',
  startDateTime: '',
  endDateTime: '',
  confirmationNumber: '',
  description: '',
  completed: false,
};

export default function LegForm({ open, item, onClose }) {
  const dispatch = useDispatch();
  const trip = useSelector(selectTrip);
  const [form, setForm] = useState(EMPTY);

  const groups = (trip?.items ?? [])
    .filter((i) => i.kind === 'group' && i.parentItemId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setForm({
        title: item.title ?? '',
        parentItemId: item.parentItemId ?? '',
        type: item.type ?? 'travel',
        subtype: item.subtype ?? '',
        startDateTime: toDateTimeLocal(item.startDateTime),
        endDateTime: toDateTimeLocal(item.endDateTime),
        confirmationNumber: item.confirmationNumber ?? '',
        description: item.description ?? '',
        completed: item.completed ?? false,
      });
    } else {
      setForm({ ...EMPTY, parentItemId: groups[0]?.itemId ?? '' });
    }
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleTypeChange = (e) => {
    const type = e.target.value;
    setForm((f) => ({ ...f, type, subtype: TYPE_SUBTYPES[type]?.[0] ?? '' }));
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
    const siblings = (trip?.items ?? []).filter(
      (i) => i.parentItemId === form.parentItemId && i.kind === 'leg',
    );
    const maxOrder = siblings.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
    const payload = {
      title: form.title.trim(),
      parentItemId: form.parentItemId || null,
      type: form.type,
      subtype: form.subtype,
      startDateTime: form.startDateTime,
      endDateTime: form.endDateTime,
      confirmationNumber: form.confirmationNumber.trim() || null,
      description: form.description.trim() || null,
      completed: form.completed,
    };
    const next = item
      ? { ...item, ...payload }
      : {
          itemId: crypto.randomUUID(),
          kind: 'leg',
          sortOrder: maxOrder + 1,
          locations: [],
          documents: [],
          completedDateTime: null,
          ...payload,
        };
    dispatch(upsertItem(next));
    onClose(next);
  };

  const subtypes = TYPE_SUBTYPES[form.type] ?? [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{item ? 'Edit Leg' : 'Add Leg'}</DialogTitle>
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
          <FormControl fullWidth size="small">
            <InputLabel>Group</InputLabel>
            <Select label="Group" value={form.parentItemId} onChange={set('parentItemId')}>
              {groups.map((g) => (
                <MenuItem key={g.itemId} value={g.itemId}>
                  {g.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={form.type} onChange={handleTypeChange}>
                <MenuItem value="travel">Travel</MenuItem>
                <MenuItem value="stay">Stay</MenuItem>
                <MenuItem value="activity">Activity</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Subtype</InputLabel>
              <Select label="Subtype" value={form.subtype} onChange={set('subtype')}>
                {subtypes.map((s) => (
                  <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>
                    {s.replace('_', ' ')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
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
            label="Confirmation #"
            value={form.confirmationNumber}
            onChange={set('confirmationNumber')}
            fullWidth
            size="small"
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
          <FormControlLabel
            control={
              <Checkbox checked={form.completed} onChange={set('completed')} size="small" />
            }
            label="Completed"
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
