// MIRA RM app: screens and navigation. Read-only in step 1 (dashboard, leads, deals, units).
import { CONFIG } from "../config.js";
import {
  isSignedIn,
  startLogin,
  completeLoginIfReturning,
  explainLoginError,
  signOut
} from "./auth.js";
import {
  get,
  post,
  data,
  change,
  downloadFile,
  SignedOutError
} from "./api.js";

const root = document.getElementById("app");
const PAGE_SIZE = 25;
let me = null;
let renderToken = 0;
let scrollWatcher = null;
/** The screen shown before Send Feedback was opened: sent along with the feedback. */
let lastScreen = "";
/** How many requests wait for this user's decision: the badge on the profile button. */
let waitingCount = 0;

// ------------------------------------------------------------------ helpers

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

function money(value, currency) {
  if (value == null) {
    return "Price on request";
  }
  return (currency ? currency + " " : "") + wholeNumber.format(value);
}

function shortDate(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function dateTime12(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function days(count) {
  return count === 1 ? "1 day" : (count || 0) + " days";
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }
  return hour < 17 ? "Good afternoon" : "Good evening";
}

function routeNow() {
  const [path, query] = (location.hash.replace(/^#\/?/, "") || "home").split(
    "?"
  );
  return { path, params: new URLSearchParams(query || "") };
}

function go(path, params) {
  const query = new URLSearchParams(params || {}).toString();
  location.hash = "#/" + path + (query ? "?" + query : "");
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// -------------------------------------------------------------------- badge

function badge(count) {
  return count > 0
    ? `<span class="badge">${count > 99 ? "99+" : count}</span>`
    : "";
}

/** Shows the count on the profile button and, where the phone allows it, on the app icon. */
function setWaiting(count) {
  waitingCount = count || 0;
  const button = document.querySelector(".avatar-button");
  if (button) {
    const old = button.querySelector(".badge");
    if (old) {
      old.remove();
    }
    button.insertAdjacentHTML("beforeend", badge(waitingCount));
  }
  try {
    if (waitingCount > 0 && navigator.setAppBadge) {
      navigator.setAppBadge(waitingCount).catch(() => {});
    } else if (!waitingCount && navigator.clearAppBadge) {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch (e) {
    // the phone has no icon badge: the one inside the app is enough
  }
}

/** Asks Salesforce again; a failure leaves the last known count in place. */
async function refreshWaiting() {
  if (!me || !isSignedIn() || document.visibilityState !== "visible") {
    return;
  }
  try {
    setWaiting((await get("approvals")).length);
  } catch (e) {
    // offline or signed out: the next screen will say so
  }
}

// -------------------------------------------------------------------- shell

const TABS = [
  {
    path: "home",
    label: "Home",
    icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
  },
  {
    path: "leads",
    label: "Leads",
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0z"
  },
  { path: "deals", label: "Deals", icon: "M4 7h16v13H4zM9 7V4h6v3" },
  {
    path: "clients",
    label: "Clients",
    icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-7 9a7 7 0 0 1 14 0zm14-9a3 3 0 1 0 0-6m2 15h4a6 6 0 0 0-6-6"
  },
  {
    path: "units",
    label: "Units",
    icon: "M4 21V5l8-3 8 3v16zM9 9h2m2 0h2M9 13h2m2 0h2M9 17h2m2 0h2"
  }
];

/** options.back = hash to return to: shows a back arrow instead of the profile button. */
function shell(title, body, activePath, options) {
  const back = options && options.back;
  const tabs = TABS.map(
    (tab) => `
      <a class="tab${tab.path === activePath ? " is-active" : ""}" href="#/${tab.path}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${tab.icon}"/></svg>
        <span>${tab.label}</span>
      </a>`
  ).join("");
  const lead = back
    ? `<a class="icon-button" href="${esc(back)}" aria-label="Back">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
       </a>`
    : `<a class="icon-button avatar-button" href="#/me" aria-label="My profile">${esc(
        ((me && me.name) || "?").slice(0, 1)
      )}${badge(waitingCount)}</a>`;
  root.innerHTML = `
    <header class="topbar">
      ${lead}
      <h1>${esc(title)}</h1>
      <button class="icon-button" id="refresh" aria-label="Refresh">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg>
      </button>
    </header>
    <main class="screen" id="screen">${body}</main>
    <nav class="tabbar">${tabs}</nav>`;
  document.getElementById("refresh").addEventListener("click", render);
}

function loading() {
  return `<div class="loading"><span class="spinner"></span></div>`;
}

function errorBox(message) {
  return `<div class="notice notice-error">${esc(message)}</div>`;
}

function emptyBox(message) {
  return `<div class="notice">${esc(message)}</div>`;
}

function chips(options, selected, attribute) {
  return `<div class="chips">${options
    .map(
      (o) =>
        `<button class="chip${o.key === selected ? " is-active" : ""}" data-${attribute}="${esc(o.key)}">${esc(o.label)}${
          o.count == null ? "" : ` <b>${o.count}</b>`
        }</button>`
    )
    .join("")}</div>`;
}

/** Loads page after page into `listEl` as the user scrolls near the end. */
function infiniteList(listEl, loadPage, renderRow, emptyMessage, token) {
  let offset = 0;
  let busy = false;
  let done = false;
  const sentinel = document.createElement("div");
  sentinel.className = "sentinel";
  listEl.after(sentinel);

  async function more() {
    if (busy || done || token !== renderToken) {
      return;
    }
    busy = true;
    sentinel.innerHTML = loading();
    try {
      const page = await loadPage(offset);
      if (token !== renderToken) {
        return;
      }
      const rows = page.rows || [];
      listEl.insertAdjacentHTML("beforeend", rows.map(renderRow).join(""));
      offset += rows.length;
      done = !page.hasMore;
      sentinel.innerHTML =
        offset === 0
          ? emptyBox(emptyMessage)
          : done
            ? `<p class="end">End of list</p>`
            : "";
    } catch (e) {
      done = true;
      handleError(e, sentinel);
    } finally {
      busy = false;
    }
    // On a tall screen one page may not fill it: the end marker is then still in view and
    // no scroll will ever happen, so keep loading until the screen is full or the list ends.
    if (
      !done &&
      token === renderToken &&
      sentinel.getBoundingClientRect().top < window.innerHeight + 300
    ) {
      more();
    }
  }

  if (scrollWatcher) {
    scrollWatcher.disconnect();
  }
  scrollWatcher = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        more();
      }
    },
    { rootMargin: "300px" }
  );
  scrollWatcher.observe(sentinel);
  more();
}

/** Rows carrying data-open navigate when tapped (links and buttons inside keep working). */
function openOnTap(listEl) {
  listEl.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) {
      return;
    }
    const rowEl = event.target.closest("[data-open]");
    if (rowEl) {
      location.hash = rowEl.dataset.open;
    }
  });
}

function field(label, value) {
  return value === null || value === undefined || value === ""
    ? ""
    : `<p class="kv"><span>${esc(label)}</span><b>${esc(value)}</b></p>`;
}

function handleError(error, target) {
  if (error instanceof SignedOutError) {
    me = null;
    teamInfo = null;
    setWaiting(0);
    renderLogin(error.message);
    return;
  }
  (target || document.getElementById("screen")).innerHTML = errorBox(
    error.message
  );
}

// ------------------------------------------------------------------ install

const INSTALL_LATER_KEY = "mira-rm-install-later";
const INSTALL_QUIET_DAYS = 14;
/** Android (and desktop Chrome / Edge) hand this over when the app can be installed in one tap. */
let installEvent = null;

function isInstalled() {
  return (
    navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function isIphone() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * How this phone can install the app: "prompt" = one tap, the browser does it;
 * "iphone" / "android" = the user does it from the browser menu, so we show the steps;
 * "" = already installed, or a browser that cannot install.
 */
function installMode() {
  if (isInstalled()) {
    return "";
  }
  if (installEvent) {
    return "prompt";
  }
  if (isIphone()) {
    return "iphone";
  }
  return /Android/.test(navigator.userAgent) ? "android" : "";
}

function installQuiet() {
  try {
    const until = Number(localStorage.getItem(INSTALL_LATER_KEY) || 0);
    return until > Date.now();
  } catch (e) {
    return false;
  }
}

/** The hint for one place: "login", "home" or "me". Empty when there is nothing to offer. */
function installHint(place) {
  const mode = installMode();
  if (!mode) {
    return "";
  }
  const action = mode === "prompt" ? "Install App" : "How to Install";
  if (place === "me") {
    return `<button class="button-outline below" type="button" data-install="go">${
      mode === "prompt" ? "Install App" : "Install App on This Phone"
    }</button>`;
  }
  if (place === "login") {
    return `
      <div class="install-login">
        <p>${
          mode === "iphone"
            ? "Tip: add the app to your Home Screen first, then sign in from its icon."
            : "Tip: install the app to open it from your home screen."
        }</p>
        <button class="button-outline" type="button" data-install="go">${action}</button>
      </div>`;
  }
  // home: only where it is one tap or the iPhone steps, and not after "Not Now"
  if (mode === "android" || installQuiet()) {
    return "";
  }
  return `
    <div class="card install-card">
      <div class="install-head">
        <img src="icons/icon-192.png" alt="" />
        <div>
          <b>Install ${esc(CONFIG.appName)}</b>
          <p class="muted">Open it from your home screen like any other app, without the browser.</p>
        </div>
      </div>
      <div class="install-actions">
        <button class="button-plain" type="button" data-install="later">Not Now</button>
        <button class="button-primary" type="button" data-install="go">${action}</button>
      </div>
    </div>`;
}

function installSlot(place) {
  return `<div data-install-slot="${place}">${installHint(place)}</div>`;
}

/** Redraws every hint on the screen: the phone may offer (or finish) the install at any moment. */
function refreshInstallHints() {
  document.querySelectorAll("[data-install-slot]").forEach((slot) => {
    slot.innerHTML = installHint(slot.dataset.installSlot);
  });
}

const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
const ADD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 8v8M8 12h8"/></svg>`;
const MENU_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v.01M12 12v.01M12 18.5v.01"/></svg>`;

function installSteps(mode) {
  const name = esc(CONFIG.appName);
  if (mode === "iphone") {
    const safari = !/CriOS|EdgiOS|FxiOS|OPiOS/.test(navigator.userAgent);
    return [
      {
        icon: SHARE_ICON,
        text: `Tap the <b>Share</b> button ${
          safari
            ? "in the bar at the bottom of Safari"
            : "next to the address at the top"
        }. If you do not see it, tap <b>•••</b> first.`
      },
      {
        icon: ADD_ICON,
        text: "Scroll down the list and tap <b>Add to Home Screen</b>."
      },
      {
        text: `Tap <b>Add</b>. The ${name} icon is now on your Home Screen.`
      },
      {
        text: `Open ${name} from that icon and sign in there. From then on you stay signed in.`
      }
    ];
  }
  return [
    {
      icon: MENU_ICON,
      text: "Tap the browser <b>menu</b> (three dots, top right; in Samsung Internet the three lines at the bottom)."
    },
    {
      icon: ADD_ICON,
      text: "Tap <b>Add to Home screen</b> or <b>Install app</b>."
    },
    {
      text: `Tap <b>Install</b>. The ${name} icon is now on your home screen.`
    }
  ];
}

function openInstallSheet(mode) {
  closeSheet();
  const steps = installSteps(mode)
    .map(
      (step, index) => `
      <li>
        <span class="install-number">${index + 1}</span>
        <p>${step.text}</p>
        ${step.icon ? `<span class="install-icon">${step.icon}</span>` : ""}
      </li>`
    )
    .join("");
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <h2>Install ${esc(CONFIG.appName)}</h2>
      <p class="muted">It takes a few seconds and is done only once.</p>
      <ol class="install-steps">${steps}</ol>
      <button class="button-primary" type="button" data-install="close">Got It</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeSheet();
    }
  });
}

async function installNow() {
  const mode = installMode();
  if (mode !== "prompt") {
    if (mode) {
      openInstallSheet(mode);
    }
    return;
  }
  const asked = installEvent;
  // the browser allows one question per event
  installEvent = null;
  try {
    await asked.prompt();
    await asked.userChoice;
  } catch (e) {
    // the browser refused to ask: the hints below fall back to the steps
  }
  refreshInstallHints();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  refreshInstallHints();
});

window.addEventListener("appinstalled", () => {
  installEvent = null;
  document
    .querySelectorAll("[data-install-slot]")
    .forEach((slot) => (slot.innerHTML = ""));
  toast(`${CONFIG.appName} is installed. Open it from your home screen.`);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-install]");
  if (!button) {
    return;
  }
  const action = button.dataset.install;
  if (action === "go") {
    installNow();
  } else if (action === "close") {
    closeSheet();
  } else if (action === "later") {
    try {
      localStorage.setItem(
        INSTALL_LATER_KEY,
        String(Date.now() + INSTALL_QUIET_DAYS * 86400000)
      );
    } catch (e) {
      // private mode: the card simply comes back next time
    }
    refreshInstallHints();
    toast("You can install the app any time from the Me screen.");
  }
});

// -------------------------------------------------------------------- login

/** detail =Salesforce's own technical words, shown small so the user can pass them on. */
function renderLogin(message, detail) {
  root.innerHTML = `
    <section class="login">
      <div class="login-mark">MIRA</div>
      <h1>${esc(CONFIG.appName)}</h1>
      <p>Your leads, deals and unit availability in one place.</p>
      ${message ? errorBox(message) : ""}
      ${detail ? `<p class="login-detail">Details for the admin: ${esc(detail)}</p>` : ""}
      <button class="button-primary" id="sign-in">Sign in with Salesforce</button>
      ${installSlot("login")}
      <p class="login-foot">${esc(CONFIG.environment)} · v${esc(CONFIG.version)}</p>
    </section>`;
  document.getElementById("sign-in").addEventListener("click", (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Opening Salesforce…";
    startLogin();
  });
}

// --------------------------------------------------------------------- home

const TONE_CLASS = {
  urgent: "tone-urgent",
  warn: "tone-warn",
  info: "tone-info"
};

async function renderHome(token) {
  shell("My Dashboard", loading(), "home");
  // the approvals count must never stop the dashboard from showing
  // nor may the user's own requests
  const [data, waiting, mine] = await Promise.all([
    get("dashboard"),
    get("approvals").catch(() => null),
    get("requests/mine").catch(() => [])
  ]);
  if (token !== renderToken) {
    return;
  }
  if (waiting) {
    setWaiting(waiting.length);
  }
  const waitingNow = waiting ? waiting.length : waitingCount;
  // on the home screen: what is still open, and what was decided in the last 7 days
  const weekAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const openMine = mine.filter((r) => r.open);
  const decidedMine = mine.filter(
    (r) => !r.open && r.decided && r.decided >= weekAgo
  );
  const myRequests = [...openMine.slice(0, 3), ...decidedMine.slice(0, 3)];
  const leads = data.leads || {};
  const deals = data.deals || {};
  const activity = data.activity || {};
  const perf = data.performance || {};

  const tiles = (leads.tiles || [])
    .map(
      (tile) => `
      <a class="tile ${tile.count > 0 ? TONE_CLASS[tile.tone] || "" : ""}" href="#/leads?bucket=${esc(tile.key)}">
        <span class="tile-count">${tile.count}</span>
        <span class="tile-label">${esc(tile.label)}</span>
      </a>`
    )
    .join("");

  const steps = (deals.steps || [])
    .map(
      (step) => `
      <a class="step" href="#/deals?step=${esc(step.key)}">
        <span class="step-count">${step.count}</span>
        <span class="step-label">${esc(step.label)}</span>
      </a>`
    )
    .join("");

  const alerts = [
    deals.stuck > 0
      ? {
          text: `${deals.stuck} deal${deals.stuck === 1 ? "" : "s"} stuck 7 days or more`,
          step: "stuck"
        }
      : null,
    deals.bookingForms > 0
      ? {
          text: `${deals.bookingForms} booking form${deals.bookingForms === 1 ? "" : "s"} to get signed`,
          step: "bookingForm"
        }
      : null,
    deals.eoiDrafts > 0
      ? {
          text: `${deals.eoiDrafts} EOI draft${deals.eoiDrafts === 1 ? "" : "s"} to finish`,
          step: "eoiDraft"
        }
      : null
  ]
    .filter(Boolean)
    .map(
      (a) =>
        `<a class="alert-row" href="#/deals?step=${a.step}">${esc(a.text)}<span>›</span></a>`
    )
    .join("");

  const bar = (label, done, target) => {
    const percent =
      target > 0
        ? Math.min(100, Math.round((done / target) * 100))
        : done > 0
          ? 100
          : 0;
    return `
      <div class="progress">
        <div class="progress-head"><span>${label}</span><b>${done}${target > 0 ? " / " + target : ""}</b></div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
      </div>`;
  };

  const months = perf.months || [];
  const top = Math.max(1, ...months.map((m) => m.value || 0));
  const chart = months
    .map(
      (m) => `
      <div class="bar" title="${esc(m.label)}: ${m.deals} deals">
        <div class="bar-fill" style="height:${Math.round(((m.value || 0) / top) * 100)}%"></div>
        <span>${esc((m.label || "").slice(0, 1))}</span>
      </div>`
    )
    .join("");

  document.getElementById("screen").innerHTML = `
    <section class="hero">
      <p>${greeting()},</p>
      <h2>${esc(leads.firstName || (me && me.firstName) || "")}</h2>
      <span>${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
    </section>

    ${installSlot("home")}
    ${
      waitingNow
        ? `<a class="alert-row approvals-alert" href="#/approvals"><b>${waitingNow} request${waitingNow === 1 ? "" : "s"} waiting for your approval</b><span>›</span></a>`
        : ""
    }
    ${
      hasTeamView()
        ? `<div class="card form team-card">
             <h2 class="form-title">My Team</h2>
             <a class="button-outline button-link" href="#/sales-performance">Sales Performance</a>
             <a class="button-outline button-link below" href="#/sales-activity">Sales Activity</a>
             <div class="two-links">
               <a href="#/deals?scope=team">Team Deals</a>
               <a href="#/leads?scope=team">Team Leads</a>
               <a href="#/activities?scope=team">Team Activities</a>
             </div>
           </div>`
        : ""
    }
    <div class="quick-actions">
      <a class="button-primary button-link" href="#/activity-new">Record Activity</a>
      <a class="button-outline button-link" href="#/client-new">Add Client</a>
    </div>

    <h3 class="section-title">My Day</h3>
    <div class="tiles">${tiles || emptyBox("Nothing needs attention.")}</div>

    ${
      myRequests.length
        ? `<h3 class="section-title">My Requests</h3>
           <div class="list" id="my-requests">${myRequests.map(myRequestRow).join("")}</div>
           <a class="button-outline button-link below" href="#/my-requests">All My Requests${
             openMine.length ? " (" + openMine.length + " open)" : ""
           }</a>`
        : ""
    }

    <h3 class="section-title">My Leads</h3>
    <div class="card two-up">
      <a href="#/leads?bucket=open"><b>${leads.openLeads || 0}</b><span>Open</span></a>
      <a href="#/leads?bucket=closed"><b>${leads.closedLeads || 0}</b><span>Closed</span></a>
    </div>

    <h3 class="section-title">My Deals</h3>
    <div class="steps">${steps}</div>
    ${alerts ? `<div class="card alert-list">${alerts}</div>` : ""}

    <h3 class="section-title">Sales Activity This Week</h3>
    <div class="card">
      ${bar("Inbound", activity.weekInbound || 0, activity.inboundTarget || 0)}
      ${bar("Outbound", activity.weekOutbound || 0, activity.outboundTarget || 0)}
      <p class="muted">${activity.monthCount || 0} this month${
        activity.lastLogged
          ? " · last recorded " + esc(dateTime12(activity.lastLogged))
          : ""
      }</p>
      <a class="button-primary button-link" href="#/activity-new">Record Activity</a>
      <a class="button-outline button-link below" href="#/activities">My Activities</a>
    </div>

    <h3 class="section-title">My Performance ${esc(perf.year || "")}</h3>
    <div class="card">
      <div class="stats">
        <div><b>${perf.monthDeals || 0}</b><span>Deals in ${esc(perf.monthLabel || "this month")}</span></div>
        <div><b>${perf.yearDeals || 0}</b><span>Deals this year</span></div>
        <div><b>${perf.yearSold || 0}</b><span>Sold this year</span></div>
      </div>
      <div class="stats">
        <div><b>AED ${compactNumber.format(perf.monthValue || 0)}</b><span>Value this month</span></div>
        <div><b>AED ${compactNumber.format(perf.yearValue || 0)}</b><span>Value this year</span></div>
        <div><b>${perf.leadsConvertedThisYear || 0} / ${perf.leadsThisYear || 0}</b><span>Leads converted</span></div>
      </div>
      <div class="chart">${chart}</div>
    </div>`;
  const requestList = document.getElementById("my-requests");
  if (requestList) {
    openOnTap(requestList);
  }
}

// -------------------------------------------------------------------- leads

const LEAD_BUCKETS = [
  { key: "open", label: "Open" },
  { key: "needContact", label: "Needs Contact" },
  { key: "waiting", label: "Waiting 1 Day+" },
  { key: "noAnswer", label: "No Answer" },
  { key: "hot", label: "Hot" },
  { key: "overdueTasks", label: "Overdue Tasks" },
  { key: "closed", label: "Closed" }
];

function leadRow(lead) {
  const flags = [
    lead.waiting ? `<span class="pill pill-warn">Waiting</span>` : "",
    lead.hasOverdueTask
      ? `<span class="pill pill-urgent">Overdue task</span>`
      : ""
  ].join("");
  const contact = [
    lead.phone
      ? `<a class="action" href="tel:${esc(lead.phone)}">Call</a>`
      : "",
    lead.phone
      ? `<a class="action" href="https://wa.me/${esc(String(lead.phone).replace(/[^0-9]/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>`
      : "",
    lead.email
      ? `<a class="action" href="mailto:${esc(lead.email)}">Email</a>`
      : ""
  ].join("");
  return `
    <article class="row">
      <div class="row-head">
        <h4>${esc(lead.name)}</h4>
        <span class="pill${lead.closed ? " pill-muted" : ""}">${esc(lead.status)}</span>
      </div>
      <p class="muted">${esc([lead.project, lead.source].filter(Boolean).join(" · "))}</p>
      <p class="muted">Assigned ${esc(shortDate(lead.assignedDate))} · ${days(lead.daysSinceAssigned)} ago ${flags}</p>
      ${lead.ownerName ? `<p class="muted">RM: <b>${esc(lead.ownerName)}</b></p>` : ""}
      ${lead.nextAction ? `<p class="next">${esc(lead.nextAction)}</p>` : ""}
      ${contact ? `<div class="actions">${contact}</div>` : ""}
    </article>`;
}

// ---------------------------------------------------------------- team lists
// A director works in the same screens as an RM and sees the team: "Mine" is the RM's own
// list, "Team" is everything Salesforce shows them of their people's records.

const SCOPES = [
  { key: "mine", label: "Mine" },
  { key: "team", label: "Team" }
];
let teamInfo = null;

function hasTeamView() {
  return Boolean(me && me.teamView);
}

function isTeamScope(params) {
  return hasTeamView() && params.get("scope") === "team";
}

async function loadTeam() {
  if (!teamInfo) {
    teamInfo = await get("team/info");
  }
  return teamInfo;
}

function scopeChips(scope) {
  return hasTeamView() ? chips(SCOPES, scope, "scope") : "";
}

function memberSelect(team, owner) {
  return `
    <select class="select" id="team-owner" aria-label="RM">
      <option value="">Whole team</option>
      ${team.members.map((m) => `<option value="${esc(m.id)}"${m.id === owner ? " selected" : ""}>${esc(m.name)}</option>`).join("")}
    </select>`;
}

/** Wires the Mine / Team chips, the RM filter and the search box of a team list. */
function wireTeamList(path, current) {
  root
    .querySelectorAll("[data-scope]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go(path, button.dataset.scope === "team" ? { scope: "team" } : {})
      )
    );
  if (!current) {
    return;
  }
  const owner = document.getElementById("team-owner");
  if (owner) {
    owner.addEventListener("change", () =>
      go(path, { ...current, owner: owner.value })
    );
  }
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener(
      "change",
      debounce(
        (event) => go(path, { ...current, search: event.target.value.trim() }),
        300
      )
    );
  }
}

async function renderTeamLeads(token, params) {
  const owner = params.get("owner") || "";
  const status = params.get("status") || "";
  const search = params.get("search") || "";
  shell("Team Leads", loading(), "leads");
  const team = await loadTeam();
  if (token !== renderToken) {
    return;
  }
  document.getElementById("screen").innerHTML = `
    ${scopeChips("team")}
    ${memberSelect(team, owner)}
    <select class="select" id="team-status" aria-label="Lead status">
      <option value="">All statuses</option>
      ${team.leadStatuses.map((s) => `<option value="${esc(s)}"${s === status ? " selected" : ""}>${esc(s)}</option>`).join("")}
    </select>
    <input class="search" id="search" type="search" placeholder="Search name, phone or email" value="${esc(search)}" />
    <div class="list" id="list"></div>`;
  const current = { scope: "team", owner, status, search };
  wireTeamList("leads", current);
  document
    .getElementById("team-status")
    .addEventListener("change", (event) =>
      go("leads", { ...current, status: event.target.value })
    );
  infiniteList(
    document.getElementById("list"),
    (offset) =>
      get("team/leads", {
        ownerId: owner,
        status,
        search,
        pageSize: PAGE_SIZE,
        offset
      }),
    leadRow,
    "No leads here.",
    token
  );
}

