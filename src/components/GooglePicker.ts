"use client";

/* Minimal types for the parts of the Google Picker used here. */
interface PickerDoc { id: string; name: string }
interface PickerApi {
  ViewId: { DOCUMENTS: unknown };
  DocsViewMode: { LIST: unknown };
  Response: { ACTION: string; DOCUMENTS: string };
  Action: { PICKED: string; CANCEL: string };
  DocsView: new (id: unknown) => { setMode(m: unknown): unknown };
  PickerBuilder: new () => {
    addView(v: unknown): PickerBuilderChain;
  };
}
type PickerBuilderChain = {
  addView(v: unknown): PickerBuilderChain;
  setOAuthToken(t: string): PickerBuilderChain;
  setDeveloperKey(k: string): PickerBuilderChain;
  setAppId(a: string): PickerBuilderChain;
  setTitle(t: string): PickerBuilderChain;
  setCallback(c: (data: Record<string, unknown>) => void): PickerBuilderChain;
  build(): { setVisible(v: boolean): void };
};
declare global {
  interface Window {
    gapi?: { load(api: string, cb: () => void): void };
    google?: { picker: PickerApi };
  }
}

let loading: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
  loading ??= new Promise<PickerApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onerror = () => { loading = null; reject(new Error("load")); };
    script.onload = () => window.gapi!.load("picker", () => resolve(window.google!.picker));
    document.head.appendChild(script);
  });
  return loading;
}

/** Opens Google's own file chooser. Choosing a file is what grants this app drive.file access to it. */
export async function pickDocument(cfg: { apiKey: string; appId: string; accessToken: string }): Promise<PickerDoc | null> {
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCUMENTS);
    view.setMode(picker.DocsViewMode.LIST);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(cfg.accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle("Choose a Google Doc")
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          const doc = (data[picker.Response.DOCUMENTS] as PickerDoc[] | undefined)?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
