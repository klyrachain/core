# Sent.dm message templates

JSON template definitions for SMS/WhatsApp via [Sent.dm](https://docs.sent.dm/docs/reference/api/template/create-template). Used by the push script and admin API.

## Structure

Each file must match the Sent API create payload shape:

- **displayName** (optional): Human name; not sent to API (API may auto-generate).
- **category**: `UTILITY` | `MARKETING` | `AUTHENTICATION`. Required for create.
- **language**: e.g. `en_US`.
- **submitForReview**: `false` = draft; `true` = submit for WhatsApp review.
- **definition**: Template body with `header`, `body`, `footer`, `buttons`. At minimum:
  - `body.multiChannel.template`: Text with variables `{{1:variable}}`, `{{2:variable}}`, …
  - `body.multiChannel.variables`: Array of `{ id, name, type: "variable", props: { variableType: "text", sample: "..." } }`.

Variable names here (`amount`, `currency`, `link`, etc.) are the keys you pass when sending a message as `templateVariables`.

## Push templates and get IDs

1. Set `SENT_DM_API_KEY` and `SENT_DM_SENDER_ID` in `.env`.
2. Run: `pnpm run sent:push-templates`
3. Copy the printed env lines into `.env`:
   - `SENT_DM_TEMPLATE_PAYMENT_REQUEST=<id>`
   - `SENT_DM_TEMPLATE_CLAIM_NOTIFICATION=<id>`

## Admin API (dashboard)

- `GET /api/admin/sent/templates` — list templates (paginated; optional `search`, `status`, `category`).
- `GET /api/admin/sent/templates/:id` — get one template.
- `POST /api/admin/sent/templates` — create (body: same as Sent create, or our JSON file shape with `definition`).
- `DELETE /api/admin/sent/templates/:id` — delete template.

Requires platform admin (session or API key with `settings:read` / `settings:write`).
