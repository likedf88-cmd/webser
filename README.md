# Avatarverse — Avatar Social Club

A working social platform: feed, reels, stories, DMs with realtime delivery, WebRTC calls with a
selectable ringtone, a multiplayer live map, an avatar marketplace with ASC Coins, mini-games and an
Ultra Admin control center.

## Read this first (audit report)

**The workspace was empty.** There was no existing Avatar Social Club repository, no Supabase project,
no database export and no Lovable project files in this environment — only an empty git repo. So there
was nothing to audit, preserve or migrate, and the `/admin` URL you linked is a hosted Lovable app I
have no access to. This project is a from-scratch implementation of the same product idea:
**Avatarverse**, built to keep the ASC identity (3D-avatar marketplace, coins, admin control) while
adding the social features you listed.

If your real project lives in Lovable/Supabase, this code is not connected to it and does not contain
your users. It is a complete, self-contained platform you can run, use and extend.

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | Node + Express + Socket.IO | real websockets for DMs, typing, presence, calls, world |
| Database | SQLite (`node:sqlite`, built into Node 22+) | zero-install, real SQL, transactions, indexes |
| Auth | bcrypt + httpOnly session cookies | no tokens in JS, server-side sessions revocable |
| Frontend | React 18 + Vite + custom CSS design system | no heavy UI dependency, dark + light themes |
| Calls | WebRTC peer connections, Socket.IO signalling | real media, not a mockup |
| World | Canvas 2D top-down multiplayer renderer | runs anywhere, real presence per zone |
| 3D avatars | three.js + GLTFLoader, server-side GLB inspector | real model rendering and real skeleton checks |

## Run it

```bash
npm install
npm run dev          # API :8787 + Vite :3000 (proxied)
# or
npm run build && npm start   # single server on :8787 serving dist/
```

Environment variables (all optional):

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | API port |
| `OWNER_PASS` | `ch123716` | password required to grant admin/owner |
| `PREVIEW_HOST` | – | extra hostname allowed by the Vite dev server |

The **first account you register becomes Owner / Ultra Admin**. Everyone after that is a normal user.
After that, elevated roles are granted in the Admin panel and require the owner password.

## What actually works (verified)

`node scripts/smoke.mjs` runs an end-to-end test against the running API. Current run: **105 checks,
105 passing**, covering:

- registration, duplicate rejection, bad password, cookie sessions, banned-user login block
- posts, likes, comments, reposts, follows, following-feed, explore payload
- stories: create, followers-only visibility, views, reactions
- wallet: daily 100 (+ streak bonus), duplicate-claim rejection, coin gifts, immutable ledger
- marketplace: buy, double-purchase block, equip, gift item, gift-already-owned block
- DMs: create conversation, send, read, reactions, read receipts, non-member 403
- roles: user blocked from admin API, admin grant requires owner password, owner cannot self-demote
- bans: rank hierarchy enforced (admin cannot ban owner), banned login + session invalidation, unban
- gift cards: owner-only issue, single redemption, invalid code rejection
- games: Flappy ASC payout + 15s rate limit, announcements fan-out
- avatar studio: real GLB parsing, corrupt/magic-byte rejection, external-asset rejection, unrigged
  models reported `unsupported`, Mixamo skeleton matched 100% and renamed in a normalized copy, Unity-style
  skeleton remapped, animation clips detected, ownership checks on equip/delete/read, appearance colours,
  outfits
- privacy: private account lock, follow request + accept, content removal by staff
- owner-only account deletion, logout

Frontend `vite build` passes. Interactive browser checks (real calls between two devices, camera
permissions, ringtone audio, and the three.js viewer drawing on a GPU) must be done by you — this
environment has no browser.

## Feature map

- **Feed** — For you / Following / Trending, infinite scroll, double-tap like, comments, repost, save,
  hashtags, @mentions, photo/video posts.
- **Reels** — full-screen snap-scrolling video, autoplay on visibility, like/save/share/follow.
- **Stories** — 24h expiry, followers-only or public, ring indicators, viewer list, reactions, DM replies.
- **Messages** — 1:1 and groups, realtime delivery, typing indicator, read receipts, photo/video/voice
  notes, GIFs, emoji picker, message reactions, replies, delete, unread badges.
- **Calls** — voice or video, incoming call modal with selectable ringtone, accept/decline, mute,
  camera on/off, front/back switch, PiP, call timer, group calls, relayed WebRTC signalling.
