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

The signed webhook endpoint is `POST https://dashmediaco.com/api/ghl-user-sync`. Configure the Dash HighLevel Marketplace app's webhook subscriptions to send `UserCreate`, `UserUpdate`, and `UserDelete` events to that URL. HighLevel signs the raw request body with `X-GHL-Signature` (Ed25519); the endpoint verifies the signature before reading or applying the event.

The bridge matches the event's `locationId` to an agency record already saved in the Dash portal registry, then adds that event user's email to that agency. A user invited to multiple registered subaccounts receives each matching agency. Agency-wide events that have no single `locationId` are ignored, so they do not grant every client workspace. Unknown location IDs are rejected for retry until the agency record is registered. Register the client portal record before inviting its users.

`UserUpdate` refreshes the email-to-agency mapping if the user's email changes. `UserDelete` removes the HighLevel-managed mapping. Admin-managed assignments are stored separately and remain in place until an admin changes them. Redis uses the existing portal database settings; no HighLevel password or access token is stored by this bridge.

This synchronizes portal access; it does not create a Dash password or copy the HighLevel password. Users can choose Google sign-in if the invited email is their Google account. For email/password sign-in, a Dash admin must separately provision a Dash password. HighLevel's event documentation describes `UserCreate` as firing when a user is created but does not specify whether that means invite creation or invite acceptance, so verify the timing with the Demo subaccount before depending on it for an onboarding deadline.

## Main site

The homepage is https://dashmediaco.com/. The www hostname redirects to the canonical domain. The contact form posts to /api/contact and uses GHL_WEBHOOK_URL, which must remain a server-side environment variable.
