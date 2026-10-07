// Read claude.md and bump version number for pages with changes
// ═══════════════════════════════════════════════════════
// SVAADH KITCHEN — Customer Reviews
// -------------------------------------------------------
// STATIC DATA → edit SK_REVIEWS below (fallback / seed)
// LIVE DATA   → auto-fetched via Apps Script (see setup)
//
// Quick-edit guide:
//   Add a static review   → append to SK_REVIEWS.reviews[]
//   Update static rating  → change summary.rating / .total
//   Update "Review us" link → change summary.reviewUrl
//   Turn on live fetch    → set SK_LIVE.enabled = true
//                            (after completing Apps Script setup)
// ═══════════════════════════════════════════════════════

// ── Live-fetch settings ─────────────────────────────────
// Uses the same Apps Script already powering the chat widget.
// Flip enabled to true once you've added getReviews() to the
// Apps Script (see instructions at the bottom of this file).
var SK_LIVE = {
  enabled   : true,         // ← Turned ON for live server fetch
  url       : 'https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec',
  cacheKey  : 'sk-rv-v1',   // bump (e.g. sk-rv-v2) to force a cache refresh
  cacheTtlMs: 2 * 60 * 60 * 1000  // re-fetch every 2 hours
};

// ── Static fallback / seed data ─────────────────────────
// Always shown instantly on page load.
// When live fetch succeeds, fresh reviews replace/extend this list
// and the summary (rating, total) is updated automatically.
var SK_REVIEWS = {

  summary: {
    rating   : 5.0,
    total    : 84,
    // 👇 Replace with your Google Business Profile review link
    reviewUrl: 'https://g.page/r/CasEH8gGAhzLEBM/review'
  },

  // ── Review entries ────────────────────────────────────
  // Fields: name, initial, bg (avatar colour), rating (1–5), date, text
  // Colours: #DB4437  #4285F4  #0F9D58  #F4B400  (or any hex)
  reviews: [
    {
      name   : 'Sujatha Mahajan',
      initial: 'S',
      bg     : '#DB4437',
      rating : 5,
      date   : '1 month ago',
      text   : 'I tried the food from Svaadh Kitchen for 2 weeks & I must say the food is very tasty, fresh, great quality & value for money. Tripti who runs this kitchen is dedicated to providing quality meals \uD83D\uDC4C Service is gud, delivery very punctual. Home cooked food taste. Highly recommend!'
    },
    {
      name   : 'Aishwarya Saha',
      initial: 'A',
      bg     : '#4285F4',
      rating : 5,
      date   : '1 month ago',
      text   : 'The service was excellent, and the food packaging was also nice.'
    },
    {
      name   : 'Tanusha Hande',
      initial: 'T',
      bg     : '#0F9D58',
      rating : 5,
      date   : '3 months ago',
      text   : 'Their food gives feel like home food. I just love it \uD83E\uDD24'
    },
    {
      name   : 'Yash Trivedi',
      initial: 'Y',
      bg     : '#F4B400',
      rating : 5,
      date   : '3 months ago',
      text   : 'Food quality and taste are amazing just like home cooked meals. Couldn\u2019t believe it was from a cloud kitchen. Portion sizes are good too. Strongly recommend!'
    },
    {
      name   : 'Chaitanya Kardile',
      initial: 'C',
      bg     : '#DB4437',
      rating : 5,
      date   : '3 months ago',
      text   : 'Enjoyed my experience at Svaadh kitchen. A solid choice for those looking for authentic home-style meals.'
    },
    {
      name   : 'Bharat Chimane',
      initial: 'B',
      bg     : '#4285F4',
      rating : 5,
      date   : '2 months ago',
      text   : 'Good food'
    },
    {
      name   : 'Komal Shinde',
      initial: 'K',
      bg     : '#0F9D58',
      rating : 5,
      date   : '3 months ago',
      text   : 'Good'
    },
    {
      name   : 'Sachin Dekhane',
      initial: 'S',
      bg     : '#F4B400',
      rating : 5,
      date   : '4 months ago',
      text   : 'Excellent food.'
    },
    {
      name   : 'Tejas Sasane',
      initial: 'T',
      bg     : '#DB4437',
      rating : 5,
      date   : '4 months ago',
      text   : 'Tasty food'
    }
  ]
};

