import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useCallback, useEffect, useState } from 'react';

import client from '../../api/client';
import LocationForm from './LocationForm';

// ── timezone helpers ──────────────────────────────────────────────────────────

const TZ_STORAGE_KEY = 'lastUsedTimezone';
const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');

function getDefaultTimezone() {
  return (
    localStorage.getItem(TZ_STORAGE_KEY) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

function saveLastTimezone(tz) {
  localStorage.setItem(TZ_STORAGE_KEY, tz);
}

/**
 * Extract the local datetime string (YYYY-MM-DDTHH:mm) from an ISO 8601
 * string with offset, e.g. "2026-05-11T14:15:00+02:00".
 * Falls back gracefully for bare strings like "2026-05-11T14:15".
 */
function parseStoredDateTime(isoString) {
  if (!isoString) return { localValue: '', timezone: getDefaultTimezone() };
  // Slice to YYYY-MM-DDTHH:mm — works for both offset and bare strings
  const bare = isoString.slice(0, 16);
  return { localValue: bare, timezone: getDefaultTimezone() };
}

/**
 * Combine a local datetime string and a named timezone into a plain
 * ISO 8601 string with numeric offset: "2026-05-11T14:15:00+02:00"
 */
function buildISOWithTZ(localValue, timezone) {
  if (!localValue) return null;
  try {
    const [datePart, timePart] = localValue.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    const dt = new Date(year, month - 1, day, hour, minute);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(dt);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const offsetMatch = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    let offset = '+00:00';
    if (offsetMatch) {
      const sign = offsetMatch[1];
      const h = offsetMatch[2].padStart(2, '0');
      const m = (offsetMatch[3] ?? '00').padStart(2, '0');
      offset = `${sign}${h}:${m}`;
    }

    const pad = (n) => String(n).padStart(2, '0');
    return `${datePart}T${pad(hour)}:${pad(minute)}:00${offset}`;
  } catch {
    return localValue;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLocation() {
  return {
    locationId: crypto.randomUUID(),
    role: 'venue',
    name: '',
    lat: null,
    lng: null,
    fullAddress: '',
    description: '',
    link: '',
    googlePlaceId: '',
    googleMapsUri: '',
  };
}

function buildInitialState(values = {}) {
  const { localValue: startLocal, timezone: startTZ } = parseStoredDateTime(values.startDateTime);
  const { localValue: endLocal } = parseStoredDateTime(values.endDateTime);
  return {
    title: values.title ?? '',
    startDateTime: startLocal,
    endDateTime: endLocal,
    timezone: startTZ,
    confirmationNumber: values.confirmationNumber ?? '',
    description: values.description ?? '',
    imageUrl: values.imageUrl ?? '',
    logoUrl: values.logoUrl ?? '',
    locations: values.locations ?? [],
  };
}

function buildPayload(form, dayId) {
  const payload = {
    dayId,
    type: 'activity',
    title: form.title.trim(),
    startDateTime: buildISOWithTZ(form.startDateTime, form.timezone),
    endDateTime: buildISOWithTZ(form.endDateTime, form.timezone),
    confirmationNumber: form.confirmationNumber.trim() || null,
    description: form.description.trim() || null,
    imageUrl: form.imageUrl.trim() || null,
    logoUrl: form.logoUrl.trim() || null,
    locations: form.locations.map((loc, i) => ({
      ...loc,
      name: loc.name.trim(),
      fullAddress: loc.fullAddress?.trim() || null,
      description: loc.description?.trim() || null,
      link: loc.link?.trim() || null,
      googlePlaceId: loc.googlePlaceId?.trim() || null,
      googleMapsUri: loc.googleMapsUri?.trim() || null,
    })),
  };

  return payload;
}

// ── component ─────────────────────────────────────────────────────────────────

/**
 * PointForm — bottom-sheet drawer for creating / editing a trip point.
 *
 * Props:
 *   tripId        — string
 *   dayId         — string
 *   open          — boolean
 *   onClose       — () => void
 *   onSaved       — () => void  (called after successful save, before close)
 *   initialValues — TripPointResponse | null  (null = create mode)
 */
export default function PointForm({ tripId, dayId, open, onClose, onSaved, onDeleted, initialValues = {} }) {
  const [form, setForm] = useState(() => buildInitialState(initialValues));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form when the drawer opens (handles switching between create / edit)
  useEffect(() => {
    if (open) {
      setForm(buildInitialState(initialValues));
      setErrors({});
    }
  }, [open, initialValues]);

  // ── field helpers ──────────────────────────────────────────────────────────

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, [errors]);

  const setTimezone = useCallback((tz) => {
    setForm((prev) => ({ ...prev, timezone: tz }));
    saveLastTimezone(tz);
  }, []);

  const addLocation = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      locations: [...prev.locations, makeLocation()],
    }));
  }, []);

  const removeLocation = useCallback((idx) => {
    setForm((prev) => ({
      ...prev,
      locations: prev.locations.filter((_, i) => i !== idx),
    }));
  }, []);

  const setLocationField = useCallback((idx, field, value) => {
    setForm((prev) => {
      const updated = [...prev.locations];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, locations: updated };
    });
  }, []);

  // ── validation ─────────────────────────────────────────────────────────────

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    form.locations.forEach((loc, i) => {
      if (!loc.name.trim()) errs[`loc_name_${i}`] = 'Name is required';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!validate()) return;

    const payload = buildPayload(form, dayId);

    try {
      setSaving(true);
      if (initialValues?.pointId) {
        await client.put(`/trips/${tripId}/points/${initialValues.pointId}`, payload);
      } else {
        await client.post(`/trips/${tripId}/points`, {
          ...payload,
          pointId: crypto.randomUUID(),
        });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      // Surface a generic error — could be enhanced with a Snackbar
      setErrors({ _submit: err?.response?.data?.detail ?? 'Save failed. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    try {
      setDeleting(true);
      await client.delete(`/trips/${tripId}/points/${initialValues.pointId}`);
      onDeleted?.();
      onClose();
    } catch (err) {
      setErrors({ _submit: err?.response?.data?.detail ?? 'Delete failed. Please try again.' });
    } finally {
      setDeleting(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const isEdit = Boolean(initialValues?.pointId);

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Title bar */}
        <Box sx={{ px: 2, py: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">{isEdit ? 'Edit Point' : 'New Point'}</Typography>
            <IconButton onClick={onClose} aria-label="Close">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        <Divider />

        {/* Scrollable body */}
        <Box sx={{ overflowY: 'auto', flex: 1, px: 2, py: 2 }}>
        <Stack spacing={3}>

          {/* Title */}
          <TextField
            label="Title"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            size="small"
            fullWidth
            required
            error={Boolean(errors.title)}
            helperText={errors.title}
          />

          {/* Start / End datetime + timezone */}
          <Stack spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Start"
                type="datetime-local"
                value={form.startDateTime}
                onChange={(e) => setField('startDateTime', e.target.value)}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End"
                type="datetime-local"
                value={form.endDateTime}
                onChange={(e) => setField('endDateTime', e.target.value)}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
            <Autocomplete
              options={ALL_TIMEZONES}
              value={form.timezone}
              onChange={(_, val) => val && setTimezone(val)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Timezone"
                  size="small"
                />
              )}
              disableClearable
            />
          </Stack>

          {/* Confirmation # */}
          <TextField
            label="Confirmation Number"
            value={form.confirmationNumber}
            onChange={(e) => setField('confirmationNumber', e.target.value)}
            size="small"
            fullWidth
          />

          {/* Description */}
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={3}
          />

          <Divider />

          {/* Locations */}
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
                Locations
              </Typography>
              <Button
                startIcon={<AddIcon />}
                size="small"
                onClick={addLocation}
                variant="outlined"
              >
                Add
              </Button>
            </Stack>

            <Stack spacing={2}>
              {form.locations.map((loc, idx) => (
                <LocationForm
                  key={loc.locationId}
                  values={loc}
                  onChange={(field, val) => setLocationField(idx, field, val)}
                  onRemove={() => removeLocation(idx)}
                  index={idx}
                />
              ))}
              {form.locations.length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                  No locations added
                </Typography>
              )}
            </Stack>
          </Box>

          {/* Advanced — image / logo URLs */}
          <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
                Advanced
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <TextField
                  label="Image URL"
                  value={form.imageUrl}
                  onChange={(e) => setField('imageUrl', e.target.value)}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Logo URL"
                  value={form.logoUrl}
                  onChange={(e) => setField('logoUrl', e.target.value)}
                  size="small"
                  fullWidth
                />
              </Stack>
            </AccordionDetails>
          </Accordion>

          {/* Submit error */}
          {errors._submit && (
            <Typography variant="body2" color="error">
              {errors._submit}
            </Typography>
          )}

          </Stack>
        </Box>

        {/* Sticky footer */}
        <Divider />
        <Stack direction="row" spacing={1} sx={{ p: 2 }} alignItems="center">
          {isEdit && (
            <IconButton
              color="error"
              onClick={handleDelete}
              disabled={saving || deleting}
              aria-label="Delete point"
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Point'}
          </Button>
        </Stack>
      </Box>
    </Dialog>
  );
}
