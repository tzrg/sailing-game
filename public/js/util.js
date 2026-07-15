// Kleine Mathe-Helfer: Winkel im Kompass-System (0 = Nord, im Uhrzeigersinn),
// Bildschirm-Koordinaten mit y nach unten.
export const TAU = Math.PI * 2;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// normalisiert einen Winkel auf [-PI, PI]
export function normAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

// Einheitsvektor für Kompasswinkel (0 = Nord = nach oben auf dem Bildschirm)
export function dirVec(a) {
  return { x: Math.sin(a), y: -Math.cos(a) };
}

// Kompasswinkel eines Vektors
export function angleOf(v) {
  return Math.atan2(v.x, -v.y);
}

// Rotation um 90° im Uhrzeigersinn (bei y nach unten)
export function rotCW(v) {
  return { x: -v.y, y: v.x };
}

export function vlen(v) {
  return Math.hypot(v.x, v.y);
}

export const MS_TO_KN = 1.94384;
