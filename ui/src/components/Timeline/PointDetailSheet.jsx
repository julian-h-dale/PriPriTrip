import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import MapIcon from '@mui/icons-material/Map';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';
import { fetchTrip, selectTrip } from '../../store/tripSlice';
import PointForm from '../Forms/PointForm';

import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import TrainIcon from '@mui/icons-material/Train';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import HotelIcon from '@mui/icons-material/Hotel';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import ExploreIcon from '@mui/icons-material/Explore';
import PlaceIcon from '@mui/icons-material/Place';

const ROYAL_BLUE = '#4169e1';

const TRAVEL_MODE_ICON = {
  flight: FlightTakeoffIcon,
  train: TrainIcon,
  bus: DirectionsBusIcon,
  car: DirectionsCarIcon,
  ferry: DirectionsBoatIcon,
  other: ExploreIcon,
};

function getPointIcon(point) {
  if (point.travelDetail?.mode) {
    return TRAVEL_MODE_ICON[point.travelDetail.mode] ?? PlaceIcon;
  }
  if (point.type === 'stay') return HotelIcon;
  if (point.type === 'activity') return LocalActivityIcon;
  return PlaceIcon;
}

function getChipLabel(point) {
  if (point.travelDetail?.mode) return point.travelDetail.mode.replace('_', ' ');
  if (point.stayDetail?.stayType) return point.stayDetail.stayType.replace('_', ' ');
  return null;
}

// origin→From, destination→To, waypoint→Via, venue→null (no label)
const ROLE_LABEL = { origin: 'From', destination: 'To', waypoint: 'Via', venue: null };

function mapsUrl(loc) {
  if (loc.googleMapsUri) return loc.googleMapsUri;
  const q = [loc.name, loc.fullAddress].filter(Boolean).join(' ');
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null;
}

function Section({ label, children }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1, mb: 0.75, display: 'block' }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function LocationRow({ label, loc }) {
  const url = mapsUrl(loc);
  return (
    <Box sx={{ mb: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {label && (
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 36, flexShrink: 0 }}>
            {label}
          </Typography>
        )}
        <Typography variant="body2" fontWeight={500}>{loc.name}</Typography>
        {url && (
          <IconButton
            size="small"
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ p: 0.25, opacity: 0.55, '&:hover': { opacity: 1 } }}
          >
            <MapIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
      {loc.description && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: label ? 5.5 : 0, lineHeight: 1.4 }}>
          {loc.description}
        </Typography>
      )}
    </Box>
  );
}

export default function PointDetailSheet({ item, onClose }) {
  const trip = useSelector(selectTrip);
  const dispatch = useDispatch();
  const [editOpen, setEditOpen] = useState(false);

  if (!item) return null;

  const Icon = getPointIcon(item);
  const chipLabel = getChipLabel(item);
  const isTravel = item.type === 'travel';

  return (
    <Drawer
      anchor="bottom"
      open={!!item}
      onClose={onClose}
      PaperProps={{
        sx: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 0,
        },
      }}
    >
      {/* Pull handle */}
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 0.5, flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'grey.300' }} />
      </Box>

      {/* Header */}
      <Box
        sx={{
          px: 3,
          pt: 1.5,
          pb: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.25,
              width: 36,
              height: 36,
              borderRadius: '50%',
              bgcolor: ROYAL_BLUE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon sx={{ fontSize: 18, color: 'white' }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.2 }}>
              {item.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {item.startDateTime && dayjs(item.startDateTime).tz(TRIP_TZ).format('MMM D · h:mm A')}
              {item.startDateTime && item.endDateTime && ' — '}
              {item.endDateTime && dayjs(item.endDateTime).tz(TRIP_TZ).format('h:mm A')}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => setEditOpen(true)}
            aria-label="Edit point"
            sx={{ flexShrink: 0 }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Box>
        {chipLabel && (
          <Chip
            label={chipLabel}
            size="small"
            variant="outlined"
            sx={{ mt: 1.5, height: 22, fontSize: '0.72rem', textTransform: 'capitalize' }}
          />
        )}
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pt: 2.5 }}>
        {item.confirmationNumber && (
          <Section label="Confirmation">
            <Typography variant="body1" fontWeight={500} sx={{ fontFamily: 'monospace', letterSpacing: 1 }}>
              {item.confirmationNumber}
            </Typography>
          </Section>
        )}

        {item.description && (
          <Section label="Notes">
            <Box
              sx={{
                typography: 'body2',
                color: 'text.secondary',
                '& p': { m: 0, mb: 1 },
                '& p:last-child': { mb: 0 },
                '& ul, & ol': { pl: 2.5, mt: 0, mb: 1 },
                '& li': { mb: 0.25 },
                '& strong': { color: 'text.primary' },
                '& code': { fontFamily: 'monospace', fontSize: '0.85em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.description}</ReactMarkdown>
            </Box>
          </Section>
        )}

        {item.locations?.length > 0 && (
          <Section label={isTravel ? 'Route' : 'Locations'}>
            {item.locations.map((loc, i) => (
              <LocationRow key={i} label={ROLE_LABEL[loc.role]} loc={loc} />
            ))}
          </Section>
        )}
      </Box>

      {/* Close button */}
      <Box sx={{ px: 3, py: 2.5, flexShrink: 0, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={onClose}
          startIcon={<CloseIcon />}
          sx={{ borderRadius: 3 }}
        >
          Close
        </Button>
      </Box>

      {/* Edit form */}
      {trip && (
        <PointForm
          tripId={trip.tripId}
          dayId={item.dayId}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => dispatch(fetchTrip(trip.tripId))}
          onDeleted={() => { dispatch(fetchTrip(trip.tripId)); setEditOpen(false); onClose(); }}
          initialValues={item}
        />
      )}
    </Drawer>
  );
}
