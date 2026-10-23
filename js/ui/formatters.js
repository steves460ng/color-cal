import { numeric } from "../domain/values.js";
/** Keep recorded/first-pass inputs exact; only derived production values are rounded. */
export function formatInput(value, settings, exact = false) {
  if (!numeric(value)) return "—";
  const number = Number(value),
    places = settings.integer ? 0 : settings.precision;
  if (!exact) return number.toFixed(places);
  const text = String(number);
  if (/[eE]/.test(text)) return text;
  const [whole, fraction = ""] = text.split(".");
  return Math.max(places, fraction.length)
    ? `${whole}.${fraction.padEnd(places, "0")}`
    : whole;
}
