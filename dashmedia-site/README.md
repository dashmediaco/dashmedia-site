# Dash Media — Landing Page

A single-page marketing site for **Dash Media** (`dashmediaco.com`). One static
`index.html` (all CSS and JS are inline — no build step) plus a logo asset and
serverless functions for the contact form and client portal routing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire page — hero, all sections, and the contact form. |
| `logo.png` | The DASH logo (512×512, transparent background). |
| `api/contact.js` | `POST /api/contact` handler — relays form submissions to GoHighLevel. |
| `api/client-login.js` | `GET /client-login` — looks up a client in Redis and redirects to its GHL subaccount. |
| `api/client-portal-admin.js` | Protected `POST /api/client-portal-admin` — creates or updates client routing records. |
| `lib/client-portal-store.js` | Server-side Redis data access and client portal URL validation. |
| `vercel.json` | Vercel project config. |
| `package.json` | Node metadata for the serverless function. |

## Deploy (Vercel)

1. Create a new Vercel project and import this folder (or push it to a repo and
   connect the repo).
2. In **Vercel → Settings → Environment Variables**, add:
   - **Name:** `GHL_WEBHOOK_URL`
   - **Value:** the GoHighLevel Inbound Webhook URL (provided by the client).
3. **Redeploy.** Vercel only picks up environment-variable changes on the next
   deploy.

> The site is also compatible with Netlify (functions) or any Node 18+ host.

## Contact form → GoHighLevel

The form in the **Contact** section submits JSON to `/api/contact`:

```json
{ "fullName": "...", "email": "...", "phone": "...", "company": "...", "volume": "..." }
```

`api/contact.js` validates the required fields, then `POST`s to `GHL_WEBHOOK_URL`:

```json
{
  "fullName": "...",
  "email": "...",
  "phone": "...",
  "company": "...",
  "volume": "...",
  "source": "dashmediaco.com contact form",
  "submittedAt": "<ISO timestamp>"
}
```

Each successful submission becomes a **new Contact in GoHighLevel** and flows into
the existing "Lead Intake" automation.

## Client login

The **Client Login** links on the site point to `/client-login`. That route reads
the selected client's record from the existing Vercel KV / Upstash Redis store
and redirects to the matching GHL subaccount. The first visit initializes the
`demo` record for **Dash Mortgage Automation Demo** and makes it the default.
Client-specific links can use `/client-login?client=client-slug`; the sitewide
button follows the Redis default record.

The registry stores a client ID, display name, GHL location ID, login-domain
base URL, status, and update time. It does **not** store GHL passwords. GHL
authenticates the user and enforces which subaccounts their GHL user can access.
Until a white-label login domain is configured in GHL, the test redirect uses
`app.gohighlevel.com`; changing the website redirect alone cannot hide that
domain.

### Add or update a client record

Set a strong `CLIENT_PORTAL_ADMIN_TOKEN` in Vercel for Preview and Production.
Then send a server-side request to `POST /api/client-portal-admin` with that
token in the `Authorization: Bearer ...` header:

```json
{
  "id": "new-client",
  "name": "Client Agency",
  "locationId": "GHL_LOCATION_ID",
  "portalBaseUrl": "https://app.gohighlevel.com",
  "status": "active",
  "setAsDefault": false
}
```

Set `setAsDefault` to `true` to route the main-site login button to that client.
Otherwise, use the client's link `/client-login?client=new-client`. To use a
white-label domain later, set `portalBaseUrl` to that client's HTTPS app domain.
Only the server can read or write Redis credentials; no database token is sent
to the browser.

## Notes

- The form shows a success message on `200` and an inline error + re-enabled button
  on failure.
- The GHL webhook URL never appears in the page source or the browser network tab —
  it only exists in the server environment variable.
- To test locally with the function: run `vercel dev` inside this folder.
