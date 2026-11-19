// MIRA RM app: screens and navigation. Read-only in step 1 (dashboard, leads, deals, units).
import { CONFIG } from "../config.js";
import {
  isSignedIn,
  startLogin,
  completeLoginIfReturning,
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
      )}</a>`;
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

    <div class="quick-actions">
      <a class="button-primary button-link" href="#/activity-new">Record Activity</a>
      <a class="button-outline button-link" href="#/client-new">Add Client</a>
    </div>

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
  openOnTap(document.getElementById("list"));
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
    <button class="bar-button bar-go" id="offer-go">Sales Offer</button>`;
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
    ${
      deal.clientId
        ? `<a class="button-outline button-link" href="#/client?id=${esc(deal.clientId)}&from=deal:${esc(deal.id)}">Open Client</a>`
        : ""
    }`;
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
    </article>`;
}

function renderActivities(token) {
  shell(
    "My Activities",
    `<a class="button-primary button-link" href="#/activity-new">Record Activity</a>
     <div class="list list-gap" id="list"></div>`,
    "home",
    { back: "#/home" }
  );
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
    }`;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
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
      <div class="card form">
        <h2 class="form-title">Proof of Activity (optional)</h2>
        <p class="muted">Add a photo of the meeting or briefing. It is saved on the activity in Salesforce.</p>
        <label class="button-outline button-link proof-pick">
          Add Photo or File
          <input type="file" id="proof-input" accept="image/*,application/pdf" multiple hidden />
        </label>
        <div id="proof-status"></div>
        ${
          proofs.length
            ? `<ul class="proof-list">${proofs.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>`
            : ""
        }
      </div>
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

  async function addProofs(files) {
    const status = document.getElementById("proof-status");
    for (const file of files) {
      if (file.size > PROOF_MAX_BYTES) {
        status.innerHTML = errorBox(
          file.name + " is larger than 15 MB and was not added."
        );
        continue;
      }
      status.innerHTML = `<div class="working"><span class="spinner"></span><span>Adding ${esc(file.name)}…</span></div>`;
      try {
        await change("POST", "sobjects/ContentVersion", {
          Title: file.name.replace(/\.[^.]+$/, ""),
          PathOnClient: file.name,
          VersionData: await readAsBase64(file),
          FirstPublishLocationId: saved.recordId
        });
        proofs.push(file.name);
        status.innerHTML = "";
      } catch (error) {
        if (error instanceof SignedOutError) {
          handleError(error);
          return;
        }
        status.innerHTML = errorBox(
          file.name + " could not be added: " + error.message
        );
        return;
      }
    }
    if (token === renderToken) {
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
    const proofInput = document.getElementById("proof-input");
    if (proofInput) {
      proofInput.addEventListener("change", () =>
        addProofs([...proofInput.files])
      );
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
     <button class="button-secondary" id="sign-out">Sign out</button>`,
    "",
    { back: "#/home" }
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
    }
    const { path, params } = routeNow();
    window.scrollTo(0, 0);
    if (path === "leads") {
      renderLeads(token, params);
    } else if (path === "deals") {
      renderDeals(token, params);
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
    } else if (path === "activities") {
      renderActivities(token);
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
