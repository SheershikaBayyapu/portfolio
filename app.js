/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BRUTALIST PORTFOLIO — app.js                                    ║
 * ║  Deferred · Zero render-blocking · Fully commented               ║
 * ║                                                                  ║
 * ║  Responsibilities:                                               ║
 * ║  1. Dynamic header greeting + real-time clock                   ║
 * ║  2. Mobile nav toggle                                           ║
 * ║  3. IntersectionObserver — section reveal + dwell tracking      ║
 * ║  4. Click tracking (live links vs GitHub links vs nav)          ║
 * ║  5. localStorage analytics (anonymised, no PII)                 ║
 * ║  6. Engagement score algorithm                                  ║
 * ║  7. Personalisation engine — DOM reorder by category            ║
 * ║  8. Skill bar animation via CSS custom properties               ║
 * ║  9. Contact form — regex validation + XSS sanitisation          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

/* ──────────────────────────────────────────────────────────────
   CONSTANTS
   ────────────────────────────────────────────────────────────── */
const STORAGE_KEY   = 'portfolio_analytics_v1';  // localStorage key
const SCORE_WEIGHTS = {
  dwell:      0.5,   // seconds of dwell time per section
  liveClick:  5,     // clicking the live project link
  githubClick: 3,    // clicking the GitHub link
  navClick:   1,     // navigating to a section
};

/* ──────────────────────────────────────────────────────────────
   ANALYTICS STATE
   Fully anonymised — no names, emails, or IP addresses stored.
   Shape: {
     sessionId: string,          // random UUID, no personal tie
     sections: {
       [sectionId]: {
         dwell: number,          // total seconds viewed
         visits: number          // times entered viewport
       }
     },
     clicks: {
       liveLinks:   { [projectId]: number },
       githubLinks: { [projectId]: number },
       social:      { [platform]: number },
       nav:         { [sectionId]: number },
     },
     categories: {               // aggregated from project interactions
       [category]: number
     },
     lastUpdated: string         // ISO timestamp
   }
   ────────────────────────────────────────────────────────────── */

/** Load analytics state from localStorage (or initialise fresh). */
function loadAnalytics() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* quota exceeded or parse error — fall through */ }

  return {
    sessionId:   generateSessionId(),
    sections:    {},
    clicks:      { liveLinks: {}, githubLinks: {}, social: {}, nav: {} },
    categories:  {},
    lastUpdated: new Date().toISOString(),
  };
}

/** Persist analytics state to localStorage. */
function saveAnalytics(state) {
  try {
    state.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* storage quota exceeded — silently ignore */ }
}

/** Generate a random pseudonymous session ID (no personal data). */
function generateSessionId() {
  return 'anon_' + Math.random().toString(36).slice(2, 11)
       + '_' + Date.now().toString(36);
}

/* ──────────────────────────────────────────────────────────────
   ENGAGEMENT SCORE ALGORITHM
   Calculates a per-category engagement score so the
   personalisation engine can decide which card to promote.

   Formula per category:
     score = Σ(dwell_for_sections_tagged_to_category × SCORE_WEIGHTS.dwell)
           + Σ(liveClicks_for_projects_in_category  × SCORE_WEIGHTS.liveClick)
           + Σ(githubClicks_for_projects_in_category × SCORE_WEIGHTS.githubClick)

   Projects carry data-category attributes in the HTML.
   We build a projectId → category map at runtime.
   ────────────────────────────────────────────────────────────── */

/** Build a map of { projectId → category } from current DOM. */
function buildProjectCategoryMap() {
  const map = {};
  document.querySelectorAll('[data-id][data-category]').forEach(card => {
    map[card.dataset.id] = card.dataset.category;
  });
  return map;
}

/**
 * Compute engagement scores per category.
 * @param {object} state   - analytics state
 * @param {object} pMap    - projectId → category map
 * @returns {object} { [category]: number }
 */
function computeEngagementScores(state, pMap) {
  const scores = {};

  /** Increment helper */
  const add = (cat, amount) => {
    scores[cat] = (scores[cat] || 0) + amount;
  };

  // Live link clicks weighted per category
  Object.entries(state.clicks.liveLinks).forEach(([pid, count]) => {
    const cat = pMap[pid];
    if (cat) add(cat, count * SCORE_WEIGHTS.liveClick);
  });

  // GitHub link clicks weighted per category
  Object.entries(state.clicks.githubLinks).forEach(([pid, count]) => {
    const cat = pMap[pid];
    if (cat) add(cat, count * SCORE_WEIGHTS.githubClick);
  });

  // Carry over any previously accumulated category score
  // (from prior sessions already merged into state.categories)
  Object.entries(state.categories).forEach(([cat, stored]) => {
    add(cat, stored);
  });

  return scores;
}

