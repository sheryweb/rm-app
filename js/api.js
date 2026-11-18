// Calls the RmAppApi services in Salesforce as the signed-in RM.
import { CONFIG } from "../config.js";
import { tokens, refreshAccessToken } from "./auth.js";

export class SignedOutError extends Error {}

async function send(route, params) {
  const t = tokens();
  if (!t) {
    throw new SignedOutError("Please sign in.");
  }
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });
  const text = query.toString();
  return fetch(
    t.instance_url + CONFIG.apiPath + route + (text ? "?" + text : ""),
    { headers: { Authorization: "Bearer " + t.access_token } }
  );
}

export async function get(route, params) {
  let response = await send(route, params);
  if (response.status === 401) {
    try {
      await refreshAccessToken();
    } catch (e) {
      throw new SignedOutError("Your sign-in has ended. Please sign in again.");
    }
    response = await send(route, params);
  }
  let body = null;
  try {
    body = await response.json();
  } catch (e) {
    // empty or non-JSON answer
  }
  if (!response.ok) {
    const message = Array.isArray(body)
      ? body[0] && body[0].message
      : body && body.error;
    if (response.status === 401) {
      throw new SignedOutError("Your sign-in has ended. Please sign in again.");
    }
    if (response.status === 403) {
      throw new Error(
        "Your user is not set up for this app yet. Ask the Salesforce admin for RM App Access."
      );
    }
    throw new Error(
      message || "Something went wrong (" + response.status + ")."
    );
  }
  return body;
}
