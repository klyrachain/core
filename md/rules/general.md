# Project Development Rules & Guidelines

## 1. Core Engineering Principles

- **Performance First:** Implement safe and secure methods that strictly minimize CPU usage.
- **Data Efficiency:** Prevent multiple network requests for the same data. Utilize caching and global state to serve data efficiently.
- **Complexity Control:** \* Functions should be single-purpose and simple.
  - Avoid deeply nested logic (cyclomatic complexity).
- **DRY Principle (Don't Repeat Yourself):** strict prohibition on function duplication. Abstract reusable logic into shared utilities or hooks.

---

## 2. Documentation & Reporting

- **Location:** All documentation, reports, and architectural decisions must be stored in the `md` folder.
- **Naming Convention:** Filenames must follow the pattern: `[filename].[type].md`.
  - _Examples:_ `registration.auth.md`, `payment-flow.design.md`.
- **Clarity:** Descriptions must be simple, well-detailed, and easy to parse.
- **Readme:** Maintain ONLY one main `README.md` at the root. All other docs should be linked from there.

---

## 3. Frontend Guidelines (Next.js 16+)

### Component Architecture

- **Atomic Structure:** Each component must reside in its own file.
- **Folder Hierarchy:** Component folders must be structured with descriptive sub-folders.
  - _Example:_ `components/Market/PayButton`, `components/Feed/LikeButton`.
- **File Size Limit:** No file (including pages) should exceed **700 lines**. Refactor into smaller sub-components or hooks if this limit is reached.
- **Server vs. Client:**
  - Clearly define Server Components vs. Client Components.
  - **Server Components:** Use for static or slow-changing data (e.g., Markets Page). Cache aggressively and fetch only when new data is available.
  - **Client Components:** Use strictly for interactivity (listeners, hooks, browser APIs).

### State Management & Data Fetching

- **Redux & RTK:** Redux is **mandatory** for global state. Use Redux Toolkit (RTK) and global state managers to distribute data.
- **Data Deduplication:** \* Never fetch the same data twice on different pages.
  - Create a Redux slice (or RTK Query endpoint) and share the data across components.
- **Prohibited Patterns:**
  - **NO Timers:** Avoid time-based polling (e.g., fetching every 30s) unless strictly necessary for real-time critical features (use WebSockets instead).
  - **NO Sync `setState` in Effects:** Avoid calling `setState` synchronously within a `useEffect`. This triggers cascading renders and hurts performance.
  - **Effects Usage:** Use `useEffect` _only_ to synchronize with external systems (DOM, APIs, subscriptions), not for deriving state.

### UI & UX Standards

- **Loading States:** \* **MANDATORY:** Use Skeleton components for loading effects.
  - _Pattern:_ Every complex component (e.g., `ProductCard`) must have a counterpart `ProductCardSkeleton`.
- **Theming:** A global theme must be defined and strictly followed across all pages (colors, spacing, typography).
- **Content:** **AVOID** using raw Emojis in the UI; use SVG icons or standardized assets instead.

---

## 4. Backend Guidelines (Express / API)

### Architecture & Setup

- **Initialization:** App setup must be driven by configuration files.
  - _Includes:_ CORS policies (whitelist localhost), TypeScript config, Port setup.
- **Folder Structure:** Strictly adhere to the MVC-inspired pattern:
  - `controllers/`
  - `utils/`
  - `routes/`
  - `services/` (Recommended for business logic)
  - `types/`
- **TypeScript:** Use a global `.d.ts` file or dedicated `types/` folder for shared interface definitions.

### Database & Logic

- **No Duplication:**
  - **Logic:** No function duplication. Use Classes or Helper functions where necessary.
  - **Database:** Prevent duplicate DB instances or connections. Initialize the DB once (Singleton pattern).
- **Schema:** Database schemas must be strictly typed and synchronized with TypeScript interfaces.

---

## 5. Suggested Additions (Recommended)

### A. Error Handling Strategy

- **Global Error Handler:** Implement a centralized error handling middleware in Express. Never let an API request hang or crash the server.
- **Graceful Degradation:** The frontend should handle API errors gracefully (e.g., show a "Retry" button instead of a blank screen).

### B. Security Best Practices

- **Input Validation:** Use libraries like `Zod` or `Joi` to validate all incoming data on both Client (Forms) and Server (API Body).
- **Sanitization:** Explicitly sanitize user inputs to prevent XSS and SQL Injection.

### C. Git Workflow & Code Quality

- **Branching:** Follow a strict branching strategy (e.g., `main`, `develop`, `feature/xyz`).
- **Pre-commit Hooks:** Use `husky` to run linters and type checks before committing.
- **Commit Messages:** Follow Conventional Commits (e.g., `feat: add payment gateway`, `fix: resolve login bug`).
