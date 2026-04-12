# Design System Specification

## 1. Overview & Creative North Star: "The Precision Architect"
This design system moves beyond the generic "dark mode" template to establish a high-density, utility-first environment inspired by the surgical precision of modern IDEs. The Creative North Star is **The Precision Architect**: a visual language that prioritizes information density, technical clarity, and structural honesty.

Unlike consumer-facing apps that rely on "fluff" and "air," this system celebrates the grid. It breaks the "standard" mold by utilizing intentional asymmetry and a rigid 4px rhythmic baseline, creating a digital workspace that feels like a high-performance instrument. We reject the "soft" web in favor of sharp lines, tonal depth, and systematic efficiency.

---

### 2. Colors & Surface Architecture
The palette is built on a foundation of neutral charcoals, punctuated by high-signal functional accents.

#### Tonal Logic
- **Background (`#131313`)**: The canvas. Use `surface-dim` for the primary workspace to reduce eye strain.
- **Surface Tiers**:
    - `surface-container-lowest` (`#0e0e0e`): For deeply recessed areas like terminal wells or sidebar tracks.
    - `surface-container` (`#201f1f`): The standard panel background.
    - `surface-container-highest` (`#353535`): For active states, tooltips, or elevated overlays.

#### The "No-Line" Rule (Refined for Density)
While the aesthetic is "crisp," do not rely on high-contrast lines for every division. Use **Tonal Nesting**: place a `surface-container-high` (`#2a2a2a`) element against a `surface-container` (`#201f1f`) background to create a boundary through value shifts.

#### Glass & Texture
To prevent the UI from feeling "dead," floating panels (like command palettes) should utilize `surface-variant` (`#353535`) at 85% opacity with a `20px` backdrop blur. This provides a "glass-engine" feel that maintains the developer-tool aesthetic while adding premium depth.

---

### 3. Typography: Editorial Utility
We pair the humanist clarity of **Inter** (replacing Open Sans for better screen-rendering at small sizes) with a strict Monospace scale for data integrity.

- **Display & Headline**: Use `headline-sm` (`1.5rem`) for view titles. Keep these lean; avoid heavy weights to maintain the "Architect" feel.
- **Body & Label**: The workhorse of the system.
    - `body-sm` (`0.75rem`): The default for high-density property grids.
    - `label-sm` (`0.6875rem`): All-caps for category headers or metadata, tracked out by `0.05em` for authority.
- **Monospace Integration**: Use `JetBrains Mono` or `Roboto Mono` for all IDs, JSON keys, and validation logs to ensure character alignment.

---

### 4. Elevation & Depth: Tonal Layering
We eschew traditional drop shadows for **Ambient Depth**.

- **The Layering Principle**: Build the UI like a physical console.
    - **Base Layer**: `surface` (The machine frame)
    - **Mid Layer**: `surface-container` (The instrument panels)
    - **Top Layer**: `surface-bright` (The interaction controls)
- **The Ghost Border**: Borders should never be 100% opaque. Use `outline-variant` (`#404850`) at **40% opacity** for structural dividers. This creates a "sub-pixel" feel that looks sharper on high-DPI displays.
- **Focus States**: Rather than a shadow, indicate focus with a `primary` (`#94ccff`) 1px border and a subtle `surface-tint` outer glow (4px blur, 10% opacity).

---

### 5. Components: High-Density Primitives

#### Buttons (Tactile & Compact)
- **Primary**: `primary-container` (`#4ba1e2`) background with `on-primary-container` text. 4px radius (`sm`).
- **Ghost (Secondary)**: `outline` border at 20% opacity. No fill. Primary text.
- **Padding**: `4px 12px` for compact density.

#### Input Fields
- **Default**: `surface-container-low` background with a 1px bottom-border using `outline-variant`. 
- **States**: On focus, the bottom border transitions to `primary` (`#94ccff`). Error states use `error` (`#ffb4ab`) with `body-sm` helper text.

#### Tabs (IDE Style)
- **Underline Style**: Use `title-sm` typography. Active state is indicated by a 2px `primary` border-bottom and `on-surface` text. Inactive tabs use `on-surface-variant` and no border.

#### Cards & Lists
- **Rule**: Forbid divider lines between list items. Use a 4px vertical gap.
- **Hover**: List items should use `surface-container-highest` on hover to provide immediate feedback without visual clutter.

#### Validation Badges (Pills)
- **Success**: `secondary-container` (`#17a65a`) background, `on-secondary-fixed` text.
- **Error**: `error-container` (`#93000a`) background, `on-error-container` text.
- **Shape**: Always `full` (9999px) roundedness to contrast against the rigid 4px grid of the containers.

---

### 6. Do’s and Don’ts

#### Do
- **Do** align everything to the 4px grid. If an icon is 16px, its container should be 24px or 32px.
- **Do** use `on-surface-variant` (`#bfc7d1`) for non-critical metadata to create visual hierarchy through color, not just size.
- **Do** use "nested" surfaces. A dark sidebar (`surface-container-lowest`) should hold lighter cards (`surface-container`).

#### Don’t
- **Don’t** use shadows to indicate hierarchy. Use color value shifts instead.
- **Don’t** use large border-radii. Keep the "Architect" feel with `0.125rem` (sm) or `0.25rem` (default) corners.
- **Don’t** use pure white (`#ffffff`). It causes "haloing" in dark mode. Use `primary-text` (`#eeeeee`).
- **Don’t** use dividers if a 8px or 12px gap can solve the separation.