const TEAM_DEAL_STEPS = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "booked", label: "Booked" },
  { key: "reserved", label: "Reserved" },
  { key: "sold", label: "Sold" }
];

async function renderTeamDeals(token, params) {
  const owner = params.get("owner") || "";
  const step = params.get("step") || "active";
  const search = params.get("search") || "";
  shell("Team Deals", loading(), "deals");
  const team = await loadTeam();
  if (token !== renderToken) {
    return;
  }
  document.getElementById("screen").innerHTML = `
    ${scopeChips("team")}
    ${chips(TEAM_DEAL_STEPS, step, "step")}
    ${memberSelect(team, owner)}
    <input class="search" id="search" type="search" placeholder="Search client or unit" value="${esc(search)}" />
    <div class="list" id="list"></div>`;
  const current = { scope: "team", owner, step, search };
  wireTeamList("deals", current);
  root
    .querySelectorAll("[data-step]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go("deals", { ...current, step: button.dataset.step })
      )
    );
  openOnTap(document.getElementById("list"));
  infiniteList(
    document.getElementById("list"),
    (offset) =>
      get("team/deals", {
        ownerId: owner,
        step,
        search,
        pageSize: PAGE_SIZE,
        offset
      }),
    dealRow,
    "No deals here.",
    token
  );
}

async function renderTeamActivities(token, params) {
  const owner = params.get("owner") || "";
  shell("Team Activities", loading(), "home", { back: "#/home" });
  const team = await loadTeam();
  if (token !== renderToken) {
    return;
  }
  document.getElementById("screen").innerHTML = `
    ${scopeChips("team")}
    ${memberSelect(team, owner)}
    <div class="list" id="list"></div>`;
  wireTeamList("activities", { scope: "team", owner });
  openOnTap(document.getElementById("list"));
  infiniteList(
    document.getElementById("list"),
    (offset) =>
      get("team/activities", { ownerId: owner, pageSize: PAGE_SIZE, offset }),
    activityRow,
    "No activity recorded yet.",
    token
  );
}

// ------------------------------------------------- sales performance (directors)
// The same dashboard as the "Sales Performance" tab in Salesforce, from the same service:
// Booked / Reserved / Sold of the director's team for a period, the trend, the projects, the
// RM leaderboard, the cancellations and the deals behind the numbers.

const PERF_PERIODS = ["Yearly", "Monthly", "Daily", "Date Range"];
const PERF_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const PERF_PRESETS = [
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "mtd", label: "MTD" },
  { key: "qtd", label: "QTD" },
  { key: "ytd", label: "YTD" }
];

function presetRange(key) {
  const end = new Date();
  let start = new Date(end);
  if (key === "last7") {
    start.setDate(end.getDate() - 6);
  } else if (key === "last30") {
    start.setDate(end.getDate() - 29);
  } else if (key === "mtd") {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else if (key === "qtd") {
    start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
  } else {
    start = new Date(end.getFullYear(), 0, 1);
  }
  return { from: isoDay(start), to: isoDay(end) };
}

/** A list of horizontal bars; a bar with a `drill` can be tapped. */
function barList(items, emptyMessage) {
  const visible = items.filter((item) => item.value > 0 || item.always);
  if (!visible.length) {
    return `<p class="muted">${esc(emptyMessage)}</p>`;
  }
  const top = Math.max(...visible.map((item) => item.value), 1);
  return visible
    .map((item) => {
      const inner = `
        <div class="progress-head"><span>${esc(item.label)}</span><b>${esc(item.amount)}</b></div>
        <div class="progress-track"><div class="progress-fill" style="width:${item.value > 0 ? Math.max(2, Math.round((item.value / top) * 100)) : 0}%"></div></div>
        ${item.note ? `<small>${esc(item.note)}</small>` : ""}`;
      return item.drill
        ? `<button type="button" class="progress drill-bar${item.selected ? " is-selected" : ""}" data-drill="${esc(JSON.stringify(item.drill))}">${inner}</button>`
        : `<div class="progress${item.selected ? " is-selected" : ""}">${inner}</div>`;
    })
    .join("");
}

function perfDealRow(deal) {
  const cancelled = deal.cancelledDate != null;
  return `
    <article class="row is-link" data-open="#/deal?id=${esc(deal.opportunityId)}">
      <div class="row-head">
        <h4>${esc([deal.projectName, deal.propertyCode].filter(Boolean).join(" · ") || deal.name)}</h4>
        <span class="pill">${esc(money(deal.amount, "AED"))}</span>
      </div>
      <p class="muted">${esc(deal.name || "")}</p>
      <p class="muted">${esc(["RM: " + (deal.rmName || "—"), deal.agencyName].filter(Boolean).join(" · "))}</p>
      <p class="muted">Booked ${esc(shortDate(deal.bookedDate))}${
        cancelled
          ? ` · Cancelled ${esc(shortDate(deal.cancelledDate))}${deal.daysHeld == null ? "" : ` · held ${days(deal.daysHeld)}`}${deal.stageReached ? ` · reached ${esc(deal.stageReached)}` : ""}`
          : ""
      }</p>
    </article>`;
}

async function renderSalesPerformance(token, params) {
  const filters = {
    period: PERF_PERIODS.includes(params.get("period"))
      ? params.get("period")
      : "Yearly",
    year: params.get("year") || "",
    month: params.get("month") || "",
    date: params.get("date") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    rm: params.get("rm") || "",
    resells: params.get("resells") === "1",
    stage: params.get("stage") || "Booked"
  };
  shell("Sales Performance", loading(), "home", { back: "#/home" });
  const data = await get("team/salesperformance", {
    periodType: filters.period,
    targetYear: filters.year,
    targetMonth: filters.month,
    targetDate: filters.date,
    startDate: filters.from,
    endDate: filters.to,
    rmId: filters.rm,
    excludeResells: filters.resells ? "true" : "false"
  });
  if (token !== renderToken) {
    return;
  }
  // what the service settled on (defaults filled in)
  filters.year = data.selectedYear || filters.year;
  filters.month = data.selectedMonth || filters.month;
  filters.date = data.selectedDate || filters.date;
  filters.from = data.selectedRangeStart || filters.from;
  filters.to = data.selectedRangeEnd || filters.to;
  const reload = (changes) => {
    const next = { ...filters, ...changes };
    go("sales-performance", {
      period: next.period,
      year: next.year,
      month: next.month,
      date: next.date,
      from: next.from,
      to: next.to,
      rm: next.rm,
      resells: next.resells ? "1" : "",
      stage: next.stage
    });
  };
  const aed = (value) => money(value || 0, "AED");
  const short = (value) => "AED " + compactNumber.format(value || 0);
  const options = (list, selected) =>
    list
      .map(
        (o) =>
          `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? " selected" : ""}>${esc(o.label)}</option>`
      )
      .join("");

  // ---- the period pickers
  const yearSelect = `<label class="form-field"><span>Year</span><select class="select" id="perf-year">${options(data.yearOptions || [], filters.year)}</select></label>`;
  const pickers =
    filters.period === "Yearly"
      ? yearSelect
      : filters.period === "Monthly"
        ? `${yearSelect}<label class="form-field"><span>Month</span><select class="select" id="perf-month">${options(
            PERF_MONTHS.map((label, i) => ({ label, value: String(i + 1) })),
            filters.month
          )}</select></label>`
        : filters.period === "Daily"
          ? `<label class="form-field"><span>Date</span><input class="search" type="date" id="perf-date" value="${esc(filters.date)}" /></label>`
          : `<div class="two-fields">
               <label class="form-field"><span>From</span><input class="search" type="date" id="perf-from" value="${esc(filters.from)}" /></label>
               <label class="form-field"><span>To</span><input class="search" type="date" id="perf-to" value="${esc(filters.to)}" /></label>
             </div>
             ${chips(PERF_PRESETS, "", "preset")}`;

  // ---- the trend: months of the year, or days of the month / range
  const rangeDays =
    filters.period === "Date Range" && filters.from && filters.to
      ? Math.round((new Date(filters.to) - new Date(filters.from)) / 86400000) +
        1
      : 0;
  const byMonth =
    filters.period === "Yearly" ||
    (filters.period === "Date Range" && rangeDays > 62);
  const trendItems = (
    byMonth ? data.monthlySeries : data.dailySeries || []
  ).map((point) => {
    const key = String(point.key || "");
    let drill = null;
    if (byMonth) {
      const parts = key.includes("-") ? key.split("-") : [filters.year, key];
      drill = {
        period: "Monthly",
        year: parts[0],
        month: String(Number(parts[1]))
      };
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      drill = { period: "Daily", date: key };
    }
    return {
      label: byMonth ? point.label : shortDate(key) || point.label,
      value: point.amount || 0,
      amount: short(point.amount),
      note: `${point.dealCount} deal${point.dealCount === 1 ? "" : "s"}`,
      drill,
      selected: filters.period === "Daily" && key === filters.date,
      always: byMonth && filters.period === "Yearly"
    };
  });

  const cancel = data.cancellations || {};
  const stageTabs = [
    ...(data.stageSections || []).map((s) => ({
      key: s.stage,
      label: s.stage,
      count: s.dealCount
    })),
    { key: "Cancelled", label: "Cancelled", count: cancel.dealCount || 0 }
  ];
  const section =
    filters.stage === "Cancelled"
      ? cancel
      : (data.stageSections || []).find((s) => s.stage === filters.stage) ||
        (data.stageSections || [])[0] ||
        {};
  const sectionRows = section.rows || [];

  document.getElementById("screen").innerHTML = `
    <div class="card form">
      <label class="form-field"><span>Period</span>
        <select class="select" id="perf-period">${options(
          PERF_PERIODS.map((label) => ({ label, value: label })),
          filters.period
        )}</select>
      </label>
      ${pickers}
      <label class="form-field"><span>Relationship Manager</span>
        <select class="select" id="perf-rm">
          <option value="">${data.viewAll ? "All RMs" : "Whole team"}</option>
          ${options(data.rmOptions || [], filters.rm)}
        </select>
      </label>
      <label class="check-line"><input type="checkbox" id="perf-resells" ${filters.resells ? "checked" : ""} /> <span>Exclude resells</span></label>
      <button type="button" class="button-outline" id="perf-reset">Reset Filters</button>
    </div>

    <p class="hint">${esc(data.periodLabel || "")} · ${
      data.viewAll
        ? "all RMs"
        : `your team (${data.teamSize} ${data.teamSize === 1 ? "person" : "people"})`
    } · by booking date · AED</p>

    <div class="tiles">
      ${(data.stageSections || [])
        .map(
          (s) => `
        <button type="button" class="tile tile-button" data-stage="${esc(s.stage)}">
          <span class="tile-label">${esc(s.stage)}</span>
          <span class="tile-count">${s.dealCount}</span>
          <span class="tile-label">${esc(short(s.totalValue))}</span>
        </button>`
        )
        .join("")}
      <div class="tile tone-total">
        <span class="tile-label">Total Sales</span>
        <span class="tile-count">${data.totalDeals}</span>
        <span class="tile-label">${esc(short(data.totalValue))}</span>
      </div>
    </div>
    <div class="card">
      ${field("Total value", aed(data.totalValue))}
      ${field("Average deal", aed(data.averageDealValue))}
    </div>

    <div class="card form">
      <h2 class="form-title">Sales Trend</h2>
      <p class="muted">${byMonth ? "By month" : "By day"}. Tap a bar to look inside it.</p>
      ${barList(trendItems, "No sales in this period.")}
    </div>

    <div class="card form">
      <h2 class="form-title">Sales by Project</h2>
      ${barList(
        (data.projectBreakdown || []).map((project) => ({
          label: project.projectName || "No project",
          value: project.totalValue || 0,
          amount: short(project.totalValue),
          note: `${project.dealCount} deal${project.dealCount === 1 ? "" : "s"} · ${project.sharePercent}% of sales`
        })),
        "No sales in this period."
      )}
    </div>

    <div class="card form">
      <h2 class="form-title">RM Leaderboard</h2>
      ${
        (data.leaderboard || []).length
          ? data.leaderboard
              .map(
                (row) => `
        <button type="button" class="owner-row leader-row" data-rm="${esc(row.rmId)}">
          <span class="rank">${row.rank}</span>
          <span><b>${esc(row.rmName)}</b><br /><small>${row.dealCount} deal${row.dealCount === 1 ? "" : "s"} · average ${esc(short(row.averageValue))} · ${row.sharePercent}%</small></span>
          <b>${esc(short(row.totalValue))}</b>
        </button>`
              )
              .join("")
          : `<p class="muted">No sales in this period.</p>`
      }
    </div>

    <div class="card form">
      <h2 class="form-title">Cancellations</h2>
      <p class="muted">Deals cancelled in this period, by cancellation date.</p>
      <div class="stats">
        <div><b>${cancel.dealCount || 0}</b><span>Deals</span></div>
        <div><b>${esc(compactNumber.format(cancel.totalValue || 0))}</b><span>AED</span></div>
        <div><b>${cancel.averageDays || 0}</b><span>Avg days held</span></div>
      </div>
      ${field("Median days held", cancel.dealCount ? String(cancel.medianDays) : "")}
      ${field("Longest held", cancel.dealCount ? days(cancel.longestDays) : "")}
      ${cancel.undatedCount ? `<p class="muted">${cancel.undatedCount} cancelled deal${cancel.undatedCount === 1 ? " has" : "s have"} no cancellation date and ${cancel.undatedCount === 1 ? "is" : "are"} not counted.</p>` : ""}
      ${
        cancel.dealCount
          ? `<h3 class="sub-title">Days Held Before Cancellation</h3>
             ${barList(
               (cancel.buckets || []).map((bucket) => ({
                 label: bucket.label,
                 value: bucket.dealCount || 0,
                 amount: String(bucket.dealCount),
                 note: short(bucket.totalValue),
                 always: true
               })),
               ""
             )}
             <h3 class="sub-title">By RM</h3>
             ${(cancel.byRm || [])
               .map(
                 (row) => `
               <div class="owner-row">
                 <span><b>${esc(row.rmName)}</b><br /><small>${row.dealCount} deal${row.dealCount === 1 ? "" : "s"} · average ${row.averageDays} days held</small></span>
                 <b>${esc(short(row.totalValue))}</b>
               </div>`
               )
               .join("")}`
          : ""
      }
    </div>

    <h2 class="list-title">Deal Breakdown</h2>
    ${chips(stageTabs, filters.stage === "Cancelled" ? "Cancelled" : section.stage, "tab")}
    ${section.rowsCapped ? `<p class="hint">Only the first ${sectionRows.length} deals are listed.</p>` : ""}
    <div class="list" id="list"></div>`;

  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(event, handler);
    }
  };
  on("perf-period", "change", (e) => reload({ period: e.target.value }));
  on("perf-year", "change", (e) => reload({ year: e.target.value }));
  on("perf-month", "change", (e) => reload({ month: e.target.value }));
  on(
    "perf-date",
    "change",
    (e) => e.target.value && reload({ date: e.target.value })
  );
  on(
    "perf-from",
    "change",
    (e) => e.target.value && reload({ from: e.target.value })
  );
  on(
    "perf-to",
    "change",
    (e) => e.target.value && reload({ to: e.target.value })
  );
  on("perf-rm", "change", (e) => reload({ rm: e.target.value }));
  on("perf-resells", "change", (e) => reload({ resells: e.target.checked }));
  on("perf-reset", "click", () => go("sales-performance", {}));
  root
    .querySelectorAll("[data-preset]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        reload({ period: "Date Range", ...presetRange(button.dataset.preset) })
      )
    );
  root
    .querySelectorAll("[data-drill]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        reload(JSON.parse(button.dataset.drill))
      )
    );
  root
    .querySelectorAll("[data-rm]")
    .forEach((button) =>
      button.addEventListener("click", () => reload({ rm: button.dataset.rm }))
    );
  const showStage = (stage) => {
    // the stage only changes the list at the bottom: stay where the list is
    sessionStorage.setItem("perf-to-list", "1");
    reload({ stage });
  };
  root
    .querySelectorAll("[data-stage]")
    .forEach((button) =>
      button.addEventListener("click", () => showStage(button.dataset.stage))
    );
  root
    .querySelectorAll("[data-tab]")
    .forEach((button) =>
      button.addEventListener("click", () => showStage(button.dataset.tab))
    );
  const list = document.getElementById("list");
  openOnTap(list);
  infiniteList(
    list,
    (offset) =>
      Promise.resolve({
        rows: sectionRows.slice(offset, offset + PAGE_SIZE),
        hasMore: offset + PAGE_SIZE < sectionRows.length
      }),
    perfDealRow,
    "No deals here.",
    token
  );
  if (sessionStorage.getItem("perf-to-list")) {
    sessionStorage.removeItem("perf-to-list");
    const title = root.querySelector(".list-title");
    if (title) {
      title.scrollIntoView();
    }
  }
}

// ---------------------------------------------------- sales activity (directors)
// The same dashboard as the "Sales Activity" tab in Salesforce, from the same service: client
// meetings and agency briefings of the people the viewer can see, against the weekly target.
// The arithmetic done here (weeks in a period, the leaderboard) is the Salesforce screen's.

const ACT_TABS = [
  { key: "meetings", label: "Client Meetings" },
  { key: "briefings", label: "Agency Briefings" }
];
const ACT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

function mondayOf(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

async function renderSalesActivity(token, params) {
  const filters = {
    tab: params.get("tab") === "briefings" ? "briefings" : "meetings",
    month: params.get("month") || "",
    week: params.get("week") || "",
    rm: params.get("rm") || ""
  };
  shell("Sales Activity", loading(), "home", { back: "#/home" });
  const data = await get("team/salesactivity", {
    month: filters.month,
    week: filters.week,
    rm: filters.rm
  });
  if (token !== renderToken) {
    return;
  }
  const reload = (changes) => {
    const next = { ...filters, ...changes };
    go("sales-activity", {
      tab: next.tab,
      month: next.month,
      week: next.week,
      rm: next.rm
    });
  };
  const dayLabel = (date) => `${date.getDate()} ${ACT_MONTHS[date.getMonth()]}`;
  const two = (n) => String(n).padStart(2, "0");

  // ---- filter lists, built the way the Salesforce screen builds them
  const now = new Date();
  const months = [{ label: "All months", value: "" }];
  const janFloor = `${now.getFullYear()}-01`;
  const dataMonth = data.earliestMonth || janFloor;
  let [y, m] = (dataMonth < janFloor ? dataMonth : janFloor)
    .split("-")
    .map(Number);
  while (y <= now.getFullYear() && months.length <= 60) {
    months.push({
      label: `${ACT_MONTHS[m - 1]} ${y}`,
      value: `${y}-${two(m)}`
    });
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  const weeks = [{ label: "All weeks", value: "" }];
  if (filters.month) {
    const [fy, fm] = filters.month.split("-").map(Number);
    const monthEnd = new Date(fy, fm, 1);
    for (
      let monday = mondayOf(new Date(fy, fm - 1, 1));
      monday < monthEnd;
      monday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 7
      )
    ) {
      weeks.push({
        label: `Week of ${dayLabel(monday)}`,
        value: isoDay(monday)
      });
    }
  } else {
    let monday = mondayOf(now);
    for (let i = 0; i < 12; i++) {
      weeks.push({
        label:
          i === 0
            ? `This week (${dayLabel(monday)})`
            : `Week of ${dayLabel(monday)}`,
        value: isoDay(monday)
      });
      monday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() - 7
      );
    }
  }
  if (filters.week && !weeks.some((w) => w.value === filters.week)) {
    const [wy, wm, wd] = filters.week.split("-").map(Number);
    weeks.push({
      label: `Week of ${dayLabel(new Date(wy, wm - 1, wd))}`,
      value: filters.week
    });
  }
  const options = (list, selected) =>
    list
      .map(
        (o) =>
          `<option value="${esc(o.value)}"${o.value === selected ? " selected" : ""}>${esc(o.label)}</option>`
      )
      .join("");

  // ---- the period in words
  let periodLabel = "";
  if (filters.week) {
    const [wy, wm, wd] = filters.week.split("-").map(Number);
    periodLabel = `week of ${dayLabel(new Date(wy, wm - 1, wd))}`;
  } else if (filters.month) {
    const [fy, fm] = filters.month.split("-").map(Number);
    periodLabel = `${ACT_MONTHS[fm - 1]} ${fy}`;
  }
  const filtered = Boolean(periodLabel);
  let targetWeeks = 1;
  if (!filters.week && filters.month) {
    const [fy, fm] = filters.month.split("-").map(Number);
    targetWeeks = Math.max(1, Math.round(new Date(fy, fm, 0).getDate() / 7));
  }

  const board =
    (filters.tab === "briefings"
      ? data.agencyBriefings
      : data.clientMeetings) || {};
  const noun =
    filters.tab === "briefings" ? "agency briefing" : "client meeting";
  const k = board.kpis || {};
  const tile = (label, value, warn) => `
    <div class="tile${warn ? " tone-urgent" : ""}">
      <span class="tile-count">${esc(String(value))}</span>
      <span class="tile-label">${esc(label)}</span>
    </div>`;
  const kpis = filtered
    ? [
        tile(`Events · ${periodLabel}`, k.monthCount),
        tile("Hours in the field", k.monthHours),
        tile("Active RMs", k.activeRms),
        tile("Agencies covered", `${k.agenciesCovered} / ${k.agenciesTotal}`),
        tile(
          "Agencies not covered",
          k.agenciesAttention,
          k.agenciesAttention > 0
        )
      ]
    : [
        tile("This week", k.weekCount),
        tile("This month", k.monthCount),
        tile("Hours in the field (month)", k.monthHours),
        tile("Active RMs this month", k.activeRms),
        tile(
          "Agencies covered (90 days)",
          `${k.agenciesCovered} / ${k.agenciesTotal}`
        ),
        tile(
          "Agencies needing attention",
          k.agenciesAttention,
          k.agenciesAttention > 0
        )
      ];

  // ---- target leaderboard
  const inTarget = (data.inboundTarget || 1) * targetWeeks;
  const outTarget = (data.outboundTarget || 1) * targetWeeks;
  const leaders = (board.rmRows || [])
    .map((r) => {
      const inShare = Math.min(r.weekInbound / inTarget, 1);
      const outShare = Math.min(r.weekOutbound / outTarget, 1);
      return {
        row: r,
        inShare,
        outShare,
        attainment: (inShare + outShare) / 2,
        met: r.weekInbound >= inTarget && r.weekOutbound >= outTarget
      };
    })
    .sort(
      (a, b) =>
        b.attainment - a.attainment || a.row.name.localeCompare(b.row.name)
    );
  const targetBase = `the weekly target of ${data.inboundTarget} inbound + ${data.outboundTarget} outbound (online counts as inbound)`;
  const targetNote = !filtered
    ? `Counting ${noun}s only, against ${targetBase}.`
    : `Counting ${noun}s in the ${periodLabel}, against ${targetBase}${targetWeeks > 1 ? ` × ${targetWeeks} weeks` : ""}.`;
  const miniBar = (label, done, target, share) => `
    <div class="progress">
      <div class="progress-head"><span>${label}</span><b>${done} / ${target}</b></div>
      <div class="progress-track"><div class="progress-fill${done >= target ? " is-met" : ""}" style="width:${Math.round(share * 100)}%"></div></div>
    </div>`;

  const attention = board.needsAttention || [];
  const attentionNote =
    attention.length < (k.agenciesAttention || 0)
      ? `Showing the ${attention.length} most urgent of ${k.agenciesAttention} agencies.`
      : filtered
        ? `${k.agenciesAttention} agencies with no ${noun} in the ${periodLabel} (last activity is all-time).`
        : `${k.agenciesAttention} agencies with no ${noun} in the last 60 days.`;
  const countList = (rows, empty) =>
    barList(
      (rows || []).map((row) => ({
        label: row.name || "Not set",
        value: row.count || 0,
        amount: String(row.count)
      })),
      empty
    );

  document.getElementById("screen").innerHTML = `
    ${chips(ACT_TABS, filters.tab, "tab")}
    <div class="card form">
      <label class="form-field"><span>Month</span><select class="select" id="act-month">${options(months, filters.month)}</select></label>
      <label class="form-field"><span>Week</span><select class="select" id="act-week">${options(weeks, filters.week)}</select></label>
      <label class="form-field"><span>Relationship Manager</span>
        <select class="select" id="act-rm">
          <option value="">All RMs</option>
          ${options(data.rmOptions || [], filters.rm)}
        </select>
      </label>
      <button type="button" class="button-outline" id="act-reset">Clear Filters</button>
    </div>

    <div class="tiles">
      ${tile(`${filtered ? "" : "Total "}Client Meetings${filtered ? " · " + periodLabel : ""}`, data.totalClientMeetings)}
      ${tile(`${filtered ? "" : "Total "}Agency Briefings${filtered ? " · " + periodLabel : ""}`, data.totalAgencyBriefings)}
    </div>
    <p class="hint">A meeting or briefing attended by several RMs counts once in these numbers.</p>
    <div class="tiles">${kpis.join("")}</div>

    <div class="card form">
      <h2 class="form-title">${filtered ? `Target Leaderboard · ${esc(periodLabel)}` : "Weekly Target Leaderboard"}</h2>
      <p class="muted">${esc(targetNote)}</p>
      ${
        leaders.length
          ? leaders
              .map(
                (l, i) => `
        <div class="leader-block">
          <div class="owner-row">
            <span class="rank">${i + 1}</span>
            <span><b>${esc(l.row.name)}</b></span>
            <span class="pill ${l.met ? "pill-ok" : "pill-muted"}">${l.met ? "Target met" : Math.round(l.attainment * 100) + "%"}</span>
          </div>
          ${miniBar("Inbound", l.row.weekInbound, inTarget, l.inShare)}
          ${miniBar("Outbound", l.row.weekOutbound, outTarget, l.outShare)}
        </div>`
              )
              .join("")
          : `<p class="muted">${filtered ? "No activities in the selected period." : "No activities logged this week yet."}</p>`
      }
    </div>

    <div class="card form">
      <h2 class="form-title">${filtered ? `RM Activity · ${esc(periodLabel)}` : "RM Activity This Month"}</h2>
      <p class="muted">${filtered ? "Each RM's own records in the selected period." : "Greyed rows have logged nothing this week."}</p>
      ${
        (board.rmRows || []).length
          ? board.rmRows
              .map(
                (r) => `
        <div class="owner-row${!filtered && !r.weekCount ? " is-idle" : ""}">
          <span><b>${esc(r.name)}</b><br /><small>${
            filtered
              ? `${r.weekInbound} inbound · ${r.weekOutbound} outbound · ${r.hours} h`
              : `${r.weekCount} this week · ${r.hours} h this month`
          }${r.lastLogged ? ` · last ${esc(r.lastLogged)}` : ""}</small></span>
          <b>${r.monthCount}</b>
        </div>`
              )
              .join("")
          : `<p class="muted">${filtered ? "No activities in the selected period." : "No activities logged this month yet."}</p>`
      }
    </div>

    <div class="card form">
      <h2 class="form-title">${filtered ? "Agencies Not Covered in the Period" : "Agencies Needing Attention"}</h2>
      ${
        attention.length
          ? `<p class="muted">${esc(attentionNote)}</p>
             ${attention
               .map(
                 (a) => `
               <div class="owner-row">
                 <span><b>${esc(a.name)}</b><br /><small>${a.lastActivity ? `Last ${esc(a.lastActivity)} · ${a.daysSince} days ago` : "Never visited"} · ${a.count90} ${filtered ? "in period" : "in 90 days"}</small></span>
                 ${a.lastActivity ? "" : `<span class="pill pill-urgent">Never</span>`}
               </div>`
               )
               .join("")}`
          : `<p class="muted">${filtered ? `Every agency had a ${noun} in the ${esc(periodLabel)}.` : `Every agency has had a ${noun} in the last 60 days.`}</p>`
      }
    </div>

    <div class="card form">
      <h2 class="form-title">Outcomes</h2>
      ${countList(board.outcomes, "No outcomes recorded in this period.")}
    </div>

    <div class="card form">
      <h2 class="form-title">Projects Not in the List</h2>
      <p class="muted">Projects typed under "Other" when recording an activity.</p>
      ${countList(board.otherProjects, "None mentioned in this period.")}
    </div>`;

  root
    .querySelectorAll("[data-tab]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        reload({ tab: button.dataset.tab })
      )
    );
  // the week list belongs to the month, so a new month clears the week
  document
    .getElementById("act-month")
    .addEventListener("change", (e) =>
      reload({ month: e.target.value, week: "" })
    );
  document
    .getElementById("act-week")
    .addEventListener("change", (e) => reload({ week: e.target.value }));
  document
    .getElementById("act-rm")
    .addEventListener("change", (e) => reload({ rm: e.target.value }));
  document
    .getElementById("act-reset")
    .addEventListener("click", () =>
      go("sales-activity", { tab: filters.tab })
    );
}

