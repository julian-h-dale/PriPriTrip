import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose conditional Tailwind classes (clsx + tailwind-merge). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