- **Avatar Studio** — upload a `.glb`/`.gltf` (20 MB limit), the server parses the real geometry,
  materials, textures, skins and animations, matches the skeleton against the ASC humanoid rig (Mixamo and
  Unity naming, plus generic aliases), writes a normalized GLB with canonical joint names while keeping the
  original upload untouched, then previews it in three.js with its own animation clips, colours, saved
  outfits and bone-attached accessories. Equip it and it renders on your profile.
- **World** — three zones, WASD/arrow movement + sprint, mobile D-pad, live player positions, world
  chat, emotes, buy an avatar and you appear as it; otherwise a coloured circle with your name on top.
- **Marketplace** — categories, search, buy with coins, gift items, equip, report listing.
- **Wallet** — balance, daily claim with countdown, coin gifting, gift card redemption, ledger, owned items.
- **Games** — Flappy ASC, server-validated payouts.
- **Admin** — stats + 14-day charts, user search, role management (owner password), ban/unban, verify,
  owner coin adjustments, owner account deletion, reports queue with notes, content removal, marketplace
  uploads (Meshy `.glb` + preview image), gift card issuance with hashed codes, announcements, audit log.

## Security model (server-side, not cosmetic)

- Roles `user < moderator < admin < owner`; every admin route checks rank on the server.
- Ban requires Administrator+ and strictly outranks the target; the last owner is protected.
- Granting admin/owner requires `OWNER_PASS`; you cannot change your own role.
- Coins are never trusted from the client: purchases and gifts run in SQL transactions with conditional
  debits, and every change writes a ledger row.
- Daily claims rely on a `PRIMARY KEY (user_id, day)` uniqueness constraint, not client clocks.
- Gift card codes are generated with `crypto.randomInt`, stored as SHA-256 hashes, shown once.
- Uploads are type/size limited (120 MB), served with `X-Content-Type-Options: nosniff`.
- Passwords are bcrypt hashed; sessions live in the DB so bans revoke access immediately.
- Rate limits on register, login, posting, comments, messages, reports, gifting and game payouts.

## Honest limitations — what is *not* implemented

These need services, keys or work I did not fake:

1. **Automatic rigging service.** The pipeline really validates models and really remaps skeletons that
   already exist, but it cannot *create* a skeleton for an unrigged mesh. Those uploads are reported
   `unsupported` with the reason and a retry button — no fake skeleton is ever assigned. Enable it by
   connecting a rigging provider (Meshy rigging API, Mixamo, Ready Player Me) to a job queue behind
   `server/avatar.js`; the upload/status/retry plumbing is already in place.
2. **3D avatar rendering is real (three.js + GLTFLoader), but the multiplayer world is still the Canvas 2D
   top-down map.** The rig mapping, normalized models and animation clips are ready for a 3D world; moving
   the world itself to instanced three.js scenes is the remaining step.
3. **Live streaming.** Not implemented — needs an RTMP/SFU provider (Livekit, Mux, Cloudflare Stream).
4. **Email verification / password reset.** Requires an email provider + tokens.
5. **GIF search.** The picker uses a small public GIF set; search needs a Giphy or Tenor API key.
6. **Calls in production** need a TURN server (e.g. Metered, Twilio) — STUN alone fails behind strict
   NATs. Group calls are mesh WebRTC, which is fine for a few people, not for large rooms.
7. **Scale.** SQLite + in-memory world state is great for a single instance and hundreds of users.
   Thousands of concurrent users need Postgres + Redis + a separate realtime gateway (e.g. Liveblocks,
   Ably, or a Socket.IO cluster with a Redis adapter), and object storage for uploads.
8. **Chat moderation investigation tools**: messages are only readable by conversation members. There is
   no staff conversation inspection, because a hidden surveillance feature is worse than none; adding it
   requires an explicit legal/consent workflow with audit logging.
9. **Account self-deletion** is intentionally routed through an Owner rather than a one-click destructive
   button.

## Layout

```
server/            index.js · db.js (schema+seed) · auth.js · realtime.js · uploads.js
                   avatar.js (GLB parser + skeleton map) · routes/
src/               App.jsx · store.jsx · api.js · styles.css · components/ (incl. Avatar3D.jsx) · pages/
scripts/smoke.mjs  end-to-end API test (fresh DB, first user becomes owner)
```

The API target for the Vite dev proxy can be overridden with `API_TARGET=http://127.0.0.1:8899`
(useful when 8787 is already busy).
