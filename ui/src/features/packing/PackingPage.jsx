import { useEffect, useId, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { Eye, EyeOff, Luggage, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { CATEGORIES, groupByCategory } from "@/features/packing/categories";
import {
  addPackingItem,
  addPackingSuggestions,
  deletePackingItem,
  deletePackingList,
  fetchPacking,
  updatePackingItem,
} from "@/features/packing/packingSlice";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { RowMenu } from "@/shared/components/RowMenu";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils/cn";

function ItemRow({ item, tripId, disabled, onEdit }) {
  const dispatch = useDispatch();
  const id = useId();
  return (
    <li className="flex items-center gap-1">
      <label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
        <input
          id={id}
          type="checkbox"
          checked={item.checked}
          disabled={disabled}
          onChange={(e) => dispatch(updatePackingItem({ tripId, id: item.id, changes: { checked: e.target.checked } }))}
          className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span className={cn("break-words text-sm", item.checked && "text-muted-foreground line-through")}>{item.text}</span>
        {item.quantity > 1 && (
          <span className="ml-auto shrink-0 rounded-sm bg-secondary px-1.5 text-xs font-medium tabular-nums text-secondary-foreground">
            ×{item.quantity}
          </span>
        )}
      </label>
      <RowMenu
        label={`More for ${item.text}`}
        items={[
          { label: "Edit", icon: <Pencil className="h-4 w-4" aria-hidden="true" />, disabled, onSelect: () => onEdit(item) },
          {
            label: "Delete",
            icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
            destructive: true,
            disabled,
            onSelect: () => dispatch(deletePackingItem({ tripId, id: item.id })),
          },
        ]}
      />
    </li>
  );
}

/** 1–99 from what was typed (blank or nonsense is 1). */
function toQuantity(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
}

function QuantityInput({ label, value, onChange, disabled, id }) {
  return (
    <Input
      id={id}
      aria-label={id ? undefined : label}
      type="number"
      inputMode="numeric"
      min={1}
      max={99}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      disabled={disabled}
      className="w-16 shrink-0 text-center tabular-nums"
    />
  );
}

function AddItem({ tripId, category, label, disabled, autoFocus }) {
  const dispatch = useDispatch();
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const result = await dispatch(addPackingItem({ tripId, category, text: text.trim(), quantity: toQuantity(quantity) }));
    setBusy(false);
    if (addPackingItem.fulfilled.match(result)) {
      setText("");
      setQuantity("1");
    }
  }
  return (
    <form onSubmit={handleSubmit} className="flex gap-2 px-2 pt-1">
      <Input
        aria-label={`Add to ${label}`}
        placeholder="Add something…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={200}
      />
      <QuantityInput label={`How many, for ${label}`} value={quantity} onChange={setQuantity} disabled={disabled} />
      <Button type="submit" variant="outline" size="icon" aria-label={`Add to ${label}`} disabled={disabled || busy || !text.trim()}>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

function PackingList({ category, items, tripId, hidePacked, disabled, onEdit, onDeleteList, justOpened }) {
  const Icon = category.icon;
  const packed = items.filter((i) => i.checked).length;
  const shown = hidePacked ? items.filter((i) => !i.checked) : items;
  return (
    <Card role="region" aria-label={category.label} className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between gap-2 pl-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          {category.label}
        </h2>
        <span className="flex items-center gap-1">
          {items.length > 0 && (
            <span className={cn("text-xs tabular-nums", packed === items.length ? "text-success" : "text-muted-foreground")}>
              {packed}/{items.length}
            </span>
          )}
          <RowMenu
            label={`More for the ${category.label} list`}
            items={[
              {
                label: "Delete list",
                icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                destructive: true,
                disabled,
                onSelect: () => onDeleteList(category, items.length),
              },
            ]}
          />
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="flex flex-col">
          {shown.map((item) => (
            <ItemRow key={item.id} item={item} tripId={tripId} disabled={disabled} onEdit={onEdit} />
          ))}
        </ul>
      )}
      {hidePacked && items.length > 0 && shown.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">All packed</p>}
      <AddItem tripId={tripId} category={category.key} label={category.label} disabled={disabled} autoFocus={justOpened} />
    </Card>
  );
}

function EditDialog({ item, tripId, onClose }) {
  const dispatch = useDispatch();
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("1");
  useEffect(() => {
    setText(item?.text ?? "");
    setQuantity(String(item?.quantity ?? 1));
  }, [item]);
  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const changes = { text: text.trim(), quantity: toQuantity(quantity) };
    const result = await dispatch(updatePackingItem({ tripId, id: item.id, changes }));
    if (updatePackingItem.fulfilled.match(result)) onClose();
  }
  return (
    <Dialog open={Boolean(item)} onClose={onClose} title="Edit">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="packing-text">What to pack</Label>
            <Input id="packing-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="packing-quantity">How many</Label>
            <QuantityInput id="packing-quantity" value={quantity} onChange={setQuantity} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!text.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteListDialog({ target, tripId, onClose, onDeleted }) {
  const dispatch = useDispatch();
  async function handleDelete() {
    const result = await dispatch(deletePackingList({ tripId, category: target.category.key }));
    if (deletePackingList.fulfilled.match(result)) onDeleted(target.category.key);
  }
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title={`Delete the ${target?.category.label ?? ""} list?`}
      description={target ? `Its ${target.count === 1 ? "1 thing goes" : `${target.count} things go`} too. You can start it again from More lists.` : undefined}
    >
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete}>
          Delete list
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Lists you haven't started, as buttons that open one. */
function StartAList({ categories, onOpen, title }) {
  if (!categories.length) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => {
          const Icon = c.icon;
          return (
            <Button key={c.key} type="button" variant="outline" size="sm" onClick={() => onOpen(c.key)}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {c.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Your own packing lists for this trip (a trip tool, in the drawer). Everyone
 * on the trip has their own, viewers included; nobody sees anyone else's.
 */
export function PackingPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const online = useSelector((s) => s.network?.online ?? true);
  const { items, status, tripId: loadedId } = useSelector((s) => s.packing);
  const tripName = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip.name : null));
  const [hidePacked, setHidePacked] = useState(false);
  const [opened, setOpened] = useState([]);
  const [editing, setEditing] = useState(null);
  const [deletingList, setDeletingList] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    dispatch(fetchTrip(tripId)); // for its name in the top bar
    dispatch(fetchPacking(tripId));
  }, [dispatch, tripId]);

  const mine = loadedId === tripId ? items : [];
  const groups = groupByCategory(mine);
  const visible = CATEGORIES.filter((c) => groups[c.key].length > 0 || opened.includes(c.key));
  const notStarted = CATEGORIES.filter((c) => !visible.includes(c));
  const packed = mine.filter((i) => i.checked).length;
  const disabled = !online;
  const open = (key) => setOpened((keys) => [...keys, key]);
  const close = (key) => setOpened((keys) => keys.filter((k) => k !== key));
  // An empty list just closes; one with things on it asks first.
  function deleteList(category, count) {
    if (count === 0) close(category.key);
    else setDeletingList({ category, count });
  }

  async function suggest() {
    setSuggesting(true);
    await dispatch(addPackingSuggestions(tripId));
    setSuggesting(false);
  }

  return (
    <ToolLayout tripId={tripId} title={tripName ?? ""}>
      <header className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Packing</h1>
          {status === "ready" && mine.length > 0 && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-semibold tabular-nums text-foreground">{packed}</span> of {mine.length} packed
            </p>
          )}
        </div>
        {status === "ready" && mine.length > 0 && (
          <Button variant="ghost" size="sm" aria-pressed={hidePacked} onClick={() => setHidePacked((h) => !h)}>
            {hidePacked ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
            {hidePacked ? "Show packed" : "Hide packed"}
          </Button>
        )}
      </header>
      {!online && (
        <p role="status" className="rounded-md border border-warning/40 px-3 py-2 text-xs text-warning">
          You’re offline. Your list shows as it was; ticking and adding need a connection.
        </p>
      )}
      {status === "loading" && loadedId === tripId && (
        <div className="flex flex-col gap-3" aria-label="Loading your packing list">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      )}
      {status === "failed" && loadedId === tripId && <p className="text-sm text-muted-foreground">Couldn’t load your packing list.</p>}
      {status === "ready" && (
        <>
          {mine.length === 0 && visible.length === 0 && (
            <Card className="flex flex-col items-center gap-3 p-6 text-center">
              <Luggage className="h-8 w-8 text-primary" aria-hidden="true" />
              <div>
                <p className="font-semibold">Nothing on your list yet</p>
                <p className="text-sm text-muted-foreground">Start with the usual things, then add and delete to suit. Only you see your list.</p>
              </div>
              <Button onClick={suggest} disabled={disabled || suggesting}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {suggesting ? "Adding…" : "Start from suggestions"}
              </Button>
            </Card>
          )}
          {visible.map((c) => (
            <PackingList
              key={c.key}
              category={c}
              items={groups[c.key]}
              tripId={tripId}
              hidePacked={hidePacked}
              disabled={disabled}
              onEdit={setEditing}
              onDeleteList={deleteList}
              justOpened={opened.includes(c.key) && groups[c.key].length === 0}
            />
          ))}
          <StartAList categories={notStarted} onOpen={open} title={mine.length ? "More lists" : "Or start a list"} />
        </>
      )}
      <EditDialog item={editing} tripId={tripId} onClose={() => setEditing(null)} />
      <DeleteListDialog
        target={deletingList}
        tripId={tripId}
        onClose={() => setDeletingList(null)}
        onDeleted={(key) => {
          close(key);
          setDeletingList(null);
        }}
      />
    </ToolLayout>
  );
}