/**
 * Identify the winning category with the highest engagement score.
 * Returns null if no clear winner exists (all zeros).
 * @param {object} scores - { [category]: number }
 * @returns {string|null}
 */
function getTopCategory(scores) {
  let top = null;
  let topScore = 0;
  Object.entries(scores).forEach(([cat, score]) => {
    if (score > topScore) { topScore = score; top = cat; }
  });
  return top;
}

/* ──────────────────────────────────────────────────────────────
   PERSONALISATION ENGINE
   Re-orders .projects__grid children so cards matching the
   user's highest-engagement category float to the top.
   Uses DocumentFragment for a single reflow (no CLS).
   Adds 'is-preferred' class for accent border animation.
   ────────────────────────────────────────────────────────────── */

/**
 * Reorder project cards based on top category, with a short delay
 * so the initial render is seen before DOM moves.
 * @param {string|null} topCategory
 */
function personaliseProjectsGrid(topCategory) {
  if (!topCategory) return; // no data yet — leave default order

  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.project-card'));

  // Partition: matching cards first, rest after (stable order within each group)
  const preferred = cards.filter(c => c.dataset.category === topCategory);
  const rest      = cards.filter(c => c.dataset.category !== topCategory);

  if (preferred.length === 0) return;

  // Mark the first preferred card with the accent animation
  preferred.forEach((card, i) => {
    if (i === 0) card.classList.add('is-preferred');
  });

  // Rebuild via DocumentFragment — single reflow, no layout shift
  const frag = document.createDocumentFragment();
  [...preferred, ...rest].forEach(card => frag.appendChild(card));
  grid.appendChild(frag);
}

/* ──────────────────────────────────────────────────────────────
   SECTION DWELL TRACKING — IntersectionObserver
   Each section tagged [data-observe] gets an entry/exit timer.
   Total dwell seconds accumulated per session in state.sections.
   ────────────────────────────────────────────────────────────── */

/** Active dwell timers: { sectionId: entryTimestamp } */
const dwellTimers = {};

/**
 * Create and attach the IntersectionObserver for section tracking.
 * Also drives the section reveal animation via 'is-visible' class.
 * @param {object} state - analytics state (mutated in place)
 */
function initSectionObserver(state) {
  const options = {
    root: null,
    rootMargin: '-10% 0px -10% 0px',
    threshold: 0.15,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const id = entry.target.id || entry.target.dataset.sectionId;

      if (entry.isIntersecting) {
        // ── Section entered viewport ──

        // 1. Reveal animation
        entry.target.classList.add('is-visible');

        // 2. Start dwell timer
        dwellTimers[id] = performance.now();

        // 3. Track visit count
        if (!state.sections[id]) {
          state.sections[id] = { dwell: 0, visits: 0 };
        }
        state.sections[id].visits++;

        // 4. Update active nav link
        updateActiveNavLink(id);

        // 5. Trigger skill bars if entering skills section
        if (id === 'skills') animateSkillBars();

      } else {
        // ── Section left viewport — accumulate dwell ──
        if (dwellTimers[id]) {
          const elapsed = (performance.now() - dwellTimers[id]) / 1000; // seconds
          delete dwellTimers[id];

          if (!state.sections[id]) {
            state.sections[id] = { dwell: 0, visits: 0 };
          }
          state.sections[id].dwell += elapsed;

          // Persist immediately so accidental close doesn't lose data
          saveAnalytics(state);
        }
      }
    });
  }, options);

  // Observe every section tagged [data-observe]
  document.querySelectorAll('[data-observe]').forEach(el => observer.observe(el));

  // Flush dwell times when user navigates away or closes tab
  window.addEventListener('pagehide', () => {
    const now = performance.now();
    Object.entries(dwellTimers).forEach(([id, start]) => {
      const elapsed = (now - start) / 1000;
      if (!state.sections[id]) state.sections[id] = { dwell: 0, visits: 0 };
      state.sections[id].dwell += elapsed;
    });
    saveAnalytics(state);
  });
}

