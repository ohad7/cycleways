import Ionicons from "@expo/vector-icons/Ionicons";
import { palette } from "./theme.js";

// Thin wrapper so the rest of the app references Ionicons by the same names the
// web Icon.jsx uses (search-outline, arrow-undo-outline, ...).
export default function Icon({ name, size = 20, color = palette.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}
