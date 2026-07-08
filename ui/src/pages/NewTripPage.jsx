import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Fab,
  IconButton,
  MobileStepper,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChatIcon from '@mui/icons-material/Chat';
import FlightIcon from '@mui/icons-material/Flight';
import TrainIcon from '@mui/icons-material/Train';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import dayjs from 'dayjs';
import client from '../api/client';
import NewTripChatOverlay from '../components/Chat/NewTripChatOverlay';
import { fetchTrips } from '../store/tripSlice';

const MODES = [
  { value: 'flight', label: 'Flight', icon: <FlightIcon /> },
  { value: 'train', label: 'Train', icon: <TrainIcon /> },
  { value: 'car', label: 'Car', icon: <DirectionsCarIcon /> },
  { value: 'ferry', label: 'Ferry', icon: <DirectionsBoatIcon /> },
  { value: 'other', label: 'Other', icon: <MoreHorizIcon /> },
];

function ordinalDay(dateStr) {
  const d = dayjs(dateStr);
  const day = d.date();
  const suffix = ['th', 'st', 'nd', 'rd'][
    day % 10 < 4 && (day < 11 || day > 13) ? day % 10 : 0
  ];
  return d.format('MMMM') + ' ' + day + suffix;
}

function buildTravelPoint({ leg, dayId }) {
  if (!leg || leg.skipped) return null;
  const pointId = crypto.randomUUID();
  return {
    pointId,
    dayId,
    type: 'travel',
    title: leg.title || leg.route || 'Travel',
    startDateTime: leg.departureDateTime,
    endDateTime: leg.arrivalDateTime,
    confirmationNumber: null,
    description: null,
    imageUrl: null,
    logoUrl: null,
    locations: leg.route
      ? leg.route.split(/[→\-–>]+/).map((part, i, arr) => ({
          locationId: crypto.randomUUID(),
          name: part.trim(),
          role: i === 0 ? 'origin' : i === arr.length - 1 ? 'destination' : 'waypoint',
          lat: null,
          lng: null,
          fullAddress: null,
          description: null,
          link: null,
          googlePlaceId: null,
          googleMapsUri: null,
        }))
      : [],
    travelDetail: {
      mode: leg.mode,
      operator: leg.operator || null,
      vehicleNumber: leg.vehicleNumber || null,
      cabinClass: null,
    },
    stayDetail: null,
    completed: false,
    completedDateTime: null,
  };
}

function buildImportPayload({ tripDetails, outbound, returnLeg }) {
  const tripId = crypto.randomUUID();
  const start = dayjs(tripDetails.startDate);
  const end = dayjs(tripDetails.endDate);

  const days = [];
  let current = start;
  while (!current.isAfter(end)) {
    const dateStr = current.format('YYYY-MM-DD');
    days.push({
      dayId: crypto.randomUUID(),
      title: ordinalDay(dateStr),
      date: dateStr,
      description: null,
      isAlternate: false,
      completed: false,
      points: [],
    });
    current = current.add(1, 'day');
  }

  const outboundPoint = buildTravelPoint({
    leg: outbound,
    dayId: days[0].dayId,
  });
  if (outboundPoint) days[0].points.push(outboundPoint);

  const returnPoint = buildTravelPoint({
    leg: returnLeg,
    dayId: days[days.length - 1].dayId,
  });
  if (returnPoint) days[days.length - 1].points.push(returnPoint);

  return {
    tripId,
    tripName: tripDetails.tripName,
    startDate: tripDetails.startDate,
    endDate: tripDetails.endDate,
    days,
  };
}

// ── Step 1: Trip Details ────────────────────────────────────────────────────

function TripDetailsCard({ values, onChange, errors }) {
  return (
    <Stack spacing={3}>
      <Typography variant="h6" fontWeight={700}>
        Trip Details
      </Typography>
      <TextField
        label="Trip Name"
        value={values.tripName}
        onChange={(e) => onChange('tripName', e.target.value)}
        error={!!errors.tripName}
        helperText={errors.tripName}
        fullWidth
        autoFocus
      />
      <TextField
        label="Start Date"
        type="date"
        value={values.startDate}
        onChange={(e) => onChange('startDate', e.target.value)}
        error={!!errors.startDate}
        helperText={errors.startDate}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="End Date"
        type="date"
        value={values.endDate}
        onChange={(e) => onChange('endDate', e.target.value)}
        error={!!errors.endDate}
        helperText={errors.endDate}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Stack>
  );
}

// ── Step 2 / 3: Travel Card ─────────────────────────────────────────────────

