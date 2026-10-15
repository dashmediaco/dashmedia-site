# Dash Media â€” Landing Page

A single-page marketing site for **Dash Media** (`dashmediaco.com`). One static
`index.html` (all CSS and JS are inline â€” no build step) plus a logo asset and
serverless functions for the contact form, client sign-in redirect, and protected portal administration.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire page â€” hero, all sections, and the contact form. |
| `client-login.html` | Private fallback page that immediately forwards visitors to HighLevel sign-in. |
| `logo.png` | The DASH logo (high-resolution transparent 3D render). |
| `api/contact.js` | `POST /api/contact` handler â€” relays form submissions to GoHighLevel. |

| `api/client-login.js` | `GET /api/client-login` â€” redirects visitors to Dash's HighLevel sign-in domain. |
| `api/client-portal-admin.js` | Protected `POST /api/client-portal-admin` â€” creates or updates client routing records. |
| `lib/client-portal-store.js` | Server-side Redis data access and portal URL validation. |
| `vercel.json` | Vercel project config. |
| `package.json` | Node metadata for the serverless function. |
| `assets/` | Static brand and illustration assets. |
| `robots.txt` and `sitemap.xml` | Search crawler access and the canonical homepage URL. |

The homepage canonical URL is `https://dashmediaco.com/`; `www.dashmediaco.com` permanently redirects there.

## Deploy (Vercel)

1. Create a new Vercel project and import this folder (or push it to a repo and
   connect the repo).
2. In **Vercel â†’ Settings â†’ Environment Variables**, add:
   - **Name:** `GHL_WEBHOOK_URL`
   - **Value:** the GoHighLevel Inbound Webhook URL (provided by the client).
3. **Redeploy.** Vercel only picks up environment-variable changes on the next
   deploy.

> The site is also compatible with Netlify (functions) or any Node 18+ host.

## Contact form â†’ GoHighLevel

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

All **Client Login** links open `/client-login`, which immediately redirects to
Dash's white-label HighLevel sign-in at `https://login.dashmediaco.com`. The
route does not show agency names, expose the Demo workspace, or include a
HighLevel location ID before sign-in.

HighLevel handles authentication and account access. After sign-in, its own
account switcher and user permissions control which subaccounts are available.
Create client users as account-level users and assign only the locations they
should access. Agency-level users can access all locations, so do not use an
agency-level login for clients. Dash never collects or stores HighLevel
passwords. The Redis portal registry is administrative metadata and does not
authenticate users or decide their permissions.

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

The registry is used only by the protected administrative endpoint. It is not
used to choose a public destination or authenticate a client. Keep
`CLIENT_PORTAL_ADMIN_TOKEN` server-side; no database token is sent to the
browser.

## Notes

- The form shows a success message on `200` and an inline error + re-enabled button
  on failure.
- The GHL webhook URL never appears in the page source or the browser network tab â€”
  it only exists in the server environment variable.
- To test locally with the function: run `vercel dev` inside this folder.
