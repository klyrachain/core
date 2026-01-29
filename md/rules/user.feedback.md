# User Feedback, Errors & Micro-Copy Rules

## Overview

This document defines the "Voice and Soul" of the application. Our goal is to maintain user calm at all times. We treat technical failures as _our_ responsibility, never the user's. We prioritize **Perceived Performance** over actual performance to make the app feel instant and responsive.

---

## 1. The "No-Blame" Philosophy

- **Rule:** Never use the word "Invalid," "Bad," or "Wrong" when referring to user input if possible.
- **Rule:** Never expose raw stack traces, hex codes, or database errors to the UI.
- **Tone:** Helpful, apologetic, and solution-oriented.
  - _Bad:_ "You entered the wrong password." (Accusatory)
  - _Good:_ "That password didn't match our records. Want to try again?" (Helpful)

---

## 2. Error Message Dictionary (Translation Layer)

Developers must map backend/blockchain errors to these "Sweet" strings in the frontend localization files.

| Technical Error / Context         | The "Sweet" User Copy                                                                                        |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| **500 Internal Server Error**     | "Don't fret, our servers just tripped over a cable. We're fixing it now. Please try again in a moment."      |
| **404 Not Found**                 | "We looked everywhere, but this market seems to have wandered off. Let's get you back home."                 |
| **Transaction Failed (General)**  | "The network is being a bit stubborn right now. Your funds are safe, but the transaction didn't go through." |
| **Execution Reverted (Slippage)** | "The price moved while you were clicking! Let's update the quote and try that swap again."                   |
| **Insufficient Funds (Gas)**      | "It looks like you need a little more ETH to cover the gas fee for this trip."                               |
| **Wallet Rejected (User denied)** | "Transaction cancelled. No worries, we'll be here when you're ready."                                        |
| **API Timeout / Slow Network**    | "Things are taking a little longer than usual. We're still trying to reach the network..."                   |

---

## 3. "Instant" Feel & Loading Tricks

We use psychology to make 5 seconds feel like 1 second.

### A. Optimistic UI (The "Lie" for Good)

- **Concept:** When a user performs an action (e.g., "Like", "Save", "Add to Cart"), update the UI **immediately** as if the server already said "Yes."
- **Implementation:**
  1.  User clicks "Like".
  2.  Redux store updates `isLiked: true`. Heart icon turns red instantly.
  3.  API request is sent in the background.
  4.  _If API fails:_ Quietly roll back the state and show a gentle toast: "We couldn't save that like, check your connection."

### B. Skeleton Screens over Spinners

- **Rule:** Never show a lonely spinning wheel on a blank white screen.
- **Standard:** Use "Shimmer" skeletons that match the exact layout of the incoming data. This signals progress and reduces cognitive load.

### C. The "Distraction" Technique (For Long Waits)

For blockchain transactions that take > 10 seconds:

- **Do Not:** Show a static "Processing..." text.
- **Do:** Rotate through "Sweet" micro-copy every 3 seconds:
  1.  _"Wrapping up your transaction..."_
  2.  _"Securing your data on-chain..."_
  3.  _"Almost there..."_
  4.  _"Just polishing the details..."_

---

## 4. Success & Neutral States

Positive feedback should be delightful but not intrusive.

- **Confetti:** Use sparingly for major milestones (e.g., "First Market Created", "Transaction Confirmed").
- **Toasts:**
  - Should appear bottom-right (desktop) or top-center (mobile).
  - Must auto-dismiss after 4 seconds.
  - **Copy:**
    - _Standard:_ "Saved."
    - _Sweet:_ "All set! Your changes are saved."

---

## 5. Empty States (The "Blank Canvas")

Never leave a container empty. An empty state is an opportunity to teach or guide.

- **Scenario:** User has no active transaction history.
- **Bad:** (Blank White Space)
- **Good:**
  - **Visual:** A soft, desaturated illustration of a vault or list.
  - **Headline:** "It's quiet in here..."
  - **Subtext:** "You haven't made any transactions yet. Once you do, they'll show up right here."
  - **CTA Button:** "[Start Trading]"

---

## 6. Implementation Guide for Developers

1.  **Centralized Text:** Store all these strings in a `locales/en.json` file. Do not hardcode strings in React components.
2.  **Error Component:** Create a generic `<ErrorBoundary>` component that catches crashes and renders the "Don't fret" message instead of a white screen of death.
3.  **Randomizer Utility:**
    ```typescript
    // utils/loadingMessages.ts
    const messages = [
      "Dusting off the servers...",
      "Asking the blockchain nicely...",
      "Crunching the numbers...",
    ];
    export const getRandomLoadingMessage = () =>
      messages[Math.floor(Math.random() * messages.length)];
    ```
