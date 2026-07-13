import { useState } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  Divider,
  Link,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import usePlacesAutocomplete from '../../hooks/usePlacesAutocomplete';

/**
 * "Which Sheraton did you mean?" (review.md 3F-5).
 *
 * The assistant only ever supplies a place *name*; these options carry real
 * Google place ids that the backend looked up itself. Tapping one writes that
 * exact place onto the location — no model call, and no re-resolution that
 * could land somewhere else.
 *
 * Our suggestions are only as good as the name the user said, and sometimes the
 * place they mean is their brother's house. The search box below the options is
 * the way out: it is the same Places autocomplete the location forms use, so a
 * street address still lands as a real place with coordinates, and the location
 * ends up on the map like any other.
 */
export default function ChatChoiceCard({ choice, onSubmit, disabled = false, savedSummary = null }) {
  const [saving, setSaving] = useState(null); // optionId | '__search__'
  const [error, setError] = useState(null);
  const { suggestions, loading, onInputChange, reset } = usePlacesAutocomplete();

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

  async function submit(key, payload) {
    setSaving(key);
    setError(null);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.detail ?? 'Could not save that place.');
      setSaving(null);
    }
  }

  const pick = (option) =>
    submit(option.optionId, { optionId: option.optionId, label: option.label });

  const pickSearched = (suggestion) => {
    if (!suggestion?.placeId) return;
    reset();
    // Only the place id crosses the wire — the backend fetches the authoritative
    // details itself, exactly as it does for an option it offered.
    submit('__search__', {
      placeId: suggestion.placeId,
      label: suggestion.mainText || suggestion.description,
    });
  };

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

      <Divider>
        <Typography variant="caption" color="text.secondary">
          or
        </Typography>
      </Divider>

      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Autocomplete
          freeSolo
          disabled={busy}
          options={suggestions}
          loading={loading}
          filterOptions={(options) => options} // Places already ranked them
          getOptionLabel={(option) =>
            typeof option === 'string' ? option : option.description ?? ''
          }
          onInputChange={onInputChange}
          onChange={(_event, value) => {
            if (value && typeof value !== 'string') pickSearched(value);
          }}
          noOptionsText="Start typing a name or address"
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Search for a different place"
              placeholder="Name or street address"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {saving === '__search__' || loading ? <CircularProgress size={14} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      </Box>

      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', px: 1.5, pb: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
