/**
 * HTML rendering for the guestbook.
 *
 * Hand-rolled template strings rather than a template engine — one less
 * dependency between you and the parts of this example that matter.
 *
 * Note {@link escapeHtml} and that every interpolation goes through it. Message
 * text comes from members, and "our users are verified humans" is emphatically
 * not a reason to skip output encoding: verified humans are entirely capable of
 * typing a `<script>` tag, and one of them will.
 */

import { countEntries, countSigners, type GuestbookEntry } from './db.js';
import type { KeslrUser } from '@keslr/auth';

/** Escape the five characters that matter in HTML text and attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

const STYLES = `
  :root { color-scheme: light dark; --fg: #1a1a17; --muted: #6b6b60; --bg: #fdfcfa;
          --card: #ffffff; --line: rgba(26,26,23,.10); --accent: #3478f6; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #ecebe6; --muted: #a3a299; --bg: #17171a; --card: #202024;
            --line: rgba(255,255,255,.10); }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 20px; background: var(--bg); color: var(--fg);
         font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -.02em; }
  .sub { color: var(--muted); margin: 0 0 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
          padding: 20px; margin-bottom: 16px; }
  .entry-head { display: flex; justify-content: space-between; gap: 12px;
                align-items: baseline; margin-bottom: 6px; }
  .who { font-weight: 600; }
  .kid { color: var(--muted); font-size: 12px; font-family: ui-monospace, monospace; }
  .when { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .msg { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
           font-weight: 600; color: var(--accent); background: rgba(52,120,246,.09);
           border: 1px solid rgba(52,120,246,.18); border-radius: 6px; padding: 2px 8px; }
  textarea { width: 100%; min-height: 90px; padding: 12px; border-radius: 10px;
             border: 1px solid var(--line); background: var(--bg); color: var(--fg);
             font: inherit; resize: vertical; }
  button, .btn { display: inline-block; margin-top: 12px; padding: 11px 22px; border: none;
                 border-radius: 8px; background: var(--accent); color: #fff; font: inherit;
                 font-weight: 500; cursor: pointer; text-decoration: none; }
  .stats { display: flex; gap: 24px; color: var(--muted); font-size: 13px; margin-bottom: 28px; }
  .empty { color: var(--muted); text-align: center; padding: 32px 0; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
  a { color: var(--accent); }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

const VERIFIED_BADGE = `<span class="badge">&#10003; Verified human</span>`;

export interface HomeViewModel {
  entries: GuestbookEntry[];
  user?: KeslrUser;
  networkIdentity?: { username: string };
}

export function renderHome(model: HomeViewModel): string {
  const { entries, user, networkIdentity } = model;

  const signBox = user
    ? user.isVerified
      ? `<div class="card">
           <div style="margin-bottom:10px">Signing as <strong>${escapeHtml(user.username ?? user.id)}</strong> ${VERIFIED_BADGE}</div>
           <form method="post" action="/sign">
             <textarea name="message" maxlength="280" required
                       placeholder="Say something."></textarea>
             <button type="submit">Sign the guestbook</button>
           </form>
           <form method="post" action="/auth/keslr/logout" style="margin-top:10px">
             <button type="submit" style="background:transparent;color:var(--muted);padding:0">Sign out</button>
           </form>
         </div>`
      : `<div class="card">
           <p><strong>Your Keslr account isn't verified yet.</strong></p>
           <p class="sub" style="margin:0">Keslr membership is granted by invitation from an existing
           verified member. Once you're verified, you can sign the book.</p>
         </div>`
    : `<div class="card">
         <p style="margin-top:0"><strong>Sign in to add your name.</strong></p>
         <p class="sub">Every entry below was written by a verified Keslr member.</p>
         <a class="btn" href="/auth/keslr/login">Sign in with Keslr</a>
       </div>`;

  const list = entries.length
    ? entries
        .map(
          (entry) => `<div class="card">
        <div class="entry-head">
          <div>
            <span class="who">${escapeHtml(entry.fullName ?? entry.username)}</span>
            ${VERIFIED_BADGE}
            <div class="kid">${escapeHtml(entry.keslrId)}</div>
          </div>
          <span class="when">${formatDate(entry.signedAt)}</span>
        </div>
        <p class="msg">${escapeHtml(entry.message)}</p>
      </div>`,
        )
        .join('\n')
    : `<div class="empty">Nobody has signed yet. Be the first.</div>`;

  const networkLine = networkIdentity
    ? `<footer>You reached this over the Keslr network as
       <strong>${escapeHtml(networkIdentity.username)}</strong>.</footer>`
    : `<footer>Built with <a href="https://github.com/keslr/keslr_connect">keslr-connect</a>.</footer>`;

  return layout(
    'Keslr Guestbook',
    `<h1>Keslr Guestbook</h1>
     <p class="sub">Every signature here belongs to a verified Keslr member.</p>
     <div class="stats">
       <span><strong>${countEntries()}</strong> entries</span>
       <span><strong>${countSigners()}</strong> members</span>
     </div>
     ${signBox}
     ${list}
     ${networkLine}`,
  );
}

export function renderError(message: string): string {
  return layout(
    'Something went wrong',
    `<h1>Hmm.</h1>
     <div class="card"><p class="msg">${escapeHtml(message)}</p></div>
     <a class="btn" href="/">Back to the guestbook</a>`,
  );
}
