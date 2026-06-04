import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

const STAY_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'rental', label: 'Rental' },
  { value: 'other', label: 'Other' },
];

/**
 * StayDetailForm
 *
 * Props:
 *   values   — { stayType, checkInTime, checkOutTime, roomType }
 *   onChange — (field, value) => void
 */
export default function StayDetailForm({ values, onChange }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary' }}>
        Stay Details
      </Typography>

      {/* Stay type selector */}
      <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
        {STAY_TYPES.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            clickable
            color={values.stayType === s.value ? 'primary' : 'default'}
            variant={values.stayType === s.value ? 'filled' : 'outlined'}
            onClick={() => onChange('stayType', s.value)}
            size="small"
          />
        ))}
      </Stack>

      <Stack spacing={2}>
        <TextField
          label="Check-in Time"
          type="time"
          value={values.checkInTime ?? ''}
          onChange={(e) => onChange('checkInTime', e.target.value)}
          size="small"
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Check-out Time"
          type="time"
          value={values.checkOutTime ?? ''}
          onChange={(e) => onChange('checkOutTime', e.target.value)}
          size="small"
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Room Type"
          value={values.roomType ?? ''}
          onChange={(e) => onChange('roomType', e.target.value)}
          size="small"
          fullWidth
        />
      </Stack>
    </Box>
  );
}
