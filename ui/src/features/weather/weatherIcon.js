import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Moon, Sun } from "lucide-react";

/**
 * A lucide icon for an OpenWeatherMap icon code ("10d": rain, by day). Our
 * own icons rather than OWM's images: they work offline and match the app.
 */
export function weatherIcon(code) {
  const kind = String(code ?? "").slice(0, 2);
  const night = String(code ?? "").endsWith("n");
  switch (kind) {
    case "01":
      return night ? Moon : Sun;
    case "02":
      return CloudSun;
    case "03":
    case "04":
      return Cloud;
    case "09":
      return CloudDrizzle;
    case "10":
      return CloudRain;
    case "11":
      return CloudLightning;
    case "13":
      return CloudSnow;
    case "50":
      return CloudFog;
    default:
      return Cloud;
  }
}
