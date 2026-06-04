import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

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

/**
 * TravelDetailForm
 *
 * Props:
 *   values   — { mode, operator, vehicleNumber, cabinClass }
 *   onChange — (field, value) => void
 */
export default function TravelDetailForm({ values, onChange }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary' }}>
        Travel Details
      </Typography>

      {/* Mode selector */}
      <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
        {TRAVEL_MODES.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            clickable
            color={values.mode === m.value ? 'primary' : 'default'}
            variant={values.mode === m.value ? 'filled' : 'outlined'}
            onClick={() => onChange('mode', m.value)}
            size="small"
          />
        ))}
      </Stack>

      <Stack spacing={2}>
        <TextField
          label="Operator / Airline"
          value={values.operator ?? ''}
          onChange={(e) => onChange('operator', e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Flight / Train Number"
          value={values.vehicleNumber ?? ''}
          onChange={(e) => onChange('vehicleNumber', e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Cabin Class"
          value={values.cabinClass ?? ''}
          onChange={(e) => onChange('cabinClass', e.target.value)}
          size="small"
          fullWidth
        />
      </Stack>
    </Box>
  );
}
