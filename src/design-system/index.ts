// Barrel: the single import surface for the design system.
// All feature/app UI imports from here. No feature file reaches into a primitive file directly.
export { Button, IconButton } from "./Button";
export { Card } from "./Card";
export { Badge } from "./Badge";
export { Money, StatRow } from "./Money";
export { ScreenHeader } from "./ScreenHeader";
export { EmptyState } from "./EmptyState";
export { Sheet, useEntitySheet } from "./Sheet";
export { ProductImage } from "./ProductImage";
export { BottomNav } from "./BottomNav";
export { Sidebar } from "./Sidebar";
export { Screen } from "./Screen";
export type { Tab } from "./navItems";
export { StoreSwitcher } from "./StoreSwitcher";
export { FormField, TextField, TextArea, CheckboxField, SelectField, fieldBase } from "./FormField";
export { TONE_BADGE, ORDER_STATUS_TONE, type StatusTone } from "./tokens";

// Theme system.
export { ThemeProvider, useTheme, THEMES, ThemePicker } from "./theme";
export type { Theme, ThemeId } from "./theme";
