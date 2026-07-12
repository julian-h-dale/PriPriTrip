import { useState } from 'react';
import {
  Box,
  CircularProgress,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

/**
 * "Which Sheraton did you mean?" (review.md 3F-5).
 *
 * The assistant only ever supplies a place *name*; these options carry real
 * Google place ids that the backend looked up itself. Tapping one writes that
 * exact place onto the location — no model call, and no re-resolution that
 * could land somewhere else.
 */
export default function ChatChoiceCard({ choice, onSubmit, disabled = false, savedSummary = null }) {
  const [saving, setSaving] = useState(null); // optionId being saved
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

  async function pick(option) {
    setSaving(option.optionId);
    setError(null);
    try {
      await onSubmit(option);
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.detail ?? 'Could not save that place.');
      setSaving(null);
    }
  }

  const busy = disabled || saving !== null;

  return (
    <Box
      sx={{
        mt: 1.25,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, px: 1.5, pt: 1.25 }}>
        {choice.prompt}
      </Typography>

      <List dense disablePadding sx={{ mt: 0.5 }}>
        {choice.options.map((option) => (
          <ListItemButton
            key={option.optionId}
            disabled={busy}
            onClick={() => pick(option)}
            sx={{ alignItems: 'flex-start', py: 1 }}
          >
            <ListItemText
              primary={option.label}
              secondary={option.sublabel}
              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
            {saving === option.optionId ? (
              <CircularProgress size={14} sx={{ mt: 0.5, ml: 1 }} />
            ) : (
              option.mapsUri && (
                <Link
                  href={option.mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  sx={{ display: 'flex', alignItems: 'center', mt: 0.5, ml: 1 }}
                >
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </Link>
              )
            )}
          </ListItemButton>
        ))}
      </List>

      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', px: 1.5, pb: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
