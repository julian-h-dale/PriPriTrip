import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { Download, FileArchive, FileImage, FileText, FolderOpen, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteDocument,
  downloadAllDocuments,
  downloadDocument,
  fetchDocuments,
  renameDocument,
  replaceDocument,
  uploadDocument,
} from "@/features/documents/documentsSlice";
import { extension, formatSize } from "@/features/documents/files";
import { fetchTrip } from "@/features/timeline/timelineSlice";
import { RowMenu } from "@/shared/components/RowMenu";
import { ToolLayout } from "@/shared/components/ToolLayout";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { formatSavedAt } from "@/shared/utils/time";

// What the server keeps (services/documents.py TYPES).
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

/** "PDF", "JPG", … from the file's extension. */
function kind(filename) {
  return extension(filename).slice(1).toUpperCase() || "File";
}

/** A hidden file picker, opened by `open()`; calls `onPick(file)`. */
function useFilePicker(onPick, testId = "document-file") {
  const ref = useRef(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      className="hidden"
      data-testid={testId}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) onPick(file);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

function DocumentRow({ doc, tripId, disabled, onRename, onDelete }) {
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);
  const picker = useFilePicker(async (file) => {
    setBusy(true);
    await dispatch(replaceDocument({ tripId, id: doc.id, file }));
    setBusy(false);
  }, `document-file-${doc.id}`);
  const Icon = doc.contentType.startsWith("image/") ? FileImage : FileText;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => dispatch(downloadDocument({ tripId, doc }))}
        disabled={disabled || busy}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-sm font-medium">{doc.name}</span>
          <span className="text-xs text-muted-foreground">
            {busy
              ? "Uploading…"
              : [kind(doc.filename), formatSize(doc.size), doc.uploadedByName, formatSavedAt(doc.updatedAt)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {picker.input}
      <RowMenu
        label={`More for ${doc.name}`}
        items={[
          { label: "Download", icon: <Download className="h-4 w-4" aria-hidden="true" />, disabled, onSelect: () => dispatch(downloadDocument({ tripId, doc })) },
          { label: "Replace file", icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />, disabled, onSelect: picker.open },
          { label: "Rename", icon: <Pencil className="h-4 w-4" aria-hidden="true" />, disabled, onSelect: () => onRename(doc) },
          { label: "Delete", icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, destructive: true, disabled, onSelect: () => onDelete(doc) },
        ]}
      />
    </li>
  );
}

function RenameDialog({ doc, tripId, onClose }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  useEffect(() => setName(doc?.name ?? ""), [doc]);
  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await dispatch(renameDocument({ tripId, id: doc.id, name: name.trim() }));
    if (renameDocument.fulfilled.match(result)) onClose();
  }
  return (
    <Dialog open={Boolean(doc)} onClose={onClose} title="Rename document">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="document-name">Name</Label>
          <Input id="document-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ doc, tripId, onClose }) {
  const dispatch = useDispatch();
  async function handleDelete() {
    const result = await dispatch(deleteDocument({ tripId, id: doc.id }));
    if (deleteDocument.fulfilled.match(result)) onClose();
  }
  return (
    <Dialog open={Boolean(doc)} onClose={onClose} title={`Delete “${doc?.name ?? ""}”?`} description="It goes for everyone on the trip.">
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={handleDelete}>
          Delete
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * The trip's documents (a trip tool, in the drawer; the owner and editors
 * only): tickets, bookings, passport scans kept on the server. Before the
 * trip, "Download all" saves one zip to the phone as a hard copy.
 */
export function DocumentsPage() {
  const { tripId } = useParams();
  const dispatch = useDispatch();
  const online = useSelector((s) => s.network?.online ?? true);
  const { documents, status, tripId: loadedId } = useSelector((s) => s.documents);
  const trip = useSelector((s) => (s.timeline?.trip?.id === tripId ? s.timeline.trip : null));
  const [uploading, setUploading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const picker = useFilePicker(async (file) => {
    setUploading(true);
    await dispatch(uploadDocument({ tripId, file }));
    setUploading(false);
  });

  useEffect(() => {
    dispatch(fetchTrip(tripId)); // its name, and whether you may see this
    dispatch(fetchDocuments(tripId));
    // Again when the connection comes back (they aren't saved for offline).
  }, [dispatch, tripId, online]);

  const mine = loadedId === tripId ? documents : [];
  const disabled = !online;
  const isViewer = trip?.role === "viewer";

  async function downloadAll() {
    setZipping(true);
    await dispatch(downloadAllDocuments({ tripId, tripName: trip?.name }));
    setZipping(false);
  }

  return (
    <ToolLayout tripId={tripId} title={trip?.name ?? ""}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Tickets, bookings and passport scans, kept with the trip. Before you leave, download them all to your phone as a backup.
        </p>
      </header>
      {isViewer ? (
        <p className="text-sm text-muted-foreground">Documents are for the people planning the trip.</p>
      ) : (
        <>
          {!online && (
            <p role="status" className="rounded-md border border-warning/40 px-3 py-2 text-xs text-warning">
              You’re offline. Documents need a connection.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadAll} disabled={disabled || zipping || mine.length === 0}>
              <FileArchive className="h-4 w-4" aria-hidden="true" />
              {zipping ? "Preparing…" : "Download all (zip)"}
            </Button>
            <Button variant="outline" onClick={picker.open} disabled={disabled || uploading}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {uploading ? "Uploading…" : "Add a document"}
            </Button>
            {picker.input}
          </div>
          {status === "loading" && loadedId === tripId && (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-card" aria-label="Loading documents" />
          )}
          {/* Offline, the banner above already says they need a connection. */}
          {status === "failed" && loadedId === tripId && online && (
            <p className="text-sm text-muted-foreground">Couldn’t load the documents.</p>
          )}
          {status === "ready" && mine.length === 0 && (
            <Card className="flex flex-col items-center gap-2 p-6 text-center">
              <FolderOpen className="h-8 w-8 text-primary" aria-hidden="true" />
              <p className="font-semibold">No documents yet</p>
              <p className="text-sm text-muted-foreground">Add PDFs or photos of tickets and bookings, up to 25 MB each.</p>
            </Card>
          )}
          {mine.length > 0 && (
            <Card className="p-2">
              <ul aria-label="Documents" className="flex flex-col">
                {mine.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} tripId={tripId} disabled={disabled} onRename={setRenaming} onDelete={setDeleting} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <RenameDialog doc={renaming} tripId={tripId} onClose={() => setRenaming(null)} />
      <DeleteDialog doc={deleting} tripId={tripId} onClose={() => setDeleting(null)} />
    </ToolLayout>
  );
}
