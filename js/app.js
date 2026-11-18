// MIRA RM app: screens and navigation. Read-only in step 1 (dashboard, leads, deals, units).
import { CONFIG } from "../config.js";
import {
  isSignedIn,
  startLogin,
  completeLoginIfReturning,
  signOut
} from "./auth.js";
import { get, SignedOutError } from "./api.js";

const root = document.getElementById("app");
const PAGE_SIZE = 25;
let me = null;
let renderToken = 0;
let scrollWatcher = null;

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
    path: "units",
    label: "Units",
    icon: "M4 21V5l8-3 8 3v16zM9 9h2m2 0h2M9 13h2m2 0h2M9 17h2m2 0h2"
  },
  {
    path: "me",
    label: "Me",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3a8 8 0 1 1-16 0 8 8 0 0 1 16 0z"
  }
];

function shell(title, body, activePath) {
  const tabs = TABS.map(
    (tab) => `
      <a class="tab${tab.path === activePath ? " is-active" : ""}" href="#/${tab.path}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${tab.icon}"/></svg>
        <span>${tab.label}</span>
      </a>`
  ).join("");
  root.innerHTML = `
    <header class="topbar">
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

function handleError(error, target) {
  if (error instanceof SignedOutError) {
    me = null;
    renderLogin(error.message);
    return;
  }
  (target || document.getElementById("screen")).innerHTML = errorBox(
    error.message
  );
}

// -------------------------------------------------------------------- login

function renderLogin(message) {
  root.innerHTML = `
    <section class="login">
      <div class="login-mark">MIRA</div>
      <h1>${esc(CONFIG.appName)}</h1>
      <p>Your leads, deals and unit availability in one place.</p>
      ${message ? errorBox(message) : ""}
      <button class="button-primary" id="sign-in">Sign in with Salesforce</button>
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
  const data = await get("dashboard");
  if (token !== renderToken) {
    return;
  }
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

    <h3 class="section-title">My Day</h3>
    <div class="tiles">${tiles || emptyBox("Nothing needs attention.")}</div>

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
      ${lead.nextAction ? `<p class="next">${esc(lead.nextAction)}</p>` : ""}
      ${contact ? `<div class="actions">${contact}</div>` : ""}
    </article>`;
}

function renderLeads(token, params) {
  const bucket = params.get("bucket") || "open";
  const search = params.get("search") || "";
  shell(
    "My Leads",
    `${chips(LEAD_BUCKETS, bucket, "bucket")}
     <input class="search" id="search" type="search" placeholder="Search name, phone or email" value="${esc(search)}" />
     <div class="list" id="list"></div>`,
    "leads"
  );
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
  { key: "stuck", label: "Stuck" },
  { key: "bookingForm", label: "Booking Form" }
];

function dealRow(deal) {
  return `
    <article class="row">
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
      ${deal.nextAction ? `<p class="next">${esc(deal.nextAction)}</p>` : ""}
    </article>`;
}

function renderDeals(token, params) {
  const step = params.get("step") || "active";
  const search = params.get("search") || "";
  shell(
    "My Deals",
    `${chips(DEAL_STEPS, step, "step")}
     <input class="search" id="search" type="search" placeholder="Search client or unit" value="${esc(search)}" />
     <div class="list" id="list"></div>`,
    "deals"
  );
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
  infiniteList(
    document.getElementById("list"),
    (offset) => get("deals", { step, search, pageSize: PAGE_SIZE, offset }),
    dealRow,
    "No deals here.",
    token
  );
}

// -------------------------------------------------------------------- units

const UNIT_STATUSES = [
  { key: "available", label: "Available" },
  { key: "blocked", label: "Blocked" },
  { key: "onApproval", label: "On Approval" },
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
  return `
    <article class="row">
      <div class="row-head">
        <h4>${esc(unit.title)}</h4>
        <span class="pill status-${esc(unit.status)}">${esc(unit.statusLabel)}</span>
      </div>
      <p class="muted">${esc(place.join(" · "))}</p>
      <p class="muted">${esc(facts.join(" · "))}</p>
      <p class="price">${esc(money(unit.price, unit.currencyCode))}</p>
    </article>`;
}

async function renderUnits(token, params) {
  const filters = {
    projectId: params.get("projectId") || "",
    status: params.get("status") || "available",
    bedrooms: params.get("bedrooms") || "",
    search: params.get("search") || ""
  };
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
    ${chips(UNIT_STATUSES, filters.status, "status")}
    <div class="filter-row">
      <select class="select" id="bedrooms">${bedroomOptions}</select>
      <input class="search" id="search" type="search" placeholder="Search unit or building" value="${esc(filters.search)}" />
    </div>
    <div class="list" id="list"></div>`;

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
     <button class="button-secondary" id="sign-out">Sign out</button>`,
    "me"
  );
  document.getElementById("sign-out").addEventListener("click", async () => {
    await signOut();
    me = null;
    renderLogin();
  });
}

// ------------------------------------------------------------------- router

async function render() {
  const token = ++renderToken;
  if (scrollWatcher) {
    scrollWatcher.disconnect();
    scrollWatcher = null;
  }
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
    }
    const { path, params } = routeNow();
    window.scrollTo(0, 0);
    if (path === "leads") {
      renderLeads(token, params);
    } else if (path === "deals") {
      renderDeals(token, params);
    } else if (path === "units") {
      await renderUnits(token, params);
    } else if (path === "me") {
      renderMe();
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
    renderLogin(error.message);
    return;
  }
  window.addEventListener("hashchange", render);
  render();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
