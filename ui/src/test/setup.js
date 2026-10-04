import "@testing-library/jest-dom/vitest";

// Runtime config shim for tests.
window.__APP_CONFIG__ = { apiBaseUrl: "http://localhost:8000" };
