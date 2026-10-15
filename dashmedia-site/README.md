# Dash Media — Landing Page

A single-page marketing site for **Dash Media** (`dashmediaco.com`). One static
`index.html` (all CSS and JS are inline — no build step) plus a logo asset and
serverless functions for the contact form and client portal routing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire page — hero, all sections, and the contact form. |
| `client-login.html` | Dash-branded agency chooser shown before sign-in, including for a single workspace. |
| `logo.png` | The DASH logo (high-resolution transparent 3D render). |
| `api/contact.js` | `POST /api/contact` handler — relays form submissions to GoHighLevel. |
| `api/client-portals.js` | `GET /api/client-portals` — returns active workspace names for the chooser. |
| `api/client-login.js` | `GET /api/client-login?client=<id>` — redirects a selected workspace to its configured sign-in domain. |
| `api/client-portal-admin.js` | Protected `POST /api/client-portal-admin` — creates or updates client routing records. |
| `lib/client-portal-store.js` | Server-side Redis data access and portal URL validation. |
| `vercel.json` | Vercel project config. |
| `package.json` | Node metadata for the serverless function. |
| `assets/` | The 16:9 borrower journey trailer and its poster frame. |
| `robots.txt` and `sitemap.xml` | Search crawler access and the canonical homepage URL. |

The homepage canonical URL is `https://dashmediaco.com/`; `www.dashmediaco.com` permanently redirects there.

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

All **Client Login** links point to `/client-login`, a Dash-branded agency
chooser. It always appears, even when the registry has only one active
workspace. The page fetches active workspace names from Redis and provides a
separate continue button for each one.

Selecting a workspace redirects to its configured sign-in domain, currently
`login.dashmediaco.com`. The redirect never appends a location ID. HighLevel
remains responsible for passwords, authentication, and subaccount permissions;
Dash does not store HighLevel passwords. The chooser does not verify which
workspaces a signed-in person may access; HighLevel enforces that after sign-in.

The Redis registry currently includes the `demo` record for **Dash Mortgage
Automation Demo**. It stores each client's ID, display name, HighLevel location
ID, login-domain base URL, status, and update time. The public chooser response
contains only active workspace IDs and names; it does not expose location IDs
or domain settings. The current sign-in host is `login.dashmediaco.com`.

### Add or update a client record

Set a strong `CLIENT_PORTAL_ADMIN_TOKEN` in Vercel for Preview and Production.
Then send a server-side request to `POST /api/client-portal-admin` with that
token in the `Authorization: Bearer ...` header:

```json
{
  "id": "new-client",
  "name": "Client Agency",
  "locationId": "GHL_LOCATION_ID",
  "portalBaseUrl": "https://login.dashmediaco.com",
  "status": "active",
  "setAsDefault": false
}
```

Set `setAsDefault` to `true` only when intentionally changing the default
workspace for legacy direct API requests. Each chooser card uses the selected
record's `portalBaseUrl`, so set a client-specific branded sign-in domain after
it is configured in HighLevel. Only the server can read or write Redis
credentials; no database token is sent to the browser.

## Notes

- The form shows a success message on `200` and an inline error + re-enabled button
  on failure.
- The GHL webhook URL never appears in the page source or the browser network tab —
  it only exists in the server environment variable.
- To test locally with the function: run `vercel dev` inside this folder.