function renderLeads(token, params) {
  if (isTeamScope(params)) {
    return renderTeamLeads(token, params);
  }
  const bucket = params.get("bucket") || "open";
  const search = params.get("search") || "";
  shell(
    "My Leads",
    `${scopeChips("mine")}${chips(LEAD_BUCKETS, bucket, "bucket")}
     <input class="search" id="search" type="search" placeholder="Search name, phone or email" value="${esc(search)}" />
     <div class="list" id="list"></div>`,
    "leads"
  );
  wireTeamList("leads", null);
  root
    .querySelectorAll("[data-bucket]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go("leads", { bucket: button.dataset.bucket, search })
      )
    );
  document.getElementById("search").addEventListener(
    "change",
    debounce(
      (event) => go("leads", { bucket, search: event.target.value.trim() }),
      300
    )
  );
  infiniteList(
    document.getElementById("list"),
    (offset) => get("leads", { bucket, search, pageSize: PAGE_SIZE, offset }),
    leadRow,
    "No leads here.",
    token
  );
}

// -------------------------------------------------------------------- deals

const DEAL_STEPS = [
  { key: "active", label: "Active" },
  { key: "eoiDraft", label: "EOI Draft" },
  { key: "eoiSubmitted", label: "EOI Submitted" },
  { key: "new", label: "New" },
  { key: "booked", label: "Booked" },
  { key: "reserved", label: "Reserved" },
  { key: "sold", label: "Sold" },
  { key: "shared", label: "Shared" },
  { key: "stuck", label: "Stuck" },
  { key: "bookingForm", label: "Booking Form" }
];

function dealRow(deal) {
  const opens = deal.kind === "deal";
  return `
    <article class="row${opens ? " is-link" : ""}"${opens ? ` data-open="#/deal?id=${esc(deal.id)}"` : ""}>
      <div class="row-head">
        <h4>${esc(deal.client || deal.title)}</h4>
        <span class="pill${deal.closed ? " pill-muted" : ""}">${esc(deal.step)}</span>
      </div>
      <p class="muted">${esc([deal.project, deal.unit].filter(Boolean).join(" · "))}</p>
      <p class="muted">${days(deal.daysInStep)} in this step${
        deal.stepDate ? " · since " + esc(shortDate(deal.stepDate)) : ""
      } ${deal.stuck ? `<span class="pill pill-urgent">Stuck</span>` : ""}${
        deal.sharedWith
          ? ` <span class="pill pill-info">Shared with ${esc(deal.sharedWith)}</span>`
          : ""
      }</p>
      ${deal.ownerName ? `<p class="muted">RM: <b>${esc(deal.ownerName)}</b></p>` : ""}
      ${deal.nextAction ? `<p class="next">${esc(deal.nextAction)}</p>` : ""}
    </article>`;
}

function renderDeals(token, params) {
  if (isTeamScope(params)) {
    return renderTeamDeals(token, params);
  }
  const step = params.get("step") || "active";
  const search = params.get("search") || "";
  shell(
    "My Deals",
    `${scopeChips("mine")}${chips(DEAL_STEPS, step, "step")}
     <input class="search" id="search" type="search" placeholder="Search client or unit" value="${esc(search)}" />
     <div class="list" id="list"></div>`,
    "deals"
  );
  wireTeamList("deals", null);
  root
    .querySelectorAll("[data-step]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go("deals", { step: button.dataset.step, search })
      )
    );
  document.getElementById("search").addEventListener(
    "change",
    debounce(
      (event) => go("deals", { step, search: event.target.value.trim() }),
      300
    )
  );
  openOnTap(document.getElementById("list"));
  infiniteList(
    document.getElementById("list"),
    (offset) => get("deals", { step, search, pageSize: PAGE_SIZE, offset }),
    dealRow,
    step === "shared" ? "You have no shared deals." : "No deals here.",
    token
  );
}

// -------------------------------------------------------------------- units

const UNIT_STATUSES = [
  { key: "available", label: "Available" },
  { key: "blocked", label: "Blocked" },
  { key: "booked", label: "Booked" },
  { key: "reserved", label: "Reserved" },
  { key: "sold", label: "Sold" },
  { key: "all", label: "All" }
];

function unitRow(unit) {
  const facts = [
    unit.type,
    unit.bedrooms == null
      ? null
      : unit.bedrooms === 0
        ? "Studio"
        : unit.bedrooms + " bed",
    unit.bathrooms == null ? null : unit.bathrooms + " bath",
    unit.areaSqFt == null ? null : wholeNumber.format(unit.areaSqFt) + " sq ft"
  ].filter(Boolean);
  const place = [
    unit.projectName,
    unit.building,
    unit.floor == null || unit.floor === "" ? null : "Floor " + unit.floor,
    unit.view
  ].filter(Boolean);
  // Available units (and Blocked ones, which only directors receive) can go into a sales offer.
  const offerable = unit.status === "available" || unit.status === "blocked";
  const picked = offerable
    ? esc(
        JSON.stringify({
          id: unit.id,
          title: unit.title,
          projectId: unit.projectId,
          projectName: unit.projectName,
          status: unit.status,
          multiOfferAllowed: unit.multiOfferAllowed !== false
        })
      )
    : "";
  return `
    <article class="row${offerable ? " is-selectable" : ""}${offerSelection.has(unit.id) ? " is-selected" : ""}"${
      offerable ? ` data-unit="${picked}"` : ""
    }>
      <div class="row-head">
        <h4>${offerable ? `<span class="check" aria-hidden="true"></span>` : ""}${esc(unit.title)}</h4>
        <span class="pill status-${esc(unit.status)}">${esc(unit.statusLabel)}</span>
      </div>
      <p class="muted">${esc(place.join(" · "))}</p>
      <p class="muted">${esc(facts.join(" · "))}</p>
      <p class="price">${esc(money(unit.price, unit.currencyCode))}</p>
    </article>`;
}

// ------------------------------------------------------------- sales offers

/** Units picked for a sales offer: id -> { id, title, projectId, projectName, multiOfferAllowed }. */
const offerSelection = new Map();
let offerOptions = null;

