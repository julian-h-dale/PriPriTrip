/**
 * Point icon + label mapping (review.md 2C-1).
 *
 * Was duplicated verbatim in PointTimelineItem.jsx and PointDetailSheet.jsx,
 * so a new travel mode had to be added in two places to show up everywhere.
 */

import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import ExploreIcon from '@mui/icons-material/Explore';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import HotelIcon from '@mui/icons-material/Hotel';
import LocalActivityIcon from '@mui/icons-material/LocalActivity';
import PlaceIcon from '@mui/icons-material/Place';
import TrainIcon from '@mui/icons-material/Train';

export const ROYAL_BLUE = '#4169e1';

export const TRAVEL_MODE_ICON = {
  flight: FlightTakeoffIcon,
  train: TrainIcon,
  bus: DirectionsBusIcon,
  car: DirectionsCarIcon,
  ferry: DirectionsBoatIcon,
  other: ExploreIcon,
};

export function getPointIcon(point) {
  if (point?.travelDetail?.mode) {
    return TRAVEL_MODE_ICON[point.travelDetail.mode] ?? PlaceIcon;
  }
  if (point?.type === 'stay') return HotelIcon;
  if (point?.type === 'activity') return LocalActivityIcon;
  return PlaceIcon;
}

/** Chip text under a point's title: travel mode or stay type, or nothing. */
export function getChipLabel(point) {
  if (point?.travelDetail?.mode) return point.travelDetail.mode.replace('_', ' ');
  if (point?.stayDetail?.stayType) return point.stayDetail.stayType.replace('_', ' ');
  return null;
}
