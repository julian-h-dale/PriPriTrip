/**
 * A stand-in for embla-carousel-react in jsdom, which has no layout for the
 * real one to measure. Same hook shape, and just enough API for the day
 * swiper: the selected slide, scrollTo / Prev / Next, and the select /
 * settle events. `fakeEmbla.api` is the latest one, so
 * a test can "swipe" with `act(() => fakeEmbla.api.scrollNext())`.
 */
import { useState } from "react";

export const fakeEmbla = { api: null };

function createApi(options = {}) {
  const listeners = {};
  let selected = options.startIndex ?? 0;
  const emit = (event) => (listeners[event] ?? []).forEach((fn) => fn(api, event));
  const api = {
    on(event, fn) {
      (listeners[event] ??= []).push(fn);
      return api;
    },
    off(event, fn) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
      return api;
    },
    selectedScrollSnap: () => selected,
    scrollTo(index, jump = false) {
      const target = Math.max(index, 0);
      if (target !== selected) {
        selected = target;
        emit("select");
      }
      emit("settle");
      api.lastJump = jump;
    },
    scrollPrev: () => api.scrollTo(selected - 1),
    scrollNext: () => api.scrollTo(selected + 1),
    lastJump: null,
  };
  return api;
}

export default function useEmblaCarousel(options) {
  // Created on the first render (the real one arrives just after mount), so
  // the component is listening before a test can swipe.
  const [api] = useState(() => (fakeEmbla.api = createApi(options)));
  return [() => {}, api];
}
