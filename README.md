# react-native-axios-inspector

A floating, dev-only network inspector for React Native apps that use axios. See every request and
response live, search and filter them, inspect full detail, and copy a repro as cURL — without a proxy
(Charles/Proxyman) or an attached debugger. Especially useful on Hermes, where Chrome DevTools can't see
network traffic directly.

## Features

- **Floating overlay, zero setup UI** — a free-floating bug button lives on top of your app; tap it to
  open a live, scrollable log of every request your app has made.
- **Drag it anywhere** — the button can be dragged to any corner or edge of the screen (it's kept fully
  on-screen and clear of safe-area insets), and stays wherever it's dropped for the rest of the session.
  Built on React Native's own `Animated`/`PanResponder`, so this doesn't add a dependency.
- **Works with multiple axios instances** — attach it per-client with a `scope` label (`"My API"`,
  `"Billing API"`, …) so logs from different backends stay distinguishable.
- **Search and filter** — filter by `All` / `Errors` / `Pending`, or search by URL, method, or status code.
- **Clear logs** — a "Clear" action in the log list header wipes every stored entry (calls `clearApiLogs()`
  under the hood), so you can start a clean trace without reloading the app.
- **Structured detail view** — tapping a row opens a summary card (method badge, status pill, duration,
  URL, error message) followed by bordered, monospaced sections for params, body, request headers,
  response, and response headers — all selectable for copy.
- **Copy any section** — each detail section (params, body, request headers, response, response headers)
  has its own "Copy" action, so you can grab and share just the piece you need — e.g. just the response
  body for a bug report — without hand-selecting text.
- **Copy as cURL** — turn any logged request into a ready-to-run `curl` command, including its query
  params (axios keeps those separate from the URL internally — this folds them back in so the repro is
  complete), with secrets already redacted. Uses a real clipboard if you wire one up, otherwise falls back
  to the native share sheet.
- **Automatic secret redaction** — headers, body, and response are recursively scanned by key name
  (`password`, `token`, `authorization`, `apiKey`, `secret`, …) and masked before anything is stored.
- **Error and pending badges** — the floating button badges itself with the error count (or total count if
  there are no errors), so you notice failures without opening the log.
- **Dev-only by construction** — `attachApiLogger` never registers interceptors unless running in a dev
  environment (or `enabled: true` is passed explicitly), so it costs nothing at runtime in a release build.
- **Zero native dependencies** — no icon library, no `safe-area-context`, no clipboard module. The whole
  package is `react` + `react-native` + `axios` (peer dependencies you already have). No autolinking, no
  `pod install`, no Gradle step — it works in plain Expo Go, not just a dev client.
- **Long-press to hide** — long-press (without dragging) the floating button to dismiss it for the
  session, no code change needed.
