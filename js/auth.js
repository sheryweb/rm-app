// Sign-in with the RM's own Salesforce user (OAuth authorization code + PKCE, no secret).
// Tokens stay on this device only. Salesforce rotates the refresh token on every use and
// drops it after 30 days without use, so an RM who opens the app regularly stays signed in.
import { CONFIG } from "../config.js";

const TOKENS_KEY = "rmapp.tokens";
const PKCE_KEY = "rmapp.pkce";

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  if (value == null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function base64Url(bytes) {
  let text = "";
  bytes.forEach((b) => {
    text += String.fromCharCode(b);
  });
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

/** The app's own address without query or hash; must match a callback on the app registration. */
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

export function tokens() {
  return read(TOKENS_KEY);
}

export function isSignedIn() {
  const t = tokens();
  return Boolean(t && t.access_token && t.instance_url);
}

export async function startLogin() {
  const verifier = randomString(48);
  const state = randomString(16);
  // localStorage, not sessionStorage: an installed iPhone app may come back in a new context
  write(PKCE_KEY, { verifier, state });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.clientId,
    redirect_uri: redirectUri(),
    scope: CONFIG.scopes,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256"
  });
  location.assign(CONFIG.loginUrl + "/services/oauth2/authorize?" + params);
}

async function tokenRequest(fields) {
  let response;
  try {
    response = await fetch(CONFIG.loginUrl + "/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CONFIG.clientId, ...fields })
    });
  } catch (e) {
    const error = new Error("Salesforce could not be reached.");
    error.code = "network";
    throw error;
  }
  let body = {};
  try {
    body = await response.json();
  } catch (e) {
    // not JSON: handled below through response.ok
  }
  if (!response.ok || !body.access_token) {
    const error = new Error(
      body.error_description || body.error || "Sign-in failed"
    );
    // no OAuth answer at all = Salesforce itself is having trouble, not a refused login
    error.code = body.error || "unavailable";
    throw error;
  }
  return body;
}

/** Removes the login saved on this device (the sign-in screen shows on the next step). */
export function forgetLogin() {
  write(TOKENS_KEY, null);
}

/** True when a failed token request says nothing about the login itself (offline, outage). */
export function isTemporary(error) {
  return Boolean(
    error && (error.code === "network" || error.code === "unavailable")
  );
}

/** True when Salesforce refused the login because the user was deactivated. */
export function isInactiveUser(error) {
  const all = (
    String((error && error.code) || "") +
    " " +
    String((error && error.message) || "")
  ).toLowerCase();
  return all.includes("inactive user") || all.includes("inactive_user");
}

/**
 * Finishes a login when Salesforce has sent the user back with ?code=...
 * Returns true when a login was completed, false when this was a normal page load.
 */
export async function completeLoginIfReturning() {
  const query = new URLSearchParams(location.search);
  if (!query.has("code") && !query.has("error")) {
    return false;
  }
  const pkce = read(PKCE_KEY);
  write(PKCE_KEY, null);
  history.replaceState(null, "", redirectUri() + location.hash);
  if (query.has("error")) {
    const error = new Error(
      query.get("error_description") || query.get("error")
    );
    error.code = query.get("error");
    throw error;
  }
  if (!pkce || pkce.state !== query.get("state")) {
    const error = new Error(
      "The sign-in did not start on this device. Please tap Sign in and try again."
    );
    error.code = "own";
    throw error;
  }
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code: query.get("code"),
    redirect_uri: redirectUri(),
    code_verifier: pkce.verifier
  });
  write(TOKENS_KEY, {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    instance_url: body.instance_url
  });
  return true;
}

const ADMIN = "Please tell the Salesforce admin.";

/**
 * Salesforce answers a failed sign-in in its own technical words ("invalid client
 * credentials"), which a user reads as "my password is wrong". This says in plain words what
 * happened and who has to act; the technical words are kept as `detail` for the admin.
 */
export function explainLoginError(error) {
  const code = String((error && error.code) || "");
  const text = String((error && error.message) || "");
  const all = (code + " " + text).toLowerCase();
  const has = (...words) => words.some((word) => all.includes(word));
  if (code === "own") {
    return { message: text, detail: "" };
  }
  let message;
  if (code === "network") {
    message =
      "Salesforce could not be reached. Check your internet connection and try again. If it keeps happening, tell the Salesforce admin.";
  } else if (has("not admin approved", "app_access_denied", "app_blocked")) {
    message =
      "Your Salesforce user does not have access to this app yet. Ask the Salesforce admin to give you RM App Access.";
  } else if (has("ip restricted", "login hours")) {
    message =
      "Salesforce does not allow your user to sign in from this network or at this time. " +
      ADMIN;
  } else if (has("inactive user", "inactive_user", "inactive_org")) {
    message = "Your Salesforce user is not active. " + ADMIN;
  } else if (code === "access_denied") {
    message =
      "The app was not allowed to connect. Tap Sign in again and choose Allow.";
  } else if (
    has("invalid_client", "redirect_uri", "unsupported_", "invalid_scope")
  ) {
    message =
      "Your username and password are fine. The app itself is not set up correctly in Salesforce. " +
      ADMIN;
  } else if (code === "invalid_grant") {
    message =
      "The sign-in took too long or was opened twice. Please tap Sign in and try again.";
  } else {
    message =
      "The sign-in did not finish. Please try again. If it keeps happening, tell the Salesforce admin.";
  }
  const detail =
    code === "network"
      ? ""
      : [code, text]
          .filter((part, i, list) => part && list.indexOf(part) === i)
          .join(": ");
  return { message, detail };
}

let refreshing = null;

/** Gets a fresh access token; many callers share one request. Rejects when the login is gone. */
export function refreshAccessToken() {
  if (!refreshing) {
    refreshing = (async () => {
      let current = tokens();
      for (;;) {
        if (!current || !current.refresh_token) {
          const error = new Error("Please sign in again.");
          error.code = "own";
          throw error;
        }
        try {
          const body = await tokenRequest({
            grant_type: "refresh_token",
            refresh_token: current.refresh_token
          });
          write(TOKENS_KEY, {
            access_token: body.access_token,
            // rotation: Salesforce sends a new refresh token and retires the old one
            refresh_token: body.refresh_token || current.refresh_token,
            instance_url: body.instance_url || current.instance_url
          });
          return;
        } catch (e) {
          if (isTemporary(e)) {
            // a network or server hiccup says nothing about the login: keep it
            throw e;
          }
          // Another window of the app may have renewed the login while this one was asking
          // (they share the saved login). Then the refusal was for the old key only: go on
          // with the newer one instead of signing the user out of both windows.
          const latest = tokens();
          if (
            latest &&
            latest.refresh_token &&
            latest.refresh_token !== current.refresh_token
          ) {
            current = latest;
            continue;
          }
          // A real refusal by Salesforce (deactivated user, revoked or expired login, access
          // taken away) ends the login on this device.
          forgetLogin();
          throw e;
        }
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function signOut() {
  const current = tokens();
  write(TOKENS_KEY, null);
  if (current && (current.refresh_token || current.access_token)) {
    try {
      await fetch(CONFIG.loginUrl + "/services/oauth2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: current.refresh_token || current.access_token
        })
      });
    } catch (e) {
      // offline or blocked: the device copy is already gone
    }
  }
}
