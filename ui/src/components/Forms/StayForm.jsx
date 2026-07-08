import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import client from '../../api/client';

const STAY_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'rental', label: 'Rental' },
  { value: 'other', label: 'Other' },
];

function parseDateTimeLocal(value) {
  if (!value) return '';
  return value.slice(0, 16);
}

export default function StayForm({ tripId, open, onClose, onSaved, initialValues = {} }) {
  const [form, setForm] = useState({
    name: '',
    stayType: 'hotel',
    checkIn: '',
    checkOut: '',
    roomType: '',
    confirmationNumber: '',
    description: '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(initialValues?.stayDetailId);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initialValues.name ?? '',
      stayType: initialValues.stayType ?? 'hotel',
      checkIn: parseDateTimeLocal(initialValues.checkIn),
      checkOut: parseDateTimeLocal(initialValues.checkOut),
      roomType: initialValues.roomType ?? '',
      confirmationNumber: initialValues.confirmationNumber ?? '',
      description: initialValues.description ?? '',
    });
    setErrors({});
  }, [open, initialValues]);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = 'Stay name is required';
    if (!form.checkIn) next.checkIn = 'Check-in is required';
    if (!form.checkOut) next.checkOut = 'Check-out is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        stayType: form.stayType,
        checkIn: form.checkIn || null,
        checkOut: form.checkOut || null,
        roomType: form.roomType.trim() || null,
        confirmationNumber: form.confirmationNumber.trim() || null,
        description: form.description.trim() || null,
      };

      if (isEdit) {
        await client.patch(
          `/trips/${tripId}/stay-details/${initialValues.stayDetailId}`,
          payload
        );
      } else {
        await client.post(`/trips/${tripId}/stay-details`, payload);
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      setErrors({ _submit: err?.response?.data?.detail ?? 'Save failed. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: '92dvh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1, pb: 0.5 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
      </Box>

      <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <EditIcon fontSize="small" color="action" />
          <Typography variant="h6">{isEdit ? 'Edit Stay' : 'New Stay'}</Typography>
        </Stack>
      </Box>

      <Divider />

      <Box sx={{ overflowY: 'auto', flex: 1, px: 2, py: 2 }}>
        <Stack spacing={2.5}>
          <TextField
            label="Stay name"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            size="small"
            fullWidth
            required
            error={Boolean(errors.name)}
            helperText={errors.name}
          />

          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary' }}>
              Stay type
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {STAY_TYPES.map((s) => (
                <Chip
                  key={s.value}
                  label={s.label}
                  clickable
                  color={form.stayType === s.value ? 'primary' : 'default'}
                  variant={form.stayType === s.value ? 'filled' : 'outlined'}
                  onClick={() => setField('stayType', s.value)}
                  size="small"
                />
              ))}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1}>
            <TextField
              label="Check-in"
              type="datetime-local"
              value={form.checkIn}
              onChange={(e) => setField('checkIn', e.target.value)}
              size="small"
              fullWidth
              required
              error={Boolean(errors.checkIn)}
              helperText={errors.checkIn}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Check-out"
              type="datetime-local"
              value={form.checkOut}
              onChange={(e) => setField('checkOut', e.target.value)}
              size="small"
              fullWidth
              required
              error={Boolean(errors.checkOut)}
              helperText={errors.checkOut}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          <TextField
            label="Room type"
            value={form.roomType}
            onChange={(e) => setField('roomType', e.target.value)}
            size="small"
            fullWidth
          />

          <TextField
            label="Confirmation number"
            value={form.confirmationNumber}
            onChange={(e) => setField('confirmationNumber', e.target.value)}
            size="small"
            fullWidth
          />

          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={3}
          />

          {errors._submit && (
            <Typography variant="body2" color="error">
              {errors._submit}
            </Typography>
          )}
        </Stack>
      </Box>

      <Divider />
      <Stack direction="row" spacing={1} sx={{ p: 2 }}>
        <Button variant="outlined" fullWidth onClick={onClose} disabled={saving} startIcon={<CloseIcon />}>
          Cancel
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Stay'}
        </Button>
      </Stack>
    </Drawer>
  );
}
