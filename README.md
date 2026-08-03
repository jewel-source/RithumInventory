# Rithum Inventory

Internal tool for pulling inventory data out of Rithum For Brands (formerly ChannelAdvisor)
instead of relying on a manual daily inventory file: search a SKU to see its live product
image(s) and quantity/sold data, or run a full catalog export.

## Setup

1. Fill in `.env.local` with your Rithum integration credentials (Application ID, Shared
   Secret, Refresh Token — obtained via the Rithum Developer Console). If the integration has
   access to more than one profile, also set `RITHUM_PROFILE_ID`.
2. `npm install`
3. `npm run dev` and open http://localhost:3000

## Features

- **`/search`** — look up a single SKU: product title, images, on-hand/available quantity, and
  units sold over the last 7/14/30/60/90 days.
- **`/export`** — kick off a full inventory export (`POST /v1/ProductExport`), poll until it's
  ready, view the rows in a table, and download as CSV.

## Notes

- `lib/rithum.ts` is the only place that talks to the Rithum API — it handles the OAuth2
  refresh-token → access-token exchange (caching the access token in memory until it's near
  expiry) and wraps authenticated requests.
- The integration is currently authorized against the **Sandbox** account, not Production —
  fine for building/testing against the imported test catalog. Re-authorizing against
  Production is a separate step in the Rithum Developer Console when this needs to run against
  real live inventory.
