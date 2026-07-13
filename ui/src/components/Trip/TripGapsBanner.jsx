import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import ChatFormCard from '../Chat/ChatFormCard';
import { useGetTripGapsQuery, useSubmitTripGapMutation } from '../../store/apiSlice';

/**
 * "3 things missing" — and a one-tap way to fix each (docs/july_11_stop.md #2).
 *
 * The app already knew what was missing (the backend's trip_gaps service) and
 * already knew how to put up a form for it (chat_forms, 3F-2). This is the two
 * of them joined on the trip page, where you actually look, instead of only
 * inside a conversation you have to start.
 *
 * Filling a gap here costs no model call: the form was built by the server and
 * the values go straight through the executor.
 */
export default function TripGapsBanner({ tripId }) {
  const { data, isLoading } = useGetTripGapsQuery(tripId, { skip: !tripId });
  const [submitGap] = useSubmitTripGapMutation();
  const [openGapId, setOpenGapId] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const gaps = data?.gaps ?? [];
  if (isLoading || dismissed || gaps.length === 0) return null;

  const blocking = data.blockingCount ?? 0;
  const openGap = gaps.find((gap) => gap.gapId === openGapId) ?? null;

  async function handleSubmit(gap, values) {
    await submitGap({
      tripId,
      target: gap.target,
      recordId: gap.recordId ?? null,
      values,
    }).unwrap();
    // The gap list refetches itself (the mutation invalidates it), so the row
    // simply disappears and the count drops.
    setOpenGapId(null);
  }

  return (
    <Alert
      severity={blocking > 0 ? 'warning' : 'info'}
      sx={{ mb: 2, alignItems: 'flex-start' }}
      action={
        <IconButton size="small" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      <AlertTitle sx={{ mb: 0.5 }}>
        {gaps.length === 1 ? '1 thing missing' : `${gaps.length} things missing`}
        {blocking > 0 && (
          <Chip
            size="small"
            color="warning"
            label={`${blocking} needed`}
            sx={{ ml: 1, height: 20 }}
          />
        )}
      </AlertTitle>

      <List dense disablePadding>
        {gaps.map((gap) => {
          const isOpen = gap.gapId === openGapId;
          return (
            <Box key={gap.gapId}>
              <ListItemButton
                onClick={() => setOpenGapId(isOpen ? null : gap.gapId)}
                sx={{ px: 0, py: 0.25 }}
              >
                <ListItemText
                  primary={gap.message}
                  primaryTypographyProps={{
                    variant: 'body2',
                    fontWeight: gap.severity === 'blocking' ? 500 : 400,
                  }}
                />
                {isOpen && <ExpandLessIcon fontSize="small" />}
              </ListItemButton>

              <Collapse in={isOpen} unmountOnExit>
                {openGap && (
                  <ChatFormCard
                    form={openGap.form}
                    onSubmit={(values) => handleSubmit(openGap, values)}
                  />
                )}
              </Collapse>
            </Box>
          );
        })}
      </List>

      {blocking === 0 && (
        <Typography variant="caption" color="text.secondary">
          Nothing here blocks the trip — these just save you a look-up later.
        </Typography>
      )}
    </Alert>
  );
}