function toast(message) {
  document.querySelectorAll(".toast").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/**
 * One PDF per group. Units of different projects can be picked together: each project gets
 * its own offer, because every project has its own offer template. A layout that cannot go
 * into a multi-unit offer gets a single offer of its own.
 */
function offerGroups(units) {
  const groups = [];
  const byProject = new Map();
  units.forEach((unit) => {
    if (!unit.multiOfferAllowed) {
      groups.push({ projectName: unit.projectName, units: [unit] });
      return;
    }
    if (!byProject.has(unit.projectId)) {
      const group = { projectName: unit.projectName, units: [] };
      byProject.set(unit.projectId, group);
      groups.push(group);
    }
    byProject.get(unit.projectId).units.push(unit);
  });
  return groups;
}

function projectCount(units) {
  return new Set(units.map((unit) => unit.projectId)).size;
}

function toggleOfferUnit(unit, rowEl) {
  if (offerSelection.has(unit.id)) {
    offerSelection.delete(unit.id);
  } else {
    const limit = (offerOptions && offerOptions.maxUnits) || 15;
    const sameProject = [...offerSelection.values()].filter(
      (other) => other.projectId === unit.projectId
    );
    if (sameProject.length >= limit) {
      toast(
        "A maximum of " + limit + " units per project can go into one offer."
      );
      return;
    }
    offerSelection.set(unit.id, unit);
  }
  rowEl.classList.toggle("is-selected", offerSelection.has(unit.id));
  renderOfferBar();
}

function clearOfferSelection() {
  offerSelection.clear();
  document
    .querySelectorAll(".row.is-selected")
    .forEach((el) => el.classList.remove("is-selected"));
  renderOfferBar();
}

function renderOfferBar() {
  let bar = document.getElementById("offer-bar");
  document.body.classList.toggle("has-offer-bar", offerSelection.size > 0);
  if (offerSelection.size === 0) {
    if (bar) {
      bar.remove();
    }
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "offer-bar";
    bar.className = "offer-bar";
    root.appendChild(bar);
  }
  const units = [...offerSelection.values()];
  const projects = projectCount(units);
  bar.innerHTML = `
    <div class="offer-bar-text">
      <b>${units.length} unit${units.length === 1 ? "" : "s"} selected</b>
      <span>${projects === 1 ? esc(units[0].projectName) : projects + " projects"}</span>
    </div>
    <button class="bar-button bar-clear" id="offer-clear">Clear</button>
    ${
      units.length === 1 && units[0].status === "available"
        ? `<button class="bar-button bar-book" id="offer-book">Book</button>`
        : ""
    }
    <button class="bar-button bar-go" id="offer-go">Sales Offer</button>`;
  const book = document.getElementById("offer-book");
  if (book) {
    book.addEventListener("click", () =>
      go("booking-new", { unit: units[0].id })
    );
  }
  document
    .getElementById("offer-clear")
    .addEventListener("click", clearOfferSelection);
  document.getElementById("offer-go").addEventListener("click", openOfferSheet);
}

function closeSheet() {
  document.querySelectorAll(".sheet-backdrop").forEach((el) => el.remove());
}

function sizeText(bytes) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

async function openOfferSheet() {
  const groups = offerGroups([...offerSelection.values()]);
  if (!groups.length) {
    return;
  }
  const unitTotal = groups.reduce((sum, group) => sum + group.units.length, 0);
  const anyMulti = groups.some((group) => group.units.length > 1);
  closeSheet();
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div id="sheet-body">${loading()}</div></div>`;
  document.body.appendChild(backdrop);
  const body = backdrop.querySelector("#sheet-body");
  let busy = false;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop && !busy) {
      closeSheet();
    }
  });
  const closeOnly = (message) => {
    body.innerHTML = `${errorBox(message)}<button class="button-secondary" id="sheet-close">Close</button>`;
    body.querySelector("#sheet-close").addEventListener("click", closeSheet);
  };

  try {
    if (!offerOptions) {
      offerOptions = await get("offers/options");
    }
  } catch (error) {
    closeOnly(error.message);
    return;
  }
  if (!offerOptions.allowed) {
    closeOnly("Sales offers are not available for your profile.");
    return;
  }

  const groupList = groups
    .map(
      (group) => `
      <div class="sheet-group">
        <p class="sheet-group-title">${esc(group.projectName)} · ${
          group.units.length === 1
            ? "single offer"
            : "one offer for " + group.units.length + " units"
        }</p>
        <ul class="sheet-units">${group.units.map((u) => `<li>${esc(u.title)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
  const currencyPicker = anyMulti
    ? `<label class="field-label" for="offer-currency">Also show prices in (optional, multi-unit offers)</label>
       <select class="select" id="offer-currency">
         <option value="">Project currency only</option>
         ${(offerOptions.currencies || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
       </select>`
    : "";
  const pdfWord = groups.length === 1 ? "PDF" : groups.length + " PDFs";
  body.innerHTML = `
    <h2>${unitTotal === 1 ? "Sales Offer" : "Sales Offer for " + unitTotal + " Units"}</h2>
    ${
      groups.length > 1
        ? `<p class="muted">Each project has its own offer document, so you get ${groups.length} PDFs.</p>`
        : ""
    }
    ${groupList}
    ${currencyPicker}
    <div id="sheet-status"></div>
    <button class="button-primary" id="offer-generate">Generate ${pdfWord}</button>
    <button class="button-plain" id="sheet-close">Cancel</button>`;
  body.querySelector("#sheet-close").addEventListener("click", closeSheet);

  body.querySelector("#offer-generate").addEventListener("click", async () => {
    const status = body.querySelector("#sheet-status");
    const currencyEl = body.querySelector("#offer-currency");
    const currencyCode = currencyEl ? currencyEl.value : "";
    busy = true;
    body.querySelector("#offer-generate").disabled = true;
    body.querySelector("#sheet-close").disabled = true;
    const step = (text) => {
      status.innerHTML = `<div class="working"><span class="spinner"></span><span>${esc(text)}</span></div>`;
    };
    const outcomes = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const label =
        groups.length === 1
          ? ""
          : " (" + (i + 1) + " of " + groups.length + ")";
      const request = {
        unitIds: group.units.map((u) => u.id),
        currencyCode: group.units.length > 1 ? currencyCode : ""
      };
      try {
        step("Preparing" + label + "…");
        await post("offers/cleanup", request);
        step("Generating the PDF" + label + "…");
        const result = await post("offers/generate", request);
        step("Downloading" + label + "…");
        // two offers made on one day share a title, so the project name keeps the files apart
        const fileName =
          groups.length > 1 && group.units.length > 1
            ? result.fileName.replace(
                /\.pdf$/i,
                " - " + group.projectName.replace(/[\\/:*?"<>|]/g, " ") + ".pdf"
              )
            : result.fileName;
        const file = await downloadFile(
          result.contentVersionId,
          fileName,
          "application/pdf"
        );
        outcomes.push({ group, file });
      } catch (error) {
        if (error instanceof SignedOutError) {
          busy = false;
          closeSheet();
          handleError(error);
          return;
        }
        outcomes.push({ group, error: error.message });
      }
    }
    busy = false;
    if (outcomes.every((outcome) => outcome.error)) {
      status.innerHTML = errorBox(outcomes[0].error);
      body.querySelector("#offer-generate").disabled = false;
      body.querySelector("#offer-generate").textContent = "Try Again";
      body.querySelector("#sheet-close").disabled = false;
      return;
    }
    showOfferResult(body, outcomes);
  });
}

function showOfferResult(body, outcomes) {
  const done = outcomes.filter((outcome) => outcome.file);
  const failed = outcomes.filter((outcome) => outcome.error);
  const files = done.map((outcome) => outcome.file);
  const urls = files.map((file) => URL.createObjectURL(file));
  const canShare = Boolean(navigator.canShare && navigator.canShare({ files }));
  const fileRows = done
    .map(
      (outcome, i) => `
      <div class="file-row">
        <div class="file-text">
          <b>${esc(outcome.group.projectName)}</b>
          <span>${esc(outcome.file.name)} · ${sizeText(outcome.file.size)}</span>
        </div>
        <a class="file-link" href="${urls[i]}" target="_blank" rel="noopener">Open</a>
        <a class="file-link" href="${urls[i]}" download="${esc(outcome.file.name)}">Save</a>
      </div>`
    )
    .join("");
  const failedRows = failed
    .map(
      (outcome) =>
        `<div class="notice notice-error">${esc(outcome.group.projectName)}: ${esc(outcome.error)}</div>`
    )
    .join("");
  body.innerHTML = `
    <div class="done-mark">✓</div>
    <h2>${files.length === 1 ? "Sales Offer Ready" : files.length + " Sales Offers Ready"}</h2>
    <p class="muted">Saved on the unit${files.length === 1 ? "" : "s"} in Salesforce as well.</p>
    <div class="file-list">${fileRows}</div>
    ${failedRows}
    ${
      canShare
        ? `<button class="button-primary" id="offer-share">Share ${files.length === 1 ? "" : "All "}(WhatsApp, Email…)</button>`
        : ""
    }
    <button class="button-plain" id="sheet-done">Done</button>`;
  if (canShare) {
    body.querySelector("#offer-share").addEventListener("click", async () => {
      try {
        await navigator.share({ files, title: "Sales Offer" });
      } catch (e) {
        // the user closed the share sheet
      }
    });
  }
  body.querySelector("#sheet-done").addEventListener("click", () => {
    urls.forEach((url) => URL.revokeObjectURL(url));
    clearOfferSelection();
    closeSheet();
  });
}

async function renderUnits(token, params) {
  const filters = {
    projectId: params.get("projectId") || "",
    status: params.get("status") || "available",
    bedrooms: params.get("bedrooms") || "",
    search: params.get("search") || ""
  };
  // Blocked units are for directors only; On Approval units are shown to nobody.
  const unitStatuses = UNIT_STATUSES.filter(
    (option) => option.key !== "blocked" || (me && me.canSeeBlockedUnits)
  );
  if (!unitStatuses.some((option) => option.key === filters.status)) {
    filters.status = "available";
  }
  shell("Units", loading(), "units");
  const projects = await get("projects");
  if (token !== renderToken) {
    return;
  }
  const projectOptions = [`<option value="">All projects</option>`]
    .concat(
      projects.map(
        (p) =>
          `<option value="${esc(p.id)}"${p.id === filters.projectId ? " selected" : ""}>${esc(p.name)} (${p.availableUnits} available)</option>`
      )
    )
    .join("");
  const bedroomOptions = [
    ["", "Any bedrooms"],
    ["0", "Studio"],
    ["1", "1 bedroom"],
    ["2", "2 bedrooms"],
    ["3", "3 bedrooms"],
    ["4", "4 bedrooms"],
    ["5", "5 bedrooms"]
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === filters.bedrooms ? " selected" : ""}>${label}</option>`
    )
    .join("");

  document.getElementById("screen").innerHTML = `
    <select class="select" id="project">${projectOptions}</select>
    ${chips(unitStatuses, filters.status, "status")}
    <div class="filter-row">
      <select class="select" id="bedrooms">${bedroomOptions}</select>
      <input class="search" id="search" type="search" placeholder="Search unit or building" value="${esc(filters.search)}" />
    </div>
    <p class="hint">Tap available units to select them for a sales offer.</p>
    <div class="list" id="list"></div>`;

  document.getElementById("list").addEventListener("click", (event) => {
    const rowEl = event.target.closest(".row.is-selectable");
    if (rowEl) {
      toggleOfferUnit(JSON.parse(rowEl.dataset.unit), rowEl);
    }
  });
  renderOfferBar();

  const apply = (change) => go("units", { ...filters, ...change });
  document
    .getElementById("project")
    .addEventListener("change", (e) => apply({ projectId: e.target.value }));
  document
    .getElementById("bedrooms")
    .addEventListener("change", (e) => apply({ bedrooms: e.target.value }));
  document
    .getElementById("search")
    .addEventListener("change", (e) =>
      apply({ search: e.target.value.trim() })
    );
  root
    .querySelectorAll("[data-status]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        apply({ status: button.dataset.status })
      )
    );
  infiniteList(
    document.getElementById("list"),
    (offset) => get("units", { ...filters, pageSize: PAGE_SIZE, offset }),
    unitRow,
    "No units match these filters.",
    token
  );
}

// ------------------------------------------------------------- deal detail

async function renderDeal(token, params) {
  shell("Deal", loading(), "deals", { back: "#/deals" });
  const deal = await get("deals/detail", { id: params.get("id") });
  if (token !== renderToken) {
    return;
  }
  document.getElementById("screen").innerHTML = `
    <div class="card">
      <div class="row-head">
        <h2 class="detail-title">${esc(deal.client || deal.title)}</h2>
        <span class="pill">${esc(deal.stage)}</span>
      </div>
      <p class="muted">${esc(deal.title)}</p>
    </div>
    <div class="card">
      ${field("Project", deal.project)}
      ${field("Unit", deal.unit)}
      ${field("Price", deal.price == null ? "" : money(deal.price, deal.currencyCode))}
      ${field("Booking date", dateTime12(deal.bookingDate))}
      ${field("Booking form signed", deal.bookingFormSigned ? "Yes" : "No")}
      ${field("SPA status", deal.spaStatus)}
      ${field("Deal owner", deal.ownerName)}
      ${field("Shared with", deal.sharedWith)}
      ${field("Created", shortDate(deal.createdDate))}
    </div>
    <div id="buyers-box"></div>
    <div id="booking-form-box"></div>
    ${
      ["New", "Cancelled", "Transferred"].includes(deal.stage)
        ? ""
        : `<div class="card form">
             <h2 class="form-title">Raise a Request</h2>
             <a class="button-outline button-link" href="#/request-dld?deal=${esc(deal.id)}">DLD Waiver Request</a>
             <a class="button-outline button-link below" href="#/request-price?deal=${esc(deal.id)}">Unit Price Change</a>
             <a class="button-outline button-link below" href="#/request-share?deal=${esc(deal.id)}">Share Deal</a>
             <a class="button-outline button-link below" href="#/request-plan?deal=${esc(deal.id)}">Payment Plan Change</a>
             ${
               deal.stage === "Booked"
                 ? `<a class="button-outline button-link below button-reject" href="#/request-cancel?deal=${esc(deal.id)}">Request Cancellation</a>`
                 : ""
             }
           </div>`
    }
    <div id="requests-box"></div>
    ${
      deal.clientId
        ? `<a class="button-outline button-link" href="#/client?id=${esc(deal.clientId)}&from=deal:${esc(deal.id)}">Open Client</a>`
        : ""
    }`;
  buyersBox(deal, token);
  bookingFormBox(deal, token);
  requestsBox(deal, token);
}

// ------------------------------------------------ approval requests of a deal
// The history is the list the "Approval History" component shows on the deal in Salesforce,
// and Salesforce decides who sees it (the same permission); for anyone else the box is absent.

const REQUEST_STATUS_PILL = {
  Pending: "pill-warn",
  "In Process": "pill-warn",
  Approved: "pill-info",
  Applied: "pill-ok",
  Rejected: "pill-urgent",
  Reverted: "pill-muted",
  Cancelled: "pill-muted",
  Draft: "pill-muted"
};

/** "Registration_Fees__c" is the field's technical name; show it in plain words. */
function plainFieldName(apiName) {
  if (apiName === "StageName") {
    return "Deal stage";
  }
  return String(apiName || "")
    .replace(/__c$/, "")
    .replace(/_/g, " ")
    .trim();
}

function requestCard(r) {
  const change =
    r.currentValue || r.requestedValue
      ? field(
          plainFieldName(r.fieldToUpdate) || "Change",
          (r.currentValue || "—") + " → " + (r.requestedValue || "—")
        )
      : "";
  const steps = (r.steps || [])
    .map(
      (s) => `
      <li>
        <b>${esc(s.action === "Started" ? "Submitted" : s.action)}</b> by ${esc(s.actorName || "—")}
        <small>${esc(dateTime12(s.actionDate))}</small>
        ${s.comments ? `<span>${esc(s.comments)}</span>` : ""}
      </li>`
    )
    .join("");
  return `
    <details class="request-row">
      <summary>
        <span><b>${esc(r.requestType)}</b><br /><small>${esc(r.name)} · ${esc(shortDate(r.createdDate))}</small></span>
        <span class="pill ${REQUEST_STATUS_PILL[r.status] || ""}">${esc(r.status)}</span>
      </summary>
      ${change}
      ${field("Requested by", r.requesterName)}
      ${field("Justification", r.justification)}
      ${
        r.isReverted
          ? field("Reverted by", r.revertedByName) +
            field("Reverted on", dateTime12(r.revertedOn)) +
            field("Revert reason", r.revertReason)
          : ""
      }
      ${steps ? `<ul class="request-steps">${steps}</ul>` : ""}
      <a class="button-outline button-link" href="#/approval?id=${esc(r.id)}">Open Request</a>
    </details>`;
}

/** A request that is waiting for a decision, shown instead of the form. */
function openRequestNote(title, open, extraRows) {
  return `
    <div class="notice notice-warn notice-left">
      <b>${esc(title)} ${esc(open.name || "")} is ${esc(String(open.status || "").toLowerCase())}</b>
      ${extraRows}
      ${field("Justification", open.justification)}
      <p>A new request can be raised once this one is decided.</p>
    </div>`;
}

/**
 * Who decides first, exactly as Salesforce does it for each request: either this user picks a
 * Sales Director from a list, or the request goes to their line manager.
 */
function approverPart(view) {
  if (view.approvers) {
    return `
      <label class="form-field">
        <span>First approver *</span>
        <select class="select" id="request-approver">
          <option value="">Select…</option>
          ${view.approvers.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}
        </select>
      </label>`;
  }
  return view.lineManager
    ? `<p class="muted">This request goes first to your line manager, <b>${esc(view.lineManager)}</b>.</p>`
    : errorBox(
        view.noApproverReason ||
          "Your user has no active line manager in Salesforce, so the request has nobody to go to. Ask the Salesforce admin to set your Manager."
      );
}

async function renderRequestDld(token, params) {
  const dealId = params.get("deal");
  const back = "#/deal?id=" + dealId;
  shell("DLD Waiver Request", loading(), "deals", { back });
  const view = await get("requests/dldwaiver", { dealId });
  if (token !== renderToken) {
    return;
  }
  const info = view.info || {};
  const screen = document.getElementById("screen");
  const summary = `
    <div class="card">
      ${field("Deal", info.opportunityName)}
      ${field("Client", info.accountName)}
      ${field("Unit", [info.projectName, info.unitTitle].filter(Boolean).join(" · "))}
      ${field("Stage", info.stageName)}
      ${field("Registration fee now", info.currentFee)}
    </div>`;

  if (view.open) {
    screen.innerHTML =
      summary +
      openRequestNote(
        "DLD waiver request",
        view.open,
        field("Requested fee", view.open.requestedFee)
      );
    return;
  }
  if (!view.canRequest) {
    screen.innerHTML =
      summary + errorBox("Your profile cannot raise a DLD waiver request.");
    return;
  }
  if (!info.eligible) {
    screen.innerHTML =
      summary +
      errorBox(
        info.ineligibleReason ||
          "This deal cannot have a DLD waiver request now."
      );
    return;
  }

  const choices = (info.feeOptions || []).filter((f) => f !== info.currentFee);
  screen.innerHTML = `
    ${summary}
    <form class="card form" id="request-form" novalidate>
      <div class="form-field">
        <span>Requested registration fee *</span>
        <div class="checks">${choices
          .map(
            (fee) => `
          <label class="form-check">
            <input type="radio" name="fee" value="${esc(fee)}" />
            <span>${esc(fee)}</span>
          </label>`
          )
          .join("")}</div>
      </div>
      <label class="form-field">
        <span>Justification * (at least 10 characters)</span>
        <textarea class="search" rows="4" id="request-justification" maxlength="2000" placeholder="Why should the fee split change?"></textarea>
      </label>
      ${approverPart(view)}
      <div id="form-status"></div>
      ${view.approvers || view.lineManager ? `<button class="button-primary" type="submit" id="request-submit">Submit for Approval</button>` : ""}
      <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
    </form>`;

  const form = document.getElementById("request-form");
  const status = document.getElementById("form-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fee = form.querySelector('input[name="fee"]:checked');
    const justification = document
      .getElementById("request-justification")
      .value.trim();
    const approver = document.getElementById("request-approver");
    const problem = !fee
      ? "Please choose the requested registration fee."
      : justification.length < 10
        ? "Please write a justification of at least 10 characters."
        : approver && !approver.value
          ? "Please choose the first approver."
          : "";
    if (problem) {
      status.innerHTML = errorBox(problem);
      return;
    }
    const button = document.getElementById("request-submit");
    button.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Submitting…</span></div>`;
    try {
      await post("requests/dldwaiver/submit", {
        dealId,
        requestedFee: fee.value,
        justification,
        approverId: approver ? approver.value : null
      });
      toast("DLD waiver request submitted.");
      location.hash = back;
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
      button.disabled = false;
    }
  });
}

/**
 * Request Cancellation: a reason, then two approvals (line manager, then Sales Admin). Only the
 * final approval cancels the deal, and that cannot be undone, so the request is confirmed with
 * a second tap before it is sent.
 */
async function renderRequestCancel(token, params) {
  const dealId = params.get("deal");
  const back = "#/deal?id=" + dealId;
  shell("Request Cancellation", loading(), "deals", { back });
  const view = await get("requests/cancellation", { dealId });
  if (token !== renderToken) {
    return;
  }
  const info = view.info || {};
  const screen = document.getElementById("screen");
  const summary = `
    <div class="card">
      ${field("Deal", info.opportunityName)}
      ${field("Client", info.accountName)}
      ${field("Unit", [info.projectName, info.unitTitle].filter(Boolean).join(" · "))}
      ${field("Stage", info.stageName)}
      ${field("Deal owner", info.ownerName)}
    </div>`;

  if (view.open) {
    screen.innerHTML =
      summary +
      openRequestNote(
        "Cancellation request",
        view.open,
        field("Requested by", view.open.requesterName)
      ) +
      `<a class="button-outline button-link" href="#/approval?id=${esc(view.open.approvalRequestId)}">Open Request</a>`;
    return;
  }
  if (!info.eligible) {
    screen.innerHTML =
      summary +
      errorBox(
        info.ineligibleReason ||
          "A cancellation cannot be requested for this deal now."
      );
    return;
  }

  screen.innerHTML = `
    ${summary}
    <div class="notice notice-warn notice-left">
      <b>What happens</b>
      <p>The deal stays Booked while the request is waiting. Two approvals are needed: your line manager first, then Sales Admin. After the final approval the deal is cancelled and the unit is released. This cannot be undone.</p>
    </div>
    <form class="card form" id="request-form" novalidate>
      <label class="form-field">
        <span>Reason for cancellation * (at least 10 characters)</span>
        <textarea class="search" rows="4" id="request-justification" maxlength="255" placeholder="Why should this deal be cancelled?"></textarea>
      </label>
      ${approverPart(view)}
      <div id="form-status"></div>
      ${view.approvers || view.lineManager ? `<button class="button-primary" type="submit" id="request-submit">Submit for Approval</button>` : ""}
      <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
    </form>`;

  const form = document.getElementById("request-form");
  const status = document.getElementById("form-status");
  const button = document.getElementById("request-submit");
  let confirmed = false;
  const unconfirm = () => {
    if (confirmed && button) {
      confirmed = false;
      button.textContent = "Submit for Approval";
      status.innerHTML = "";
    }
  };
  // a change after the first tap asks for the confirmation again
  form.addEventListener("input", unconfirm);
  form.addEventListener("change", unconfirm);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const justification = document
      .getElementById("request-justification")
      .value.trim();
    const approver = document.getElementById("request-approver");
    const problem =
      justification.length < 10
        ? "Please write a reason of at least 10 characters."
        : approver && !approver.value
          ? "Please choose the first approver."
          : "";
    if (problem) {
      status.innerHTML = errorBox(problem);
      return;
    }
    if (!confirmed) {
      confirmed = true;
      button.textContent = "Tap Again to Send the Request";
      status.innerHTML = `<div class="notice notice-warn">You are asking to cancel <b>${esc(info.opportunityName)}</b>. Tap again to send the request.</div>`;
      return;
    }
    button.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Submitting…</span></div>`;
    try {
      await post("requests/cancellation/submit", {
        dealId,
        justification,
        approverId: approver ? approver.value : null
      });
      toast("Cancellation request submitted.");
      location.hash = back;
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      confirmed = false;
      button.textContent = "Submit for Approval";
      status.innerHTML = errorBox(error.message);
      button.disabled = false;
    }
  });
}

function approvalRow(r) {
  return `
    <article class="row is-link" data-open="#/approval?id=${esc(r.id)}">
      <div class="row-head">
        <h4>${esc(r.requestType)}</h4>
        <span class="pill pill-warn">Waiting</span>
      </div>
      <p class="muted">${esc([r.subject, r.name].filter(Boolean).join(" · "))}</p>
      ${r.change ? `<p class="muted">${esc(r.change)}</p>` : ""}
      <p class="muted">From ${esc(r.requester || "—")} · ${esc(dateTime12(r.submitted))}</p>
    </article>`;
}

/** One request the user raised: what, where it stands, and who has it now. */
function myRequestRow(r) {
  const where = r.open
    ? r.waitingFor
      ? "Waiting for " + r.waitingFor
      : "Waiting for a decision"
    : r.decided
      ? "Decided " + shortDate(r.decided)
      : "";
  return `
    <article class="row is-link" data-open="#/approval?id=${esc(r.id)}&from=mine">
      <div class="row-head">
        <h4>${esc(r.requestType)}</h4>
        <span class="pill ${REQUEST_STATUS_PILL[r.status] || ""}">${esc(r.open ? "Waiting" : r.status)}</span>
      </div>
      <p class="muted">${esc([r.subject, r.name].filter(Boolean).join(" · "))}</p>
      ${r.change ? `<p class="muted">${esc(r.change)}</p>` : ""}
      <p class="muted">${where ? `<b>${esc(where)}</b> · ` : ""}Sent ${esc(dateTime12(r.submitted))}</p>
    </article>`;
}

/** Every request the user raised (the latest 50), open ones first. */
async function renderMyRequests(token) {
  shell("My Requests", loading(), "home", { back: "#/home" });
  const rows = await get("requests/mine");
  if (token !== renderToken) {
    return;
  }
  const open = rows.filter((r) => r.open);
  const decided = rows.filter((r) => !r.open);
  const screen = document.getElementById("screen");
  screen.innerHTML = rows.length
    ? `${
        open.length
          ? `<h3 class="section-title">Open</h3>
             <div class="list">${open.map(myRequestRow).join("")}</div>`
          : emptyBox("None of your requests is waiting for a decision.")
      }
      ${
        decided.length
          ? `<h3 class="section-title">Decided</h3>
             <div class="list">${decided.map(myRequestRow).join("")}</div>`
          : ""
      }
      <p class="end">End of list</p>`
    : emptyBox(
        "You have not raised any request yet. Requests are raised from a deal."
      );
  openOnTap(screen);
}

async function renderApprovals(token) {
  shell("My Approvals", loading(), "home", { back: "#/home" });
  const rows = await get("approvals");
  if (token !== renderToken) {
    return;
  }
  setWaiting(rows.length);
  const screen = document.getElementById("screen");
  screen.innerHTML = rows.length
    ? `<div class="list" id="list">${rows.map(approvalRow).join("")}</div>
       <p class="end">End of list</p>`
    : emptyBox("Nothing is waiting for your approval.");
  const list = document.getElementById("list");
  if (list) {
    openOnTap(list);
  }
}

async function renderApproval(token, params) {
  const id = params.get("id");
  shell("Request", loading(), "home", {
    back: params.get("from") === "mine" ? "#/my-requests" : "#/approvals"
  });
  let r = await get("approvals/detail", { id });
  if (token !== renderToken) {
    return;
  }
  const screen = document.getElementById("screen");
  let note = "";

  function draw() {
    const price =
      r.currentPrice != null || r.requestedPrice != null
        ? field(
            "Price",
            money(r.currentPrice, r.priceCurrency) +
              " → " +
              money(r.requestedPrice, r.priceCurrency)
          ) +
          field(
            "Discount",
            r.discountPercent == null ? "" : r.discountPercent + "%"
          )
        : "";
    const steps = (r.steps || [])
      .map(
        (s) => `
        <li>
          <b>${esc(s.action)}</b> by ${esc(s.actor || "—")}
          <small>${esc(dateTime12(s.actionDate))}</small>
          ${s.comments ? `<span>${esc(s.comments)}</span>` : ""}
        </li>`
      )
      .join("");
    screen.innerHTML = `
      <div class="card">
        <div class="row-head">
          <h2 class="detail-title">${esc(r.requestType)}</h2>
          <span class="pill ${REQUEST_STATUS_PILL[r.status] || ""}">${esc(r.status)}</span>
        </div>
        <p class="muted">${esc(r.name)}</p>
      </div>
      <div class="card">
        <h2 class="form-title">What Is Asked</h2>
        ${
          r.currentValue || r.requestedValue
            ? field(
                plainFieldName(r.fieldToUpdate) || "Change",
                (r.currentValue || "—") + " → " + (r.requestedValue || "—")
              )
            : ""
        }
        ${price}
        ${field("Share with", r.requestedSharedRm)}
        ${field("Requested by", r.requester)}
        ${field("Requested on", dateTime12(r.requestDate))}
        ${field("Justification", r.justification)}
        ${
          r.requestType === "Cancellation"
            ? `<div class="notice notice-warn notice-left"><p>Two approvals are needed: the line manager first, then Sales Admin. On the final approval the deal is cancelled and the unit is released. This cannot be undone.</p></div>`
            : ""
        }
      </div>
      ${planComparison(r.paymentPlan)}
      <div class="card">
        <h2 class="form-title">The Deal</h2>
        ${field("Client", r.client)}
        ${field("Project", r.project)}
        ${field("Unit", r.unit)}
        ${field("Deal", r.dealName)}
        ${field("Stage", r.dealStage)}
        ${
          r.dealId && r.canOpenDeal
            ? `<a class="button-outline button-link" href="#/deal?id=${esc(r.dealId)}">Open the Deal</a>`
            : !r.dealId
              ? `<p class="muted">No deal is linked to this request.</p>`
              : ""
        }
      </div>
      <div class="card">
        <h2 class="form-title">Decisions So Far</h2>
        ${steps ? `<ul class="request-steps">${steps}</ul>` : `<p class="muted">None yet.</p>`}
        ${
          (r.waitingFor || []).length
            ? `<p class="muted">Waiting for: <b>${esc(r.waitingFor.join(", "))}</b></p>`
            : ""
        }
      </div>
      ${
        r.canDecide
          ? `<div class="card form">
               <h2 class="form-title">Your Decision</h2>
               <label class="form-field">
                 <span>Comment (required when rejecting)</span>
                 <textarea class="search" rows="3" id="decision-comment" maxlength="4000"></textarea>
               </label>
               <div id="form-status">${note}</div>
               <button type="button" class="button-primary" data-decide="approve">Approve</button>
               <button type="button" class="button-outline button-reject" data-decide="reject">Reject</button>
             </div>`
          : note
            ? `<div class="card">${note}</div>`
            : ""
      }`;
  }

  screen.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-decide]");
    if (!button) {
      return;
    }
    const action = button.dataset.decide;
    const comments = document.getElementById("decision-comment").value.trim();
    const status = document.getElementById("form-status");
    if (action === "reject" && comments.length < 3) {
      status.innerHTML = errorBox("Please write the reason for rejecting.");
      document.getElementById("decision-comment").focus();
      return;
    }
    // one more tap: a decision cannot be taken back from here
    if (button.dataset.sure !== "yes") {
      screen.querySelectorAll("[data-decide]").forEach((other) => {
        other.dataset.sure = "";
        other.textContent =
          other.dataset.decide === "approve" ? "Approve" : "Reject";
      });
      button.dataset.sure = "yes";
      button.textContent =
        action === "approve" ? "Tap Again to Approve" : "Tap Again to Reject";
      status.innerHTML = "";
      return;
    }
    screen.querySelectorAll("[data-decide]").forEach((other) => {
      other.disabled = true;
    });
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Saving your decision…</span></div>`;
    try {
      r = await post("approvals/decide", { requestId: id, action, comments });
      note = `<div class="notice notice-ok notice-left"><b>${action === "approve" ? "Approved" : "Rejected"}</b><p>${
        (r.waitingFor || []).length
          ? "The request now goes to " + esc(r.waitingFor.join(", ")) + "."
          : "The request is decided."
      }</p></div>`;
      toast(action === "approve" ? "Approved." : "Rejected.");
      refreshWaiting();
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      note = errorBox(error.message);
      try {
        r = await get("approvals/detail", { id });
      } catch (e) {
        // keep what is on the screen
      }
    }
    if (token === renderToken) {
      draw();
      window.scrollTo(0, document.body.scrollHeight);
    }
  });
  draw();
}

async function renderRequestPrice(token, params) {
  const dealId = params.get("deal");
  const back = "#/deal?id=" + dealId;
  shell("Unit Price Change", loading(), "deals", { back });
  const view = await get("requests/unitprice", { dealId });
  if (token !== renderToken) {
    return;
  }
  const info = view.info || {};
  const screen = document.getElementById("screen");
  const summary = `
    <div class="card">
      ${field("Unit", info.unitTitle)}
      ${field("Project", info.projectName)}
      ${field("Unit status", info.unitStatus)}
      ${field("Price now", info.currentPrice == null ? "" : money(info.currentPrice, info.currencyCode))}
    </div>`;

  if (view.open) {
    screen.innerHTML =
      summary +
      openRequestNote(
        "Unit price change request",
        view.open,
        field(
          "Requested price",
          money(view.open.requestedPrice, view.open.currencyCode)
        )
      );
    return;
  }
  if (view.reason) {
    screen.innerHTML = summary + errorBox(view.reason);
    return;
  }
  if (info.currentPrice == null) {
    screen.innerHTML =
      summary +
      errorBox(
        "This unit has no price in Salesforce, so a discount cannot be worked out."
      );
    return;
  }

  // the same arithmetic as Salesforce: whole amounts, rounded half up
  const discounted = (percent) =>
    Math.round(info.currentPrice * (1 - percent / 100));
  // System Administrator and Sales Admin pick the first approver; everyone else needs a manager
  const canSubmit = Boolean(view.approvers || view.lineManager);
  screen.innerHTML = `
    ${summary}
    <form class="card form" id="request-form" novalidate>
      <label class="form-field">
        <span>Discount *</span>
        <select class="select" id="request-discount">
          <option value="">Select a discount (1 to 10%)</option>
          ${(view.discounts || [])
            .map(
              (percent) =>
                `<option value="${percent}">${percent}%  →  ${esc(money(discounted(percent), info.currencyCode))}</option>`
            )
            .join("")}
        </select>
      </label>
      <div id="price-preview"></div>
      <label class="form-field">
        <span>Justification * (at least 10 characters)</span>
        <textarea class="search" rows="4" id="request-justification" maxlength="2000" placeholder="Why should the price change?"></textarea>
      </label>
      ${approverPart(view)}
      <div id="form-status"></div>
      ${canSubmit ? `<button class="button-primary" type="submit" id="request-submit">Submit for Approval</button>` : ""}
      <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
    </form>`;

  const form = document.getElementById("request-form");
  const status = document.getElementById("form-status");
  const select = document.getElementById("request-discount");
  select.addEventListener("change", () => {
    const percent = Number(select.value);
    document.getElementById("price-preview").innerHTML = percent
      ? `<div class="notice notice-left price-preview">
           ${field("Price now", money(info.currentPrice, info.currencyCode))}
           ${field("Requested price", money(discounted(percent), info.currencyCode))}
           ${field("Difference", money(info.currentPrice - discounted(percent), info.currencyCode))}
         </div>`
      : "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const percent = Number(select.value);
    const justification = document
      .getElementById("request-justification")
      .value.trim();
    const approver = document.getElementById("request-approver");
    const problem = !percent
      ? "Please choose the discount."
      : justification.length < 10
        ? "Please write a justification of at least 10 characters."
        : approver && !approver.value
          ? "Please choose the first approver."
          : "";
    if (problem) {
      status.innerHTML = errorBox(problem);
      return;
    }
    const button = document.getElementById("request-submit");
    button.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Submitting…</span></div>`;
    try {
      await post("requests/unitprice/submit", {
        dealId,
        discountPercent: percent,
        justification,
        approverId: approver ? approver.value : null
      });
      toast("Unit price change request submitted.");
      location.hash = back;
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
      button.disabled = false;
    }
  });
}

