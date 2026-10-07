import { useEffect, useId, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { ArrowDownUp, Plus } from "lucide-react";
import { loadRates } from "@/features/currency/currencySlice";
import { money, parseAmount, referenceAmount } from "@/features/currency/money";
import { fetchCurrencyList, saveTripExtras, tripExtras } from "@/features/currency/rates";
import { HOME, currencyOn, tripCurrencies } from "@/features/currency/tripCurrencies";
import { referenceDay } from "@/features/today/todayView";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select } from "@/shared/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { formatAgo } from "@/shared/utils/time";
import { useTrackOnce } from "@/shared/analytics/useAnalytics";
import { selectOnline } from "@/shared/networkSlice";

function OtherCurrency({ open, onClose, onPick, exclude }) {
  const ids = useId();
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    fetchCurrencyList()
      .then((all) => live && setList(all.filter((c) => !exclude.includes(c.code))))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, exclude]);

  return (
    <Dialog open={open} onClose={onClose} title="Another currency" description="Convert to US dollars from any currency.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code) onPick(code);
        }}
      >
        {failed ? (
          <p className="text-sm text-muted-foreground">Couldn’t load the list of currencies. Connect and try again.</p>
        ) : list === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-code`}>Currency</Label>
            <Select id={`${ids}-code`} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">Choose…</option>
              {list.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!code}>
            Add
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function Converter({ code, rate }) {
  const ids = useId();
  const [text, setText] = useState("");
  const [toLocal, setToLocal] = useState(false); // false: local -> USD (the usual way)
  const from = toLocal ? HOME : code;
  const to = toLocal ? code : HOME;
  const amount = parseAmount(text);
  const result = amount == null ? null : toLocal ? amount * rate.rate : amount / rate.rate;
  const ref = referenceAmount(rate.rate);
  // Used, not just opened: once a visit, not per keystroke.
  useTrackOnce("currency-convert", amount != null, { currency: code });

  return (
    <>
      <Card role="region" aria-label="Rate" className="flex flex-col gap-1 p-4">
        <p className="text-lg font-semibold">
          1 USD = {rate.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {code}
        </p>
        <p className="text-sm text-muted-foreground">
          {money(ref, code)} = {money(ref / rate.rate, HOME)}
        </p>
      </Card>
      <Card role="region" aria-label="Calculator" className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-amount`}>Amount in {from}</Label>
          <Input
            id={`${ids}-amount`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-12 text-2xl"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="min-w-0 text-2xl font-semibold">
            <span className="sr-only">In {to}: </span>
            {result == null ? <span className="text-muted-foreground">{money(0, to)}</span> : money(result, to)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setToLocal((v) => !v);
              if (result != null) setText(String(Math.round(result * 100) / 100));
            }}
            aria-label={`Swap: convert ${to} to ${from}`}
          >
            <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
            Swap
          </Button>
        </div>
      </Card>
    </>
  );
}

function Currency({ trip }) {
  const dispatch = useDispatch();
  const online = useSelector(selectOnline);
  const { rates, fetchedAt, status, error } = useSelector((s) => s.currency);
  const [extras, setExtras] = useState(() => tripExtras(trip.id));
  const [picking, setPicking] = useState(false);
  const local = useMemo(() => tripCurrencies(trip), [trip]);
  const codes = useMemo(() => [...local, ...extras.filter((c) => !local.includes(c))], [local, extras]);
  const [selected, setSelected] = useState(() => {
    const ref = referenceDay(trip);
    return (ref.active && currencyOn(trip, ref.date)) || codes[0] || null;
  });
  const code = codes.includes(selected) ? selected : (codes[0] ?? null);
  const codesKey = codes.join(",");

  useEffect(() => {
    if (codesKey) dispatch(loadRates(codesKey.split(",")));
  }, [dispatch, codesKey, online]);

  function addOther(picked) {
    const next = extras.includes(picked) ? extras : [...extras, picked];
    setExtras(next);
    saveTripExtras(trip.id, next);
    setSelected(picked);
    setPicking(false);
  }

  const rate = code ? rates[code] : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Currency</h1>
        {fetchedAt && rate && (
          <p className={cn("text-xs", status === "failed" || !online ? "text-warning" : "text-muted-foreground")}>
            Rate from {rate.date} · checked {formatAgo(fetchedAt)}
            {!online && " · offline"}
          </p>
        )}
      </header>

      <div role="group" aria-label="Currencies" className="flex flex-wrap gap-2">
        {codes.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={c === code ? "default" : "outline"}
            aria-pressed={c === code}
            onClick={() => setSelected(c)}
          >
            {c}
          </Button>
        ))}
        {/* The list of currencies comes from Frankfurter: online only. */}
        <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(true)} disabled={!online}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Other…
        </Button>
      </div>

      {codes.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <p className="font-medium">This trip is in US dollars</p>
          <p className="text-sm text-muted-foreground">Pick another currency with Other… to convert it.</p>
        </Card>
      ) : rate ? (
        <Converter key={code} code={code} rate={rate} />
      ) : status === "loading" ? (
        <div aria-label="Loading the rate" className="h-24 animate-pulse rounded-lg border border-border bg-card" />
      ) : (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <p className="font-medium">No rate for {code} yet</p>
          <p className="text-sm text-muted-foreground">
            {online ? (error ?? "Frankfurter has no rate for it.") : "Connect once to get today’s rate; it’s kept for offline after that."}
          </p>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        A reference (mid-market) rate from Frankfurter, kept on this phone for 12 hours. Cards and ATMs add their own
        margin.
      </p>
      <OtherCurrency open={picking} onClose={() => setPicking(false)} onPick={addOther} exclude={codes} />
    </>
  );
}

export function CurrencyPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const { trip, status, tripId: loadedId } = useSelector((s) => s.timeline);
  const current = loadedId === tripId && trip?.id === tripId ? trip : null;

  useEffect(() => {
    dispatch(fetchTrip(tripId));
  }, [dispatch, tripId]);

  return (
    <ToolLayout tripId={tripId} title={current?.name ?? ""}>
      {current ? (
        <Currency key={current.id} trip={current} />
      ) : status === "notFound" || status === "failed" ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Couldn’t load this trip</p>
        </Card>
      ) : (
        <div aria-label="Loading trip" className="h-24 animate-pulse rounded-lg border border-border bg-card" />
      )}
    </ToolLayout>
  );
}
