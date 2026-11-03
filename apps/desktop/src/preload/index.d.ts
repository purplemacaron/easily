import type { EasilyApi } from "./index";

declare global {
  interface Window {
    easily: EasilyApi;
  }
}