function TravelCard({ label, values, onChange, errors = {}, tripStart, tripEnd }) {
  if (values.skipped) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ pt: 4 }}>
        <Typography variant="h6" fontWeight={700}>
          {label}
        </Typography>
        <Typography color="text.secondary">Skipped</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h6" fontWeight={700}>
        {label}
      </Typography>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Mode
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {MODES.map((m) => (
            <Chip
              key={m.value}
              icon={m.icon}
              label={m.label}
              clickable
              variant={values.mode === m.value ? 'filled' : 'outlined'}
              color={values.mode === m.value ? 'primary' : 'default'}
              onClick={() => onChange('mode', m.value)}
            />
          ))}
        </Stack>
      </Box>

      <TextField
        label="Title"
        placeholder="e.g. Flight to Rome"
        value={values.title}
        onChange={(e) => onChange('title', e.target.value)}
        fullWidth
      />
      <TextField
        label="Route"
        placeholder="e.g. LHR → FCO"
        value={values.route}
        onChange={(e) => onChange('route', e.target.value)}
        fullWidth
      />
      <TextField
        label="Departure"
        type="datetime-local"
        value={values.departureDateTime}
        onChange={(e) => onChange('departureDateTime', e.target.value)}
        error={!!errors.departureDateTime}
        helperText={errors.departureDateTime}
        fullWidth
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: {
            min: tripStart ? `${tripStart}T00:00` : undefined,
            max: tripEnd ? `${tripEnd}T23:59` : undefined,
          },
        }}
      />
      <TextField
        label="Arrival"
        type="datetime-local"
        value={values.arrivalDateTime}
        onChange={(e) => onChange('arrivalDateTime', e.target.value)}
        error={!!errors.arrivalDateTime}
        helperText={errors.arrivalDateTime}
        fullWidth
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: {
            min: tripStart ? `${tripStart}T00:00` : undefined,
            max: tripEnd ? `${tripEnd}T23:59` : undefined,
          },
        }}
      />
      <TextField
        label="Operator"
        placeholder="e.g. British Airways"
        value={values.operator}
        onChange={(e) => onChange('operator', e.target.value)}
        fullWidth
      />
      <TextField
        label="Flight / Vehicle Number"
        placeholder="e.g. BA0256"
        value={values.vehicleNumber}
        onChange={(e) => onChange('vehicleNumber', e.target.value)}
        fullWidth
      />
    </Stack>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const emptyLeg = () => ({
  skipped: false,
  mode: 'flight',
  title: '',
  route: '',
  departureDateTime: '',
  arrivalDateTime: '',
  operator: '',
  vehicleNumber: '',
});