/* ──────────────────────────────────────────────────────────────
   CLICK EVENT TRACKING
   Delegates from document (handles dynamically reordered cards).
   Captures live-link clicks vs github-link clicks vs nav clicks.
   ────────────────────────────────────────────────────────────── */

/**
 * Register a single delegated click listener on the document.
 * @param {object} state        - analytics state
 * @param {object} pMap         - projectId → category map
 */
function initClickTracking(state, pMap) {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-track]');
    if (!el) return;

    const track   = el.dataset.track;
    const project = el.dataset.project;

    switch (track) {

      // ── Project live deployment link ──
      case 'live-link': {
        if (!project) break;
        state.clicks.liveLinks[project] =
          (state.clicks.liveLinks[project] || 0) + 1;

        // Accumulate into category score immediately
        const cat = pMap[project];
        if (cat) {
          state.categories[cat] = (state.categories[cat] || 0) + SCORE_WEIGHTS.liveClick;
        }

        saveAnalytics(state);
        break;
      }

      // ── GitHub repository link ──
      case 'github-link': {
        if (!project) break;
        state.clicks.githubLinks[project] =
          (state.clicks.githubLinks[project] || 0) + 1;

        const cat = pMap[project];
        if (cat) {
          state.categories[cat] = (state.categories[cat] || 0) + SCORE_WEIGHTS.githubClick;
        }

        saveAnalytics(state);
        break;
      }

      // ── Social links ──
      case 'social-github':
      case 'social-linkedin':
      case 'social-twitter':
      case 'social-email': {
        const platform = track.replace('social-', '');
        state.clicks.social[platform] =
          (state.clicks.social[platform] || 0) + 1;
        saveAnalytics(state);
        break;
      }

      default:
        break;
    }
  });

  // Navigation link tracking (header nav + mobile nav)
  document.querySelectorAll('[data-section]').forEach(link => {
    link.addEventListener('click', () => {
      const section = link.dataset.section;
      if (!section) return;
      state.clicks.nav[section] =
        (state.clicks.nav[section] || 0) + SCORE_WEIGHTS.navClick;
      saveAnalytics(state);
    });
  });
}

/* ──────────────────────────────────────────────────────────────
   ACTIVE NAV LINK
   ────────────────────────────────────────────────────────────── */
function updateActiveNavLink(sectionId) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('is-active', link.dataset.section === sectionId);
  });
}

/* ──────────────────────────────────────────────────────────────
   SKILL BARS — CSS custom property animation
   Sets --skill-level on each .skill__bar element.
   CSS transition handles the animation (no JS animation loop).
   ────────────────────────────────────────────────────────────── */
let skillsAnimated = false;

function animateSkillBars() {
  if (skillsAnimated) return;
  skillsAnimated = true;

  document.querySelectorAll('.skill__bar[data-level]').forEach(bar => {
    const level = parseInt(bar.dataset.level, 10) || 0;
    // requestAnimationFrame ensures transition fires after paint
    requestAnimationFrame(() => {
      bar.style.setProperty('--skill-level', level);
    });
  });
}

/* ──────────────────────────────────────────────────────────────
   DYNAMIC HEADER — Real-time greeting + clock
   Updates every second via setInterval.
   ────────────────────────────────────────────────────────────── */
function initHeaderClock() {
  const greetingEl = document.getElementById('greeting-text');
  const timeEl     = document.getElementById('greeting-time');
  if (!greetingEl || !timeEl) return;

  function update() {
    const now  = new Date();
    const h    = now.getHours();
    const mm   = String(now.getMinutes()).padStart(2, '0');
    const ss   = String(now.getSeconds()).padStart(2, '0');

    // Greeting by time of day
    let greeting;
    if      (h < 5)  greeting = 'LATE NIGHT';
    else if (h < 12) greeting = 'GOOD MORNING';
    else if (h < 17) greeting = 'GOOD AFTERNOON';
    else if (h < 21) greeting = 'GOOD EVENING';
    else             greeting = 'GOOD NIGHT';

    greetingEl.textContent = greeting;
    timeEl.textContent     = `${String(h).padStart(2,'0')}:${mm}:${ss}`;
  }

  update(); // immediate — prevents blank frame
  setInterval(update, 1000);
}

/* ──────────────────────────────────────────────────────────────
   MOBILE NAV TOGGLE
   ────────────────────────────────────────────────────────────── */
