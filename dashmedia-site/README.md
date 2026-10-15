# Dash Media Website

The Dash Media marketing website is a static page with Vercel serverless functions for the contact form and client portal.

## Client portal flow

1. A visitor selects Client Login and sees the Dash-branded sign-in page.
2. Google verifies the user's email. Dash creates a signed, HTTP-only session and opens the agency page.
3. The private agency API looks up that normalized email in Redis and returns only active agencies assigned to that user. The page is always shown after sign-in, even when the user has one agency. There is no public Demo listing.
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

An email can be assigned to multiple agencies by listing their IDs in clientIds. Use an empty array to remove all Dash agency assignments for that email. Disabled or unknown agencies cannot be assigned. The Demo is not assigned to anyone by default; add only the intended user emails through the protected API after the necessary credentials are configured.

## Main site

The homepage is https://dashmediaco.com/. The www hostname redirects to the canonical domain. The contact form posts to /api/contact and uses GHL_WEBHOOK_URL, which must remain a server-side environment variable.
