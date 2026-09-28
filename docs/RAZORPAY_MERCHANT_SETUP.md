# Connect your Razorpay account to FinFam

This implementation connects one owner-managed merchant account using server-side API keys. It does not implement partner OAuth, personal bank access, or RazorpayX payouts. Entering an email or merchant ID does not establish a connection.

## Setup

1. Rotate the Razorpay keys previously hardcoded in this repository if they were real. Removing them from source does not revoke them or erase Git history.
2. Configure the backend variables in `server/.env.example` through your host's secret settings. Use test keys first. Never put secrets in a frontend build or APK.
3. Configure Firebase Admin credentials for the same project as `src/lib/firebase.ts`. Enable Google sign-in in Firebase Authentication and authorise your app domain. Put your actual Firebase Authentication UID in `RAZORPAY_ADMIN_UIDS`.
4. Configure Firestore and deny all direct client access to `razorpayMerchantEvents` and `razorpayMerchantSync`. Only Admin SDK access is required. Review any existing broad Firestore allow rules: a more specific deny cannot override an overlapping allow.
5. Run the backend with `npm --prefix server install` then `npm --prefix server start`. Run the frontend with `npm ci` then `npm run dev`. The existing Vite proxy forwards `/api` to port 8080.
6. Open Payments → Razorpay merchant account → Sign in to connect / verify. Connection is reported only after a successful provider API request. Family profile selection is not merchant authentication.
7. In Razorpay configure the public HTTPS webhook URL `https://YOUR_HOST/api/razorpay/merchant/webhook`, using the exact `RAZORPAY_WEBHOOK_SECRET`. Subscribe to relevant payment and refund events. Test delivery before switching modes.
8. Switch to activated live-account API keys only after sandbox verification. Restart/redeploy the backend after changing secrets. A successful API check does not itself prove live checkout activation.

## Behaviour

- Fetches 25 actual payments per page directly from Razorpay. Shows amount, status, method, date and refunded amount. No bank or available balance is inferred.
- Refreshes every 15 seconds while mounted, with manual refresh. This is polling, not an instant push guarantee. Watch Razorpay rate limits when adding concurrent administrators.
- Webhook signatures are checked over original bytes, and receipts are deduplicated transactionally in Firestore. Firebase Functions rawBody is supported. No payment state is derived from webhook order: the dashboard fetches current provider state each time.
- If Firestore is unavailable webhook delivery returns 503 for provider retry. The dashboard shows the last receipt timestamp when available.
- Sign out removes the current viewer session; it does not revoke Razorpay API credentials. To disconnect the integration, revoke the key in Razorpay and remove backend credentials.
- Historical mock wallets and other legacy app features are separate from this new merchant panel. This change does not certify the legacy premium, refunds or family transfer flows for production. Do not expose those legacy financial endpoints as a production service without a separate authentication and payment-state audit.
- The UI is added to the root React/Vite app. The separate `mobile/` Expo source has not been migrated by this change. No APK is produced.

## Hosting

The module is mirrored under `functions/server/` for the existing Firebase Functions package. Supply environment variables/secret bindings using your hosting configuration. The root deployment dependencies now include `firebase-admin` for the existing Vercel server entry point. The root lockfile has also been refreshed to include the existing Firebase client dependency. No deployment or live credentials are included in this PR.

## Verification

Run `node --test server/test/razorpayMerchant.test.js` and `npm run build`.

Official references:
- https://razorpay.com/docs/api/payments/
- https://razorpay.com/docs/webhooks/validate-test/
