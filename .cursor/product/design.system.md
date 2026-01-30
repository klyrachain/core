# Design System & UI Tokens

## 1. Principles

- **Atomic:** Build from the smallest unit (atoms) up to pages.
- **Accessible:** All color combinations must meet WCAG AA (4.5:1).
- **Responsive:** Mobile-first design approach.

## 2. Color Palette (Tokens)

**Usage Rule:** Never use raw hex codes in code. Use the Tailwind class or CSS variable.

### Brand (Primary)

_Used for main actions, active states, and brand identity._

- `primary-50`: `#F0F9FF` (Subtle backgrounds)
- `primary-100`: `#E0F2FE`
- `primary-500`: `#0EA5E9` **(Main Brand Color)**
- `primary-600`: `#0284C7` (Hover states)
- `primary-900`: `#0C4A6E` (Text on light backgrounds)

### Neutrals (Surface & Text)

_Used for text, borders, and surface backgrounds._

- `neutral-0`: `#FFFFFF` (Card Backgrounds)
- `neutral-50`: `#F8FAFC` (Page Background)
- `neutral-200`: `#E2E8F0` (Borders, Dividers)
- `neutral-400`: `#94A3B8` (Icons, Disabled text)
- `neutral-600`: `#475569` (Secondary text)
- `neutral-900`: `#0F172A` (Main Body text)

### Semantic (Feedback)

- `success`: `#22C55E` (Completed, Safe)
- `warning`: `#F59E0B` (Pending, Caution)
- `danger`: `#EF4444` (Destructive, Errors)
- `info`: `#3B82F6` (Guidance, Links)

---

## 3. Typography

**Font Family:** `Inter` (sans-serif) for UI, `JetBrains Mono` for code blocks.

### Scale

| Token       | Size | Line Height | Usage                  |
| :---------- | :--- | :---------- | :--------------------- |
| `text-xs`   | 12px | 16px        | Meta data, timestamps  |
| `text-sm`   | 14px | 20px        | Labels, secondary text |
| `text-base` | 16px | 24px        | Standard body copy     |
| `text-lg`   | 18px | 28px        | Card titles            |
| `text-xl`   | 20px | 28px        | Section headers        |
| `text-2xl`  | 24px | 32px        | Page titles            |
| `text-4xl`  | 36px | 40px        | Hero headers           |

### Weights

- `Regular (400)`: Body text.
- `Medium (500)`: Interactive elements (Buttons, Nav).
- `Semibold (600)`: Headings and emphasized data.

---

## 4. Spacing & Grid

**Base Unit:** 4px. All spacing is a multiple of 4.

### Spacing Scale

- `space-1`: 4px
- `space-2`: 8px (Component internal padding)
- `space-3`: 12px
- `space-4`: 16px (Standard Card padding)
- `space-6`: 24px
- `space-8`: 32px (Section separation)
- `space-12`: 48px

### Breakpoints (Grid)

- **Mobile:** < 640px (1 Column, 16px margin)
- **Tablet:** 640px - 1024px (2-4 Columns, 24px margin)
- **Desktop:** > 1024px (12 Columns, max-width 1280px)

---

## 5. UI Properties

### Border Radius

- `rounded-sm`: 4px (Checkboxes, Tags)
- `rounded-md`: 8px (Buttons, Inputs)
- `rounded-lg`: 12px (Cards, Modals)
- `rounded-full`: 9999px (Avatars, Pills)

### Shadows (Elevation)

- `shadow-sm`: 0 1px 2px (Buttons, Inputs)
- `shadow-md`: 0 4px 6px (Cards, Dropdowns)
- `shadow-lg`: 0 10px 15px (Modals, Popovers)
- `shadow-none`: 0 0 0 (Flat elements)

### Z-Index (Stacking Order)

- `z-0`: Default
- `z-10`: Dropdowns
- `z-40`: Sticky Headers
- `z-50`: Modals / Overlays
- `z-100`: Tooltips / Toasts

---

## 6. Core Components

### A. Buttons

- **Primary:** `bg-primary-500` text-white `hover:bg-primary-600` `active:scale-95`
- **Secondary:** `border-neutral-200` text-neutral-900 `hover:bg-neutral-50`
- **Ghost:** `bg-transparent` text-neutral-600 `hover:bg-neutral-100`
- **Destructive:** `bg-danger` text-white `hover:opacity-90`

### B. Inputs

- **Default:** `border-neutral-200` bg-white text-neutral-900
- **Focus:** `ring-2 ring-primary-100` border-primary-500
- **Error:** `border-danger` text-danger `ring-danger-light`
- **Disabled:** `bg-neutral-100` text-neutral-400 cursor-not-allowed

### C. Cards

- **Container:** `bg-white` `rounded-lg` `border border-neutral-200` `shadow-sm`
- **Hover (Interactive):** `hover:shadow-md` `hover:-translate-y-1` (transition-all duration-200)

---

## 7. Animation & Micro-interactions

- **Duration Fast:** 150ms (Hover effects, Button clicks)
- **Duration Normal:** 300ms (Modal open, Slide overs)
- **Duration Slow:** 500ms (Skeleton loading loops)
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` (Standard ease-in-out)
