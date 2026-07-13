import { Box, List, ListItemButton, ListItemText, Typography } from '@mui/material';

import dayjs from '../../utils/dayjs';
import { placeLabel } from '../../utils/format';
import { getPointIcon } from '../../utils/pointIcons';

/**
 * What comes after the next thing.
 *
 * A flat list, on purpose. No day headers, no "today"/"tomorrow" grouping — the
 * weekday is just a label the eye can skim (`Fri 6:30 PM`), with no logic behind
 * it (docs/active_trip_plan.md).
 */
export default function ThenList({ points, onSelect }) {
  if (!points?.length) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ fontWeight: 700, letterSpacing: 1, px: 0.5 }}
      >
        Then
      </Typography>
      <List dense disablePadding>
        {points.map((point) => {
          const Icon = getPointIcon(point);
          const place = point.locations?.[0];
          return (
            <ListItemButton
              key={point.pointId}
              onClick={() => onSelect?.(point)}
              sx={{ borderRadius: 2, px: 1, alignItems: 'flex-start' }}
            >
              <Box sx={{ minWidth: 78, pt: 0.4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {dayjs(point.startUtc).format('ddd h:mm A')}
                </Typography>
              </Box>
              <Icon sx={{ fontSize: 18, color: 'text.secondary', mr: 1, mt: 0.3 }} />
              <ListItemText
                primary={point.title}
                secondary={place ? placeLabel(place) : null}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