export default function NewTripPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTripId, setChatTripId] = useState(null);

  const [tripDetails, setTripDetails] = useState({
    tripName: '',
    startDate: '',
    endDate: '',
  });
  const [detailErrors, setDetailErrors] = useState({});

  const [outbound, setOutbound] = useState(emptyLeg());
  const [returnLeg, setReturnLeg] = useState(emptyLeg());
  const [outboundErrors, setOutboundErrors] = useState({});
  const [returnErrors, setReturnErrors] = useState({});

  function updateDetail(field, value) {
    setTripDetails((prev) => ({ ...prev, [field]: value }));
    if (detailErrors[field]) setDetailErrors((prev) => ({ ...prev, [field]: null }));
  }

  function updateLeg(setter, field, value) {
    setter((prev) => ({ ...prev, [field]: value }));
  }

  function validateDetails() {
    const errs = {};
    if (!tripDetails.tripName.trim()) errs.tripName = 'Required';
    if (!tripDetails.startDate) errs.startDate = 'Required';
    if (!tripDetails.endDate) errs.endDate = 'Required';
    if (tripDetails.startDate && tripDetails.endDate && tripDetails.endDate < tripDetails.startDate) {
      errs.endDate = 'End date must be after start date';
    }
    setDetailErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateLeg(leg, setErrors) {
    if (leg.skipped) { setErrors({}); return true; }
    const errs = {};
    const { startDate, endDate } = tripDetails;
    if (leg.departureDateTime) {
      const depDate = leg.departureDateTime.slice(0, 10);
      if (depDate < startDate || depDate > endDate)
        errs.departureDateTime = `Must be within ${startDate} – ${endDate}`;
    }
    if (leg.arrivalDateTime) {
      if (leg.departureDateTime && leg.arrivalDateTime < leg.departureDateTime) {
        errs.arrivalDateTime = 'Arrival must be after departure';
      } else {
        const arrDate = leg.arrivalDateTime.slice(0, 10);
        if (arrDate < startDate || arrDate > endDate)
          errs.arrivalDateTime = `Must be within ${startDate} – ${endDate}`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (step === 0) {
      if (!validateDetails()) return;
      // seed outbound defaults on first advance
      setOutbound((prev) => ({
        ...prev,
        departureDateTime: prev.departureDateTime || `${tripDetails.startDate}T00:00`,
        arrivalDateTime: prev.arrivalDateTime || `${tripDetails.startDate}T23:00`,
      }));
    }
    if (step === 1) {
      if (!validateLeg(outbound, setOutboundErrors)) return;
      // seed return defaults on first advance
      setReturnLeg((prev) => ({
        ...prev,
        departureDateTime: prev.departureDateTime || `${tripDetails.endDate}T00:00`,
        arrivalDateTime: prev.arrivalDateTime || `${tripDetails.endDate}T23:00`,
      }));
    }
    setStep((s) => s + 1);
  }

  function handleBack() {
    if (step === 0) navigate('/');
    else setStep((s) => s - 1);
  }

  async function handleSubmit() {
    if (!validateLeg(returnLeg, setReturnErrors)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildImportPayload({ tripDetails, outbound, returnLeg });
      await client.post('/trip/import', payload);
      dispatch(fetchTrips());
      navigate(`/trip/${payload.tripId}`);
    } catch (err) {
      setSubmitError(err?.response?.data?.detail ?? 'Failed to create trip. Please try again.');
      setSubmitting(false);
    }
  }

  const steps = [
    {
      label: 'Trip Details',
      content: (
        <TripDetailsCard values={tripDetails} onChange={updateDetail} errors={detailErrors} />
      ),
    },
    {
      label: 'Outbound Travel',
      content: (
        <TravelCard
          label="Outbound Travel"
          values={outbound}
          onChange={(f, v) => updateLeg(setOutbound, f, v)}
          errors={outboundErrors}
          tripStart={tripDetails.startDate}
          tripEnd={tripDetails.endDate}
        />
      ),
    },
    {
      label: 'Return Travel',
      content: (
        <TravelCard
          label="Return Travel"
          values={returnLeg}
          onChange={(f, v) => updateLeg(setReturnLeg, f, v)}
          errors={returnErrors}
          tripStart={tripDetails.startDate}
          tripEnd={tripDetails.endDate}
        />
      ),
    },
  ];

  const isLast = step === steps.length - 1;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: 48 }}>
          <IconButton color="inherit" edge="start" onClick={handleBack} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            New Trip
          </Typography>
        </Toolbar>
      </AppBar>

      <MobileStepper
        variant="dots"
        steps={steps.length}
        position="static"
        activeStep={step}
        sx={{ bgcolor: 'background.paper', px: 2, py: 1 }}
        nextButton={<Box />}
        backButton={<Box />}
      />

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Container maxWidth="sm" sx={{ pt: 3, pb: 12 }}>
          <Paper elevation={0} sx={{ p: 3, borderRadius: 3, bgcolor: 'background.paper' }}>
            {steps[step].content}
          </Paper>

          {submitError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSubmitError(null)}>
              {submitError}
            </Alert>
          )}
        </Container>
      </Box>

      {/* Fixed bottom action bar */}
      <Paper
        elevation={4}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          p: 2,
          display: 'flex',
          gap: 1,
          bgcolor: 'background.paper',
        }}
      >

      <Fab
        color="primary"
        aria-label="Open new trip chat"
        onClick={() => setChatOpen(true)}
        sx={{ position: 'fixed', right: 24, bottom: 88 }}
      >
        <ChatIcon />
      </Fab>

      <NewTripChatOverlay
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        tripId={chatTripId}
        workflowName="trip:new_trip"
        onTripIdChange={setChatTripId}
      />
        {step > 0 && !isLast && (
          <Button
            variant="outlined"
            fullWidth
            onClick={() => {
              const setter = step === 1 ? setOutbound : setReturnLeg;
              setter((prev) => ({ ...prev, skipped: !prev.skipped }));
            }}
          >
            {(step === 1 ? outbound : returnLeg).skipped ? 'Add Travel' : 'Skip'}
          </Button>
        )}

        {!isLast && (
          <Button variant="contained" fullWidth onClick={handleNext}>
            Next
          </Button>
        )}

        {isLast && (
          <>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => {
                setReturnLeg((prev) => ({ ...prev, skipped: !prev.skipped }));
              }}
            >
              {returnLeg.skipped ? 'Add Return' : 'Skip Return'}
            </Button>
            <Button
              variant="contained"
              fullWidth
              onClick={handleSubmit}
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {submitting ? 'Creating…' : 'Create Trip'}
            </Button>
          </>
        )}
      </Paper>
    </Box>
  );
}