// ── Avatar colour palette (applied to live reviews too) ─
var _AV_COLORS = ['#DB4437', '#4285F4', '#0F9D58', '#F4B400'];

// ═══════════════════════════════════════════════════════
// LIVE FETCH — runs silently in the background
// ═══════════════════════════════════════════════════════

/**
 * Tries to load fresh reviews from the Apps Script proxy.
 * Priority: memory → localStorage cache → network fetch.
 * On any error it silently keeps the static SK_REVIEWS data.
 */
function tryFetchLiveReviews() {
  if (!SK_LIVE.enabled) return;   // not configured yet — skip quietly

  // 1. Check localStorage cache ─────────────────────────
  try {
    var raw = localStorage.getItem(SK_LIVE.cacheKey);
    if (raw) {
      var cached = JSON.parse(raw);
      if (Date.now() - cached.ts < SK_LIVE.cacheTtlMs) {
        _applyLiveData(cached.data);   // update SK_REVIEWS in-memory
        renderReviews();               // re-render with live data
        return;                        // done — no network call needed
      }
    }
  } catch (cacheErr) { /* ignore corrupt cache */ }

  // 2. Network fetch via Apps Script proxy ──────────────
  fetch(SK_LIVE.url, {
    method: 'POST',
    body  : JSON.stringify({ _action: 'getReviews' })
  })
  .then(function(resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  })
  .then(function(data) {
    // Apps Script returns { error: true } if not configured
    if (!data || data.error || !Array.isArray(data.reviews)) return;

    _applyLiveData(data);

    // Save to localStorage so next visitor skips the fetch
    try {
      localStorage.setItem(SK_LIVE.cacheKey,
        JSON.stringify({ ts: Date.now(), data: data }));
    } catch (ignore) {}

    renderReviews();   // update the UI with fresh data
  })
  .catch(function() {
    // Silently fall back to static data — no error shown to user
  });
}

/**
 * Merges live data from Apps Script into SK_REVIEWS.
 * Live reviews go first; static reviews that are NOT in the
 * live set are appended as filler (keeps the grid full).
 */
function _applyLiveData(data) {
  if (typeof data.rating === 'number') SK_REVIEWS.summary.rating    = data.rating;
  if (typeof data.total  === 'number') SK_REVIEWS.summary.total     = data.total;
  if (typeof data.reviewUrl === 'string' && data.reviewUrl)
                                       SK_REVIEWS.summary.reviewUrl = data.reviewUrl;

  if (Array.isArray(data.reviews) && data.reviews.length) {
    // Map live reviews → normalise into our card format
    var live = data.reviews.map(function(r, i) {
      return {
        name   : r.name    || 'Google Reviewer',
        initial: (r.name   || 'G').charAt(0).toUpperCase(),
        bg     : r.bg      || _AV_COLORS[i % _AV_COLORS.length],
        rating : r.rating  || 5,
        date   : r.date    || '',
        text   : r.text    || ''
      };
    });

    // Keep static reviews that are NOT already in the live set
    var liveNames  = live.map(function(r) { return r.name; });
    var staticFill = SK_REVIEWS.reviews.filter(function(r) {
      return liveNames.indexOf(r.name) === -1;
    });

    SK_REVIEWS.reviews = live.concat(staticFill);
  }
}

// ═══════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════
var _MAX_REVIEW_LEN = 150;