async function renderRequestShare(token, params) {
  const dealId = params.get("deal");
  const back = "#/deal?id=" + dealId;
  shell("Share Deal", loading(), "deals", { back });
  const view = await get("requests/sharedeal", { dealId });
  if (token !== renderToken) {
    return;
  }
  const info = view.info || {};
  const screen = document.getElementById("screen");
  const half =
    view.price == null ? "" : money(view.price / 2, view.currencyCode);
  const summary = `
    <div class="card">
      ${field("Deal", info.opportunityName)}
      ${field("Stage", info.stageName)}
      ${field("Owner (first RM)", info.ownerName)}
      ${info.shareDeal ? field("Shared now with", info.sharedRmName) : ""}
      ${field("Unit price", view.price == null ? "" : money(view.price, view.currencyCode))}
      ${field("Each RM's credit (50%)", half)}
    </div>`;

  if (view.open) {
    screen.innerHTML =
      summary +
      openRequestNote(
        "Share deal request",
        view.open,
        field("Second RM asked for", view.open.requestedSharedRmName)
      );
    return;
  }
  if (view.reason) {
    screen.innerHTML = summary + errorBox(view.reason);
    return;
  }

  const rms = view.rms || [];
  // System Administrator and Sales Admin pick the first approver; everyone else needs a manager
  const canSubmit = Boolean(view.approvers || view.lineManager);
  screen.innerHTML = `
    ${summary}
    ${
      info.shareDeal
        ? `<div class="notice notice-left">This deal is already shared with <b>${esc(info.sharedRmName || "")}</b>. Submitting asks to change the second RM.</div>`
        : ""
    }
    <form class="card form" id="request-form" novalidate>
      <label class="form-field">
        <span>Second RM *</span>
        <select class="select" id="request-rm">
          <option value="">Select the second RM</option>
          ${rms.map((rm) => `<option value="${esc(rm.id)}">${esc(rm.name)}</option>`).join("")}
        </select>
      </label>
      <div id="share-preview"></div>
      <label class="form-field">
        <span>Justification * (at least 10 characters)</span>
        <textarea class="search" rows="4" id="request-justification" maxlength="2000" placeholder="Why should this deal be shared?"></textarea>
      </label>
      ${approverPart(view)}
      <div id="form-status"></div>
      ${canSubmit ? `<button class="button-primary" type="submit" id="request-submit">Submit for Approval</button>` : ""}
      <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
    </form>`;

  const form = document.getElementById("request-form");
  const status = document.getElementById("form-status");
  const select = document.getElementById("request-rm");
  select.addEventListener("change", () => {
    const chosen = rms.find((rm) => rm.id === select.value);
    document.getElementById("share-preview").innerHTML = chosen
      ? `<div class="notice notice-left price-preview">
           <b>The deal will be shared 50/50</b>
           ${field(info.ownerName || "Owner", half)}
           ${field(chosen.name, half)}
         </div>`
      : "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const justification = document
      .getElementById("request-justification")
      .value.trim();
    const approver = document.getElementById("request-approver");
    const problem = !select.value
      ? "Please choose the second RM."
      : justification.length < 10
        ? "Please write a justification of at least 10 characters."
        : approver && !approver.value
          ? "Please choose the first approver."
          : "";
    if (problem) {
      status.innerHTML = errorBox(problem);
      return;
    }
    const button = document.getElementById("request-submit");
    button.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Submitting…</span></div>`;
    try {
      await post("requests/sharedeal/submit", {
        dealId,
        sharedRmId: select.value,
        justification,
        approverId: approver ? approver.value : null
      });
      toast("Share deal request submitted.");
      location.hash = back;
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
      button.disabled = false;
    }
  });
}

/** One instalment line: what it is, when, and how much. */
function planLineText(line, price, currencyCode) {
  const percent = Number(line.percent) || 0;
  const constant = Number(line.constantAmount) || 0;
  const parts = [shortDate(line.installmentDate)];
  if (percent) {
    parts.push(percent + "%");
    if (price != null) {
      parts.push(money(Math.round((price * percent) / 100), currencyCode));
    }
  }
  if (constant) {
    parts.push(
      currencyCode
        ? money(constant, currencyCode)
        : constant.toLocaleString("en-US")
    );
  }
  if (line.isAdditionalPayment) {
    parts.push("Additional payment");
  }
  return parts.filter(Boolean).join(" · ");
}

async function renderRequestPlan(token, params) {
  const dealId = params.get("deal");
  const back = "#/deal?id=" + dealId;
  shell("Payment Plan Change", loading(), "deals", { back });
  const view = await get("requests/paymentplan", { dealId });
  if (token !== renderToken) {
    return;
  }
  const screen = document.getElementById("screen");
  const summary = `
    <div class="card">
      ${field("Unit", [view.project, view.unit].filter(Boolean).join(" · "))}
      ${field("Unit price", view.price == null ? "" : money(view.price, view.currencyCode))}
    </div>`;
  const readOnlyPlan = () => `
    <div class="card form">
      <h2 class="form-title">Payment Plan Now</h2>
      ${
        (view.lines || []).length
          ? view.lines
              .map(
                (line) => `
        <div class="owner-row">
          <span><b>${esc(line.milestoneName)}</b><br /><small>${esc(planLineText(line, view.price, view.currencyCode))}</small></span>
        </div>`
              )
              .join("")
          : `<p class="muted">This unit has no instalments.</p>`
      }
    </div>`;

  if (view.open && view.locked) {
    screen.innerHTML = `
      ${summary}
      <div class="notice notice-warn notice-left">
        <b>Payment plan change request ${esc(view.open.name || "")} is ${esc(String(view.open.statusLabel || view.open.status || "").toLowerCase())}</b>
        ${view.open.approvalStageLabel ? `<p>${esc(view.open.approvalStageLabel)}</p>` : ""}
        ${field("Justification", view.open.justification)}
        <p>The payment plan is locked until this request is decided.</p>
      </div>
      ${readOnlyPlan()}`;
    return;
  }
  if (view.reason) {
    screen.innerHTML =
      summary + errorBox(view.reason) + (view.canRequest ? readOnlyPlan() : "");
    return;
  }

  const known = new Set(view.knownMilestones || []);
  const text = (value) =>
    value === null || value === undefined ? "" : String(value);
  let nextKey = 1;
  const state = {
    rows: (view.lines || []).map((line) => ({
      key: "r" + nextKey++,
      cashFlowId: line.cashFlowId,
      milestoneName: line.milestoneName || "",
      installmentDate: line.installmentDate || "",
      percent: text(line.percent),
      constantAmount: text(line.constantAmount),
      isAdditionalPayment: line.isAdditionalPayment === true,
      locked: Number(line.receivedAmount) > 0,
      isNew: false,
      removed: false,
      original: line
    })),
    justification: "",
    approverId: "",
    editing: null,
    error: ""
  };
  const number = (typed) => {
    const value = String(typed).trim();
    return value === "" || Number.isNaN(Number(value)) ? null : Number(value);
  };
  const changed = (row) =>
    !row.isNew &&
    !row.removed &&
    (row.milestoneName !== (row.original.milestoneName || "") ||
      row.installmentDate !== (row.original.installmentDate || "") ||
      (number(row.percent) || 0) !== (Number(row.original.percent) || 0) ||
      (number(row.constantAmount) || 0) !==
        (Number(row.original.constantAmount) || 0) ||
      row.isAdditionalPayment !== (row.original.isAdditionalPayment === true));
  const total = () =>
    Math.round(
      state.rows
        .filter((row) => !row.removed)
        .reduce((sum, row) => sum + (number(row.percent) || 0), 0) * 100
    ) / 100;
  const changes = () => {
    const list = [];
    state.rows.forEach((row) => {
      const line = {
        cashFlowId: row.cashFlowId || null,
        milestoneName: row.milestoneName.trim(),
        installmentDate: row.installmentDate,
        percent: number(row.percent),
        constantAmount: number(row.constantAmount),
        isAdditionalPayment: row.isAdditionalPayment
      };
      if (row.isNew && !row.removed) {
        list.push({ ...line, action: "Insert" });
      } else if (!row.isNew && row.removed) {
        list.push({ action: "Delete", cashFlowId: row.cashFlowId });
      } else if (changed(row)) {
        list.push({ ...line, action: "Update" });
      }
    });
    return list;
  };
  const keepTyped = () => {
    const justification = document.getElementById("request-justification");
    const approver = document.getElementById("request-approver");
    if (justification) {
      state.justification = justification.value;
    }
    if (approver) {
      state.approverId = approver.value;
    }
  };
  const canSubmit = Boolean(view.approvers || view.lineManager);

  function drawEditor() {
    const row = state.editing;
    const isNew = !state.rows.includes(row);
    screen.innerHTML = `
      <form class="card form" id="line-form" novalidate>
        <h2 class="form-title">${isNew ? "Add Instalment" : "Edit Instalment"}</h2>
        <label class="form-field">
          <span>Milestone name *</span>
          <input class="search" type="text" id="line-name" list="line-names" maxlength="80" value="${esc(row.milestoneName)}" autocomplete="off" />
          <datalist id="line-names">${[...known].map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        </label>
        <div id="line-name-note"></div>
        <label class="form-field">
          <span>Instalment date *</span>
          <input class="search" type="date" id="line-date" value="${esc(row.installmentDate)}" />
        </label>
        <label class="form-field">
          <span>Percent of the unit price</span>
          <input class="search" type="text" inputmode="decimal" id="line-percent" value="${esc(row.percent)}" autocomplete="off" />
        </label>
        <label class="form-field">
          <span>Constant amount${view.currencyCode ? " (" + esc(view.currencyCode) + ")" : ""}</span>
          <input class="search" type="text" inputmode="decimal" id="line-constant" value="${esc(row.constantAmount)}" autocomplete="off" />
        </label>
        <label class="check-line"><input type="checkbox" id="line-additional" ${row.isAdditionalPayment ? "checked" : ""} /> <span>Additional payment</span></label>
        <p class="muted">The year of the instalment is taken from its date.</p>
        <div id="form-status"></div>
        <button class="button-primary" type="submit">Save Instalment</button>
        <button class="button-outline" type="button" id="line-cancel">Cancel</button>
      </form>`;
    const name = document.getElementById("line-name");
    const note = () => {
      const typed = name.value.trim();
      document.getElementById("line-name-note").innerHTML =
        typed && !known.has(typed)
          ? `<div class="notice notice-warn notice-left">The booking form does not know the name “${esc(typed)}”. Pick a name from the suggestions if you can; with a new name the booking form cannot be generated until the Salesforce admin adds it.</div>`
          : "";
    };
    name.addEventListener("input", note);
    note();
    document.getElementById("line-cancel").addEventListener("click", () => {
      state.editing = null;
      draw();
    });
    document.getElementById("line-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const typed = {
        milestoneName: name.value.trim(),
        installmentDate: document.getElementById("line-date").value,
        percent: document.getElementById("line-percent").value.trim(),
        constantAmount: document.getElementById("line-constant").value.trim(),
        isAdditionalPayment: document.getElementById("line-additional").checked
      };
      const percent = number(typed.percent);
      const constant = number(typed.constantAmount);
      const problem = !typed.milestoneName
        ? "Please enter the milestone name."
        : !typed.installmentDate
          ? "Please choose the instalment date."
          : (typed.percent !== "" && percent === null) ||
              (percent !== null && (percent < 0 || percent > 100))
            ? "The percent must be a number from 0 to 100."
            : (typed.constantAmount !== "" && constant === null) ||
                (constant !== null && constant < 0)
              ? "The constant amount must be a number."
              : !percent && !constant
                ? "Please enter a percent or a constant amount."
                : "";
      if (problem) {
        document.getElementById("form-status").innerHTML = errorBox(problem);
        return;
      }
      Object.assign(row, typed);
      if (isNew) {
        state.rows.push(row);
      }
      state.editing = null;
      draw();
    });
    window.scrollTo(0, 0);
  }

  function draw() {
    if (state.editing) {
      drawEditor();
      return;
    }
    const sum = total();
    const pending = changes();
    screen.innerHTML = `
      ${summary}
      <div class="card form">
        <h2 class="form-title">Instalments</h2>
        ${state.rows
          .map((row) => {
            const tag = row.locked
              ? `<span class="pill pill-muted">Payment received</span>`
              : row.removed
                ? `<span class="pill pill-urgent">Will be removed</span>`
                : row.isNew
                  ? `<span class="pill pill-ok">New</span>`
                  : changed(row)
                    ? `<span class="pill pill-warn">Changed</span>`
                    : "";
            const actions = row.locked
              ? ""
              : row.removed
                ? `<button type="button" class="plan-action" data-undo="${row.key}">Undo</button>`
                : `<button type="button" class="plan-action" data-edit="${row.key}">Edit</button>
                   <button type="button" class="picked-clear" data-remove="${row.key}" aria-label="Remove ${esc(row.milestoneName)}">✕</button>`;
            return `
          <div class="owner-row${row.removed ? " plan-removed" : ""}">
            <span><b>${esc(row.milestoneName)}</b> ${tag}<br /><small>${esc(planLineText(row, view.price, view.currencyCode))}</small></span>
            ${actions}
          </div>`;
          })
          .join("")}
        <p class="muted ${sum === 100 ? "note-ok" : "note-warn"}">Total: ${sum}% / 100%${sum === 100 ? "" : ". The percentages must add up to exactly 100%."}</p>
        <button type="button" class="button-outline" id="plan-add">Add Instalment</button>
      </div>
      <form class="card form" id="request-form" novalidate>
        <p class="muted">${
          pending.length
            ? `${pending.length} change${pending.length === 1 ? "" : "s"} to send for approval. Nothing changes on the unit until the request is approved.`
            : "Edit, remove or add an instalment above to start a request."
        }</p>
        <label class="form-field">
          <span>Justification * (at least 10 characters)</span>
          <textarea class="search" rows="4" id="request-justification" maxlength="2000" placeholder="Why should the payment plan change?">${esc(state.justification)}</textarea>
        </label>
        ${approverPart(view)}
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        ${canSubmit ? `<button class="button-primary" type="submit" id="request-submit">Submit for Approval</button>` : ""}
        <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
      </form>`;
    state.error = "";
    const approver = document.getElementById("request-approver");
    if (approver) {
      approver.value = state.approverId;
    }
    const rowOf = (key) => state.rows.find((row) => row.key === key);
    screen.querySelectorAll("[data-edit]").forEach((button) =>
      button.addEventListener("click", () => {
        keepTyped();
        state.editing = rowOf(button.dataset.edit);
        draw();
      })
    );
    screen.querySelectorAll("[data-remove]").forEach((button) =>
      button.addEventListener("click", () => {
        keepTyped();
        const row = rowOf(button.dataset.remove);
        if (row.isNew) {
          state.rows = state.rows.filter((other) => other !== row);
        } else {
          row.removed = true;
        }
        draw();
      })
    );
    screen.querySelectorAll("[data-undo]").forEach((button) =>
      button.addEventListener("click", () => {
        keepTyped();
        rowOf(button.dataset.undo).removed = false;
        draw();
      })
    );
    document.getElementById("plan-add").addEventListener("click", () => {
      keepTyped();
      state.editing = {
        key: "r" + nextKey++,
        cashFlowId: null,
        milestoneName: "",
        installmentDate: "",
        percent: "",
        constantAmount: "",
        isAdditionalPayment: false,
        locked: false,
        isNew: true,
        removed: false
      };
      draw();
    });
    document
      .getElementById("request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        keepTyped();
        const status = document.getElementById("form-status");
        const list = changes();
        const approverSelect = document.getElementById("request-approver");
        const problem = !list.length
          ? "Make at least one change to the payment plan first."
          : total() !== 100
            ? `The percentages must add up to exactly 100%. The total is now ${total()}%.`
            : state.justification.trim().length < 10
              ? "Please write a justification of at least 10 characters."
              : approverSelect && !approverSelect.value
                ? "Please choose the first approver."
                : "";
        if (problem) {
          status.innerHTML = errorBox(problem);
          return;
        }
        const button = document.getElementById("request-submit");
        button.disabled = true;
        status.innerHTML = `<div class="working"><span class="spinner"></span><span>Submitting…</span></div>`;
        try {
          await post("requests/paymentplan/submit", {
            dealId,
            justification: state.justification.trim(),
            approverId: approverSelect ? approverSelect.value : null,
            changes: list
          });
          toast("Payment plan change request submitted.");
          location.hash = back;
        } catch (error) {
          if (error instanceof SignedOutError) {
            handleError(error);
            return;
          }
          status.innerHTML = errorBox(error.message);
          button.disabled = false;
        }
      });
  }
  draw();
}

/** For the approver of a Payment Plan Change: the instalments today next to what is asked. */
function planComparison(plan) {
  if (!plan || plan.notApplicable) {
    return "";
  }
  const label = {
    updated: ["Changed", "pill-warn"],
    deleted: ["Removed", "pill-urgent"],
    added: ["New", "pill-ok"]
  };
  const rows = (lines, empty) =>
    (lines || []).length
      ? lines
          .map((line) => {
            const tag = label[line.changeType];
            return `
        <div class="owner-row">
          <span><b>${esc(line.milestoneName || "")}</b> ${tag ? `<span class="pill ${tag[1]}">${tag[0]}</span>` : ""}${line.hasPayments ? ` <span class="pill pill-muted">Payment received</span>` : ""}<br />
          <small>${esc(
            [
              shortDate(line.installmentDate),
              line.percent ? line.percent + "%" : "",
              line.amount ? Number(line.amount).toLocaleString("en-US") : ""
            ]
              .filter(Boolean)
              .join(" · ")
          )}</small></span>
        </div>`;
          })
          .join("")
      : `<p class="muted">${empty}</p>`;
  return `
    <div class="card">
      <h2 class="form-title">Instalments Today</h2>
      <p class="muted">Only the instalments this request touches${plan.totalInstallmentCount ? `, out of ${plan.totalInstallmentCount} on the unit` : ""}.</p>
      ${rows(plan.currentLines, "No existing instalment is changed or removed.")}
    </div>
    <div class="card">
      <h2 class="form-title">Asked For</h2>
      ${rows(plan.proposedLines, "Nothing is left of these instalments.")}
    </div>`;
}

async function requestsBox(deal, token) {
  const box = document.getElementById("requests-box");
  let view;
  try {
    view = await get("deals/requests", { id: deal.id });
  } catch (error) {
    if (token === renderToken && box) {
      box.innerHTML = errorBox(
        "The requests could not be loaded: " + error.message
      );
    }
    return;
  }
  if (token !== renderToken || !box || !view.allowed) {
    return;
  }
  const rows = view.requests || [];
  box.innerHTML = `
    <div class="card form">
      <h2 class="form-title">Approval History</h2>
      ${
        rows.length
          ? rows.map(requestCard).join("")
          : `<p class="muted">No approval requests on this deal yet.</p>`
      }
    </div>`;
}

// ------------------------------------------------------- buyers of a deal
// The main purchaser's ownership share and the joint owners, which the booking form prints.

function shareText(value) {
  return value === null || value === undefined ? "—" : value + "%";
}

async function buyersBox(deal, token) {
  const box = document.getElementById("buyers-box");
  let view;
  try {
    view = await get("deals/owners", { id: deal.id });
  } catch (error) {
    if (token === renderToken && box) {
      box.innerHTML = errorBox(
        "The buyers could not be loaded: " + error.message
      );
    }
    return;
  }
  if (token !== renderToken || !box) {
    return;
  }
  const owners = view.owners || [];
  box.innerHTML = `
    <div class="card form">
      <h2 class="form-title">Buyers</h2>
      <p class="kv"><span>${esc(view.mainName || "Main purchaser")}<br /><small>Main purchaser</small></span><b>${shareText(view.mainShare)}</b></p>
      ${owners
        .map(
          (o) =>
            `<p class="kv"><span>${esc(o.name)}<br /><small>Joint owner</small></span><b>${shareText(o.share)}</b></p>`
        )
        .join("")}
      ${
        owners.length && view.total !== 100
          ? `<p class="muted note-warn">The shares add up to ${esc(view.total)}%, not 100%.</p>`
          : ""
      }
      ${
        view.canEdit
          ? `<a class="button-outline button-link" href="#/deal-owners?id=${esc(deal.id)}">${owners.length ? "Edit Buyers" : "Add Joint Owner"}</a>`
          : ""
      }
    </div>`;
}

async function renderDealOwners(token, params) {
  const dealId = params.get("id");
  const back = "#/deal?id=" + dealId;
  shell("Buyers", loading(), "deals", { back });
  const view = await get("deals/owners", { id: dealId });
  if (token !== renderToken) {
    return;
  }
  if (!view.canEdit) {
    throw new Error("You cannot change the buyers of this deal.");
  }
  const screen = document.getElementById("screen");
  const asText = (n) => (n === null || n === undefined ? "" : String(n));
  const state = {
    mainShare: asText(view.mainShare),
    owners: (view.owners || []).map((o) => ({
      accountId: o.accountId,
      name: o.name,
      share: asText(o.share)
    })),
    error: ""
  };
  const number = (text) => {
    const typed = String(text).trim();
    return typed === "" || Number.isNaN(Number(typed)) ? null : Number(typed);
  };
  const total = () =>
    [state.mainShare, ...state.owners.map((o) => o.share)].reduce(
      (sum, text) => sum + (number(text) || 0),
      0
    );
  const totalLine = () => {
    const sum = Math.round(total() * 100) / 100;
    return sum === 100
      ? `<p class="muted note-ok" id="share-total">Total: 100%</p>`
      : `<p class="muted note-warn" id="share-total">Total: ${sum}%. The shares should add up to 100%.</p>`;
  };

  function draw() {
    screen.innerHTML = `
      <div class="card form">
        <h2 class="form-title">Ownership Shares</h2>
        <div class="owner-row">
          <span><b>${esc(view.mainName || "Main purchaser")}</b><br /><small>Main purchaser</small></span>
          <label class="share-input"><input class="search" type="text" inputmode="decimal" data-share="main" value="${esc(state.mainShare)}" autocomplete="off" aria-label="Share of the main purchaser" /><i>%</i></label>
        </div>
        ${state.owners
          .map(
            (o, i) => `
          <div class="owner-row">
            <span><b>${esc(o.name)}</b><br /><small>Joint owner ${i + 1}</small></span>
            <label class="share-input"><input class="search" type="text" inputmode="decimal" data-share="${i}" value="${esc(o.share)}" autocomplete="off" aria-label="Share of ${esc(o.name)}" /><i>%</i></label>
            <button type="button" class="picked-clear" data-remove="${i}" aria-label="Remove ${esc(o.name)}">✕</button>
          </div>`
          )
          .join("")}
        ${totalLine()}
        <div class="form-field">
          <span>Add a joint owner</span>
          <input class="search" type="search" id="owner-search" placeholder="Search clients by name, phone, email or passport…" autocomplete="off" />
          <div class="lookup-results" id="owner-results"></div>
          <p class="muted">Client not in the list? <a href="#/client-new">Add the client first</a>, then come back to this deal.</p>
        </div>
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="owners-save">Save Buyers</button>
        <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
      </div>
      <p class="hint">Each joint owner also needs their Customer Due Diligence filled in before the booking form can be generated. The deal page lists what is missing.</p>`;

    screen.querySelectorAll("[data-share]").forEach((input) =>
      input.addEventListener("input", () => {
        if (input.dataset.share === "main") {
          state.mainShare = input.value;
        } else {
          state.owners[Number(input.dataset.share)].share = input.value;
        }
        document.getElementById("share-total").outerHTML = totalLine();
      })
    );
    const search = document.getElementById("owner-search");
    const results = document.getElementById("owner-results");
    let latest = 0;
    search.addEventListener(
      "input",
      debounce(async () => {
        const term = search.value.trim();
        const mine = ++latest;
        if (term.length < 2) {
          results.innerHTML = "";
          return;
        }
        try {
          const page = await get("clients", {
            search: term,
            pageSize: 10,
            offset: 0
          });
          if (mine !== latest) {
            return;
          }
          const taken = [
            view.mainAccountId,
            ...state.owners.map((o) => o.accountId)
          ];
          const rows = (page.rows || []).filter((c) => !taken.includes(c.id));
          results.innerHTML = rows.length
            ? rows
                .map(
                  (c) =>
                    `<button type="button" data-add="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}<br /><small>${esc(
                      [
                        c.kind === "company" ? "Company" : "Individual",
                        c.mobile
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    )}</small></button>`
                )
                .join("")
            : `<p class="muted">No match.</p>`;
        } catch (error) {
          results.innerHTML = errorBox(error.message);
        }
      }, 300)
    );
  }

  async function save() {
    const main = number(state.mainShare);
    if (main === null) {
      state.error = "Please enter the ownership share of the main purchaser.";
      draw();
      return;
    }
    const blank = state.owners.find((o) => number(o.share) === null);
    if (blank) {
      state.error = "Please enter the ownership share of " + blank.name + ".";
      draw();
      return;
    }
    document.getElementById("owners-save").disabled = true;
    document.getElementById("form-status").innerHTML =
      `<div class="working"><span class="spinner"></span><span>Saving…</span></div>`;
    try {
      await post("deals/owners/save", {
        dealId,
        mainShare: main,
        owners: state.owners.map((o) => ({
          accountId: o.accountId,
          share: number(o.share)
        }))
      });
      toast("Buyers saved.");
      location.hash = back;
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      state.error = error.message;
      draw();
    }
  }

  screen.addEventListener("click", (event) => {
    const el = event.target.closest("button");
    if (!el || !screen.contains(el)) {
      return;
    }
    if (el.dataset.add) {
      state.owners.push({
        accountId: el.dataset.add,
        name: el.dataset.name,
        share: ""
      });
      state.error = "";
      draw();
    } else if (el.dataset.remove) {
      state.owners.splice(Number(el.dataset.remove), 1);
      state.error = "";
      draw();
    } else if (el.id === "owners-save") {
      save();
    }
  });
  draw();
}

/**
 * The booking form on a deal: the app's version of the "Generate Booking Form PDF" button.
 * Salesforce decides whether it can be generated (stage, unit, Customer Due Diligence of every
 * buyer) and makes the same PDF; the app shows the answer and hands the file to the phone.
 */
async function bookingFormBox(deal, token) {
  const box = document.getElementById("booking-form-box");
  let status;
  let file = null;
  let fileUrl = null;
  let note = "";

  function draw() {
    const gaps = (status.gaps || [])
      .map((line) => `<li>${esc(line)}</li>`)
      .join("");
    const canShare = Boolean(
      file && navigator.canShare && navigator.canShare({ files: [file] })
    );
    box.innerHTML = `
      <div class="card form">
        <h2 class="form-title">Booking Form</h2>
        ${
          status.fileVersionId
            ? `<p class="muted">Last generated ${esc(dateTime12(status.fileDate))}${status.fileSize ? " · " + sizeText(status.fileSize) : ""}</p>`
            : status.canGenerate
              ? `<p class="muted">No booking form has been generated for this deal yet.</p>`
              : ""
        }
        ${status.reason ? `<p class="muted">${esc(status.reason)}</p>` : ""}
        ${
          gaps
            ? `<div class="notice notice-warn notice-left">
                 <b>Customer Due Diligence is incomplete</b>
                 <ul class="gap-list">${gaps}</ul>
                 ${deal.clientId ? `<a class="button-outline button-link" href="#/client?id=${esc(deal.clientId)}&from=deal:${esc(deal.id)}">Open Client to Complete</a>` : ""}
               </div>`
            : ""
        }
        ${
          file
            ? `<div class="file-row">
                 <div class="file-text"><b>${esc(status.fileTitle)}</b><span>${sizeText(file.size)}</span></div>
                 <a class="file-link" href="${fileUrl}" target="_blank" rel="noopener">Open</a>
                 <a class="file-link" href="${fileUrl}" download="${esc(file.name)}">Save</a>
               </div>
               ${canShare ? `<button type="button" class="button-primary" id="form-share">Share (WhatsApp, Email…)</button>` : ""}`
            : status.fileVersionId
              ? `<button type="button" class="button-outline" id="form-get">Open the Booking Form</button>`
              : ""
        }
        <div id="form-box-status">${note}</div>
        ${
          status.canGenerate
            ? `<button type="button" class="${status.fileVersionId ? "button-outline" : "button-primary"}" id="form-generate">${status.fileVersionId ? "Generate Again" : "Generate Booking Form"}</button>
               ${status.fileVersionId ? `<p class="muted">Generating again replaces the previous booking form.</p>` : ""}`
            : ""
        }
      </div>`;
    const busy = (text) => {
      document.getElementById("form-box-status").innerHTML =
        `<div class="working"><span class="spinner"></span><span>${esc(text)}</span></div>`;
      box.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
    };
    const fail = (error) => {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      note = errorBox(error.message);
      if (token === renderToken) {
        draw();
      }
    };
    const fetchFile = async () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      file = await downloadFile(
        status.fileVersionId,
        status.fileTitle + ".pdf",
        "application/pdf"
      );
      fileUrl = URL.createObjectURL(file);
    };
    const get1 = document.getElementById("form-get");
    if (get1) {
      get1.addEventListener("click", async () => {
        busy("Getting the booking form…");
        try {
          await fetchFile();
          note = "";
          if (token === renderToken) {
            draw();
          }
        } catch (error) {
          fail(error);
        }
      });
    }
    const share = document.getElementById("form-share");
    if (share) {
      share.addEventListener("click", async () => {
        try {
          await navigator.share({ files: [file], title: "Booking Form" });
        } catch (e) {
          // the user closed the share sheet
        }
      });
    }
    const generate = document.getElementById("form-generate");
    if (generate) {
      generate.addEventListener("click", async () => {
        busy("Generating the booking form. This can take up to a minute…");
        try {
          // two calls: Salesforce cannot make the PDF right after removing the old file
          await post("deals/bookingform/cleanup", { dealId: deal.id });
          status = await post("deals/bookingform/generate", {
            dealId: deal.id
          });
          file = null;
          await fetchFile();
          note = "";
          toast("Booking form ready.");
          if (token === renderToken) {
            draw();
          }
        } catch (error) {
          try {
            status = await get("deals/bookingform", { id: deal.id });
            file = null;
          } catch (e) {
            // keep what is on the screen
          }
          fail(error);
        }
      });
    }
  }

  try {
    status = await get("deals/bookingform", { id: deal.id });
  } catch (error) {
    if (token === renderToken && box) {
      box.innerHTML = errorBox(
        "The booking form could not be checked: " + error.message
      );
    }
    return;
  }
  if (token === renderToken && box) {
    draw();
  }
}

// ------------------------------------------------------------------ clients

const CLIENT_KINDS = [
  { key: "all", label: "All" },
  { key: "client", label: "Individuals" },
  { key: "company", label: "Companies" }
];

function clientRow(client) {
  return `
    <article class="row is-link" data-open="#/client?id=${esc(client.id)}">
      <div class="row-head">
        <h4>${esc(client.name)}</h4>
        <span class="pill ${client.kind === "company" ? "pill-warn" : "pill-info"}">${
          client.kind === "company" ? "Company" : "Individual"
        }</span>
      </div>
      <p class="muted">${esc([client.mobile, client.email].filter(Boolean).join(" · "))}</p>
      <p class="muted">${esc([client.country, client.ownerName ? "Owner: " + client.ownerName : ""].filter(Boolean).join(" · "))}</p>
    </article>`;
}

function renderClients(token, params) {
  const kind = params.get("kind") || "all";
  const search = params.get("search") || "";
  shell(
    "Clients",
    `${chips(CLIENT_KINDS, kind, "kind")}
     <input class="search" id="search" type="search" placeholder="Search name, phone, email, passport" value="${esc(search)}" />
     <div class="list" id="list"></div>
     <a class="fab" href="#/client-new" aria-label="Add client">+ Add Client</a>`,
    "clients"
  );
  root
    .querySelectorAll("[data-kind]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go("clients", { kind: button.dataset.kind, search })
      )
    );
  document
    .getElementById("search")
    .addEventListener("change", (event) =>
      go("clients", { kind, search: event.target.value.trim() })
    );
  openOnTap(document.getElementById("list"));
  infiniteList(
    document.getElementById("list"),
    (offset) => get("clients", { kind, search, pageSize: PAGE_SIZE, offset }),
    clientRow,
    search
      ? "No clients match this search."
      : "No clients yet. Tap Add Client to create one.",
    token
  );
}

// ------------------------------------------- a record as Salesforce shows it
// The sections, fields, labels and order come from the page layout Salesforce gives the
// signed-in RM, so the app always matches the Salesforce record page; nothing is listed here.

const layoutCache = new Map();
const SALESFORCE_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

async function recordWithLayout(recordId) {
  if (!SALESFORCE_ID.test(recordId || "")) {
    throw new Error("This record could not be found.");
  }
  const record = await data(
    "ui-api/records/" + recordId + "?layoutTypes=Full&modes=View"
  );
  const key = record.apiName + ":" + (record.recordTypeId || "");
  if (!layoutCache.has(key)) {
    layoutCache.set(
      key,
      await data(
        "ui-api/layout/" +
          record.apiName +
          "?layoutType=Full&mode=View" +
          (record.recordTypeId ? "&recordTypeId=" + record.recordTypeId : "")
      )
    );
  }
  return { record, layout: layoutCache.get(key) };
}

function layoutValue(record, apiName) {
  const fields = record.fields || {};
  const entry = fields[apiName];
  if (!entry) {
    return "";
  }
  // a lookup shows the name of the record it points to, not its id
  const relation = apiName.endsWith("__c")
    ? apiName.slice(0, -1) + "r"
    : apiName.endsWith("Id")
      ? apiName.slice(0, -2)
      : null;
  if (relation && fields[relation] && fields[relation].displayValue) {
    return fields[relation].displayValue;
  }
  const value = entry.value;
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return shortDate(value);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return dateTime12(value);
  }
  return entry.displayValue || String(value);
}

function layoutItemValue(record, item) {
  const names = item.layoutComponents
    .filter((part) => part.componentType === "Field" && part.apiName)
    .map((part) => part.apiName);
  const isName = names.includes("LastName");
  return names
    .map((name) => layoutValue(record, name))
    .filter(Boolean)
    .join(isName ? " " : ", ");
}

/** Salesforce lays a section out in columns; on a phone the left column is read first. */
function layoutSectionItems(section) {
  const columns = [];
  section.layoutRows.forEach((row) => {
    row.layoutItems.forEach((item, index) => {
      if (
        item.layoutComponents.some(
          (part) => part.componentType === "Field" && part.apiName
        )
      ) {
        (columns[index] = columns[index] || []).push(item);
      }
    });
  });
  return columns.flat();
}

function layoutSections(record, layout, editHref) {
  return layout.sections
    .map((section, index) => {
      const items = layoutSectionItems(section);
      if (!items.length) {
        return "";
      }
      let filled = 0;
      const rows = items
        .map((item) => {
          const value = layoutItemValue(record, item);
          if (value) {
            filled += 1;
          }
          return `<p class="kv${value ? "" : " is-empty"}"><span>${esc(item.label)}${
            item.required ? ` <i class="req">*</i>` : ""
          }</span><b>${value ? esc(value) : "—"}</b></p>`;
        })
        .join("");
      return `
        <details class="card record-section"${index === 0 ? " open" : ""}>
          <summary>
            <span>${esc(section.heading)}</span>
            <small>${filled} of ${items.length} filled</small>
          </summary>
          ${
            editHref && items.some((item) => item.editableForUpdate)
              ? `<a class="action section-edit" href="${esc(editHref(section))}">Edit ${esc(section.heading)}</a>`
              : ""
          }
          ${rows}
        </details>`;
    })
    .join("");
}

// ------------------------------------------------ editing a record, by section
// The form for a section is built from the same Salesforce layout: its editable fields, their
// labels, types and picklist choices. Saving goes through Salesforce's own record service, so
// permissions, validation rules and triggers apply exactly as on the Salesforce page.

const kitCache = new Map();
const EDITABLE_TYPES = [
  "String",
  "TextArea",
  "Email",
  "Phone",
  "Url",
  "Picklist",
  "MultiPicklist",
  "Boolean",
  "Date",
  "Double",
  "Int",
  "Percent",
  "Currency"
];
const NUMBER_TYPES = ["Double", "Int", "Percent", "Currency"];

async function cached(key, load) {
  if (!kitCache.has(key)) {
    kitCache.set(key, load());
  }
  try {
    return await kitCache.get(key);
  } catch (error) {
    kitCache.delete(key);
    throw error;
  }
}

function objectInfo(objectName) {
  return cached("info:" + objectName, () =>
    data("ui-api/object-info/" + objectName)
  );
}

/** Everything needed to build a form: field facts, the edit layout and the picklist choices. */
async function editKit(objectName, recordTypeId) {
  const info = await objectInfo(objectName);
  const recordType = recordTypeId || info.defaultRecordTypeId;
  const [layout, picks] = await Promise.all([
    cached("edit:" + objectName + ":" + recordType, () =>
      data(
        "ui-api/layout/" +
          objectName +
          "?layoutType=Full&mode=Edit&recordTypeId=" +
          recordType
      )
    ),
    cached("picks:" + objectName + ":" + recordType, () =>
      data(
        "ui-api/object-info/" + objectName + "/picklist-values/" + recordType
      )
    )
  ]);
  return { info, layout, picks: picks.picklistFieldValues || {}, recordType };
}

/** The fields of a section the RM may fill, in reading order. */
function editableParts(kit, section, isNew) {
  const parts = [];
  layoutSectionItems(section).forEach((item) => {
    if (!(isNew ? item.editableForNew : item.editableForUpdate)) {
      return;
    }
    const components = item.layoutComponents.filter(
      (part) => part.componentType === "Field" && part.apiName
    );
    components.forEach((part) => {
      const fact = kit.info.fields[part.apiName];
      if (
        !fact ||
        !(isNew ? fact.createable : fact.updateable) ||
        !EDITABLE_TYPES.includes(fact.dataType)
      ) {
        return;
      }
      parts.push({
        apiName: part.apiName,
        fact,
        label: components.length > 1 ? fact.label : item.label,
        required: item.required && (components.length === 1 || fact.required)
      });
    });
  });
  return parts;
}

function partInput(kit, part, value) {
  const { apiName, fact, label, required } = part;
  const type = fact.dataType;
  const mark = `data-field="${esc(apiName)}" data-type="${type}" data-label="${esc(label)}"`;
  const head = `<span>${esc(label)}${required ? " *" : ""}</span>`;
  const need = required ? " required" : "";
  const text = value === null || value === undefined ? "" : String(value);
  if (type === "Boolean") {
    return `
      <label class="form-check">
        <input type="checkbox" ${mark}${value ? " checked" : ""} />
        <span>${esc(label)}</span>
      </label>`;
  }
  if (type === "Picklist" || type === "MultiPicklist") {
    const choices = ((kit.picks[apiName] || {}).values || []).map((c) => ({
      value: c.value,
      label: c.label
    }));
    const chosen = type === "MultiPicklist" ? text.split(";") : [text];
    chosen
      .filter((v) => v && !choices.some((c) => c.value === v))
      .forEach((v) => choices.push({ value: v, label: v }));
    if (type === "MultiPicklist") {
      return `
        <div class="form-field" ${mark}>
          ${head}
          <div class="checks">${choices
            .map(
              (c) => `
            <label class="form-check">
              <input type="checkbox" value="${esc(c.value)}"${chosen.includes(c.value) ? " checked" : ""} />
              <span>${esc(c.label)}</span>
            </label>`
            )
            .join("")}</div>
        </div>`;
    }
    return `
      <label class="form-field">
        ${head}
        <select class="select" ${mark}${need}>
          <option value="">None</option>
          ${choices
            .map(
              (c) =>
                `<option value="${esc(c.value)}"${c.value === text ? " selected" : ""}>${esc(c.label)}</option>`
            )
            .join("")}
        </select>
      </label>`;
  }
  if (type === "TextArea") {
    return `
      <label class="form-field">
        ${head}
        <textarea class="search" rows="3" ${mark}${need}>${esc(text)}</textarea>
      </label>`;
  }
  const kind =
    type === "Date"
      ? `type="date"`
      : type === "Email"
        ? `type="email" inputmode="email"`
        : type === "Phone"
          ? `type="tel" inputmode="tel"`
          : type === "Url"
            ? `type="url" inputmode="url"`
            : NUMBER_TYPES.includes(type)
              ? `type="text" inputmode="decimal"`
              : `type="text"`;
  const limit =
    type === "String" && fact.length ? ` maxlength="${fact.length}"` : "";
  return `
    <label class="form-field">
      ${head}
      <input class="search" ${kind} ${mark}${need}${limit} autocomplete="off" value="${esc(text)}" />
    </label>`;
}

/** What the RM entered, field by field; an empty box means "no value". */
function readParts(form) {
  const values = {};
  form.querySelectorAll("[data-field]").forEach((el) => {
    const type = el.dataset.type;
    let value;
    if (type === "Boolean") {
      value = el.checked;
    } else if (type === "MultiPicklist") {
      value =
        [...el.querySelectorAll("input:checked")]
          .map((box) => box.value)
          .join(";") || null;
    } else {
      const typed = el.value.trim();
      value = typed === "" ? null : typed;
      if (value !== null && NUMBER_TYPES.includes(type)) {
        value = Number(typed.replace(/,/g, ""));
        if (Number.isNaN(value)) {
          throw new Error(el.dataset.label + " must be a number.");
        }
      }
    }
    values[el.dataset.field] = value;
  });
  return values;
}

function missingRequired(form) {
  const empty = [...form.querySelectorAll("[required]")].find(
    (el) => !el.value.trim()
  );
  if (empty) {
    empty.focus();
    return empty.dataset.label + " is required.";
  }
  return "";
}

function recordTypeName(kit, recordTypeId) {
  const found = (kit.info.recordTypeInfos || {})[recordTypeId];
  return found ? found.name : "";
}

/**
 * Due diligence boxes that are only asked for after a certain answer (for example "Source of
 * Funds - Other") stay hidden until that answer is chosen. The rules come from the booking
 * form check in Salesforce, so the form and the check always agree.
 */
function applyConditions(form, conditions) {
  const rules = [];
  (conditions || []).forEach((rule) => {
    [
      [rule.field, rule.parent],
      [rule.personField, rule.personParent]
    ].forEach(([field, parent]) => {
      const child = form.querySelector(`[data-field="${field}"]`);
      const parentEl = form.querySelector(`[data-field="${parent}"]`);
      if (child && parentEl) {
        const twin = form.querySelector(
          `[data-field="${field.replace(/__(c|pc)$/, "_Arabic__$1")}"]`
        );
        rules.push({
          boxes: [child, twin].filter(Boolean),
          parentEl,
          values: rule.whenParentHas || []
        });
      }
    });
  });
  const picked = (el) =>
    el.dataset.type === "MultiPicklist"
      ? [...el.querySelectorAll("input:checked")].map((box) => box.value)
      : [el.value];
  const refresh = () =>
    rules.forEach((rule) => {
      const show = picked(rule.parentEl).some((v) => rule.values.includes(v));
      rule.boxes.forEach((el) => {
        (el.closest(".form-field") || el).hidden = !show;
      });
    });
  rules.forEach((rule) => rule.parentEl.addEventListener("change", refresh));
  refresh();
}

async function renderEdit(token, params) {
  const id = params.get("id");
  const wizard = params.get("wizard") === "1";
  const clientId = params.get("client") || "";
  shell(wizard ? "Add Client" : "Edit", loading(), "clients", {
    back: "#/clients"
  });
  if (!SALESFORCE_ID.test(id || "")) {
    throw new Error("This record could not be found.");
  }
  const record = await data(
    "ui-api/records/" + id + "?layoutTypes=Full&modes=Edit"
  );
  const kit = await editKit(record.apiName, record.recordTypeId);
  if (!clientOptions) {
    clientOptions = await get("clients/options");
  }
  if (token !== renderToken) {
    return;
  }
  const isContact = record.apiName === "Contact";
  const isCompany =
    !isContact && recordTypeName(kit, record.recordTypeId) === "Company";
  const detail = isContact
    ? "#/contact?id=" + id + (clientId ? "&client=" + clientId : "")
    : "#/client?id=" + id;
  const steps = kit.layout.sections
    .map((section) => ({ section, parts: editableParts(kit, section, false) }))
    .filter((step) => step.parts.length);
  if (!steps.length) {
    throw new Error("There is nothing you can edit on this record.");
  }
  const wanted = params.get("s");
  const index = Math.max(
    0,
    steps.findIndex((step) => step.section.id === wanted)
  );
  const { section, parts } = steps[index];
  const before = {};
  parts.forEach((part) => {
    const entry = record.fields[part.apiName];
    before[part.apiName] = entry ? entry.value : null;
  });

  // in the add flow, step 1 was the short form; a company ends with its contact
  const stepNumber = isContact ? index + 1 : index + 2;
  const stepTotal = isContact
    ? steps.length
    : steps.length + 1 + (isCompany ? 1 : 0);
  const stepLine = wizard
    ? `<p class="step-line">${isContact ? "Contact · " : ""}Step ${stepNumber} of ${stepTotal}</p>`
    : "";

  shell(
    wizard ? (isContact ? "Add Contact" : "Add Client") : "Edit",
    "",
    "clients",
    { back: detail }
  );
  document.getElementById("screen").innerHTML = `
    ${stepLine}
    <form class="card form" id="edit-form" novalidate>
      <h2 class="form-title">${esc(section.heading)}</h2>
      ${parts.map((part) => partInput(kit, part, before[part.apiName])).join("")}
      <div id="form-status"></div>
      <button class="button-primary" type="submit" id="edit-save">${wizard ? "Save and Next" : "Save"}</button>
      ${
        wizard
          ? `<button class="button-outline" type="button" id="edit-skip">Skip for Now</button>`
          : `<a class="button-outline button-link" href="${esc(detail)}">Cancel</a>`
      }
    </form>
    ${wizard ? `<p class="hint">Each step is saved when you press Save and Next. You can stop at any time and complete the rest later from the client's page. <a href="${esc(detail)}">Finish later</a></p>` : ""}`;

  const form = document.getElementById("edit-form");
  const status = document.getElementById("form-status");
  const saveButton = document.getElementById("edit-save");
  applyConditions(form, clientOptions.conditions);

  function onward() {
    if (!wizard) {
      location.hash = detail;
      return;
    }
    const next = steps[index + 1];
    if (next) {
      go("edit", {
        id,
        s: next.section.id,
        wizard: "1",
        client: clientId
      });
    } else if (isCompany) {
      go("contact-new", { client: id, wizard: "1" });
    } else {
      toast(isContact ? "Contact saved." : "All steps done.");
      location.hash =
        isContact && clientId ? "#/client?id=" + clientId : detail;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const missing = missingRequired(form);
    if (missing) {
      status.innerHTML = errorBox(missing);
      return;
    }
    let changed;
    try {
      const now = readParts(form);
      changed = {};
      Object.keys(now).forEach((name) => {
        const was = before[name] === undefined ? null : before[name];
        if (now[name] !== was && !(now[name] === false && was === null)) {
          changed[name] = now[name];
        }
      });
    } catch (error) {
      status.innerHTML = errorBox(error.message);
      return;
    }
    if (!Object.keys(changed).length) {
      onward();
      return;
    }
    saveButton.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Saving…</span></div>`;
    try {
      await change("PATCH", "ui-api/records/" + id, { fields: changed });
      toast("Saved.");
      onward();
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
      saveButton.disabled = false;
    }
  });
  const skip = document.getElementById("edit-skip");
  if (skip) {
    skip.addEventListener("click", onward);
  }
}

