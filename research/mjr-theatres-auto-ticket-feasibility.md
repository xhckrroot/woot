# MJR Theatres — Auto Ticket Purchase Feasibility Research

**Date:** 2026-04-01
**Site:** https://www.mjrtheatres.com/

---

## Executive Summary

MJR Theatres uses **Vista Entertainment Solutions** (a New Zealand-based cinema software company) as their entire ticketing backend — website, mobile app, and POS. Building an auto-purchase system is **feasible** but the approach matters significantly. There are two main paths: browser automation (scraping) or direct API integration. The API route is cleaner but requires a commercial agreement with Vista.

---

## Key Technical Findings

### 1. Ticketing Backend: Vista Entertainment Solutions

**Confirmed** — MJR's mobile app package ID on Google Play is `nz.co.vista.android.movie.mjrtheatres`, which is Vista's white-label mobile app template. This means:

- All ticket sales flow through Vista's infrastructure
- The website, mobile app, and in-theatre kiosks all hit Vista APIs
- User accounts / loyalty (MJR Premier) are managed by Vista

### 2. Vista's API Ecosystem

Vista exposes several API layers:

| API | Description | Access |
|-----|-------------|--------|
| **OCAPI** (Omni-Channel API) | Primary API — movies, showtimes, seat maps, bookings, payments | B2B agreement required |
| **Connect API** | External app/website transaction API with central data aggregation | B2B agreement required |
| **REST / SOAP / ODATA** | Legacy integration endpoints | B2B agreement required |

**Key API capabilities:**
- Query showtimes, movies, seat availability
- Create bookings / reservations
- Process payments (callbacks)
- Generate digital tickets (PDF / QR codes)
- Loyalty member info and rewards

**Developer resources:**
- Vista Developer Portal: https://developer.vista.co/digital-platform/getting-started/
- Vista API Docs: https://help.vista.co/hc/en-nz/articles/28996191348889-API-documentation
- Connect API example (Maya Cinemas): https://tickets.mayacinemas.com/WSVistaWebClient/api-docs/general/introduction

**Authentication:** Vista uses **Auth0** for identity/authentication.

**Rate limiting:** Enforced on sensitive endpoints.

### 3. Website Tech Stack

- The website blocks direct curl/fetch requests (returns 403) — likely Cloudflare or similar WAF
- Built on Vista's web platform which uses **Umbraco CMS + React** components
- Key URLs discovered:
  - `/ticketing/` — main ticket purchase page
  - `/showtimes/` — showtimes listing
  - `/movies/{id}-{slug}/` — individual movie pages (e.g. `/movies/1000034661-eko/`)
  - `/theatres/{id}-{name}/` — theatre pages (e.g. `/theatres/x042y-mjr-southgate-cinema/`)
  - `/log-in/` — account login (MJR Premier)

### 4. MJR Mobile App

- **iOS:** https://apps.apple.com/us/app/mjr-theatres/id1454274187
- **Android:** `nz.co.vista.android.movie.mjrtheatres`
- Built on Vista's Ionic-based mobile framework
- Supports: ticket purchase, concession ordering, seat selection, rewards management

---

## Approach Options

### Option A: Browser Automation (Playwright/Puppeteer)

**How it works:** Automate a headless browser to navigate the MJR website, select a movie/showtime, pick seats, and complete checkout.

**Pros:**
- No API agreement needed
- Works with existing website exactly as a user would
- The `woot` repo already has Playwright infrastructure set up

**Cons:**
- Website has WAF protection (403 on direct requests) — need to handle bot detection
- Fragile — any UI change breaks the automation
- Slower than direct API calls
- Seat selection UI may use complex canvas/SVG rendering
- Payment flow likely involves 3rd-party payment processor redirect
- May violate Terms of Service

**Estimated complexity:** Medium-High

### Option B: Vista API Integration (Recommended for owners)

**How it works:** Use Vista's OCAPI or Connect API directly to query showtimes, create bookings, and process payments programmatically.

**Pros:**
- Clean, reliable, and fast
- Proper seat availability and booking guarantees
- No bot detection issues
- Supported integration path

**Cons:**
- Requires B2B API access agreement with Vista
- Likely involves commercial terms (ticketing fees, settlement, etc.)
- Development must occur in Vista's sandbox environment first
- Rate limits enforced

**Estimated complexity:** Medium (once API access is granted)

### Option C: Hybrid — Reverse-Engineer Mobile App API

**How it works:** Intercept the mobile app's API calls to understand the endpoints, then replicate them.

**Pros:**
- No formal agreement needed upfront
- APIs are typically more stable than web UI
- Mobile APIs tend to be well-structured REST endpoints

**Cons:**
- Auth0 authentication will need to be handled (token refresh, etc.)
- Vista may detect and block unauthorized API clients
- API endpoints may change without notice
- Potentially violates ToS

**Estimated complexity:** Medium-High

---

## Recommendation

Since this is **for the site owners** (MJR/Kinepolis), the clear path is:

1. **Contact Vista Entertainment** to request B2B API access (OCAPI)
2. Get sandbox credentials and develop against Vista's documented API
3. Build a service that:
   - Monitors for new movie listings matching target criteria
   - Automatically selects preferred showtime/seats when available
   - Completes the purchase via API
   - Sends confirmation to designated recipients

This is a **straightforward integration project** once API access is in hand. Vista's API is well-documented and purpose-built for this kind of automation.

If API access is slow to obtain, a **Playwright-based prototype** using the existing `woot` test infrastructure can prove the concept in the meantime.

---

## Existing Infrastructure (woot repo)

The `woot` repo already has:
- Playwright configured for browser automation
- Test scripts that navigate MJR's checkout flow
- Session handling and login automation
- Buy-button detection and sold-out status checking

This provides a solid foundation for an Option A prototype.

---

## Next Steps

1. **Reach out to Vista** for API access (recommended primary path)
2. **Prototype with Playwright** using existing woot infrastructure (quick win)
3. **Define target movies/showtimes** criteria for the auto-purchase logic
4. **Determine payment handling** — pre-authorized card, stored payment method, etc.
