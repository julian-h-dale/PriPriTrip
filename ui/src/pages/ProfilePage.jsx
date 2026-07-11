import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AppLayout from '../components/AppLayout';
import { getProfile, lookupTimezone, updateProfile } from '../api/profileService';
import { usePlacesAutocomplete } from '../hooks/usePlacesAutocomplete';

export default function ProfilePage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [values, setValues] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phoneNumber: '',
    homeLocation: {
      name: '',
      fullAddress: '',
      lat: null,
      lng: null,
      googlePlaceId: '',
      googleMapsUri: '',
    },
    homeTimezoneId: '',
  });

  const {
    suggestions,
    loading: loadingSuggestions,
    search: searchPlaces,
    resolvePlace,
    reset: resetSuggestions,
  } = usePlacesAutocomplete();
  const [locationInput, setLocationInput] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const profile = await getProfile();
        if (!active) return;
        setValues({
          email: profile.email ?? '',
          firstName: profile.firstName ?? '',
          lastName: profile.lastName ?? '',
          phoneNumber: profile.phoneNumber ?? '',
          homeLocation: {
            name: profile.homeLocation?.name ?? '',
            fullAddress: profile.homeLocation?.fullAddress ?? '',
            lat: profile.homeLocation?.lat ?? null,
            lng: profile.homeLocation?.lng ?? null,
            googlePlaceId: profile.homeLocation?.googlePlaceId ?? '',
            googleMapsUri: profile.homeLocation?.googleMapsUri ?? '',
          },
          homeTimezoneId: profile.homeTimezoneId ?? '',
        });
        setLocationInput(profile.homeLocation?.name ?? '');
      } catch (err) {
        if (active) {
          setError(err?.response?.data?.detail ?? 'Could not load profile.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const handleLocationInputChange = useCallback((_, newInput) => {
    setLocationInput(newInput);

    if (!newInput.trim()) {
      resetSuggestions();
      // Clearing the input clears the stored home location too.
      setValues((prev) => ({
        ...prev,
        homeLocation: {
          ...prev.homeLocation,
          name: '',
          fullAddress: '',
          lat: null,
          lng: null,
          googlePlaceId: '',
          googleMapsUri: '',
        },
        homeTimezoneId: '',
      }));
      return;
    }

    searchPlaces(newInput);
  }, [resetSuggestions, searchPlaces]);

  const handleLocationSelect = useCallback(async (_, suggestion) => {
    if (!suggestion) return;
    const details = await resolvePlace(suggestion);
    if (!details) return;

    const tzid = await lookupTimezone(details.lat, details.lng);
    setValues((prev) => ({
      ...prev,
      homeLocation: {
        name: details.name,
        fullAddress: details.fullAddress,
        lat: details.lat,
        lng: details.lng,
        googlePlaceId: details.googlePlaceId,
        googleMapsUri: details.googleMapsUri,
      },
      homeTimezoneId: tzid ?? '',
    }));
    setLocationInput(details.name);
  }, [resolvePlace]);

  function setField(field, value) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        firstName: values.firstName.trim() || null,
        lastName: values.lastName.trim() || null,
        phoneNumber: values.phoneNumber.trim() || null,
        homeLocation: values.homeLocation.name
          ? {
            name: values.homeLocation.name,
            fullAddress: values.homeLocation.fullAddress || null,
            lat: values.homeLocation.lat,
            lng: values.homeLocation.lng,
            googlePlaceId: values.homeLocation.googlePlaceId || null,
            googleMapsUri: values.homeLocation.googleMapsUri || null,
          }
          : null,
        homeTimezoneId: values.homeTimezoneId || null,
      };
      const updated = await updateProfile(payload);
      setValues((prev) => ({
        ...prev,
        firstName: updated.firstName ?? '',
        lastName: updated.lastName ?? '',
        phoneNumber: updated.phoneNumber ?? '',
        homeTimezoneId: updated.homeTimezoneId ?? '',
      }));
      setSuccess('Profile saved.');
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout title="Profile">
      <Container maxWidth="sm" sx={{ pt: 3, pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          User Profile
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Tell us about yourself so chats can use this context.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2}>
            <TextField label="Email" value={values.email} fullWidth disabled />
            <Stack direction="row" spacing={1}>
              <TextField
                label="First Name"
                value={values.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                fullWidth
              />
              <TextField
                label="Last Name"
                value={values.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                fullWidth
              />
            </Stack>
            <TextField
              label="Phone Number"
              value={values.phoneNumber}
              onChange={(e) => setField('phoneNumber', e.target.value)}
              fullWidth
            />

            <Autocomplete
              freeSolo
              options={suggestions}
              groupBy={(option) => option.groupLabel}
              getOptionLabel={(option) => (typeof option === 'string' ? option : option.description)}
              filterOptions={(x) => x}
              inputValue={locationInput}
              onInputChange={handleLocationInputChange}
              onChange={handleLocationSelect}
              loading={loadingSuggestions}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Home Location"
                  fullWidth
                  slotProps={{
                    input: {
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingSuggestions && <CircularProgress size={16} />}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    },
                  }}
                />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.placeId}>
                  <Stack>
                    <Typography variant="body2">{option.mainText}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.description}
                    </Typography>
                  </Stack>
                </li>
              )}
            />

            <TextField
              label="Home Timezone"
              value={values.homeTimezoneId}
              fullWidth
              disabled
            />

            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 1 }}>
              <Button variant="outlined" onClick={() => navigate('/')}>Cancel</Button>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Container>
    </AppLayout>
  );
}
