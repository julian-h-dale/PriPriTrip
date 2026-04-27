import { useState } from 'react';
import { motion } from 'framer-motion';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import { Box, Chip, Collapse, Typography } from '@mui/material';
import dayjs from 'dayjs';

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

const MotionTimelineItem = motion.create(TimelineItem);

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

export default function LegTimelineItem({ item, isFirst, isLast }) {
  const [open, setOpen] = useState(false);
  const SubtypeIcon = getSubtypeIcon(item.subtype);

  return (
    <MotionTimelineItem
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={() => setOpen((p) => !p)}
      sx={{ cursor: 'pointer' }}
    >
      <TimelineOppositeContent
        sx={{ m: 'auto 0', py: '10px' }}
        variant="body2"
        color="text.secondary"
      >
        {dayjs(item.startDateTime).format('h:mm A')}
      </TimelineOppositeContent>

      <TimelineSeparator>
        <TimelineConnector sx={{ bgcolor: isFirst ? 'transparent' : 'grey.400' }} />
        <TimelineDot sx={{ bgcolor: ROYAL_BLUE, p: 0.5 }}>
          <SubtypeIcon sx={{ fontSize: 14, color: 'white' }} />
        </TimelineDot>
        <TimelineConnector sx={{ bgcolor: isLast ? 'transparent' : 'grey.400' }} />
      </TimelineSeparator>

      <TimelineContent sx={{ py: '10px', px: 2 }}>
        <Typography variant="body2" fontWeight={500}>
          {item.title}
        </Typography>

        <Collapse in={open} unmountOnExit>
          <Box
            sx={{
              mt: 1,
              mb: 0.5,
              pl: 1.5,
              borderLeft: `3px solid ${ROYAL_BLUE}44`,
            }}
          >
            {/* Time range */}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
              {dayjs(item.startDateTime).format('h:mm A')}
              {' — '}
              {dayjs(item.endDateTime).format('h:mm A')}
            </Typography>

            {/* Subtype chip */}
            {item.subtype && (
              <Chip
                label={item.subtype}
                size="small"
                variant="outlined"
                sx={{ mb: 1, height: 20, fontSize: '0.7rem', textTransform: 'capitalize' }}
              />
            )}

            {/* Confirmation number */}
            {item.confirmationNumber && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                Confirmation: <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{item.confirmationNumber}</Box>
              </Typography>
            )}

            {/* Description */}
            {item.description && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                {item.description}
              </Typography>
            )}

            {/* Locations */}
            {item.locations?.length > 0 && (
              <Box>
                {item.type === 'travel' && item.locations.length >= 2 ? (
                  <>
                    <Typography variant="caption" display="block">
                      <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>From</Box>
                      {item.locations[0].name}
                    </Typography>
                    <Typography variant="caption" display="block">
                      <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>To</Box>
                      {item.locations[item.locations.length - 1].name}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="caption" display="block">
                    {item.locations[0].name}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </Collapse>
      </TimelineContent>
    </MotionTimelineItem>
  );
}
