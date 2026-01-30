# Testing & Quality Assurance (QA) Rules

## Overview

Quality Assurance is the safety net of the application. We adhere to the **Testing Pyramid** strategy: a broad base of fast Unit Tests, a middle layer of Integration Tests, and a focused top layer of End-to-End (E2E) Tests.

## 1. General Testing Standards

- **Zero Regression Policy:**
  - If a bug is found in production, a test case MUST be written to reproduce that bug before fixing it. This ensures the bug never returns.
- **Naming Conventions:**
  - Test files must be co-located with their source files (or in a `__tests__` folder).
  - Format: `[filename].test.ts` or `[filename].spec.ts`.
  - Test descriptions (`it('should...')`) must be plain English sentences describing behavior, not implementation.
- **Clean State:**
  - Every test must run in isolation.
  - Use `beforeEach` and `afterEach` hooks to clean up database mocks or store states. **NEVER** let one test depend on the result of another.

## 2. Unit Testing (The Foundation)

- **Scope:** Individual functions, utilities, Redux reducers, and isolated components.
- **Tools:** Jest or Vitest.
- **Rules:**
  - **Pure Functions:** 100% coverage required for all helper functions and logic/utility classes.
  - **Redux/State:**
    - Test every Reducer action.
    - Test Selectors to ensure they return the correct slice of state.
  - **Mocking:**
    - **NEVER** make real network requests in unit tests.
    - Mock all external dependencies (API calls, Database connections, Third-party libs).

## 3. Integration Testing (Backend & API)

- **Scope:** Testing how modules interact (e.g., Controller -> Service -> Database).
- **Tools:** Supertest (for Express), Jest.
- **Rules:**
  - **Happy Path:** Test the successful execution of the endpoint (200 OK).
  - **Edge Cases:** Test invalid inputs, missing parameters, and unauthorized access (400/401/403 errors).
  - **Database:** Use a separate "Test Database" (Dockerized) that is wiped clean after every test suite. DO NOT run tests against the development or production DB.

## 4. Frontend Component Testing

- **Scope:** Interactive UI elements (Forms, Modals, Buttons).
- **Tools:** React Testing Library (RTL).
- **Rules:**
  - **Test Behavior, Not Implementation:**
    - _Bad:_ `expect(wrapper.state('value')).toBe('admin')`
    - _Good:_ `expect(screen.getByText('Welcome Admin')).toBeVisible()`
  - **Accessibility (A11y) Check:**
    - Tests should fail if components lack ARIA labels or fail contrast checks (using `jest-axe`).
  - **User Simulation:** Use `userEvent` (not `fireEvent`) to mimic real user interactions like typing and clicking.

## 5. End-to-End (E2E) Testing

- **Scope:** Critical User Journeys (CUJs).
- **Tools:** Cypress or Playwright.
- **Rules:**
  - **Focus:** Only test critical flows: Sign Up, Login, Checkout, Profile Update.
  - **No Flakiness:** E2E tests are expensive. If a test is flaky (fails randomly), it must be fixed immediately or removed.
  - **Environment:** Run E2E tests against a Staging environment that mirrors Production.

## 6. Pre-Commit & CI Gates

- **Husky Hooks:**
  - Developers cannot commit code if `lint` or `type-check` fails.
- **CI Pipeline:**
  - Pull Requests (PRs) cannot be merged unless the CI pipeline passes ALL Unit and Integration tests.
  - Code Coverage reports must be generated. If coverage drops below the defined threshold (e.g., 80%), the build fails.