/** A new contact on a company: the first section of the Contact layout, then the other steps. */
async function renderContactNew(token, params) {
  const clientId = params.get("client") || "";
  const wizard = params.get("wizard") === "1";
  const detail = "#/client?id=" + clientId;
  shell("Add Contact", loading(), "clients", { back: detail });
  if (!SALESFORCE_ID.test(clientId)) {
    throw new Error("This company could not be found.");
  }
  const info = await objectInfo("Contact");
  const clientType = Object.values(info.recordTypeInfos || {}).find(
    (type) => type.name === "Client" && type.available
  );
  const [kit, existing] = await Promise.all([
    editKit("Contact", clientType ? clientType.recordTypeId : null),
    companyContacts(clientId)
  ]);
  if (token !== renderToken) {
    return;
  }
  const steps = kit.layout.sections
    .map((section) => ({ section, parts: editableParts(kit, section, true) }))
    .filter((step) => step.parts.length);
  if (!steps.length) {
    throw new Error("You cannot add a contact here.");
  }
  const { section, parts } = steps[0];
  const currency = (kit.picks.CurrencyIsoCode || {}).defaultValue;
  // the first contact of a company is its primary contact unless the RM unticks it
  const start = (part) =>
    part.apiName === "Primary__c"
      ? existing.length === 0
      : part.apiName === "CurrencyIsoCode" && currency
        ? currency.value
        : null;
  document.getElementById("screen").innerHTML = `
    ${wizard ? `<p class="step-line">Last part · the company's contact</p>` : ""}
    <form class="card form" id="edit-form" novalidate>
      <h2 class="form-title">${esc(section.heading)}</h2>
      ${parts.map((part) => partInput(kit, part, start(part))).join("")}
      <div id="form-status"></div>
      <button class="button-primary" type="submit" id="edit-save">${steps.length > 1 ? "Save and Next" : "Save"}</button>
      <a class="button-outline button-link" href="${esc(detail)}">${wizard ? "Skip for Now" : "Cancel"}</a>
    </form>
    <p class="hint">The signatory's due diligence details are kept on the contact. After this step the app takes you through them.</p>`;

  const form = document.getElementById("edit-form");
  const status = document.getElementById("form-status");
  const saveButton = document.getElementById("edit-save");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const missing = missingRequired(form);
    if (missing) {
      status.innerHTML = errorBox(missing);
      return;
    }
    let fields;
    try {
      fields = { AccountId: clientId };
      Object.entries(readParts(form)).forEach(([name, value]) => {
        if (value !== null) {
          fields[name] = value;
        }
      });
      if (clientType) {
        fields.RecordTypeId = clientType.recordTypeId;
      }
    } catch (error) {
      status.innerHTML = errorBox(error.message);
      return;
    }
    saveButton.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Saving…</span></div>`;
    try {
      const created = await change("POST", "ui-api/records", {
        apiName: "Contact",
        fields
      });
      toast("Contact saved.");
      if (steps.length > 1) {
        go("edit", {
          id: created.id,
          s: steps[1].section.id,
          wizard: "1",
          client: clientId
        });
      } else {
        location.hash = detail;
      }
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
      saveButton.disabled = false;
    }
  });
}

async function renderContact(token, params) {
  const clientId = params.get("client") || "";
  shell("Contact", loading(), "clients", {
    back: clientId ? "#/client?id=" + clientId : "#/clients"
  });
  const { record, layout } = await recordWithLayout(params.get("id"));
  if (token !== renderToken) {
    return;
  }
  if (record.apiName !== "Contact") {
    throw new Error("This contact could not be found.");
  }
  const name =
    layoutValue(record, "Name") ||
    [layoutValue(record, "FirstName"), layoutValue(record, "LastName")]
      .filter(Boolean)
      .join(" ");
  const primary = record.fields.Primary__c && record.fields.Primary__c.value;
  document.getElementById("screen").innerHTML = `
    <div class="card">
      <div class="row-head">
        <h2 class="detail-title">${esc(name)}</h2>
        ${primary ? `<span class="pill pill-info">Primary</span>` : ""}
      </div>
    </div>
    ${layoutSections(
      record,
      layout,
      (section) =>
        "#/edit?id=" + record.id + "&s=" + section.id + "&client=" + clientId
    )}`;
}

async function companyContacts(accountId) {
  if (!SALESFORCE_ID.test(accountId || "")) {
    return [];
  }
  const soql =
    "SELECT Id, Name, Title, Primary__c FROM Contact WHERE AccountId = '" +
    accountId +
    "' ORDER BY Primary__c DESC, Name LIMIT 50";
  const answer = await data("query?q=" + encodeURIComponent(soql));
  return answer.records || [];
}

async function renderClient(token, params) {
  const from = params.get("from") || "";
  const back = from.startsWith("deal:")
    ? "#/deal?id=" + from.slice(5)
    : "#/clients";
  shell("Client", loading(), "clients", { back });
  // our own service first: it only answers for Client and Company accounts
  const client = await get("clients/detail", { id: params.get("id") });
  const [{ record, layout }, contacts] = await Promise.all([
    recordWithLayout(client.id),
    client.kind === "company" ? companyContacts(client.id) : []
  ]);
  if (token !== renderToken) {
    return;
  }
  const company = client.kind === "company";
  const number = client.mobile || client.phone;
  const contact = [
    number ? `<a class="action" href="tel:${esc(number)}">Call</a>` : "",
    number
      ? `<a class="action" href="https://wa.me/${esc(String(number).replace(/[^0-9]/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>`
      : "",
    client.email
      ? `<a class="action" href="mailto:${esc(client.email)}">Email</a>`
      : ""
  ].join("");
  const deals = (client.deals || [])
    .map(
      (deal) => `
      <a class="alert-row deal-line" href="#/deal?id=${esc(deal.id)}">
        <span><b>${esc([deal.project, deal.unit].filter(Boolean).join(" · ") || deal.title)}</b><br /><small>${esc(deal.stage)}</small></span>
        <span>›</span>
      </a>`
    )
    .join("");
  // what the booking form still needs, by the same rules as the booking form check
  const gaps = client.bookingForm || { missing: [] };
  const dueDiligence = layout.sections.find((section) =>
    /due diligence/i.test(section.heading)
  );
  const contactHash = "#/contact?id=" + gaps.contactId + "&client=" + client.id;
  let bookingNote = "";
  if (gaps.noPrimaryContact) {
    bookingNote = `
      <div class="notice notice-warn notice-left">
        <b>Booking form: not ready</b>
        <p>This company has no primary contact. Add the contact whose details the booking form should print, then fill in their Customer Due Diligence.</p>
        <a class="button-outline button-link" href="#/contact-new?client=${esc(client.id)}">Add Contact</a>
      </div>`;
  } else if ((gaps.missing || []).length) {
    const fix = company
      ? `<a class="button-outline button-link" href="${esc(contactHash)}">Open ${esc(gaps.contactName || "Contact")}</a>`
      : dueDiligence
        ? `<a class="button-outline button-link" href="#/edit?id=${esc(client.id)}&s=${esc(dueDiligence.id)}">Complete Now</a>`
        : "";
    bookingNote = `
      <div class="notice notice-warn notice-left">
        <b>Booking form: ${gaps.missing.length} ${gaps.missing.length === 1 ? "detail" : "details"} missing</b>
        <p>${company ? `On the primary contact ${esc(gaps.contactName || "")}: ` : ""}${esc(gaps.missing.join(", "))}.</p>
        ${fix}
      </div>`;
  } else {
    bookingNote = `
      <div class="notice notice-ok notice-left">
        <b>Booking form: ready</b>
        <p>Customer Due Diligence is complete${company && gaps.contactName ? ` (primary contact ${esc(gaps.contactName)})` : ""}.</p>
      </div>`;
  }
  const contactLines = contacts
    .map(
      (person) => `
      <a class="alert-row deal-line" href="#/contact?id=${esc(person.Id)}&client=${esc(client.id)}">
        <span><b>${esc(person.Name)}</b>${person.Primary__c ? ` <span class="pill pill-info">Primary</span>` : ""}${
          person.Title ? `<br /><small>${esc(person.Title)}</small>` : ""
        }</span>
        <span>›</span>
      </a>`
    )
    .join("");
  document.getElementById("screen").innerHTML = `
    <div class="card">
      <div class="row-head">
        <h2 class="detail-title">${esc(client.name)}</h2>
        <span class="pill ${company ? "pill-warn" : "pill-info"}">${company ? "Company" : "Individual"}</span>
      </div>
      ${contact ? `<div class="actions">${contact}</div>` : ""}
    </div>
    <a class="button-primary button-link start-booking" href="#/booking-new?client=${esc(client.id)}">Start Booking</a>
    ${bookingNote}
    ${layoutSections(
      record,
      layout,
      (section) => "#/edit?id=" + record.id + "&s=" + section.id
    )}
    ${
      company
        ? `<h3 class="section-title">Contacts</h3>${
            contactLines
              ? `<div class="card alert-list">${contactLines}</div>`
              : emptyBox("No contacts on this company yet.")
          }
          <a class="button-outline button-link add-contact" href="#/contact-new?client=${esc(client.id)}">Add Contact</a>`
        : ""
    }
    <h3 class="section-title">Deals</h3>
    ${deals ? `<div class="card alert-list">${deals}</div>` : emptyBox("No deals for this client yet.")}`;
}

