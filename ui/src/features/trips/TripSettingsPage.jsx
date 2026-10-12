import { useEffect, useId, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { Download, ImageOff, LogOut, Trash2 } from "lucide-react";
import { fetchMemories } from "@/features/journal/journalSlice";
import { photoSrc } from "@/features/journal/photoUrls";
import { saveToPhone } from "@/features/journal/saveToPhone";
import { MembersPanel } from "@/features/sharing/MembersPanel";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { TripCover } from "@/features/trips/TripCover";
import { COVER_EMOJI, exportFilename, hasCover } from "@/features/trips/tripSettings";
import { deleteTrip, leaveTrip, updateTrip } from "@/features/trips/tripsSlice";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { notify } from "@/shared/notificationSlice";
import {
  DISTANCE_UNITS,
  OPEN_ON,
  RADIUS_STEPS,
  setDistanceUnit,
  setNearbyRadius,
  setOpenOn,
  useDistanceUnit,
  useNearbyRadius,
  useOpenOn,
} from "@/shared/phoneSettings";
import { selectOnline } from "@/shared/networkSlice";
import { apiClient } from "@/shared/services/apiClient";
import { cn } from "@/shared/utils/cn";
import { tripPhase } from "@/shared/utils/tripDates";

const NAME_MAX = 120;

const OFFLINE = "You’re offline";
const NO_MEMORIES = [];

function Section({ title, description, children, className }) {
  const id = useId();
  return (
    <Card aria-labelledby={id} role="region" className={cn("flex flex-col gap-3 p-4", className)}>
      <div>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Save a change to the trip; resolves to an error message, or null. */
async function save(dispatch, tripId, changes) {
  const result = await dispatch(updateTrip({ id: tripId, changes }));
  return updateTrip.fulfilled.match(result) ? null : result.payload;
}

function NameSection({ trip, disabled }) {
  const dispatch = useDispatch();
  const id = useId();
  const [name, setName] = useState(trip.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = name.trim() !== trip.name && name.trim() !== "";

  async function submit(e) {
    e.preventDefault();
    if (!changed) return;
    setBusy(true);
    setError(await save(dispatch, trip.id, { name: name.trim() }));
    setBusy(false);
  }

  return (
    <Section title="Name">
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <Label htmlFor={id} className="sr-only">
          Trip name
        </Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={name}
            maxLength={NAME_MAX}
            disabled={disabled}
            title={disabled ? OFFLINE : undefined}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <Button type="submit" disabled={disabled || busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </Section>
  );
}

/** Photos that can be the cover: on memories everyone can see, already uploaded. */
function coverPhotos(memories) {
  return memories
    .filter((m) => m.isPublic && !m.pending)
    .flatMap((m) => m.photos ?? [])
    .filter((p) => p.thumbUrl && !p.thumbUrl.startsWith("blob:"));
}

function CoverSection({ trip, disabled }) {
  const dispatch = useDispatch();
  const id = useId();
  const [tab, setTab] = useState(trip.coverThumbUrl ? "photo" : "emoji");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const memories = useSelector((s) => (s.journal?.tripId === trip.id ? s.journal.items : NO_MEMORIES));
  const photos = coverPhotos(memories);

  useEffect(() => {
    dispatch(fetchMemories(trip.id));
  }, [dispatch, trip.id]);

  async function set(changes) {
    setBusy(true);
    const message = await save(dispatch, trip.id, changes);
    setError(message);
    setBusy(false);
    return message;
  }

  async function submitTyped(e) {
    e.preventDefault();
    if (typed.trim() && !(await set({ coverEmoji: typed.trim() }))) setTyped("");
  }

  const off = disabled || busy;
  const tabClass = (on) =>
    cn(
      "flex min-h-10 items-center justify-center rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <Section title="Cover" description="Shown on the trip’s card in your trips list, for everyone on the trip.">
      <div className="flex items-center gap-3">
        {hasCover(trip) ? (
          <TripCover trip={trip} className="h-16 w-16 text-4xl" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            None
          </span>
        )}
        {hasCover(trip) && (
          <Button
            variant="outline"
            size="sm"
            disabled={off}
            title={disabled ? OFFLINE : undefined}
            onClick={() => set({ coverEmoji: null, coverPhotoId: null })}
          >
            <ImageOff className="h-4 w-4" aria-hidden="true" />
            Remove cover
          </Button>
        )}
      </div>

      <div role="group" aria-label="Cover kind" className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
        <button type="button" aria-pressed={tab === "emoji"} onClick={() => setTab("emoji")} className={tabClass(tab === "emoji")}>
          Emoji
        </button>
        <button type="button" aria-pressed={tab === "photo"} onClick={() => setTab("photo")} className={tabClass(tab === "photo")}>
          Photo
        </button>
      </div>

      {tab === "emoji" ? (
        <>
          <ul aria-label="Emoji" className="grid grid-cols-6 gap-1">
            {COVER_EMOJI.map((emoji) => (
              <li key={emoji}>
                <button
                  type="button"
                  aria-label={`Use ${emoji}`}
                  aria-pressed={trip.coverEmoji === emoji}
                  disabled={off}
                  onClick={() => set({ coverEmoji: emoji })}
                  className={cn(
                    "flex h-11 w-full items-center justify-center rounded-md text-2xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    trip.coverEmoji === emoji && "bg-accent ring-2 ring-primary"
                  )}
                >
                  {emoji}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={submitTyped} noValidate className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={`${id}-typed`}>Or type one</Label>
              <Input id={`${id}-typed`} value={typed} maxLength={16} disabled={off} onChange={(e) => setTyped(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" disabled={off || !typed.trim()}>
              Use
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Only photos from memories everyone can see.</p>
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos from memories everyone can see yet.</p>
          ) : (
            <ul aria-label="Photos" className="grid grid-cols-4 gap-1.5">
              {photos.map((photo, i) => {
                const chosen = trip.coverThumbUrl === photo.thumbUrl;
                return (
                  <li key={photo.id}>
                    <button
                      type="button"
                      aria-label={`Use photo ${i + 1}`}
                      aria-pressed={chosen}
                      disabled={off}
                      onClick={() => set({ coverPhotoId: photo.id })}
                      className={cn(
                        "block aspect-square w-full overflow-hidden rounded-md bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        chosen && "ring-2 ring-primary"
                      )}
                    >
                      <img src={photoSrc(photo.thumbUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}

/** One choice of a few, as a row of segments (like Text size in the drawer). */
function Choice({ label, options, value, onChange }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-sm">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="grid rounded-md border border-border bg-background p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              "min-h-10 rounded-sm px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What this phone does with the trip, nothing saved to the server: so it
 * works offline and needs no Save. Distances are for every trip.
 */
function PhoneSection({ trip }) {
  const unit = useDistanceUnit();
  const radius = useNearbyRadius(trip.id);
  const chosen = useOpenOn(trip.id);
  // With no choice made, what the trip opens on now.
  const opensOn = chosen ?? (tripPhase(trip) === "past" ? "timeline" : "today");
  const steps = RADIUS_STEPS[unit];
  return (
    <Section title="On this phone" description="Only on this phone: these don’t change the trip for anyone else.">
      <Choice label="Opens on" options={OPEN_ON} value={opensOn} onChange={(key) => setOpenOn(trip.id, key)} />
      <Choice label="Distances (every trip)" options={DISTANCE_UNITS} value={unit} onChange={setDistanceUnit} />
      <Choice
        label="Nearby points of interest, within"
        options={steps.map((s) => ({ key: String(s.metres), label: s.label }))}
        value={String(radius.metres)}
        onChange={(key) => setNearbyRadius(trip.id, Number(key))}
      />
    </Section>
  );
}

function ExportSection({ trip, online }) {
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { data } = await apiClient.get(`/trips/${trip.id}/export`, { responseType: "blob", silent: true });
      await saveToPhone(new File([data], exportFilename(trip.name), { type: "application/json" }));
    } catch {
      dispatch(notify({ type: "error", message: "Couldn’t download the trip. Try again." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Export" description="The whole plan as a file, the same kind Import trip takes.">
      <div>
        <Button variant="outline" onClick={download} disabled={!online || busy} title={online ? undefined : OFFLINE}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy ? "Downloading…" : "Download this trip"}
        </Button>
      </div>
    </Section>
  );
}

/** Delete (the owner) or Leave (an editor), apart at the bottom. */
function DangerSection({ trip, online }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const owner = trip.role === "owner";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const result = await dispatch(owner ? deleteTrip(trip.id) : leaveTrip(trip.id));
    setBusy(false);
    if (result.meta.requestStatus === "fulfilled") navigate("/trips", { replace: true });
    else {
      setConfirming(false);
      dispatch(notify({ type: "error", message: owner ? "Couldn’t delete the trip." : "Couldn’t leave the trip." }));
    }
  }

  return (
    <Section title={owner ? "Delete trip" : "Leave trip"} className="border-destructive/50">
      <p className="text-sm text-muted-foreground">
        {owner
          ? "Removes it for you and everyone you’ve shared it with."
          : "It leaves your trips list. The owner can add you again."}
      </p>
      <div>
        <Button variant="destructive" onClick={() => setConfirming(true)} disabled={!online} title={online ? undefined : OFFLINE}>
          {owner ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          {owner ? "Delete trip" : "Leave trip"}
        </Button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title={owner ? "Delete trip?" : "Leave trip?"}
        description={`“${trip.name}” will be removed from your trips.`}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {owner ? (busy ? "Deleting…" : "Delete") : busy ? "Leaving…" : "Leave"}
          </Button>
        </DialogFooter>
      </Dialog>
    </Section>
  );
}

/**
 * Trip settings (Run stage 29), from the ⋯ menu on the trips list: the
 * trip's cover and name (saved for everyone), what this phone does with it,
 * who's on it (the owner), an export, and Delete or Leave. Owners and editors only (NotForViewers).
 */
export function TripSettingsPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const online = useSelector(selectOnline);
  const { trip, tripId: loadedId, stale } = useSelector((s) => s.timeline);
  const current = loadedId === tripId && trip?.id === tripId ? trip : null;
  // Changes need the server: not offline, and not from a saved copy.
  const disabled = !online || stale;

  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId, online]);

  return (
    <ToolLayout tripId={tripId} title="Trip settings">
      {current ? (
        <>
          <CoverSection trip={current} disabled={disabled} />
          <NameSection key={current.name} trip={current} disabled={disabled} />
          <PhoneSection trip={current} />
          {current.role === "owner" && (
            <Section title="People" description="Add someone by the email they sign in with.">
              <MembersPanel tripId={current.id} />
            </Section>
          )}
          <ExportSection trip={current} online={online} />
          <DangerSection trip={current} online={online} />
        </>
      ) : (
        <div aria-label="Loading" className="h-40 animate-pulse rounded-lg bg-card" />
      )}
    </ToolLayout>
  );
}
