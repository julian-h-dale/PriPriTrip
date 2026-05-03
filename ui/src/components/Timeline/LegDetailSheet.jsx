import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Typography,
} from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import MapIcon from '@mui/icons-material/Map';
import dayjs from '../../utils/dayjs';
import { TRIP_TZ } from '../../utils/dayjs';

import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import TrainIcon from '@mui/icons-material/Train';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import HotelIcon from '@mui/icons-material/Hotel';
import HomeIcon from '@mui/icons-material/Home';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import HikingIcon from '@mui/icons-material/Hiking';
import MuseumIcon from '@mui/icons-material/Museum';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import ExploreIcon from '@mui/icons-material/Explore';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import PlaceIcon from '@mui/icons-material/Place';

const ROYAL_BLUE = '#4169e1';

const SUBTYPE_ICON_MAP = {
  flight: FlightTakeoffIcon,
  train: TrainIcon,
  bus: DirectionsBusIcon,
  car: DirectionsCarIcon,
  ferry: DirectionsBoatIcon,
  boat: DirectionsBoatIcon,
  hotel: HotelIcon,
  hostel: HotelIcon,
  airbnb: HomeIcon,
  rental: HomeIcon,
  walk: DirectionsWalkIcon,
  hike: HikingIcon,
  museum: MuseumIcon,
  restaurant: RestaurantIcon,
  tour: ExploreIcon,
  activity: LocalActivityIcon,
};

function getSubtypeIcon(subtype) {
  return SUBTYPE_ICON_MAP[subtype?.toLowerCase()] ?? PlaceIcon;
}

function mapsUrl(loc) {
  if (loc.lat != null && loc.long != null) {
    return `https://maps.google.com/?q=${loc.lat},${loc.long}`;
  }
  const query = loc.fullAddress || loc.name;
  return query ? `https://maps.google.com/?q=${encodeURIComponent(query)}` : null;
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

export default function LegDetailSheet({ item, onClose, onEdit }) {
  if (!item) return null;

  const SubtypeIcon = getSubtypeIcon(item.subtype);
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
            <SubtypeIcon sx={{ fontSize: 18, color: 'white' }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.2 }}>
              {item.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {dayjs(item.startDateTime).tz(TRIP_TZ).format('MMM D · h:mm A')}
              {' — '}
              {dayjs(item.endDateTime).tz(TRIP_TZ).format('h:mm A')}
            </Typography>
          </Box>
          {onEdit && (
            <IconButton size="small" onClick={() => { onClose(); onEdit(item); }}>
              <EditIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
        {item.subtype && (
          <Chip
            label={item.subtype.replace('_', ' ')}
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
            {isTravel ? (
              item.locations.map((loc, i) => {
                let label;
                if (i === 0) label = 'From';
                else if (i === item.locations.length - 1) label = 'To';
                else label = 'Via';
                return <LocationRow key={i} label={label} loc={loc} />;
              })
            ) : (
              item.locations.map((loc, i) => (
                <LocationRow key={i} loc={loc} />
              ))
            )}
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
    </Drawer>
  );
}