// --------------------------------------------------------------- add client

let clientOptions = null;

function inputField(name, label, options) {
  const o = options || {};
  return `
    <label class="form-field">
      <span>${esc(label)}${o.required ? " *" : ""}</span>
      <input class="search" name="${name}" type="${o.type || "text"}"${o.required ? " required" : ""}${
        o.inputmode ? ` inputmode="${o.inputmode}"` : ""
      }${o.autocomplete ? ` autocomplete="${o.autocomplete}"` : ' autocomplete="off"'}${o.max ? ` max="${o.max}"` : ""} />
    </label>`;
}

function selectField(name, label, choices, required) {
  return `
    <label class="form-field">
      <span>${esc(label)}${required ? " *" : ""}</span>
      <select class="select" name="${name}"${required ? " required" : ""}>
        <option value="">Select…</option>
        ${choices.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("")}
      </select>
    </label>`;
}

async function renderClientNew(token, params) {
  const kind = params.get("kind") === "company" ? "company" : "client";
  shell("Add Client", loading(), "clients", { back: "#/clients" });
  if (!clientOptions) {
    clientOptions = await get("clients/options");
  }
  if (token !== renderToken) {
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const personFields =
    inputField("firstName", "First name", { autocomplete: "off" }) +
    inputField("lastName", "Last name", { required: true }) +
    inputField("email", "Email", {
      required: true,
      type: "email",
      inputmode: "email"
    }) +
    inputField("mobile", "Mobile (with country code)", {
      required: true,
      type: "tel",
      inputmode: "tel"
    }) +
    selectField("gender", "Gender", clientOptions.genders, false) +
    selectField("nationality", "Nationality", clientOptions.countries, false) +
    selectField(
      "countryOfResidence",
      "Country of residence",
      clientOptions.countries,
      true
    ) +
    inputField("birthdate", "Date of birth", {
      required: true,
      type: "date",
      max: today
    }) +
    inputField("passportNo", "Passport number", { required: true }) +
    inputField("passportIssueDate", "Passport issue date", {
      required: true,
      type: "date",
      max: today
    }) +
    inputField("passportExpiryDate", "Passport expiry date", {
      required: true,
      type: "date"
    });
  const companyFields =
    inputField("companyName", "Company name", { required: true }) +
    inputField("email", "Company email", {
      required: true,
      type: "email",
      inputmode: "email"
    }) +
    inputField("mobile", "Phone (with country code)", {
      required: true,
      type: "tel",
      inputmode: "tel"
    }) +
    inputField("tradeLicense", "Trade licence number", { required: true }) +
    selectField(
      "countryOfIncorporation",
      "Country of incorporation",
      clientOptions.countries,
      false
    ) +
    inputField("signatory", "Signatory name");

  document.getElementById("screen").innerHTML = `
    ${chips(
      [
        { key: "client", label: "Individual" },
        { key: "company", label: "Company" }
      ],
      kind,
      "newkind"
    )}
    <form class="card form" id="client-form" novalidate>
      ${kind === "company" ? companyFields : personFields}
      <div id="form-status"></div>
      <button class="button-primary" type="submit" id="client-save">Save Client</button>
    </form>
    <p class="hint">Step 1. Fields with * are required. The client is saved in Salesforce under your name, then the app takes you through the remaining details. Each step can be skipped and completed later.</p>`;

  root
    .querySelectorAll("[data-newkind]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        go("client-new", { kind: button.dataset.newkind })
      )
    );
  const form = document.getElementById("client-form");
  const status = document.getElementById("form-status");
  const saveButton = document.getElementById("client-save");

  async function submit(createAnyway) {
    const missing = [...form.querySelectorAll("[required]")].find(
      (el) => !el.value.trim()
    );
    if (missing) {
      status.innerHTML = errorBox(
        missing
          .closest(".form-field")
          .querySelector("span")
          .textContent.replace(" *", "") + " is required."
      );
      missing.focus();
      return;
    }
    const payload = { kind, createAnyway };
    new FormData(form).forEach((value, key) => {
      payload[key] = String(value).trim();
    });
    saveButton.disabled = true;
    status.innerHTML = `<div class="working"><span class="spinner"></span><span>Saving…</span></div>`;
    try {
      const result = await post("clients/create", payload);
      if (result.created) {
        toast("Client saved. Now the remaining details.");
        location.hash = "#/edit?id=" + result.id + "&wizard=1";
        return;
      }
      // possible duplicates: let the RM open the existing client or create a new one knowingly
      status.innerHTML = `
        <div class="notice notice-warn">
          <b>This client may already exist.</b>
          ${result.matches
            .map(
              (m) => `
            <a class="alert-row deal-line" href="#/client?id=${esc(m.id)}">
              <span><b>${esc(m.name)}</b><br /><small>Same ${esc(String(m.matchedOn).toLowerCase())} · ${esc(
                [m.phone, m.email].filter(Boolean).join(" · ")
              )}</small></span>
              <span>Open ›</span>
            </a>`
            )
            .join("")}
          <button class="button-outline" type="button" id="create-anyway">Create a New Client Anyway</button>
        </div>`;
      document
        .getElementById("create-anyway")
        .addEventListener("click", () => submit(true));
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      status.innerHTML = errorBox(error.message);
    } finally {
      saveButton.disabled = false;
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(false);
  });
}

// ------------------------------------------------------------- book a unit
// The app's version of the "Book this Unit" button in Salesforce: the same questions (client,
// assisted by agent, agency, agent). It can start from a unit or from a client. Booking cannot
// be undone from here, so the RM always passes a review screen first.

