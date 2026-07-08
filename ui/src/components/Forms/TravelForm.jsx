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
import LocationForm from './LocationForm';

const TRAVEL_MODES = [
  { value: 'flight', label: 'Flight' },
  { value: 'train', label: 'Train' },
  { value: 'car', label: 'Car' },
  { value: 'bus', label: 'Bus' },
  { value: 'ferry', label: 'Ferry' },
  { value: 'boat', label: 'Boat' },
  { value: 'walk', label: 'Walk' },
  { value: 'hike', label: 'Hike' },
  { value: 'other', label: 'Other' },
];

function parseDateTimeLocal(value) {
  if (!value) return '';
  return value.slice(0, 16);
}

function findByRole(locations, role) {
  return (locations ?? []).find((loc) => loc.role === role) || null;
}

function makeLocation(role, overrides = {}) {
  return {
    locationId: overrides.locationId || crypto.randomUUID(),
    role,
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

function buildTravelLocations(locations = []) {
  const origin = findByRole(locations, 'origin');
  const destination = findByRole(locations, 'destination');
  const remainder = locations.filter((loc) => loc.role !== 'origin' && loc.role !== 'destination');
  return [
    makeLocation('origin', origin || {}),
    makeLocation('destination', destination || {}),
    ...remainder,
  ];
}

export default function TravelForm({
  tripId,
  open,
  onClose,
  onSaved,
  onDeleted,
  initialValues = {},
  requireLocations = false,
}) {
  const [form, setForm] = useState({
    name: '',
    mode: 'flight',
    operator: '',
    vehicleNumber: '',
    cabinClass: '',
    departureDateTime: '',
    arrivalDateTime: '',
    locations: [],
    confirmationNumber: '',
    description: '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isEdit = Boolean(initialValues?.travelDetailId);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initialValues.name ?? '',
      mode: initialValues.mode ?? 'flight',
      operator: initialValues.operator ?? '',
      vehicleNumber: initialValues.vehicleNumber ?? '',
      cabinClass: initialValues.cabinClass ?? '',
      departureDateTime: parseDateTimeLocal(initialValues.departureDateTime),
      arrivalDateTime: parseDateTimeLocal(initialValues.arrivalDateTime),
      locations: buildTravelLocations(initialValues.locations),
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

  function setLocationField(index, field, value) {
    setForm((prev) => {
      const nextLocations = [...prev.locations];
      if (!nextLocations[index]) return prev;
      nextLocations[index] = { ...nextLocations[index], [field]: value };
      return { ...prev, locations: nextLocations };
    });

    if (index === 0 && errors.originName) {
      setErrors((prev) => ({ ...prev, originName: undefined }));
    }
    if (index === 1 && errors.destinationName) {
      setErrors((prev) => ({ ...prev, destinationName: undefined }));
    }
  }

  function validate() {
    const next = {};
    const origin = findByRole(form.locations, 'origin');
    const destination = findByRole(form.locations, 'destination');
    if (!form.name.trim()) next.name = 'Travel name is required';
    if (!form.departureDateTime) next.departureDateTime = 'Departure date/time is required';
    if (!form.arrivalDateTime) next.arrivalDateTime = 'Arrival date/time is required';
    if (requireLocations && !origin?.name?.trim()) next.originName = 'Origin is required';
    if (requireLocations && !destination?.name?.trim()) next.destinationName = 'Destination is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        mode: form.mode,
        operator: form.operator.trim() || null,
        vehicleNumber: form.vehicleNumber.trim() || null,
        cabinClass: form.cabinClass.trim() || null,
        departureDateTime: form.departureDateTime || null,
        arrivalDateTime: form.arrivalDateTime || null,
        confirmationNumber: form.confirmationNumber.trim() || null,
        description: form.description.trim() || null,
      };

      const normalizedLocations = buildTravelLocations(form.locations).map((loc) => ({
        ...loc,
        role: loc.role === 'destination' ? 'destination' : loc.role === 'origin' ? 'origin' : loc.role,
        name: loc.name?.trim() || (loc.role === 'origin' ? 'Origin' : loc.role === 'destination' ? 'Destination' : 'Location'),
        fullAddress: loc.fullAddress?.trim() || null,
        description: loc.description?.trim() || null,
        link: loc.link?.trim() || null,
        googlePlaceId: loc.googlePlaceId?.trim() || null,
        googleMapsUri: loc.googleMapsUri?.trim() || null,
      }));
      payload.locations = normalizedLocations;

      if (isEdit) {
        await client.patch(
          `/trips/${tripId}/travel-details/${initialValues.travelDetailId}`,
          payload
        );
      } else {
        await client.post(`/trips/${tripId}/travel-details`, payload);
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      setErrors({ _submit: err?.response?.data?.detail ?? 'Save failed. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    try {
      setDeleting(true);
      await client.delete(`/trips/${tripId}/travel-details/${initialValues.travelDetailId}`);
      onDeleted?.();
      if (!onDeleted) {
        onSaved?.();
      }
      onClose?.();
    } catch (err) {
      setErrors({ _submit: err?.response?.data?.detail ?? 'Delete failed. Please try again.' });
    } finally {
      setDeleting(false);
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
          <Typography variant="h6">{isEdit ? 'Edit Travel' : 'New Travel'}</Typography>
        </Stack>
      </Box>

      <Divider />

      <Box sx={{ overflowY: 'auto', flex: 1, px: 2, py: 2 }}>
        <Stack spacing={2.5}>
          <TextField
            label="Travel name"
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
              Travel mode
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {TRAVEL_MODES.map((m) => (
                <Chip
                  key={m.value}
                  label={m.label}
                  clickable
                  color={form.mode === m.value ? 'primary' : 'default'}
                  variant={form.mode === m.value ? 'filled' : 'outlined'}
                  onClick={() => setField('mode', m.value)}
                  size="small"
                />
              ))}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1}>
            <TextField
              label="Departure"
              type="datetime-local"
              value={form.departureDateTime}
              onChange={(e) => setField('departureDateTime', e.target.value)}
              size="small"
              fullWidth
              required
              error={Boolean(errors.departureDateTime)}
              helperText={errors.departureDateTime}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Arrival"
              type="datetime-local"
              value={form.arrivalDateTime}
              onChange={(e) => setField('arrivalDateTime', e.target.value)}
              size="small"
              fullWidth
              required
              error={Boolean(errors.arrivalDateTime)}
              helperText={errors.arrivalDateTime}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          <LocationForm
            values={form.locations[0] || makeLocation('origin')}
            onChange={(field, value) => setLocationField(0, field, value)}
            onRemove={() => {}}
            index={0}
            title="Origin"
            roleEditable={false}
            hideRemove
          />
          {errors.originName && (
            <Typography variant="body2" color="error" sx={{ mt: -1.5 }}>
              {errors.originName}
            </Typography>
          )}

          <LocationForm
            values={form.locations[1] || makeLocation('destination')}
            onChange={(field, value) => setLocationField(1, field, value)}
            onRemove={() => {}}
            index={1}
            title="Destination"
            roleEditable={false}
            hideRemove
          />
          {errors.destinationName && (
            <Typography variant="body2" color="error" sx={{ mt: -1.5 }}>
              {errors.destinationName}
            </Typography>
          )}

          <TextField
            label="Operator / Airline"
            value={form.operator}
            onChange={(e) => setField('operator', e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Flight / Train Number"
            value={form.vehicleNumber}
            onChange={(e) => setField('vehicleNumber', e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Cabin Class"
            value={form.cabinClass}
            onChange={(e) => setField('cabinClass', e.target.value)}
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
        {isEdit && (
          <Button
            variant="outlined"
            color="error"
            fullWidth
            onClick={handleDelete}
            disabled={saving || deleting}
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        )}
        <Button variant="outlined" fullWidth onClick={onClose} disabled={saving || deleting} startIcon={<CloseIcon />}>
          Cancel
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={handleSave}
          disabled={saving || deleting}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Travel'}
        </Button>
      </Stack>
    </Drawer>
  );
}
