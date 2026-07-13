import { useState } from 'react';
import {
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';

import dayjs from '../../utils/dayjs';
import { useSetTripStatusMutation } from '../../store/apiSlice';

/**
 * How a trip decides it is underway (docs/active_trip_plan.md).
 *
 * Activation is **automatic**: a trip is active while its dates say it is, derived
 * on read rather than stored, so nothing drifts and no cron is needed.
 *
 * This menu sets what that rule resolves against:
 *   - Automatic    (stored "draft")  — active exactly while the trip is on.
 *   - On this trip (stored "active") — forced on regardless of the dates.
 *
 * There is no force-*off*. If the dates say you are travelling, you are — and the
 * full itinerary is one tap away from the What's Next screen.
 *
 * `status` is the resolved value; `statusIntent` is what's stored. Both are needed
 * or the checkmark cannot tell an automatically-active trip from a forced one.
 */
export default function TripStatusMenu({ trip, anchorEl, onClose }) {
  const [setTripStatus] = useSetTripStatusMutation();
  const [saving, setSaving] = useState(false);

  const forced = trip?.statusIntent === 'active';
  const isActive = trip?.status === 'active';

  async function choose(next) {
    setSaving(true);
    try {
      await setTripStatus({ tripId: trip.tripId, status: next }).unwrap();
    } finally {
      setSaving(false);
      onClose();
    }
  }

  const dates =
    trip?.startDate && trip?.endDate
      ? `${dayjs(trip.startDate).format('MMM D')} – ${dayjs(trip.endDate).format('MMM D')}`
      : null;

  return (
    <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={onClose}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, display: 'block' }}>
        {isActive ? "Currently: on this trip" : 'Currently: planning'}
      </Typography>
      <Divider />

      <MenuItem disabled={saving} onClick={() => choose('draft')}>
        <ListItemIcon>
          {!forced ? <CheckIcon fontSize="small" /> : <EventRepeatIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText
          primary="Automatic"
          secondary={dates ? `Active during ${dates}` : 'Active during the trip'}
        />
      </MenuItem>

      <MenuItem disabled={saving} onClick={() => choose('active')}>
        <ListItemIcon>
          {forced ? <CheckIcon fontSize="small" /> : <FlightTakeoffIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText primary="On this trip" secondary="Show what's next now" />
      </MenuItem>
    </Menu>
  );
}