async function renderBookingNew(token, params) {
  const fromClient = params.get("client") || "";
  const fromUnit = params.get("unit") || "";
  const back = fromClient ? "#/client?id=" + fromClient : "#/units";
  shell("Book a Unit", loading(), fromClient ? "clients" : "units", { back });
  const [unitStart, clientStart] = await Promise.all([
    fromUnit ? get("bookings/unit", { id: fromUnit }) : null,
    fromClient ? get("clients/detail", { id: fromClient }) : null
  ]);
  if (token !== renderToken) {
    return;
  }
  const screen = document.getElementById("screen");
  const state = {
    step: "form",
    unit: unitStart,
    client: clientStart,
    assisted: false,
    agency: null,
    agent: null,
    error: "",
    result: null
  };

  const unitFacts = (u) =>
    [
      u.projectName,
      u.building,
      u.floor ? "Floor " + u.floor : null,
      u.type,
      u.bedrooms == null
        ? null
        : u.bedrooms === 0
          ? "Studio"
          : u.bedrooms + " bed",
      u.areaSqFt == null ? null : wholeNumber.format(u.areaSqFt) + " sq ft"
    ]
      .filter(Boolean)
      .join(" · ");

  const pickedBox = (key, title, line, extra) => `
    <div class="picked picked-tall">
      <span><b>${esc(title)}</b>${line ? `<br /><small>${esc(line)}</small>` : ""}${extra || ""}</span>
      <button type="button" class="picked-clear" data-clear="${key}" aria-label="Change">✕</button>
    </div>`;

  const searchBox = (key, placeholder) => `
    <input class="search" type="search" data-lookup="${key}" placeholder="${esc(placeholder)}" autocomplete="off" />
    <div class="lookup-results" data-results="${key}"></div>`;

  function gapsNote() {
    const gaps = state.client && state.client.bookingForm;
    if (!gaps) {
      return "";
    }
    if (gaps.noPrimaryContact) {
      return `<p class="muted note-warn">Booking form: this company has no primary contact yet. You can book now and add the contact before generating the booking form.</p>`;
    }
    if ((gaps.missing || []).length) {
      return `<p class="muted note-warn">Booking form: ${gaps.missing.length} due diligence ${gaps.missing.length === 1 ? "detail is" : "details are"} still missing for this client. You can book now and complete them before generating the booking form.</p>`;
    }
    return `<p class="muted note-ok">Booking form: this client's due diligence is complete.</p>`;
  }

  function formScreen() {
    return `
      <div class="card form">
        <div class="form-field">
          <span>Unit *</span>
          ${
            state.unit
              ? pickedBox(
                  "unit",
                  state.unit.title,
                  unitFacts(state.unit),
                  `<br /><small class="price">${esc(money(state.unit.price, state.unit.currencyCode))}</small>`
                ) +
                (state.unit.bookable
                  ? ""
                  : errorBox(
                      state.unit.reason || "This unit cannot be booked."
                    ))
              : searchBox("unit", "Search available units…")
          }
        </div>
        <div class="form-field">
          <span>Client *</span>
          ${
            state.client
              ? pickedBox(
                  "client",
                  state.client.name,
                  state.client.kind === "company" ? "Company" : "Individual",
                  ""
                ) + gapsNote()
              : searchBox(
                  "client",
                  "Search clients by name, phone, email or passport…"
                ) +
                `<p class="muted">Client not in the list? <a href="#/client-new">Add the client first</a>, then start the booking from the client's page.</p>`
          }
        </div>
        <label class="form-check">
          <input type="checkbox" id="assisted"${state.assisted ? " checked" : ""} />
          <span>Assisted by Agent</span>
        </label>
        ${
          state.assisted
            ? `<div class="form-field">
                 <span>Agency *</span>
                 ${state.agency ? pickedBox("agency", state.agency.name, "", "") : searchBox("agency", "Search agencies…")}
               </div>
               <div class="form-field">
                 <span>Agent *</span>
                 ${
                   !state.agency
                     ? `<p class="muted">Choose the agency first.</p>`
                     : state.agent
                       ? pickedBox("agent", state.agent.name, "", "")
                       : searchBox("agent", "Search the agency's agents…")
                 }
               </div>`
            : ""
        }
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="to-review">Review Booking</button>
        <a class="button-outline button-link" href="${esc(back)}">Cancel</a>
      </div>`;
  }

  function reviewScreen() {
    return `
      <p class="step-line">Please check before you book</p>
      <div class="card">
        ${field("Unit", state.unit.title)}
        ${field("Project", state.unit.projectName)}
        ${field("Details", unitFacts(state.unit))}
        ${field("Price", money(state.unit.price, state.unit.currencyCode))}
        ${field("Client", state.client.name)}
        ${field("Assisted by agent", state.assisted ? "Yes" : "No")}
        ${state.assisted ? field("Agency", state.agency.name) + field("Agent", state.agent.name) : ""}
      </div>
      <div class="notice notice-warn notice-left">
        <b>This cannot be undone here</b>
        <p>Booking creates the deal in Salesforce and takes the unit out of availability straight away. To reverse a booking a cancellation request is needed.</p>
      </div>
      <div class="card form">
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="confirm-booking">Confirm Booking</button>
        <button type="button" class="button-outline" id="back-to-form">Back</button>
      </div>`;
  }

  function doneScreen() {
    const r = state.result;
    return `
      <div class="card">
        <h2 class="form-title">Unit ${esc(r.unit || "")} is booked</h2>
        ${field("Client", r.client)}
        ${field("Project", r.projectName)}
        ${field("Deal", r.dealName)}
        ${field("Stage", r.stage)}
      </div>
      <a class="button-primary button-link" href="#/deal?id=${esc(r.dealId)}">Open the Deal</a>
      <a class="button-outline button-link below" href="#/units">Back to Units</a>`;
  }

  function validate() {
    if (!state.unit) {
      return "Please choose the unit.";
    }
    if (!state.unit.bookable) {
      return state.unit.reason || "This unit cannot be booked.";
    }
    if (!state.client) {
      return "Please choose the client.";
    }
    if (state.assisted && !state.agency) {
      return "Please choose the agency, or untick Assisted by Agent.";
    }
    if (state.assisted && !state.agent) {
      return "Please choose the agent.";
    }
    return "";
  }

  const LOOKUPS = {
    unit: async (term) =>
      (
        (
          await get("units", {
            status: "available",
            search: term,
            pageSize: 10,
            offset: 0
          })
        ).rows || []
      ).map((u) => ({
        id: u.id,
        name: u.title,
        detail: [u.projectName, money(u.price, u.currencyCode)]
          .filter(Boolean)
          .join(" · ")
      })),
    client: async (term) =>
      (
        (await get("clients", { search: term, pageSize: 10, offset: 0 }))
          .rows || []
      ).map((c) => ({
        id: c.id,
        name: c.name,
        detail: [c.kind === "company" ? "Company" : "Individual", c.mobile]
          .filter(Boolean)
          .join(" · ")
      })),
    agency: (term) => get("bookings/agencies", { search: term }),
    agent: (term) =>
      get("bookings/agents", { agencyId: state.agency.id, search: term })
  };

  function bindLookups() {
    screen.querySelectorAll("[data-lookup]").forEach((input) => {
      const key = input.dataset.lookup;
      const results = screen.querySelector(`[data-results="${key}"]`);
      let latest = 0;
      const run = async () => {
        const term = input.value.trim();
        const mine = ++latest;
        // an agency's agents are few: list them at once; the others wait for two letters
        if (term.length < 2 && key !== "agent") {
          results.innerHTML = "";
          return;
        }
        try {
          const found = await LOOKUPS[key](term);
          if (mine !== latest) {
            return;
          }
          results.innerHTML = found.length
            ? found
                .map(
                  (o) =>
                    `<button type="button" data-pick="${key}" data-id="${esc(o.id)}" data-name="${esc(o.name)}">${esc(o.name)}${
                      o.detail ? `<br /><small>${esc(o.detail)}</small>` : ""
                    }</button>`
                )
                .join("")
            : `<p class="muted">No match.</p>`;
        } catch (error) {
          results.innerHTML = errorBox(error.message);
        }
      };
      input.addEventListener("input", debounce(run, 300));
      if (key === "agent") {
        run();
      }
    });
  }

  function draw() {
    screen.innerHTML =
      state.step === "review"
        ? reviewScreen()
        : state.step === "done"
          ? doneScreen()
          : formScreen();
    bindLookups();
  }

  async function pick(key, id, name) {
    if (key === "unit" || key === "client") {
      // read it again in full: the unit's price and whether it is still free, the client's kind
      const status = document.getElementById("form-status");
      status.innerHTML = `<div class="working"><span class="spinner"></span><span>Loading…</span></div>`;
      try {
        state[key] =
          key === "unit"
            ? await get("bookings/unit", { id })
            : await get("clients/detail", { id });
      } catch (error) {
        if (error instanceof SignedOutError) {
          handleError(error);
          return;
        }
        state.error = error.message;
      }
    } else {
      state[key] = { id, name };
      if (key === "agency") {
        state.agent = null;
      }
    }
    if (token === renderToken) {
      draw();
    }
  }

  async function confirm() {
    const button = document.getElementById("confirm-booking");
    button.disabled = true;
    document.getElementById("form-status").innerHTML =
      `<div class="working"><span class="spinner"></span><span>Booking…</span></div>`;
    try {
      state.result = await post("bookings/create", {
        unitId: state.unit.id,
        clientId: state.client.id,
        assistedByAgent: state.assisted,
        agencyId: state.assisted ? state.agency.id : null,
        agentId: state.assisted ? state.agent.id : null
      });
      state.step = "done";
      state.error = "";
      offerSelection.clear();
      draw();
      window.scrollTo(0, 0);
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      state.error = error.message;
      draw();
    }
  }

  screen.addEventListener("change", (event) => {
    if (event.target.id === "assisted") {
      state.assisted = event.target.checked;
      state.error = "";
      draw();
    }
  });
  screen.addEventListener("click", (event) => {
    const el = event.target.closest("button");
    if (!el || !screen.contains(el)) {
      return;
    }
    const d = el.dataset;
    if (d.pick) {
      state.error = "";
      pick(d.pick, d.id, d.name);
      return;
    }
    if (d.clear) {
      state[d.clear] = null;
      if (d.clear === "agency") {
        state.agent = null;
      }
      state.error = "";
    } else if (el.id === "to-review") {
      state.error = validate();
      if (!state.error) {
        state.step = "review";
        window.scrollTo(0, 0);
      }
    } else if (el.id === "back-to-form") {
      state.step = "form";
      state.error = "";
    } else if (el.id === "confirm-booking") {
      confirm();
      return;
    } else {
      return;
    }
    draw();
  });
  draw();
}

// ----------------------------------------------------------- sales activities
// The same steps, wording and rules as the "Record Activity" wizard in Salesforce: the save
// goes to that wizard's own service, so nothing here decides what is valid.
// Changing an activity later follows the validation rule on the object: Salesforce tells the app
// which parts this user may change (an RM: activity, client, outcome, projects), and only those
// are offered.

const ACTIVITY_COPY = {
  "Client Meeting":
    "You met a client, indoor, outdoor or online, introduced via an agency.",
  "Agency Briefing":
    "You briefed an agency's agents on projects, inventory or offers."
};
const DURATIONS = [
  { label: "30 min", value: 30 },
  { label: "45 min", value: 45 },
  { label: "1 h", value: 60 },
  { label: "1.5 h", value: 90 },
  { label: "2 h", value: 120 },
  { label: "3 h", value: 180 },
  { label: "Custom", value: "custom" }
];
const PROOF_MAX_BYTES = 15 * 1024 * 1024;

function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clockTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function targetBar(label, done, target) {
  const percent =
    target > 0
      ? Math.min(100, Math.round((done / target) * 100))
      : done > 0
        ? 100
        : 0;
  return `
    <div class="progress">
      <div class="progress-head"><span>${esc(label)}</span><b>${done}${target > 0 ? " / " + target : ""}</b></div>
      <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
    </div>`;
}

function activityRow(a) {
  const who = [a.agency, a.client].filter(Boolean).join(" · ");
  const length =
    a.minutes == null
      ? ""
      : a.minutes >= 60
        ? ` · ${Math.round((a.minutes / 60) * 10) / 10} h`
        : ` · ${a.minutes} min`;
  return `
    <article class="row is-link" data-open="#/activity?id=${esc(a.id)}">
      <div class="row-head">
        <h4>${esc(a.activity || a.name)}</h4>
        ${a.activityType ? `<span class="pill pill-info">${esc(a.activityType)}</span>` : ""}
      </div>
      <p class="muted">${esc(who || "Not Registered Agency")}</p>
      <p class="muted">${esc(dateTime12(a.startDateTime))}${length}${
        a.outcome ? ` · ${esc(a.outcome)}` : ""
      }</p>
      ${a.ownerName ? `<p class="muted">RM: <b>${esc(a.ownerName)}</b></p>` : ""}
    </article>`;
}

function renderActivities(token, params) {
  if (isTeamScope(params)) {
    return renderTeamActivities(token, params);
  }
  shell(
    "My Activities",
    `${scopeChips("mine")}<a class="button-primary button-link" href="#/activity-new">Record Activity</a>
     <div class="list list-gap" id="list"></div>`,
    "home",
    { back: "#/home" }
  );
  wireTeamList("activities", null);
  openOnTap(document.getElementById("list"));
  infiniteList(
    document.getElementById("list"),
    (offset) => get("activities", { pageSize: PAGE_SIZE, offset }),
    activityRow,
    "You have not recorded any activity yet.",
    token
  );
}

async function renderActivity(token, params) {
  shell("Activity", loading(), "home", { back: "#/activities" });
  const a = await get("activities/detail", { id: params.get("id") });
  if (token !== renderToken) {
    return;
  }
  const projects = (a.projectsDiscussed || []).join(", ");
  document.getElementById("screen").innerHTML = `
    <div class="card">
      <div class="row-head">
        <h2 class="detail-title">${esc(a.activity || a.name)}</h2>
        ${a.activityType ? `<span class="pill pill-info">${esc(a.activityType)}</span>` : ""}
      </div>
      <p class="muted">${esc(a.name)}</p>
    </div>
    <div class="card">
      ${field("Agency", a.agency || "Not Registered Agency")}
      ${field("Client", a.client)}
      ${field("Started", dateTime12(a.startDateTime))}
      ${field("Ended", dateTime12(a.endDateTime))}
      ${field("Time spent", a.timeSpent)}
      ${field("Number of agents", a.numberOfAgents)}
      ${field("Other RMs who attended", (a.rmsAttended || []).join(", "))}
      ${field("Projects discussed", projects)}
      ${field("Other project", a.otherProject)}
      ${field("How it went", a.outcome)}
      ${field("What was discussed", a.description)}
      ${field("RM", a.rmName)}
      ${field("Line manager", a.lineManager)}
      ${field("Photos and files", a.files ? String(a.files) : "")}
    </div>
    ${
      (a.editable || []).length
        ? `<a class="button-primary button-link" href="#/activity-edit?id=${esc(a.id)}">Edit Activity</a>`
        : ""
    }
    <div class="list-gap">${proofCard([], "Add Photo or File")}</div>`;
  bindProofCard(a.id, [], () => {
    toast("Added to the activity.");
    if (token === renderToken) {
      render();
    }
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * Proof of activity, as on the last screen of the Salesforce wizard: take a picture now with
 * the phone's camera, or pick a picture or file already on the phone. Saved on the activity.
 */
function proofCard(added, title) {
  return `
    <div class="card form" id="proof-card">
      <h2 class="form-title">${esc(title)}</h2>
      <p class="muted">Take a picture of the meeting or briefing, or upload one you already took. It is saved on the activity in Salesforce.</p>
      <label class="button-primary button-link proof-pick">
        Take Photo
        <input type="file" id="proof-camera" accept="image/*" capture="environment" hidden />
      </label>
      <label class="button-outline button-link proof-pick below">
        Upload Photo or File
        <input type="file" id="proof-input" accept="image/*,application/pdf" multiple hidden />
      </label>
      <div id="proof-status"></div>
      ${
        added.length
          ? `<ul class="proof-list">${added.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>`
          : ""
      }
    </div>`;
}

function bindProofCard(recordId, added, onAdded) {
  const status = document.getElementById("proof-status");
  async function add(files, fromCamera) {
    let done = 0;
    for (const file of files) {
      if (file.size > PROOF_MAX_BYTES) {
        status.innerHTML = errorBox(
          file.name + " is larger than 15 MB and was not added."
        );
        continue;
      }
      // a camera picture arrives with a generic name such as image.jpg
      const extension = (file.name.match(/\.[^.]+$/) || [".jpg"])[0];
      const title = fromCamera
        ? "Photo " +
          new Date().toLocaleString("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
          })
        : file.name.replace(/\.[^.]+$/, "");
      status.innerHTML = `<div class="working"><span class="spinner"></span><span>Adding ${esc(title)}…</span></div>`;
      try {
        await change("POST", "sobjects/ContentVersion", {
          Title: title,
          PathOnClient: fromCamera ? title + extension : file.name,
          VersionData: await readAsBase64(file),
          FirstPublishLocationId: recordId
        });
        added.push(title);
        done += 1;
        status.innerHTML = "";
      } catch (error) {
        if (error instanceof SignedOutError) {
          handleError(error);
          return;
        }
        status.innerHTML = errorBox(
          title + " could not be added: " + error.message
        );
        break;
      }
    }
    if (done) {
      onAdded();
    }
  }
  [
    ["proof-camera", true],
    ["proof-input", false]
  ].forEach(([id, fromCamera]) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("change", () => add([...input.files], fromCamera));
    }
  });
}

async function renderActivityNew(token) {
  shell("Record Activity", loading(), "home", { back: "#/home" });
  const options = await get("activities/options");
  if (token !== renderToken) {
    return;
  }
  activityForm(token, options, null);
}

async function renderActivityEdit(token, params) {
  const id = params.get("id");
  shell("Edit Activity", loading(), "home", { back: "#/activity?id=" + id });
  const [options, record] = await Promise.all([
    get("activities/options"),
    get("activities/detail", { id })
  ]);
  if (token !== renderToken) {
    return;
  }
  if (!(record.editable || []).length) {
    throw new Error("You cannot change this activity.");
  }
  activityForm(token, options, record);
}

/** The Record Activity form; with `record` it edits that activity instead. */
function activityForm(token, options, record) {
  const editing = !!record;
  const can = (part) => !editing || record.editable.includes(part);
  const screen = document.getElementById("screen");
  const followDefault = new Date();
  followDefault.setDate(followDefault.getDate() + 3);
  const started =
    editing && record.startDateTime ? new Date(record.startDateTime) : null;
  const ended =
    editing && record.endDateTime ? new Date(record.endDateTime) : null;
  // times that cannot be shown as "one day, start and end" are left exactly as they are
  const keepWhen =
    editing && (!started || !ended || isoDay(started) !== isoDay(ended));
  const state = {
    step: editing ? "edit" : 1,
    activity: editing ? record.activity : null,
    type: editing ? record.activityType : options.defaultType || null,
    agency:
      editing && record.agencyId
        ? { id: record.agencyId, name: record.agency }
        : null,
    notRegistered: editing && !record.agencyId,
    client:
      editing && record.clientId
        ? { id: record.clientId, name: record.client }
        : null,
    agents:
      editing && record.numberOfAgents != null
        ? String(record.numberOfAgents)
        : "",
    rms: editing ? [...(record.rmsAttended || [])] : [],
    projects: editing ? [...(record.projectsDiscussed || [])] : [],
    otherProject: (editing && record.otherProject) || "",
    description: (editing && record.description) || "",
    outcome: editing ? record.outcome : null,
    date: started ? isoDay(started) : isoDay(new Date()),
    startTime: started ? clockTime(started) : "10:00",
    duration: editing ? "custom" : 60,
    customEnd: ended ? clockTime(ended) : "",
    followUp: false,
    followUpDate: isoDay(followDefault),
    followUpNote: "",
    error: ""
  };
  let saved = null;
  const proofs = [];
  const isBriefing = () => state.activity === "Agency Briefing";
  const otherPicked = () => state.projects.includes(options.otherProjectValue);

  const chipRow = (values, isOn, attribute) =>
    `<div class="chips chips-wrap">${values
      .map(
        (value) =>
          `<button type="button" class="chip${isOn(value) ? " is-active" : ""}" data-${attribute}="${esc(value)}">${esc(value)}</button>`
      )
      .join("")}</div>`;

  const lookup = (key, label, picked, placeholder, disabled) => `
    <div class="form-field">
      <span>${label}</span>
      ${
        picked
          ? `<div class="picked"><b>${esc(picked.name)}</b><button type="button" class="picked-clear" data-clear="${key}" aria-label="Remove">✕</button></div>`
          : `<input class="search" type="search" data-lookup="${key}" placeholder="${esc(placeholder)}" autocomplete="off"${disabled ? " disabled" : ""} />
             <div class="lookup-results" data-results="${key}"></div>`
      }
    </div>`;

  // ---- the parts of the form; each one is left out when this user may not change it
  const partActivity = () =>
    can("activity")
      ? `<div class="form-field">
           <span>Activity *</span>
           ${chipRow(options.activities || [], (v) => v === state.activity, "activity")}
         </div>`
      : "";
  const partType = () =>
    can("type")
      ? `<div class="form-field">
           <span>How was it held? *</span>
           ${chipRow(options.types || [], (v) => v === state.type, "type")}
         </div>`
      : "";
  const partAgency = () =>
    can("agency")
      ? `${lookup(
          "agency",
          `Agency${state.notRegistered ? "" : " *"}`,
          state.notRegistered ? null : state.agency,
          state.notRegistered ? "Not a registered agency" : "Search agencies…",
          state.notRegistered
        )}
        <label class="form-check">
          <input type="checkbox" id="not-registered"${state.notRegistered ? " checked" : ""} />
          <span>Not Registered Agency</span>
        </label>`
      : "";
  const partClient = () =>
    can("client")
      ? lookup(
          "client",
          "Client (optional)",
          state.client,
          "Search clients…",
          false
        )
      : "";
  const partAgents = () =>
    can("agents")
      ? `<label class="form-field">
           <span>${isBriefing() ? "Number of agents briefed *" : "Number of agents present (optional)"}</span>
           <input class="search" type="text" inputmode="numeric" data-bind="agents" value="${esc(state.agents)}" autocomplete="off" />
         </label>`
      : "";
  const partRms = () =>
    can("rms")
      ? `<div class="form-field">
           <span>Other RMs who attended (optional)</span>
           <input class="search" type="search" id="rm-search" placeholder="Type a name…" autocomplete="off" />
           <div class="lookup-results" id="rm-results"></div>
           ${
             state.rms.length
               ? `<div class="chips chips-wrap">${state.rms
                   .map(
                     (name) =>
                       `<button type="button" class="chip is-active" data-rm-remove="${esc(name)}">${esc(name)} ✕</button>`
                   )
                   .join("")}</div>`
               : ""
           }
         </div>`
      : "";
  const partProjects = () =>
    can("projects")
      ? `<div class="form-field">
           <span>Projects discussed (optional)</span>
           ${chipRow(options.projectNames || [], (v) => state.projects.includes(v), "project")}
           ${
             otherPicked()
               ? `<input class="search other-project" type="text" maxlength="100" data-bind="otherProject" placeholder="Which project?" value="${esc(state.otherProject)}" autocomplete="off" />`
               : ""
           }
         </div>`
      : "";
  const partDescription = () =>
    can("description")
      ? `<label class="form-field">
           <span>What was discussed? (optional)</span>
           <textarea class="search" rows="3" maxlength="255" data-bind="description" placeholder="${
             isBriefing()
               ? "What was presented? Projects covered, agent questions, agreed follow-ups…"
               : "What was discussed? Client interest, units shown, objections, next step…"
           }">${esc(state.description)}</textarea>
         </label>`
      : "";
  const partOutcome = () =>
    can("outcome")
      ? `<div class="form-field">
           <span>How did it go? *</span>
           ${chipRow(options.outcomes || [], (v) => v === state.outcome, "outcome")}
         </div>`
      : "";
  const partWhen = () =>
    can("when") && !keepWhen
      ? `<label class="form-field">
           <span>Date *</span>
           <input class="search" type="date" data-bind="date" max="${isoDay(new Date())}" value="${esc(state.date)}" />
         </label>
         <label class="form-field">
           <span>Start time *</span>
           <input class="search" type="time" data-bind="startTime" value="${esc(state.startTime)}" />
         </label>
         ${
           editing
             ? ""
             : `<div class="form-field">
                  <span>How long did it take? *</span>
                  <div class="chips chips-wrap">${DURATIONS.map(
                    (d) =>
                      `<button type="button" class="chip${d.value === state.duration ? " is-active" : ""}" data-duration="${d.value}">${d.label}</button>`
                  ).join("")}</div>
                </div>`
         }
         ${
           state.duration === "custom"
             ? `<label class="form-field">
                  <span>End time *</span>
                  <input class="search" type="time" data-bind="customEnd" value="${esc(state.customEnd)}" />
                </label>`
             : ""
         }`
      : "";

  function stepOne() {
    return `
      <div class="card">
        ${targetBar("Inbound this week", options.weekInbound || 0, options.inboundTarget || 0)}
        ${targetBar("Outbound this week", options.weekOutbound || 0, options.outboundTarget || 0)}
      </div>
      <p class="step-line">Step 1 of 3 · What did you do?</p>
      ${(options.activities || [])
        .map(
          (name) => `
        <button type="button" class="card pick-card" data-activity="${esc(name)}">
          <b>${esc(name)}</b>
          <span>${esc(ACTIVITY_COPY[name] || "")}</span>
        </button>`
        )
        .join("")}
      <a class="button-outline button-link" href="#/activities">My Activities</a>`;
  }

  function stepTwo() {
    return `
      <p class="step-line">Step 2 of 3 · ${esc(state.activity)}</p>
      <div class="card form">
        ${partType()}${partAgency()}${partClient()}${partAgents()}${partRms()}${partProjects()}${partDescription()}${partOutcome()}
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="to-when">Continue</button>
        <button type="button" class="button-outline" data-step="1">Back</button>
      </div>`;
  }

  function stepThree() {
    return `
      <p class="step-line">Step 3 of 3 · When did it happen?</p>
      <div class="card form">
        ${partWhen()}
        <label class="form-check">
          <input type="checkbox" id="follow-up"${state.followUp ? " checked" : ""} />
          <span>Schedule a follow-up task for yourself</span>
        </label>
        ${
          state.followUp
            ? `<label class="form-field">
                 <span>Follow up on</span>
                 <input class="search" type="date" data-bind="followUpDate" min="${isoDay(new Date())}" value="${esc(state.followUpDate)}" />
               </label>
               <label class="form-field">
                 <span>Note (optional)</span>
                 <input class="search" type="text" maxlength="255" data-bind="followUpNote" value="${esc(state.followUpNote)}" autocomplete="off" />
               </label>`
            : ""
        }
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="save-activity">Save Activity</button>
        <button type="button" class="button-outline" data-step="2">Back</button>
      </div>`;
  }

  /** What this user may not change, shown as it is. */
  function lockedCard() {
    const rows = [
      can("type") ? "" : field("How it was held", record.activityType),
      can("agency")
        ? ""
        : field("Agency", record.agency || "Not Registered Agency"),
      can("when") && !keepWhen
        ? ""
        : field("Started", dateTime12(record.startDateTime)) +
          field("Ended", dateTime12(record.endDateTime)),
      can("agents") ? "" : field("Number of agents", record.numberOfAgents),
      can("rms")
        ? ""
        : field(
            "Other RMs who attended",
            (record.rmsAttended || []).join(", ")
          ),
      can("description") ? "" : field("What was discussed", record.description)
    ].join("");
    return rows
      ? `<div class="card">
           <h2 class="form-title">Cannot Be Changed Here</h2>
           ${rows}
           <p class="muted locked-hint">Please contact your Line Manager for any change to these details.</p>
         </div>`
      : "";
  }

  function editScreen() {
    return `
      <div class="card form">
        <h2 class="form-title">${esc(record.name)}</h2>
        ${partActivity()}${partType()}${partAgency()}${partClient()}${partWhen()}${partAgents()}${partRms()}${partProjects()}${partDescription()}${partOutcome()}
        <div id="form-status">${state.error ? errorBox(state.error) : ""}</div>
        <button type="button" class="button-primary" id="save-activity">Save Changes</button>
        <a class="button-outline button-link" href="#/activity?id=${esc(record.id)}">Cancel</a>
      </div>
      ${lockedCard()}`;
  }

  function done() {
    const count = saved.weekCount || 0;
    const met =
      (saved.weekInbound || 0) >= (saved.inboundTarget || 0) &&
      (saved.weekOutbound || 0) >= (saved.outboundTarget || 0);
    const praise = met
      ? "Weekly target met. Brilliant!"
      : count >= 10
        ? "Great momentum!"
        : count >= 5
          ? "Nice pace!"
          : "";
    return `
      <div class="card">
        <h2 class="form-title">Activity ${esc(saved.recordName)} saved</h2>
        <p class="muted">That's ${count} activit${count === 1 ? "y" : "ies"} recorded this week.${
          saved.followUpDate
            ? ` A follow-up task is set for ${esc(saved.followUpDate)}.`
            : ""
        } ${praise}</p>
        ${targetBar("Inbound this week", saved.weekInbound || 0, saved.inboundTarget || 0)}
        ${targetBar("Outbound this week", saved.weekOutbound || 0, saved.outboundTarget || 0)}
      </div>
      ${proofCard(proofs, "Proof of Activity (optional)")}
      <a class="button-primary button-link" href="#/activity-new" id="another">Record Another Activity</a>
      <a class="button-outline button-link below" href="#/activities">My Activities</a>`;
  }

  function validateDetails() {
    if (can("activity") && !state.activity) {
      return "Please choose the activity.";
    }
    if (can("type") && !state.type) {
      return "Please choose how it was held.";
    }
    if (can("agency") && !state.notRegistered && !state.agency) {
      return 'Please select the agency, or tick "Not Registered Agency".';
    }
    if (can("agents")) {
      const agents = state.agents.trim();
      if (agents && !/^\d{1,5}$/.test(agents)) {
        return "The number of agents must be a whole number.";
      }
      if (isBriefing() && (!agents || Number(agents) < 1)) {
        return "Please enter how many agents attended the briefing.";
      }
    }
    if (can("projects") && otherPicked() && !state.otherProject.trim()) {
      return "Please name the project you discussed that is not in the list.";
    }
    if (can("outcome") && !state.outcome) {
      return "Please pick an outcome: how did it go?";
    }
    return "";
  }

  function times() {
    if (editing && (!can("when") || keepWhen)) {
      // not this user's to change: send back exactly what is stored
      return {
        start: record.startDateTime ? new Date(record.startDateTime) : null,
        end: record.endDateTime ? new Date(record.endDateTime) : null
      };
    }
    if (!state.date || !state.startTime) {
      throw new Error("Please set the date and the start time.");
    }
    const start = new Date(state.date + "T" + state.startTime);
    let end;
    if (state.duration === "custom") {
      if (!state.customEnd) {
        throw new Error("Please set the end time.");
      }
      end = new Date(state.date + "T" + state.customEnd);
    } else {
      end = new Date(start.getTime() + state.duration * 60000);
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("The date or time is not valid.");
    }
    if (end <= start) {
      throw new Error("The end time must be after the start time.");
    }
    if (start > new Date()) {
      throw new Error(
        "The activity cannot start in the future. Record it after it has happened."
      );
    }
    return { start, end };
  }

  async function save() {
    let when;
    try {
      if (editing) {
        const problem = validateDetails();
        if (problem) {
          throw new Error(problem);
        }
      }
      when = times();
      if (state.followUp && !state.followUpDate) {
        throw new Error("Please set the follow-up date.");
      }
    } catch (error) {
      state.error = error.message;
      draw();
      return;
    }
    const button = document.getElementById("save-activity");
    button.disabled = true;
    document.getElementById("form-status").innerHTML =
      `<div class="working"><span class="spinner"></span><span>Saving…</span></div>`;
    const payload = {
      activity: state.activity,
      activityType: state.type,
      agencyId: state.notRegistered || !state.agency ? null : state.agency.id,
      notRegisteredAgency: state.notRegistered,
      clientId: state.client ? state.client.id : null,
      description: state.description,
      startDateTime: when.start ? when.start.toISOString() : null,
      endDateTime: when.end ? when.end.toISOString() : null,
      numberOfAgents: state.agents.trim() ? Number(state.agents) : null,
      rmsAttended: state.rms,
      outcome: state.outcome,
      projectsDiscussed: state.projects,
      otherProject: state.otherProject
    };
    try {
      if (editing) {
        await post("activities/update", { id: record.id, ...payload });
        toast("Activity saved.");
        location.hash = "#/activity?id=" + record.id;
        return;
      }
      saved = await post("activities/save", {
        ...payload,
        followUpDate: state.followUp ? state.followUpDate : "",
        followUpNote: state.followUp ? state.followUpNote : ""
      });
      state.step = 4;
      state.error = "";
      draw();
      window.scrollTo(0, 0);
    } catch (error) {
      if (error instanceof SignedOutError) {
        handleError(error);
        return;
      }
      state.error = error.message;
      draw();
    }
  }

  function bindLookup(key, route) {
    const input = screen.querySelector(`[data-lookup="${key}"]`);
    const results = screen.querySelector(`[data-results="${key}"]`);
    if (!input || !results) {
      return;
    }
    let latest = 0;
    input.addEventListener(
      "input",
      debounce(async () => {
        const term = input.value.trim();
        const mine = ++latest;
        if (term.length < 2) {
          results.innerHTML = "";
          return;
        }
        try {
          const found = await get(route, { search: term });
          if (mine !== latest) {
            return;
          }
          results.innerHTML = found.length
            ? found
                .map(
                  (o) =>
                    `<button type="button" data-pick="${key}" data-id="${esc(o.id)}" data-name="${esc(o.name)}">${esc(o.name)}</button>`
                )
                .join("")
            : `<p class="muted">No match.</p>`;
        } catch (error) {
          results.innerHTML = errorBox(error.message);
        }
      }, 300)
    );
  }

  function draw() {
    screen.innerHTML =
      state.step === "edit"
        ? editScreen()
        : state.step === 1
          ? stepOne()
          : state.step === 2
            ? stepTwo()
            : state.step === 3
              ? stepThree()
              : done();
    // typed values are kept as they are typed, so a redraw never loses them
    screen.querySelectorAll("[data-bind]").forEach((el) =>
      el.addEventListener("input", () => {
        state[el.dataset.bind] = el.value;
      })
    );
    bindLookup("agency", "activities/agencies");
    bindLookup("client", "activities/clients");
    const rmSearch = document.getElementById("rm-search");
    if (rmSearch) {
      rmSearch.addEventListener("input", () => {
        const term = rmSearch.value.trim().toLowerCase();
        document.getElementById("rm-results").innerHTML =
          term.length < 2
            ? ""
            : (options.rmNames || [])
                .filter(
                  (name) =>
                    name.toLowerCase().includes(term) &&
                    !state.rms.includes(name)
                )
                .slice(0, 8)
                .map(
                  (name) =>
                    `<button type="button" data-rm-add="${esc(name)}">${esc(name)}</button>`
                )
                .join("");
      });
    }
    if (document.getElementById("proof-card")) {
      bindProofCard(saved.recordId, proofs, () => {
        if (token === renderToken) {
          draw();
        }
      });
    }
  }

  screen.addEventListener("change", (event) => {
    if (event.target.id === "not-registered") {
      state.notRegistered = event.target.checked;
      draw();
    } else if (event.target.id === "follow-up") {
      state.followUp = event.target.checked;
      draw();
    }
  });
  screen.addEventListener("click", (event) => {
    if (event.target.id === "another") {
      // "Record Another Activity" is the same address, so start over by hand
      event.preventDefault();
      render();
      return;
    }
    const el = event.target.closest("button");
    if (!el || !screen.contains(el)) {
      return;
    }
    const d = el.dataset;
    if (d.activity) {
      state.activity = d.activity;
      if (!editing) {
        state.step = 2;
        window.scrollTo(0, 0);
      }
    } else if (d.type) {
      state.type = d.type;
    } else if (d.outcome) {
      state.outcome = d.outcome;
    } else if (d.project) {
      state.projects = state.projects.includes(d.project)
        ? state.projects.filter((p) => p !== d.project)
        : [...state.projects, d.project];
    } else if (d.pick) {
      state[d.pick] = { id: d.id, name: d.name };
    } else if (d.clear) {
      state[d.clear] = null;
    } else if (d.rmAdd) {
      state.rms = [...state.rms, d.rmAdd];
    } else if (d.rmRemove) {
      state.rms = state.rms.filter((name) => name !== d.rmRemove);
    } else if (d.duration) {
      state.duration = d.duration === "custom" ? "custom" : Number(d.duration);
    } else if (d.step) {
      state.step = Number(d.step);
      state.error = "";
      window.scrollTo(0, 0);
    } else if (el.id === "to-when") {
      state.error = validateDetails();
      if (!state.error) {
        state.step = 3;
        window.scrollTo(0, 0);
      }
    } else if (el.id === "save-activity") {
      save();
      return;
    } else {
      return;
    }
    if (d.activity || d.type || d.outcome || d.project || d.duration) {
      state.error = "";
    }
    draw();
  });
  draw();
}

// ----------------------------------------------------------------------- me

function renderMe() {
  shell(
    "Me",
    `<div class="card profile">
       <div class="avatar">${esc(((me && me.name) || "?").slice(0, 1))}</div>
       <h2>${esc(me && me.name)}</h2>
       <p class="muted">${esc(me && me.email)}</p>
       <p class="muted">${esc(me && me.profile)}</p>
     </div>
     <div class="card">
       <p class="kv"><span>Connected to</span><b>${esc(CONFIG.environment)}</b></p>
       <p class="kv"><span>App version</span><b>${esc(CONFIG.version)}</b></p>
     </div>
     <a class="button-outline button-link" href="#/approvals">My Approvals${
       waitingCount ? " (" + waitingCount + " waiting)" : ""
     }</a>
     <a class="button-outline button-link below" href="#/my-requests">My Requests</a>
     <a class="button-outline button-link below" href="#/feedback">Send Feedback</a>
     ${installSlot("me")}
     <button class="button-secondary below" id="sign-out">Sign out</button>`,
    "",
    { back: "#/home" }
  );
  document.getElementById("sign-out").addEventListener("click", async () => {
    await signOut();
    me = null;
    teamInfo = null;
    setWaiting(0);
    renderLogin();
  });
}

// ----------------------------------------------------------------- feedback

const FEEDBACK_TYPES = [
  { key: "problem", label: "Problem" },
  { key: "suggestion", label: "Suggestion" },
  { key: "other", label: "Other" }
];

/** A few words from the user about the app itself, saved in Salesforce for the admin. */
function renderFeedback() {
  const from = lastScreen || "home";
  let type = "problem";
  shell(
    "Send Feedback",
    `<form class="card form" id="feedback-form" novalidate>
       <div class="form-field">
         <span>What is it about?</span>
         <div id="feedback-types"></div>
       </div>
       <label class="form-field">
         <span>Your message *</span>
         <textarea class="search" rows="6" id="feedback-message" maxlength="5000" placeholder="What happened, or what would make the app better for you?"></textarea>
       </label>
       <p class="muted">Sent with your message: your name, the screen you were on (${esc(from.split("?")[0])}), the app version and your phone type.</p>
       <div id="form-status"></div>
       <button class="button-primary" type="submit" id="feedback-submit">Send</button>
       <a class="button-outline button-link" href="#/me">Cancel</a>
     </form>`,
    "",
    { back: "#/me" }
  );
  const types = document.getElementById("feedback-types");
  const drawTypes = () => {
    types.innerHTML = chips(FEEDBACK_TYPES, type, "type");
  };
  drawTypes();
  types.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-type]");
    if (chip) {
      event.preventDefault();
      type = chip.dataset.type;
      drawTypes();
    }
  });
  const status = document.getElementById("form-status");
  document
    .getElementById("feedback-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("feedback-message").value.trim();
      if (message.length < 5) {
        status.innerHTML = errorBox(
          "Please write a few words about what happened or what you would like."
        );
        return;
      }
      const button = document.getElementById("feedback-submit");
      button.disabled = true;
      status.innerHTML = `<div class="working"><span class="spinner"></span><span>Sending…</span></div>`;
      try {
        const saved = await post("feedback/save", {
          type,
          message,
          screen: from,
          appVersion: CONFIG.version,
          device: navigator.userAgent
        });
        toast(`Thank you. Your feedback was sent (${saved.name}).`);
        location.hash = "#/" + from;
      } catch (error) {
        if (error instanceof SignedOutError) {
          handleError(error);
          return;
        }
        status.innerHTML = errorBox(error.message);
        button.disabled = false;
      }
    });
}

// -------------------------------------------------------------- new version

let updateOffered = false;

/**
 * An open app keeps running the screens it started with. This asks the site for the published
 * version number and, when it differs, offers to load the new screens.
 */
async function checkForUpdate() {
  if (updateOffered || document.visibilityState !== "visible") {
    return;
  }
  try {
    const response = await fetch("config.js?check=" + Date.now(), {
      cache: "no-store"
    });
    if (!response.ok) {
      return;
    }
    const found = /version:\s*"([^"]+)"/.exec(await response.text());
    if (found && found[1] !== CONFIG.version) {
      offerUpdate(found[1]);
    }
  } catch (e) {
    // offline: the next check will tell
  }
}

function offerUpdate(version) {
  updateOffered = true;
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.innerHTML = `
    <span>A new version of the app is ready (v${esc(version)}).</span>
    <button type="button">Update Now</button>`;
  document.body.appendChild(bar);
  bar.querySelector("button").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Updating…";
    try {
      const registration =
        "serviceWorker" in navigator &&
        (await navigator.serviceWorker.getRegistration());
      if (registration) {
        await registration.update();
      }
    } catch (e) {
      // the reload below still fetches the new screens
    }
    location.reload();
  });
}

// ------------------------------------------------------------------- router

async function render() {
  const token = ++renderToken;
  if (scrollWatcher) {
    scrollWatcher.disconnect();
    scrollWatcher = null;
  }
  closeSheet();
  const oldBar = document.getElementById("offer-bar");
  if (oldBar) {
    oldBar.remove();
  }
  document.body.classList.remove("has-offer-bar");
  if (!isSignedIn()) {
    renderLogin();
    return;
  }
  try {
    if (!me) {
      root.innerHTML = loading();
      me = await get("me");
      if (token !== renderToken) {
        return;
      }
      refreshWaiting();
    }
    const { path, params } = routeNow();
    window.scrollTo(0, 0);
    if (path !== "feedback" && path !== "me") {
      lastScreen = location.hash.replace(/^#\/?/, "") || "home";
    }
    if (path === "leads") {
      await renderLeads(token, params);
    } else if (path === "deals") {
      await renderDeals(token, params);
    } else if (path === "units") {
      await renderUnits(token, params);
    } else if (path === "deal") {
      await renderDeal(token, params);
    } else if (path === "clients") {
      renderClients(token, params);
    } else if (path === "client") {
      await renderClient(token, params);
    } else if (path === "contact") {
      await renderContact(token, params);
    } else if (path === "contact-new") {
      await renderContactNew(token, params);
    } else if (path === "edit") {
      await renderEdit(token, params);
    } else if (path === "approvals") {
      await renderApprovals(token);
    } else if (path === "my-requests") {
      await renderMyRequests(token);
    } else if (path === "approval") {
      await renderApproval(token, params);
    } else if (path === "request-price") {
      await renderRequestPrice(token, params);
    } else if (path === "sales-activity") {
      await renderSalesActivity(token, params);
    } else if (path === "sales-performance") {
      await renderSalesPerformance(token, params);
    } else if (path === "request-plan") {
      await renderRequestPlan(token, params);
    } else if (path === "request-share") {
      await renderRequestShare(token, params);
    } else if (path === "request-dld") {
      await renderRequestDld(token, params);
    } else if (path === "request-cancel") {
      await renderRequestCancel(token, params);
    } else if (path === "deal-owners") {
      await renderDealOwners(token, params);
    } else if (path === "booking-new") {
      await renderBookingNew(token, params);
    } else if (path === "activities") {
      await renderActivities(token, params);
    } else if (path === "activity-new") {
      await renderActivityNew(token);
    } else if (path === "activity-edit") {
      await renderActivityEdit(token, params);
    } else if (path === "activity") {
      await renderActivity(token, params);
    } else if (path === "client-new") {
      await renderClientNew(token, params);
    } else if (path === "me") {
      renderMe();
    } else if (path === "feedback") {
      renderFeedback();
    } else {
      await renderHome(token);
    }
  } catch (error) {
    if (!document.getElementById("screen")) {
      shell(CONFIG.appName, "", "home");
    }
    handleError(error);
  }
}

async function start() {
  try {
    await completeLoginIfReturning();
  } catch (error) {
    const problem = explainLoginError(error);
    renderLogin(problem.message, problem.detail);
    return;
  }
  window.addEventListener("hashchange", render);
  render();
}

document.addEventListener("visibilitychange", checkForUpdate);
setInterval(checkForUpdate, 15 * 60 * 1000);
document.addEventListener("visibilitychange", refreshWaiting);
setInterval(refreshWaiting, 5 * 60 * 1000);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
