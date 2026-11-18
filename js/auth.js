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
  const response = await fetch(CONFIG.loginUrl + "/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CONFIG.clientId, ...fields })
  });
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
    error.code = body.error;
    throw error;
  }
  return body;
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
    throw new Error(query.get("error_description") || query.get("error"));
  }
  if (!pkce || pkce.state !== query.get("state")) {
    throw new Error(
      "The sign-in did not start on this device. Please try again."
    );
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

let refreshing = null;

/** Gets a fresh access token; many callers share one request. Rejects when the login is gone. */
export function refreshAccessToken() {
  if (!refreshing) {
    refreshing = (async () => {
      const current = tokens();
      if (!current || !current.refresh_token) {
        throw new Error("Please sign in again.");
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
      } catch (e) {
        if (e.code === "invalid_grant") {
          write(TOKENS_KEY, null);
        }
        throw e;
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
