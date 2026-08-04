// Barrel: the single import surface for the design system.
// All feature/app UI imports from here. No feature file reaches into a primitive file directly.
export { Button, IconButton } from "./Button";
export { Card } from "./Card";
export { Badge } from "./Badge";
export { Money, StatRow } from "./Money";
export { AnimatedNumber } from "./AnimatedNumber";
export { Reveal, RevealList } from "./Reveal";
export { Lightbox } from "./Lightbox";
export { Dialog } from "./Dialog";
export { Dropdown, DropdownItem, DropdownSeparator } from "./Dropdown";
export { CommandPalette, type CommandGroup, type CommandItem } from "./CommandPalette";
export { ScreenHeader } from "./ScreenHeader";
export { EmptyState } from "./EmptyState";
export { Spinner } from "./Spinner";
export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton";
export { Sheet, useEntitySheet } from "./Sheet";
export { ToastProvider, useToast } from "./Toast";
export { ProductImage } from "./ProductImage";
export { PhotoPicker } from "./PhotoPicker";
export { MultiPhotoPicker, type GalleryTile } from "./MultiPhotoPicker";
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
export { OLIVIA_BRAND, OLIVIA_DEFAULT_STOREFRONT, OLIVIA_SLUG } from "./olivia";
