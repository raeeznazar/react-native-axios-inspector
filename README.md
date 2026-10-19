# react-native-axios-inspector

A floating, dev-only network inspector for React Native apps that use axios. See every
request/response live, search and filter them, inspect full detail, and copy a repro as cURL — without a
proxy (Charles/Proxyman) or an attached debugger. Useful on Hermes, where Chrome DevTools can't see network
traffic directly.

**Zero native dependencies.** No icon library, no `safe-area-context`, no clipboard module — the whole
thing is `react` + `react-native` + `axios` (all peer dependencies you already have). That means no
autolinking, no pod install, no gradle step, and it works in plain Expo Go, not just a dev client. There is
nothing version-sensitive here to break on a future RN or Expo bump.

It is dev-only by construction: `attachApiLogger` never registers interceptors unless running in a dev
environment (or `enabled: true` is passed explicitly), so there is no runtime cost in a release build.

## Install

```bash
npm install react-native-axios-inspector
```

`axios`, `react`, and `react-native` are peer dependencies — install them if your project doesn't already
have them (it almost certainly does).

## Usage

For every axios instance your app creates, attach the logger once:

```ts
import axios from "axios";
import { attachApiLogger } from "react-native-axios-inspector";

export const apiClient = axios.create({ baseURL: "https://api.example.com" });
attachApiLogger(apiClient, "My API");

export const billingClient = axios.create({
  baseURL: "https://billing.example.com",
});
attachApiLogger(billingClient, "Billing API");
```

Mount the overlay once, at the app root, after your providers/navigation:

```tsx
import { ApiInspector } from "react-native-axios-inspector";

export default function App() {
  return (
    <>
      <RootNavigator />
      {__DEV__ ? <ApiInspector /> : null}
    </>
  );
}
```

Tap the floating bug button to open the live log. Long-press it to hide it for the session (no code
change needed). Tap any row for full request/response detail, including a "Copy as cURL" action.

## Options

```ts
attachApiLogger(apiClient, "My API", {
  // Extra key-name substrings to mask, in addition to the built-in list
  // (password, otp, token, pin, cvv, secret, authorization, apiKey, accessToken, refreshToken, clientSecret, ...).
  redactKeys: ["ssn"],
  // Truncate stored/rendered body text past this length (default 50_000 chars).
  maxBodyBytes: 20_000,
  // Overrides the dev-environment check.
  enabled: true,
});
```

```tsx
<ApiInspector
  position="bottom-right" // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  insets={{ bottom: 24 }} // pass your app's safe-area insets if you have them
  onCopyToClipboard={(text) => Clipboard.setString(text)} // optional: wire a real clipboard module
/>
```

Without `onCopyToClipboard`, "Copy as cURL" opens the native share sheet instead (`Share.share`, part of
`react-native` core — no extra dependency).

## Security note

Redaction runs on headers, request body, and response body before anything is stored, recursively, by key
name. That means the cURL export will contain `«redacted»` in place of real secrets — you'll need to paste
a live token back in by hand for endpoints that require auth. That's a deliberate tradeoff: it's the
export action, which is the most likely thing to end up pasted into a chat or a ticket.

## Why no icon library / safe-area-context / clipboard?

Those are the dependencies that actually break across RN/Expo versions (native linking, autolinking,
duplicate native module versions). Avoiding them entirely means this package has nothing to maintain as
your other projects' RN/Expo versions move forward — only `react`, `react-native`, and `axios` as peer
deps, all using APIs that have been stable for years.
