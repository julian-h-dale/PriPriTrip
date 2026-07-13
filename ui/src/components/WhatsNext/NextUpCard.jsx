import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';

import dayjs from '../../utils/dayjs';
import { placeLabel, placeLocality } from '../../utils/format';
import { getPointIcon } from '../../utils/pointIcons';
import { countdown, leaveByHint } from '../../utils/tripClock';

const URGENCY_COLOR = {
  now: 'success',
  soon: 'warning',
  today: 'info',
  later: 'default',
};

/**
 * The one thing you have to do next (docs/active_trip_plan.md).
 *
 * Everything a traveller fumbles for is on this card: the time, the place with a
 * map link, the flight number, and — the complaint from the stopping-point doc,
 * verbatim — the confirmation number "one tap from the screen (not three)".
 */
export default function NextUpCard({ point, now, onDone, busy = false }) {
  const [copied, setCopied] = useState(false);
  if (!point) return null;

  const Icon = getPointIcon(point);
  const { text, urgency } = countdown(point.startUtc, now, point.endUtc);
  const isNow = urgency === 'now';

  const place = point.locations?.[0] ?? null;
  const travel = point.travelDetail ?? null;
  const stay = point.stayDetail ?? null;
  const confirmation = point.confirmationNumber ?? travel?.confirmationNumber ?? stay?.confirmationNumber;
  const hint = leaveByHint(point);

  async function copyConfirmation() {
    try {
      await navigator.clipboard.writeText(confirmation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 3,
        borderWidth: 2,
        borderColor: isNow ? 'success.main' : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1 }}>
          {isNow ? 'Now' : 'Next'}
        </Typography>
        <Chip size="small" label={text} color={URGENCY_COLOR[urgency]} sx={{ height: 22 }} />
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <Icon sx={{ fontSize: 28, color: 'primary.main', mt: 0.25 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {point.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {dayjs(point.startUtc).format('ddd D MMM · h:mm A')}
          </Typography>
        </Box>
      </Box>

      {place && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 2 }}>
          <PlaceIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {placeLabel(place)}
            </Typography>
            {placeLocality(place) && (
              <Typography variant="caption" color="text.secondary">
                {placeLocality(place)}
              </Typography>
            )}
          </Box>
          {place.googleMapsUri && (
            <Button
              size="small"
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              component={Link}
              href={place.googleMapsUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              Maps
            </Button>
          )}
        </Box>
      )}

      {(travel?.operator || travel?.vehicleNumber || stay?.roomType) && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {[travel?.operator, travel?.vehicleNumber, travel?.cabinClass, stay?.roomType]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      )}

      {confirmation && (
        <Box
          sx={{
            mt: 2,
            p: 1.25,
            borderRadius: 2,
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Confirmation
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {confirmation}
            </Typography>
          </Box>
          <Tooltip title={copied ? 'Copied' : 'Copy'}>
            <IconButton
              size="small"
              onClick={copyConfirmation}
              aria-label="Copy confirmation number"
              color={copied ? 'success' : 'default'}
            >
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {hint && !isNow && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Be at {hint.place} by {dayjs(hint.at).format('h:mm A')}
        </Typography>
      )}

      <Button
        fullWidth
        variant={isNow ? 'contained' : 'outlined'}
        color={isNow ? 'success' : 'primary'}
        startIcon={<DoneAllIcon />}
        onClick={() => onDone(point)}
        disabled={busy}
        sx={{ mt: 2.5, borderRadius: 2 }}
      >
        Done
      </Button>
    </Paper>
  );
}
