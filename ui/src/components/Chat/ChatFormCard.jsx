import { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * A form the assistant attached to its reply (review.md 3F-2).
 *
 * Every field's type, label, options and current value came from the backend —
 * this component only renders what it was handed and posts the values back.
 * Saving runs through the executor with no model call, so it is instant.
 */
export default function ChatFormCard({ form, onSubmit, disabled = false, savedSummary = null }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(form.fields.map((field) => [field.name, field.value ?? ''])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (savedSummary) {
    return (
      <Box
        sx={{
          mt: 1,
          p: 1.25,
          borderRadius: 1,
          border: 1,
          borderColor: 'success.light',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />
        <Typography variant="caption" color="text.secondary">
          {savedSummary}
        </Typography>
      </Box>
    );
  }

  const setField = (name, value) => setValues((prev) => ({ ...prev, [name]: value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.detail ?? 'Could not save those details.');
      setSaving(false);
    }
  }

  const busy = saving || disabled;

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ mt: 1.25, p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.25 }}>
        {form.title}
      </Typography>

      <Stack spacing={1.5}>
        {form.fields.map((field) => {
          const common = {
            label: field.label,
            value: values[field.name] ?? '',
            onChange: (e) => setField(field.name, e.target.value),
            size: 'small',
            fullWidth: true,
            disabled: busy,
            helperText: field.helpText || undefined,
          };

          if (field.type === 'select') {
            return (
              <TextField key={field.name} {...common} select>
                {field.options.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            );
          }
          if (field.type === 'textarea') {
            return <TextField key={field.name} {...common} multiline minRows={2} />;
          }
          if (field.type === 'date' || field.type === 'datetime') {
            return (
              <TextField
                key={field.name}
                {...common}
                type={field.type === 'date' ? 'date' : 'datetime-local'}
                InputLabelProps={{ shrink: true }}
              />
            );
          }
          return <TextField key={field.name} {...common} />;
        })}

        {error && (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        )}

        <Button
          type="submit"
          variant="contained"
          size="small"
          disabled={busy}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{ alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving…' : form.submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}