- **Long-press to dismiss an error row** — long-press the ⚠️ icon next to an error row's status to drop
  just that row from the visible list. This only hides it from the current view (it's not deleted from
  the store, and doesn't affect the error badge count) — it reappears the next time the overlay's
  component remounts (an app reload, or a Fast Refresh that resets its state).

## Table of contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
  - [`attachApiLogger` options](#attachapilogger-options)
  - [`ApiInspector` props](#apiinspector-props)
- [API reference](#api-reference)
- [Enabling it in a specific build (e.g. a QA release APK)](#enabling-it-in-a-specific-build-eg-a-qa-release-apk)
- [Security note](#security-note)
- [Why no icon library / safe-area-context / clipboard?](#why-no-icon-library--safe-area-context--clipboard)

## Install

Not published to the npm registry yet — install directly from GitHub:

```bash
npm install git+https://github.com/raeeznazar/react-native-axios-inspector.git
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

Mount the overlay once, at the app root, after your providers/navigation. You don't need to gate it
yourself — leave `enabled` unset and it defaults to a dev-environment check:

```tsx
import { ApiInspector } from "react-native-axios-inspector";

export default function App() {
  return (
    <>
      <RootNavigator />
      <ApiInspector />
    </>
  );
}
```

Tap the floating bug button to open the live log. Long-press it to hide it for the session (no code
change needed). Long-press the ⚠️ icon on an error row to drop just that row from the list until the next
reload. Tap any row for the full, structured request/response detail — each section (params, body,
headers, response) has its own "Copy" action, and the header's "Copy as cURL" reproduces the whole
request, query params included. Use "Clear" in the header to wipe all stored logs.

## Options

### `attachApiLogger` options

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

| Option         | Type       | Default                   | Description                                                      |
| -------------- | ---------- | -------------------------- | ------------------------------------------------------------------ |
| `redactKeys`   | `string[]` | built-in list (see above) | Lower-cased substrings matched against object keys to mask values. |
| `maxBodyBytes` | `number`   | `50_000`                  | Truncates stored/rendered body text past this length.              |
| `enabled`      | `boolean`  | dev-environment check     | Force on/off regardless of environment.                            |

### `ApiInspector` props

```tsx
<ApiInspector
  position="bottom-right" // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  insets={{ bottom: 24 }} // pass your app's safe-area insets if you have them
  onCopyToClipboard={(text) => Clipboard.setString(text)} // optional: wire a real clipboard module
/>
```

| Prop                | Type                                                              | Default          | Description                                                                 |
| ------------------- | ------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| `enabled`           | `boolean`                                                         | dev-environment check | Force the overlay on/off.                                                 |
| `insets`            | `{ top?, bottom?, left?, right? }`                                | `{}`              | Your app's safe-area insets; the button uses a fixed offset without them.  |
| `position`          | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"`      | `"bottom-right"`  | Starting corner for the button. It's draggable to anywhere on screen afterward and stays put for the session. |
| `onCopyToClipboard` | `(text: string) => void`                                          | —                 | Wire a real clipboard module; without it, "Copy as cURL" opens the native share sheet. |

Without `onCopyToClipboard`, "Copy as cURL" opens the native share sheet instead (`Share.share`, part of
`react-native` core — no extra dependency).

## API reference

Everything the package exports:

| Export                 | Kind      | Purpose                                                                 |
| ----------------------- | --------- | ------------------------------------------------------------------------ |
| `attachApiLogger`      | function  | Wires request/response/error logging into one axios instance's interceptors. The only call most apps need. |
| `ApiInspector`         | component | The floating overlay + log viewer. Mount once at the app root.          |
| `logApiRequest`        | function  | Lower-level: records a pending log entry for a request config.          |
| `logApiResponse`       | function  | Lower-level: patches a pending entry with a successful response.        |
| `logApiError`          | function  | Lower-level: patches a pending entry with an error/failure.             |
| `addApiLog`            | function  | Lower-level store write: appends a new log entry, returns its id.       |
| `updateApiLog`         | function  | Lower-level store write: patches an existing entry by id.               |
| `getApiLogs`           | function  | Returns the current in-memory log array (most recent first).            |
| `subscribeApiLogs`     | function  | Subscribes to log changes; returns an unsubscribe function.             |
| `clearApiLogs`         | function  | Clears all stored logs.                                                 |
| `ApiInspectorOptions`  | type      | Options accepted by `attachApiLogger`.                                  |
| `ApiInspectorProps`    | type      | Props accepted by `<ApiInspector />`.                                   |
| `ApiInspectorInsets`   | type      | Shape of the `insets` prop.                                             |
| `ApiLogEntry`          | type      | Shape of one stored log entry.                                          |

`logApiRequest`, `logApiResponse`, `logApiError`, and the store functions are exported for advanced use
(e.g. wiring up a non-axios client); most apps only need `attachApiLogger` and `ApiInspector`.

The in-memory store keeps the most recent **200** entries; older ones are dropped automatically.

## Enabling it in a specific build (e.g. a QA release APK)

By default `enabled` resolves to a dev-environment check (`__DEV__`, falling back to
`NODE_ENV !== "production"`), so a normal release/production build already has it off with zero runtime
cost — the interceptors are never even registered. Pass `enabled: true` / `enabled={true}` to force it on
regardless of environment, and `enabled: false` to force it off even in a dev build.

This package doesn't read any env var itself — it only takes a plain `boolean`, because it's meant to drop
into any RN/Expo project regardless of that project's own build-flag conventions. To make it configurable
per build (e.g. "on" for a QA handoff APK, "off" for the real production build), compute the boolean once
in your own app and reuse it for both the client wiring and the overlay:

```ts
// In an Expo app: EXPO_PUBLIC_-prefixed vars are inlined into the JS bundle at build time, so this
// resolves to a fixed true/false baked into that specific build — not something toggled at runtime
// after the app is installed. Set EXPO_PUBLIC_ENABLE_API_INSPECTOR=true in .env before building a
// QA APK, and remove it (or set it to "false") before a real production build.
export const API_INSPECTOR_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_API_INSPECTOR === "true";
```

```ts
attachApiLogger(apiClient, "My API", { enabled: API_INSPECTOR_ENABLED });
```

```tsx
<ApiInspector enabled={API_INSPECTOR_ENABLED} />
```

Each built APK/IPA gets whichever value the flag had at build time, permanently — there's no in-app switch
to flip it later. Need both an "inspector on" QA build and an "inspector off" production build? Set the
flag, build, then change it and build again; that's two separate artifacts, not one build with a toggle.

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

## License

MIT © Raeez
