# Flow Typed

Paste an essay, connect a Google account, and send the text to a new or existing Google Doc with its formatting intact.

Built with Next.js, TypeScript and Tailwind CSS, on the official Google OAuth 2.0, Docs and Drive APIs.

## Run it

Needs Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
openssl rand -base64 48      # paste the result into SESSION_SECRET in .env.local
npm run dev                  # http://localhost:3000
```

Without Google credentials the site runs and shows "Setup needed" in place of the sign-in button.

## Set up Google (about 10 minutes)

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project and note its **project number**.
2. Under **APIs & Services > Library**, enable the **Google Docs API**, **Google Drive API** and **Google Picker API**.
3. Under **Google Auth Platform**, configure the consent screen. Add the scope `https://www.googleapis.com/auth/drive.file`. While the app is in Testing, add your Google address as a **test user**.
4. Under **Credentials**, create an **OAuth client ID** of type **Web application**:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`

   Put the ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Under **Credentials**, create an **API key** for `GOOGLE_PICKER_API_KEY`. Restrict it to the Picker API, and to these website referrers: your site and `https://docs.google.com/*`.
6. Put the project number in `GOOGLE_PROJECT_NUMBER` and restart the dev server.

To deploy, set `APP_URL` to your https address, add the matching origin and redirect URI to the OAuth client, and move the consent screen out of Testing. Public apps may need Google's brand verification. The privacy page is at `/privacy`; add your contact details there before publishing.

## How it works

| Topic | Approach |
| --- | --- |
| Permissions | Only `openid email profile` and `drive.file`. The app can reach only documents it created or that you chose in Google's Picker. There's no Gmail or Drive-wide access. |
| Sessions | No database. Tokens live in an AES-256-GCM encrypted, HttpOnly, SameSite=Lax cookie. Sign-in uses PKCE and a state check. |
| Sending | All text and formatting go in one `documents.batchUpdate`, which Google applies atomically. `requiredRevisionId` stops a write if the document changed after it was read; the app then re-reads and retries. Failed writes aren't blindly repeated, which avoids double insertion. |
| Progress | The send route streams real stages (creating, reading, writing). The bar shows stages, not a timer. |
| Formatting kept | Headings, bold, italic, underline, strikethrough, links, bullets and numbers with nesting, alignment, quotes, code, line breaks. |
| Not kept | Images and tables (table text becomes paragraphs), colors and font sizes. Horizontal rules become `* * *`. A nested list that mixes bullets and numbers uses its top level's style. |
| Paste safety | Pasted HTML is parsed inertly and rebuilt from an allow-list. Scripts, images and `javascript:` links never reach the page. |

The app calls only Google's token, revoke, Docs (`documents.create`, `get`, `batchUpdate`) and Drive (`files.list`) endpoints. It has no code for email, sharing, permissions or comments. Google may independently send its own security notices.

## Tests

```bash
npm test            # converter, validation, encryption, PKCE
npm run typecheck
npm run test:e2e    # real route handlers and components in Chromium, against a strict fake of Google
```

`test:e2e` needs Playwright's browser (`npx playwright install chromium`). It uses esbuild and the Tailwind compiler rather than `next build`, so also run `npm run build`.
