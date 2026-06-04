import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

const LOCATION_ROLES = [
  { value: 'origin', label: 'Origin' },
  { value: 'destination', label: 'Destination' },
  { value: 'waypoint', label: 'Waypoint' },
  { value: 'venue', label: 'Venue' },
];

/**
 * LocationForm
 *
 * Props:
 *   values   — LocationCreate object
 *   onChange — (field, value) => void
 *   onRemove — () => void
 *   index    — number (for display label)
 */
export default function LocationForm({ values, onChange, onRemove, index }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, position: 'relative' }}>
      {/* Header row */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          Location {index + 1}
        </Typography>
        <IconButton size="small" onClick={onRemove} aria-label="Remove location">
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>

      {/* Role selector */}
      <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
        {LOCATION_ROLES.map((r) => (
          <Chip
            key={r.value}
            label={r.label}
            clickable
            color={values.role === r.value ? 'primary' : 'default'}
            variant={values.role === r.value ? 'filled' : 'outlined'}
            onClick={() => onChange('role', r.value)}
            size="small"
          />
        ))}
      </Stack>

      <Stack spacing={2}>
        <TextField
          label="Name"
          value={values.name ?? ''}
          onChange={(e) => onChange('name', e.target.value)}
          size="small"
          fullWidth
          required
        />
        <TextField
          label="Full Address"
          value={values.fullAddress ?? ''}
          onChange={(e) => onChange('fullAddress', e.target.value)}
          size="small"
          fullWidth
        />

        {/* Lat / Lng side by side */}
        <Stack direction="row" spacing={1}>
          <TextField
            label="Latitude"
            type="number"
            value={values.lat ?? ''}
            onChange={(e) =>
              onChange('lat', e.target.value === '' ? null : parseFloat(e.target.value))
            }
            size="small"
            fullWidth
            inputProps={{ step: 'any' }}
          />
          <TextField
            label="Longitude"
            type="number"
            value={values.lng ?? ''}
            onChange={(e) =>
              onChange('lng', e.target.value === '' ? null : parseFloat(e.target.value))
            }
            size="small"
            fullWidth
            inputProps={{ step: 'any' }}
          />
        </Stack>

        <TextField
          label="Link / Website"
          value={values.link ?? ''}
          onChange={(e) => onChange('link', e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Description"
          value={values.description ?? ''}
          onChange={(e) => onChange('description', e.target.value)}
          size="small"
          fullWidth
          multiline
          rows={2}
        />
      </Stack>

      {/* Advanced fields */}
      <Box mt={1}>
        <Accordion disableGutters elevation={0} sx={{ background: 'transparent' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Advanced
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Stack spacing={2}>
              <TextField
                label="Google Place ID"
                value={values.googlePlaceId ?? ''}
                onChange={(e) => onChange('googlePlaceId', e.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="Google Maps URI"
                value={values.googleMapsUri ?? ''}
                onChange={(e) => onChange('googleMapsUri', e.target.value)}
                size="small"
                fullWidth
              />
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Paper>
  );
}
