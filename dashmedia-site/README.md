# Dash Media Website

The Dash Media marketing website is static with Vercel functions for the contact form and internal HighLevel location inventory sync. HighLevel handles client authentication on the white-label domain.

## Client login

The website's Client Login links open `https://login.dashmediaco.com/` directly. HighLevel's Dash-branded login handles email/password and Google sign-in once, then applies the user's existing HighLevel sub-account permissions. If the user belongs to multiple sub-accounts, HighLevel provides its account switcher. Dash does not collect HighLevel passwords or show a separate agency chooser.

`/client-login` and `/agency` remain as compatibility redirects to the branded HighLevel login domain. The old Dash login page and agency chooser were removed. HighLevel is the authority for user invitations, workspace membership, and access.

## Vercel configuration

Keep registry and sync secrets server-side in Vercel. Add the HighLevel sync credentials in Vercel Production only:

- PORTAL_SESSION_SECRET: at least 32 random bytes for legacy signed portal sessions.
- CLIENT_PORTAL_ADMIN_TOKEN: a strong bearer token for the protected assignment API.
- GHL_PRIVATE_INTEGRATION_TOKEN: the agency Private Integration token with only users.readonly and locations.readonly.
- CRON_SECRET: a random secret Vercel uses to authenticate the scheduled sync request.
- Redis/KV REST URL and token: the existing Upstash or Vercel KV connection used for agency and user records.

HighLevel login does not use the site's legacy Google OAuth client. HighLevel's own Google button and email/password form authenticate users on the white-label domain.

## Agency inventory

The protected POST endpoint is `/api/client-portal-admin`. Send the admin token as `Authorization: Bearer TOKEN`. Save each approved agency with its HighLevel location ID. User assignments in this Redis registry are an internal membership mirror only; they do not create or restrict HighLevel access. Invite users and assign their sub-accounts in HighLevel.

Example agency record fields:

    {
      "id": "demo",
      "name": "Dash Mortgage Automation Demo",
      "locationId": "GHL_LOCATION_ID",
      "portalBaseUrl": "https://login.dashmediaco.com",
      "status": "active"
    }

Example user assignment:

    {
      "action": "assign-user",
      "email": "client@example.com",
      "clientIds": ["demo"]
    }

An email can be mapped to multiple inventory records by listing their IDs in `clientIds`. Use an empty array to remove admin-managed inventory mappings for that email. Disabled or unknown agencies cannot be assigned. These records do not control which HighLevel sub-accounts a user can open.

## HighLevel user sync

The production poller reads HighLevel agency users for each location already registered in Dash and reconciles the per-email agency list in Redis. It runs once per minute at `/api/ghl-user-poll-sync` on Vercel Production. A new invite appears after HighLevel exposes that user through its Users API; confirm the exact pending-invite timing with the Demo account before promising instant access.

Create an agency Private Integration under HighLevel Settings > Private Integrations named `Dash Client Portal User Sync`. Grant only `users.readonly` and `locations.readonly`. Save its generated token as the server-side Vercel Production variable `GHL_PRIVATE_INTEGRATION_TOKEN`. Set a random `CRON_SECRET` in the same environment; Vercel sends it as a Bearer authorization header for scheduled requests. Never put either secret in client-side code or GitHub.

The sync mirrors membership when a HighLevel user's email or location membership changes. The Dash registry is now internal inventory only; it does not control sign-in or grant HighLevel access. HighLevel's own user and sub-account settings decide which workspaces a user can open. The poller does not auto-register every HighLevel subaccount: add an approved client location to the Dash registry first so internal, duplicate, or test locations do not enter the inventory.

The signed Marketplace webhook receiver at `POST /api/ghl-user-sync` remains available for a future Marketplace app, but no webhook subscription is required for the scheduled poller. The mirror is not part of the user-facing login flow.

## Main site

The homepage is https://dashmediaco.com/. The www hostname redirects to the canonical domain. The contact form posts to /api/contact and uses GHL_WEBHOOK_URL, which must remain a server-side environment variable.
