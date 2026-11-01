const sections: Array<{ title: string; items: string[] }> = [
  {
    title: "What Flow Typed does in your Google account",
    items: [
      "Creates a Google Doc when you ask it to, and inserts your text into the document you choose.",
      "Lists documents that Flow Typed created or that you opened through it, so you can pick one again.",
    ],
  },
  {
    title: "What it never does",
    items: [
      "It never sends email and has no email permission.",
      "It never shares documents, changes sharing settings, or invites collaborators.",
      "It never creates notifications of its own.",
      "It never asks for or stores your Google password. You sign in on Google's own page.",
    ],
  },
  {
    title: "Google permissions",
    items: [
      "Flow Typed asks for your basic profile (name and email, to show which account is connected) and the drive.file permission.",
      "drive.file covers only files you create with Flow Typed or choose in the Google Drive picker. It can't see the rest of your Drive.",
    ],
  },
  {
    title: "Where your data goes",
    items: [
      "Your text passes through this site's server only to reach Google, and isn't stored or logged by the app.",
      "Your draft is saved in this browser tab's session storage so it survives the Google sign-in redirect. It's removed when the tab closes.",
      "Google sign-in tokens are kept in an encrypted, HTTP-only cookie in your browser, not in a database. The app has no database.",
      "When you open the Drive picker, a short-lived access token limited to drive.file is passed to Google's picker in your browser.",
    ],
  },
  {
    title: "Notices from Google",
    items: [
      "Google may independently send you security or account notices, such as an email that a new app was connected to your account. Those come from Google, not Flow Typed, and the app can't turn them off.",
    ],
  },
  {
    title: "Disconnecting",
    items: [
      "Choose Disconnect to revoke Flow Typed's access and delete the cookie. You can also remove access at any time from your Google Account's third-party connections page.",
      "Documents already created stay in your Google Drive and are yours to keep or delete.",
    ],
  },
  {
    title: "Google API data",
    items: [
      "Flow Typed's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google data isn't sold, used for advertising, or used to train AI models.",
    ],
  },
];

export function PrivacyContent() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-muted">The short version: your words go to the document you pick, and nowhere else.</p>
      <div className="mt-8 space-y-7">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="font-semibold">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted">
              {s.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
