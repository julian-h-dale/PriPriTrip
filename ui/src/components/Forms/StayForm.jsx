import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useEffect, useState } from 'react';
import {
  useCreateStayDetailMutation,
  useDeleteStayDetailMutation,
  usePatchStayDetailMutation,
} from '../../store/apiSlice';
import { getErrorMessage } from '../../utils/errors';
import LocationForm from './LocationForm';

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

function makeLocation(overrides = {}) {
  return {
    locationId: overrides.locationId || crypto.randomUUID(),
    role: overrides.role || 'venue',
    name: overrides.name ?? '',
    lat: overrides.lat ?? null,
    lng: overrides.lng ?? null,
    fullAddress: overrides.fullAddress ?? '',
    description: overrides.description ?? '',
    link: overrides.link ?? '',
    googlePlaceId: overrides.googlePlaceId ?? '',
    googleMapsUri: overrides.googleMapsUri ?? '',
  };
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
    locations: [],
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createStayDetail] = useCreateStayDetailMutation();
  const [patchStayDetail] = usePatchStayDetailMutation();
  const [deleteStayDetail] = useDeleteStayDetailMutation();
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
      locations:
        (initialValues.locations ?? []).length > 0
          ? initialValues.locations.map((loc) => makeLocation(loc))
          : [makeLocation({ role: 'venue' })],
    });
    setErrors({});
  }, [open, initialValues]);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function addLocation() {
    setForm((prev) => ({
      ...prev,
      locations: [...prev.locations, makeLocation({ role: 'venue' })],
    }));
  }

  function removeLocation(index) {
    setForm((prev) => ({
      ...prev,
      locations: prev.locations.filter((_, i) => i !== index),
    }));
  }

  function setLocationField(index, field, value) {
    setForm((prev) => {
      const nextLocations = [...prev.locations];
      if (!nextLocations[index]) return prev;
      nextLocations[index] = { ...nextLocations[index], [field]: value };
      return { ...prev, locations: nextLocations };
    });
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
        locations: form.locations.map((loc) => ({
          ...loc,
          role: loc.role || 'venue',
          name: loc.name?.trim() || 'Location',
          fullAddress: loc.fullAddress?.trim() || null,
          description: loc.description?.trim() || null,
          link: loc.link?.trim() || null,
          googlePlaceId: loc.googlePlaceId?.trim() || null,
          googleMapsUri: loc.googleMapsUri?.trim() || null,
        })),
      };

      if (isEdit) {
        await patchStayDetail({
          tripId,
          stayDetailId: initialValues.stayDetailId,
          patch: payload,
        }).unwrap();
      } else {
        await createStayDetail({ tripId, stay: payload }).unwrap();
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      setErrors({ _submit: getErrorMessage(err, 'Save failed. Please try again.') });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    try {
      setDeleting(true);
      await deleteStayDetail({ tripId, stayDetailId: initialValues.stayDetailId }).unwrap();
      onSaved?.();
      onClose?.();
    } catch (err) {
      setErrors({ _submit: getErrorMessage(err, 'Delete failed. Please try again.') });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <EditIcon fontSize="small" color="action" />
              <Typography variant="h6">{isEdit ? 'Edit Stay' : 'New Stay'}</Typography>
            </Stack>
            <IconButton onClick={onClose} aria-label="Close">
              <CloseIcon />
            </IconButton>
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

          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
                Locations
              </Typography>
              <IconButton size="small" onClick={addLocation} aria-label="Add location">
                <AddIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Stack spacing={2}>
              {form.locations.map((loc, idx) => (
                <LocationForm
                  key={loc.locationId}
                  values={loc}
                  onChange={(field, value) => setLocationField(idx, field, value)}
                  onRemove={() => removeLocation(idx)}
                  index={idx}
                />
              ))}
            </Stack>
          </Box>

          {errors._submit && (
            <Typography variant="body2" color="error">
              {errors._submit}
            </Typography>
          )}
          </Stack>
        </Box>

        <Divider />
        <Stack direction="row" spacing={1} sx={{ p: 2 }} alignItems="center">
          {isEdit && (
            <IconButton
              color="error"
              onClick={handleDelete}
              disabled={saving || deleting}
              aria-label="Delete stay"
              sx={{ border: 1, borderColor: 'error.main' }}
            >
              {deleting ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineIcon />}
            </IconButton>
          )}
          <Button
            variant="contained"
            sx={{ flex: 1 }}
            onClick={handleSave}
            disabled={saving || deleting}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Stay'}
          </Button>
        </Stack>
      </Box>
    </Dialog>
  );
}
