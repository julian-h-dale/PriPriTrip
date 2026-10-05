import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Runtime config shim for tests.
window.__APP_CONFIG__ = { apiBaseUrl: "http://localhost:8000" };

// Embla (the day swiper) measures layout, which jsdom doesn't have.
vi.mock("embla-carousel-react", () => import("./fakeEmbla.js"));
