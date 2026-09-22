# Dash Media — Landing Page

A single-page marketing site for **Dash Media** (`dashmediaco.com`). One static
`index.html` (all CSS and JS are inline — no build step) plus a logo asset and a
serverless function for the contact/quote form.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire page — hero, all sections, and the contact form. |
| `logo.png` | The DASH logo (512×512, transparent background). |
| `api/contact.js` | `POST /api/contact` handler — relays form submissions to GoHighLevel. |
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

## Notes

- The form shows a success message on `200` and an inline error + re-enabled button
  on failure.
- The GHL webhook URL never appears in the page source or the browser network tab —
  it only exists in the server environment variable.
- To test locally with the function: run `vercel dev` inside this folder.
