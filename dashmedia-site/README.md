# Dash Media Website

The Dash Media marketing website is a static page with Vercel serverless functions for the contact form and client portal.

## Client portal flow

1. A visitor selects Client Login and sees the Dash-branded sign-in page.
2. Google verifies the user's email. Dash creates a signed, HTTP-only session and opens the agency page.
3. The private agency API looks up that normalized email in Redis and returns only active agencies assigned to that user. Assignments can be added by an admin or synchronized from HighLevel user events. The page is always shown after sign-in, even when the user has one agency. There is no public Demo listing.
4. Selecting an agency calls a server route that checks the same assignment again, then opens the selected HighLevel location on the white-label domain.

Dash does not collect or store HighLevel passwords. HighLevel user and location permissions remain the final access control. Google sign-in to Dash does not automatically sign a user into HighLevel; configure HighLevel OIDC SSO separately if the second sign-in prompt should be removed.

## Vercel configuration

Keep these values server-side in Vercel Preview and Production:

- GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: Google OAuth web client credentials.
- PORTAL_SESSION_SECRET: at least 32 random bytes for signed sessions and OAuth state.
- CLIENT_PORTAL_ADMIN_TOKEN: a strong bearer token for the protected assignment API.
- GHL_PRIVATE_INTEGRATION_TOKEN: the agency Private Integration token with only users.readonly and locations.readonly.
- CRON_SECRET: a random secret Vercel uses to authenticate the scheduled sync request.
- GOOGLE_OAUTH_REDIRECT_URI: optional; defaults to https://dashmediaco.com/api/google-callback.
- Redis/KV REST URL and token: the existing Upstash or Vercel KV connection used for agency and user records.

Register the exact callback URL, https://dashmediaco.com/api/google-callback, in the Google OAuth client. The sign-in requests openid, email, and profile, and requires a verified email. Redeploy after changing Vercel environment variables.

## Agency records and user assignments

The protected POST endpoint is /api/client-portal-admin. Send the admin token as Authorization: Bearer TOKEN. First save an agency record with its HighLevel location ID. Then assign only the intended verified email addresses to that agency.

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

An email can be assigned to multiple agencies by listing their IDs in clientIds. Use an empty array to remove admin-managed Dash agency assignments for that email. Disabled or unknown agencies cannot be assigned. The Demo is not assigned to anyone by default; a user appears there only after an admin assigns them or the HighLevel bridge receives a matching subaccount user event.

## HighLevel user sync

The production poller reads HighLevel agency users for each location already registered in Dash and reconciles the per-email agency list in Redis. It runs once per minute at `/api/ghl-user-poll-sync` on Vercel Production. A new invite appears after HighLevel exposes that user through its Users API; confirm the exact pending-invite timing with the Demo account before promising instant access.

Create an agency Private Integration under HighLevel Settings > Private Integrations named `Dash Client Portal User Sync`. Grant only `users.readonly` and `locations.readonly`. Save its generated token as the server-side Vercel Production variable `GHL_PRIVATE_INTEGRATION_TOKEN`. Set a random `CRON_SECRET` in the same environment; Vercel sends it as a Bearer authorization header for scheduled requests. Never put either secret in client-side code or GitHub.

The sync updates access when a HighLevel user's email or location membership changes, and removes HighLevel-managed access when the user disappears from that location. Admin-managed Dash assignments remain separate. Disabled Dash client records have their HighLevel-managed access removed. The poller does not auto-register every HighLevel subaccount: add an approved client location to the Dash registry first so internal, duplicate, or test locations do not become client agencies.

The signed Marketplace webhook receiver at `POST /api/ghl-user-sync` remains available for a future Marketplace app, but no webhook subscription is required for the scheduled poller. Dash sign-in remains separate from HighLevel: Google sign-in uses the verified email to find agency access, and email/password accounts need a separately provisioned Dash password. Dash does not collect or store HighLevel passwords.

## Main site

The homepage is https://dashmediaco.com/. The www hostname redirects to the canonical domain. The contact form posts to /api/contact and uses GHL_WEBHOOK_URL, which must remain a server-side environment variable.
