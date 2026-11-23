// Calls the RmAppApi services in Salesforce as the signed-in RM.
import { CONFIG } from "../config.js";
import { tokens, refreshAccessToken } from "./auth.js";

export class SignedOutError extends Error {}

const SIGNED_OUT = "Your sign-in has ended. Please sign in again.";

/** Sends a request with the RM's token; when the token has expired, renews it once and retries. */
async function authorized(buildUrl, options) {
  const attempt = () => {
    const t = tokens();
    if (!t) {
      throw new SignedOutError("Please sign in.");
    }
    return fetch(buildUrl(t.instance_url), {
      ...options,
      headers: {
        ...(options && options.headers),
        Authorization: "Bearer " + t.access_token
      }
    }).catch(() => {
      // the browser only says "Failed to fetch": say what it means
      throw new Error(
        "Salesforce could not be reached. Check your internet connection and try again."
      );
    });
  };
  let response = await attempt();
  if (response.status === 401) {
    try {
      await refreshAccessToken();
    } catch (e) {
      throw new SignedOutError(SIGNED_OUT);
    }
    response = await attempt();
    if (response.status === 401) {
      throw new SignedOutError(SIGNED_OUT);
    }
  }
  return response;
}

async function readJson(response) {
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
    if (response.status === 403 && !message) {
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

export async function get(route, params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });
  const text = query.toString();
  const response = await authorized(
    (base) => base + CONFIG.apiPath + route + (text ? "?" + text : "")
  );
  return readJson(response);
}

export async function post(route, body) {
  const response = await authorized((base) => base + CONFIG.apiPath + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return readJson(response);
}

/**
 * Reads from Salesforce's own data services (record + page layout) as the signed-in RM, so the
 * RM gets exactly the fields, labels and records Salesforce itself would show that user.
 */
export async function data(path) {
  const response = await authorized(
    (base) => base + "/services/data/v62.0/" + path
  );
  return readJson(response);
}

/**
 * Creates (POST) or updates (PATCH) a record through Salesforce's own data services as the
 * signed-in RM: Salesforce's permissions, validation rules and triggers all apply as usual.
 */
export async function change(method, path, body) {
  const response = await authorized(
    (base) => base + "/services/data/v62.0/" + path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }
  );
  if (response.ok) {
    return response.status === 204 ? null : response.json();
  }
  let answer = null;
  try {
    answer = await response.json();
  } catch (e) {
    // no readable answer
  }
  const first = Array.isArray(answer) ? answer[0] : answer;
  const output = (first && first.output) || {};
  const lines = (output.errors || []).map((error) => error.message);
  Object.values(output.fieldErrors || {}).forEach((list) =>
    list.forEach((error) =>
      lines.push(
        (error.fieldLabel ? error.fieldLabel + ": " : "") + error.message
      )
    )
  );
  throw new Error(
    lines.filter(Boolean).join(" ") ||
      (first && first.message) ||
      "The record could not be saved (" + response.status + ")."
  );
}

/** Downloads a Salesforce file (by ContentVersion id) with the RM's login; returns a File. */
export async function downloadFile(contentVersionId, fileName, mimeType) {
  const response = await authorized(
    (base) =>
      base +
      "/services/data/v61.0/sobjects/ContentVersion/" +
      encodeURIComponent(contentVersionId) +
      "/VersionData"
  );
  if (!response.ok) {
    throw new Error(
      "The file could not be downloaded (" + response.status + ")."
    );
  }
  const bytes = await response.arrayBuffer();
  return new File([bytes], fileName, { type: mimeType });
}
