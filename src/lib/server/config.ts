export const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface GoogleConfig {
  appUrl: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  redirectUri: string;
  secureCookies: boolean;
}

/** Returns null until the app is fully configured, so the UI can say so instead of pretending. */
export function getConfig(): GoogleConfig | null {
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!appUrl || !clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32) return null;
  return {
    appUrl,
    clientId,
    clientSecret,
    sessionSecret,
    redirectUri: `${appUrl}/api/auth/google/callback`,
    secureCookies: appUrl.startsWith("https://"),
  };
}

export function getPickerConfig(): { apiKey: string; appId: string } | null {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_PROJECT_NUMBER;
  return apiKey && appId ? { apiKey, appId } : null;
}
