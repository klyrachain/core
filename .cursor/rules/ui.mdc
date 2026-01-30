# UI/UX & Product Design Rules

## Overview

These rules govern the visual and interactive aspects of the application. They ensure high visibility, a consistent "feel," and strict compatibility with the Next.js/Redux architecture.

---

## 1. Core Visual Principles & Visibility

- **Contrast is Mandatory:** \* All text and interactive elements must meet **WCAG AA** standards (minimum 4.5:1 contrast ratio).
- **No Hardcoded Values:** \* **Forbidden:** Raw hex codes (e.g., `#000000`) or raw pixels (e.g., `15px`) in inline styles.
  - **Mandatory:** Use defined Theme Tokens (CSS Variables or Tailwind utility classes) for all colors, spacing, and typography.
- **Whitespace & Breathability:** \* Adhere strictly to the **4px or 8px grid system**.
  - Padding/Margins must be multiples of the base unit (e.g., 4, 8, 16, 24, 32).
- **Visual Hierarchy:** \* Use font weight and color to denote hierarchy, not just size.
  - **Primary Actions:** Solid, high-contrast colors.
  - **Secondary Actions:** Outlined or ghost buttons.
  - **Tertiary/Meta Text:** Use `text-muted` or `text-secondary` tokens (never illegible gray).

---

## 2. Component Design & Interaction

- **State Completeness:** Every interactive component (Buttons, Inputs, Cards) must have designs for **ALL** five states:
  1.  **Default/Idle**
  2.  **Hover** (Visual cue: opacity change, lift, or color shift)
  3.  **Active/Pressed** (Tactile feedback: scale down)
  4.  **Focus** (Visible ring for accessibility)
  5.  **Disabled** (Visually distinct, non-interactive)
- **Skeleton Loading:** \* **AVOID:** Full-page spinners for content updates.
  - **USE:** Skeleton loaders that mimic the layout of the content being fetched (e.g., `ProductCardSkeleton` dimensions === `ProductCard`).
- **Feedback Loops:** \* **Success:** Toast notification or inline checkmark.
  - **Error:** Inline red text with a clear icon (color alone is insufficient).
  - **Processing:** Button text becomes "Loading..." or shows an internal spinner.

---

## 3. Typography & Readability

- **Line Length:** Paragraph text should not exceed **60-75 characters** per line.
- **Vertical Rhythm:** \* Body text line height: **1.5x** font size.
  - Headings line height: **1.1x - 1.2x**.
- **Responsive Typography:** \* Use fluid units (`rem`/`em`) or responsive classes.
  - Text must remain legible on mobile without horizontal scrolling.
- **Content Layout:** \* Avoid "Walls of Text." Break long descriptions with headers, bullet points, or visual dividers.

---

## 4. Asset & File Management

- **Vector First:** Use **SVGs** for all icons and simple illustrations (ensures sharpness).
- **Naming Convention:** `[icon-name].[type].svg`.
  - _Example:_ `user-profile-filled.svg`, `arrow-right-outlined.svg`.
- **Icon Consistency:** \* All icons must share the same stroke width (e.g., 1.5px) and corner radius.
  - **Pattern:** Use _Filled_ variants for active states and _Outlined_ variants for idle states.

---

## 5. Integration with Development (Next.js/Redux)

- **Server-Component Friendly:** \* Design layouts where "static" shells (Sidebar, Header) are distinct from "dynamic" regions (Feeds). This supports the Server/Client separation rule.
- **State-Driven Design:** \* **Empty States:** Never leave blank space. Provide an illustration and Action (e.g., "No Markets Found. [Create Market]").
  - **Error States:** Design for API failures (e.g., "Failed to load price").
- **Animation Guardrails:**
  - **Tools:** Use `GSAP` or CSS transitions.
  - **Timing:** Transitions must be between **200ms and 300ms**.
  - **Performance:** Avoid auto-playing heavy media that blocks the main thread.

---

## 6. Documentation & Hand-off

- **Markdown Reports:** Store design decisions in the `md` folder.
  - _Filename:_ `[component-name].design.md` (e.g., `pay-button.design.md`).
- **Annotations:** Designs for developers must explicitly label:
  - **Dynamic Data:** "This title comes from API."
  - **Conditions:** "Only show this badge if user is Pro."