function renderReviews() {
  var grid           = document.getElementById('reviewsGrid');
  var countEl        = document.getElementById('reviewsTotalCount');
  var ratingEl       = document.getElementById('reviewsBigNum');
  var reviewsStarsEl = document.getElementById('reviewsSummaryStars');
  var reviewUrlEl    = document.getElementById('reviewUsBtn');

  if (!grid) return;   // not on the reviews section

  var s = SK_REVIEWS.summary;

  if (ratingEl)       ratingEl.textContent      = s.rating.toFixed(1);
  if (reviewsStarsEl) reviewsStarsEl.textContent = '\u2605'.repeat(5);
  if (countEl)        countEl.textContent        =
    s.total + ' ' + (typeof t === 'function' ? t('idx_reviews_count') : 'reviews on Google');
  if (reviewUrlEl) {
    reviewUrlEl.href        = s.reviewUrl;
    reviewUrlEl.textContent = (typeof t === 'function' ? t('idx_review_us') : 'Review us on Google');
  }

  var readMore = (typeof t === 'function' ? t('idx_read_more') : 'Read more');
  
  // Create a copy of the reviews array and shuffle it
  var shuffledReviews = SK_REVIEWS.reviews.slice();
  for (let i = shuffledReviews.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledReviews[i], shuffledReviews[j]] = [shuffledReviews[j], shuffledReviews[i]];
  }
  
  // Show up to 8 random reviews to keep the UI clean
  grid.innerHTML = shuffledReviews.slice(0, 8).map(function(r) {
    var stars    = '\u2605'.repeat(r.rating);
    var isLong   = r.text.length > _MAX_REVIEW_LEN;
    var textHtml = isLong
      ? '<span class="rv-short">'  + _esc(r.text.substring(0, _MAX_REVIEW_LEN)) + '\u2026</span>'
        + '<span class="rv-full" style="display:none">' + _esc(r.text) + '</span>'
      : _esc(r.text);

    return '<div class="review-card">'
      + '<div class="rv-header">'
        + '<div class="rv-avatar" style="background:' + r.bg + '">' + _esc(r.initial) + '</div>'
        + '<div class="rv-info">'
          + '<div class="rv-name">' + _esc(r.name)
              + '<span class="rv-verified" title="Google Reviewer">\u2713</span></div>'
          + '<div class="rv-date">' + _esc(r.date) + '</div>'
        + '</div>'
        + '<div class="rv-g-badge" title="Google Review">'
            + '<span class="rv-g-b">G</span><span class="rv-g-o">o</span>'
            + '<span class="rv-g-g">o</span><span class="rv-g-g2">g</span>'
            + '<span class="rv-g-l">l</span><span class="rv-g-e">e</span>'
        + '</div>'
      + '</div>'
      + '<div class="rv-stars">' + stars + '</div>'
      + '<div class="rv-text">'  + textHtml + '</div>'
      + (isLong
          ? '<button class="rv-more-btn" onclick="toggleReview(this)">' + readMore + '</button>'
          : '')
      + '</div>';
  }).join('');
}

function toggleReview(btn) {
  var textDiv = btn.previousElementSibling;   // .rv-text
  var shortEl = textDiv.querySelector('.rv-short');
  var fullEl  = textDiv.querySelector('.rv-full');
  if (!shortEl || !fullEl) return;

  if (fullEl.style.display === 'none') {
    shortEl.style.display = 'none';
    fullEl.style.display  = '';
    btn.textContent = (typeof t === 'function' ? t('idx_read_less') : 'Show less');
  } else {
    shortEl.style.display = '';
    fullEl.style.display  = 'none';
    btn.textContent = (typeof t === 'function' ? t('idx_read_more') : 'Read more');
  }
}

// Minimal HTML escape for review text
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ────────────────────────────────────────────────
// 1. Render static data immediately (zero network delay).
// 2. Silently try to fetch live data in background and re-render if successful.
document.addEventListener('DOMContentLoaded', function() {
  renderReviews();          // instant render with static data
  tryFetchLiveReviews();    // background live fetch (no-op if disabled)
});
