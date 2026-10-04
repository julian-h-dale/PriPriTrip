/**
 * Keep a copy of a photo on the phone: the share sheet with the file where
 * the browser can share files (iOS offers "Save Image" there; Android
 * "Save to device" or the gallery), else a plain download.
 *
 * Returns "shared", "cancelled" (the user closed the sheet) or "downloaded".
 */
export async function saveToPhone(file) {
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      // Sharing refused (e.g. not from a tap): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "photo.jpg";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
