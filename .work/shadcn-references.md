# shadcn/ui References (RadView3D migration)

Source material reviewed for the 2026-10-03 UI migration:

- Vite setup: https://ui.shadcn.com/docs/installation/vite — React + TypeScript; Tailwind CSS v4 using `@tailwindcss/vite`; `@/*` alias in TypeScript/Vite; shadcn CLI adds source-owned components.
- Manual setup: https://ui.shadcn.com/docs/installation/manual — required packages include shadcn, class-variance-authority, cn, lucide-react, tw-animate-css; `components.json` configures aliases/theme and CSS variables.
- Component catalog: https://ui.shadcn.com/docs/components — available primitives include Button, Card, Checkbox, Dialog, Alert Dialog, Select, Slider, Toggle Group, Tooltip, Separator, Scroll Area, Badge, etc.
- Theming: https://ui.shadcn.com/docs/theming — CSS-variable semantic tokens (`background`, `foreground`, `card`, `popover`, `primary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) and `.dark` theme overrides.
- Button: https://ui.shadcn.com/docs/components/button — variant/size primitives, Lucide icon support and `buttonVariants` for anchors.
- Card: https://ui.shadcn.com/docs/components/card — composable Card, Header, Title, Description, Content, Footer parts.
- Select: https://ui.shadcn.com/docs/components/select and https://ui.shadcn.com/docs/components/base/select — composable trigger/value/content/item pattern.
- Slider: https://ui.shadcn.com/docs/components/slider — controlled value/max/step.
- Toggle Group: https://ui.shadcn.com/docs/components/toggle-group — single selection for mutually-exclusive viewer layouts.
- Alert Dialog: https://ui.shadcn.com/docs/components/alert-dialog — semantic confirmation with title, description, cancel and action.
- Dialog: https://ui.shadcn.com/docs/components/dialog — semantic modal composition, focus behavior and transitions.
- Tooltip: https://ui.shadcn.com/docs/components/tooltip — provider/trigger/content pattern.
- Sidebar: https://ui.shadcn.com/docs/components/sidebar — composable sidebar provider/panel/menu parts, available if a collapsible sidebar becomes useful.

Project setup uses the official shadcn CLI with the Base UI implementation and Nova preset (Lucide + Geist). Generated component sources reside at `src/components/ui/` and the app composes these with its retained Tauri backend and CT canvas renderer.