function initMobileNav() {
  const burger    = document.getElementById('burger-btn');
  const mobileNav = document.getElementById('mobile-nav');
  if (!burger || !mobileNav) return;

  burger.addEventListener('click', () => {
    const isOpen = burger.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', isOpen);
    mobileNav.hidden = !isOpen;
  });

  // Close on nav link click
  mobileNav.querySelectorAll('.mobile-nav__link').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', false);
      mobileNav.hidden = true;
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!burger.contains(e.target) && !mobileNav.contains(e.target)) {
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', false);
      mobileNav.hidden = true;
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   XSS SANITISATION UTILITIES
   Used for contact form fields before any display operations.
   Not for server submission — this is purely defensive on the
   client side for any future dynamic rendering.
   ────────────────────────────────────────────────────────────── */

/**
 * Escape HTML special characters to neutralise XSS injection.
 * @param {string} str - raw user input
 * @returns {string}   - HTML-safe string
 */
function sanitiseHTML(str) {
  const map = {
    '&':  '&amp;',
    '<':  '&lt;',
    '>':  '&gt;',
    '"':  '&quot;',
    "'":  '&#x27;',
    '/':  '&#x2F;',
    '`':  '&#x60;',
    '=':  '&#x3D;',
  };
  return String(str).replace(/[&<>"'`=/]/g, ch => map[ch]);
}

/**
 * Strip any HTML tags from a string (belt-and-suspenders).
 * @param {string} str
 * @returns {string}
 */
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

/* ──────────────────────────────────────────────────────────────
   CONTACT FORM VALIDATION
   Uses regex tests + sanitisation.
   Honeypot check to detect bots.
   Form data is NEVER stored in localStorage — analytics state
   is kept entirely separate (different key, different object).
   ────────────────────────────────────────────────────────────── */

/** Regex patterns */
const PATTERNS = {
  // RFC 5322 simplified email regex
  email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/,
  // Name: printable characters, no HTML/script tags
  name: /^[^<>{}[\]\\|;=+]{2,80}$/,
  // Subject: same printable restriction
  subject: /^[^<>{}[\]\\|;=+]{2,120}$/,
};

/**
 * Display an inline field error.
 * @param {string} fieldId - e.g. 'name'
 * @param {string} message
 */
function setFieldError(fieldId, message) {
  const input = document.getElementById(`f-${fieldId}`);
  const msg   = document.getElementById(`err-${fieldId}`);
  if (input) input.classList.add('has-error');
  if (msg)   msg.textContent = message;
}

/** Clear a field error. */
function clearFieldError(fieldId) {
  const input = document.getElementById(`f-${fieldId}`);
  const msg   = document.getElementById(`err-${fieldId}`);
  if (input) input.classList.remove('has-error');
  if (msg)   msg.textContent = '';
}

/**
 * Validate the contact form.
 * @returns {boolean} true if valid
 */
function validateForm() {
  let valid = true;

  // Clear previous errors
  ['name','email','subject','message'].forEach(f => clearFieldError(f));

  const name    = document.getElementById('f-name')?.value.trim()    || '';
  const email   = document.getElementById('f-email')?.value.trim()   || '';
  const subject = document.getElementById('f-subject')?.value.trim() || '';
  const message = document.getElementById('f-message')?.value.trim() || '';

  // Name validation
  if (!name) {
    setFieldError('name', '↳ Please enter your name.');
    valid = false;
  } else if (!PATTERNS.name.test(name)) {
    setFieldError('name', '↳ Name contains invalid characters.');
    valid = false;
  }

  // Email validation
  if (!email) {
    setFieldError('email', '↳ Please enter your email address.');
    valid = false;
  } else if (!PATTERNS.email.test(email)) {
    setFieldError('email', '↳ Please enter a valid email address.');
    valid = false;
  }

  // Subject validation
  if (!subject) {
    setFieldError('subject', '↳ Please enter a subject.');
    valid = false;
  } else if (!PATTERNS.subject.test(subject)) {
    setFieldError('subject', '↳ Subject contains invalid characters.');
    valid = false;
  }

  // Message validation — min 10 chars to prevent trivial submissions
  if (!message) {
    setFieldError('message', '↳ Please enter a message.');
    valid = false;
  } else if (message.length < 10) {
    setFieldError('message', '↳ Message is too short (minimum 10 characters).');
    valid = false;
  } else if (message.length > 2000) {
    setFieldError('message', '↳ Message is too long (maximum 2000 characters).');
    valid = false;
  }

  // Update ARIA error summary for screen readers
  const errorSummary = document.getElementById('form-errors');
  if (errorSummary) {
    if (!valid) {
      errorSummary.textContent = 'Please correct the errors below before sending.';
      errorSummary.hidden = false;
    } else {
      errorSummary.textContent = '';
      errorSummary.hidden = true;
    }
  }

  return valid;
}

function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  // Real-time validation feedback on blur
  ['name','email','subject','message'].forEach(fieldId => {
    const input = document.getElementById(`f-${fieldId}`);
    if (!input) return;
    input.addEventListener('blur', () => {
      // Re-validate just this field by running full validation
      // (simpler than per-field logic, negligible cost)
      validateForm();
    });
    // Clear error on focus
    input.addEventListener('focus', () => clearFieldError(fieldId));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // ── Honeypot check — bots fill the hidden field ──
    const honeypot = form.querySelector('#hp_field');
    if (honeypot && honeypot.value.length > 0) {
      // Silently succeed to fool bots, but don't process
      showFormSuccess(form);
      return;
    }

    if (!validateForm()) return;

    // ── Sanitise all values before any further processing ──
    // (In production, send these via fetch to your backend.)
    const payload = {
      name:    sanitiseHTML(stripTags(form.querySelector('#f-name').value.trim())),
      email:   sanitiseHTML(stripTags(form.querySelector('#f-email').value.trim())),
      subject: sanitiseHTML(stripTags(form.querySelector('#f-subject').value.trim())),
      message: sanitiseHTML(stripTags(form.querySelector('#f-message').value.trim())),
    };

    // ── Simulate async submission (replace with real fetch call) ──
    const submitBtn = document.getElementById('form-submit');
    if (submitBtn) {
      submitBtn.disabled  = true;
      submitBtn.textContent = 'SENDING…';
    }

    // Simulated network delay — replace with:
    // fetch('/api/contact', { method: 'POST', body: JSON.stringify(payload) })
    setTimeout(() => {
      console.info('[Portfolio] Form submission payload (sanitised):', payload);
      showFormSuccess(form);
    }, 1200);
  });
}

/** Show success state and reset form. */
function showFormSuccess(form) {
  const success = document.getElementById('form-success');
  const submitBtn = document.getElementById('form-submit');

  if (success)   { success.hidden = false; }
  if (submitBtn) { submitBtn.hidden = true; }

  form.reset();

  // Re-enable after a delay so the user can see the success message
  setTimeout(() => {
    if (submitBtn) {
      submitBtn.disabled  = false;
      submitBtn.textContent = 'SEND MESSAGE →';
      submitBtn.hidden    = false;
    }
    if (success) success.hidden = true;
  }, 6000);
}

/* ──────────────────────────────────────────────────────────────
   MAIN INIT — runs after DOM is fully parsed (script is deferred)
   ────────────────────────────────────────────────────────────── */
function init() {
  // 1. Load / initialise analytics state from localStorage
  const state = loadAnalytics();

  // 2. Build project → category map from current DOM
  const pMap = buildProjectCategoryMap();

  // 3. Compute engagement scores from accumulated state
  const scores    = computeEngagementScores(state, pMap);
  const topCat    = getTopCategory(scores);

  // 4. Personalise projects grid — runs synchronously before first paint
  //    (deferred script fires after HTML parse, before first rAF cycle)
  personaliseProjectsGrid(topCat);

  // 5. IntersectionObserver — section reveals + dwell tracking
  initSectionObserver(state);

  // 6. Click tracking — delegated listener
  initClickTracking(state, pMap);

  // 7. Header clock
  initHeaderClock();

  // 8. Mobile nav
  initMobileNav();

  // 9. Contact form
  initContactForm();

  // 10. Expose debug helper in non-production environments
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__portfolioDebug = {
      getState:  () => state,
      getScores: () => computeEngagementScores(state, pMap),
      getTopCat: () => getTopCategory(computeEngagementScores(state, pMap)),
      clearData: () => {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      },
    };
    console.info(
      '%c[Portfolio Debug] window.__portfolioDebug available.',
      'color:#ff4d00; font-weight:bold'
    );
  }
}

/* ──────────────────────────────────────────────────────────────
   ENTRY POINT
   Script tag has `defer` so DOMContentLoaded has already fired
   by the time this module executes. Safe to call init() directly.
   ────────────────────────────────────────────────────────────── */
init();
