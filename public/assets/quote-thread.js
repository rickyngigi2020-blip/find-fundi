// The job thread: everything that happened to a job's price, drawn like a
// chat between the customer and the fundi booked on it. There are no typed
// messages (they talk on the phone); the bubbles are quotations, updates and
// answers, and the bar at the bottom holds the one thing each side can do next.
//
// Needs supabase-client.js (apiFetch, escapeHtml), categories.js
// (CATEGORY_LABELS) and job-media.js (formatKsh, PAYMENT_LABELS) loaded first.
//
//   QuoteThread.open(jobId, role)   fetch /jobs/:id/thread and show it
//   QuoteThread.refresh()           re-fetch if open (pages call it on changes)
//   QuoteThread.onChange = fn       pages reload their lists after an action
//   QuoteThread.preview(data, role) draw fixture data with no network (dev only)

(function () {
  const KINDS = [
    { key: 'labour', label: 'Labour' },
    { key: 'parts', label: 'Parts' },
    { key: 'transport', label: 'Transport' },
    { key: 'other', label: 'Other' },
  ];
  const UNITS = ['pcs', 'm', 'kg', 'litres', 'hrs'];

  const ICONS = {
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
    phone: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    lock: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    trash: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };

  // The wallpaper: a fundi's toolbox drawn in thin lines, the way the chat app
  // fills its background with doodles. Wrench, hammer, plug, nut, drop, house.
  const DOODLE = (() => {
    const g = (x, y, r, s, d) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})">${d}</g>`;
    const wrench = '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>';
    const hammer = '<path d="m15 12-8.4 8.4a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.9-1.9A2 2 0 0 1 19 8.2V7l-2.3-2.3a6 6 0 0 0-4.2-1.7H9l.9.8A6.2 6.2 0 0 1 12 8.4V10l2 2h1.2a2 2 0 0 1 1.4.6l1.9 1.9"/>';
    const plug = '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>';
    const nut = '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><circle cx="12" cy="12" r="3.2"/>';
    const drop = '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>';
    const house = '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>';
    const bolt = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><g fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${
      g(18, 16, -14, 1.5, wrench)}${g(120, 8, 18, 1.3, plug)}${g(186, 62, -8, 1.4, nut)}${
      g(54, 92, 22, 1.45, hammer)}${g(150, 120, -18, 1.3, drop)}${g(14, 172, 6, 1.4, house)}${
      g(100, 186, -24, 1.35, bolt)}${g(196, 178, 12, 1.2, wrench)}</g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  })();

  const CSS = `
  .qt-root { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #061A35; color: #fff; font-family: "Inter", sans-serif; -webkit-font-smoothing: antialiased; }
  .qt-root.qt-enter { animation: qtIn 320ms cubic-bezier(.22,1,.36,1); }
  @keyframes qtIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .qt-head { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top) + 8px) 10px 8px 4px; background: #041530; box-shadow: 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px -14px rgba(0,0,0,0.7); }
  .qt-icon { flex: none; width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; color: #fff; background: transparent; transition: background-color 160ms ease, transform 200ms cubic-bezier(.34,1.56,.64,1); }
  .qt-icon:hover { background: rgba(255,255,255,0.08); }
  .qt-icon:active { transform: scale(0.92); background: rgba(255,255,255,0.12); }
  .qt-root :focus-visible { outline: 2px solid #FE6902; outline-offset: 2px; }
  .qt-avatar { flex: none; width: 42px; height: 42px; border-radius: 50%; object-fit: cover; background: #FE6902; display: grid; place-items: center; font: 600 16px/1 "Poppins", sans-serif; color: #041530; }
  .qt-who { flex: 1; min-width: 0; }
  .qt-name { font: 600 17px/1.25 "Poppins", sans-serif; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qt-sub { margin-top: 1px; font-size: 12.5px; line-height: 1.3; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qt-scroll { position: relative; flex: 1; overflow-y: auto; overscroll-behavior: contain; background-color: #061A35; background-image: ${DOODLE}; background-size: 240px 240px; }
  .qt-scroll::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: 0.05; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  .qt-list { position: relative; max-width: 760px; margin: 0 auto; padding: 10px 12px 18px; display: flex; flex-direction: column; gap: 3px; }
  .qt-row { display: flex; }
  .qt-row.out { justify-content: flex-end; }
  .qt-row.gap { margin-top: 9px; }
  .qt-b { position: relative; max-width: min(84%, 460px); padding: 6px 9px 5px 10px; border-radius: 10px; font-size: 15.5px; line-height: 1.42; box-shadow: 0 1px 1px rgba(0,0,0,0.28); animation: qtBubble 260ms cubic-bezier(.22,1,.36,1) backwards; }
  @keyframes qtBubble { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .qt-b.in { background: #0D2547; }
  .qt-b.out { background: #A84500; }
  .qt-b.tail.in { border-top-left-radius: 0; }
  .qt-b.tail.out { border-top-right-radius: 0; }
  .qt-b.tail::before { content: ""; position: absolute; top: 0; width: 8px; height: 13px; background: inherit; }
  .qt-b.tail.in::before { left: -8px; clip-path: polygon(0 0, 100% 0, 100% 100%); }
  .qt-b.tail.out::before { right: -8px; clip-path: polygon(0 0, 100% 0, 0 100%); }
  .qt-text { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 12px; }
  .qt-text > span:first-child { flex: 1 1 auto; }
  .qt-time { margin-left: auto; font-size: 11.5px; line-height: 1.6; color: rgba(255,255,255,0.62); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .qt-chip { align-self: center; margin: 9px auto 6px; max-width: 86%; padding: 5px 12px; border-radius: 8px; background: rgba(13,37,71,0.94); color: rgba(255,255,255,0.8); font-size: 12.5px; line-height: 1.45; text-align: center; box-shadow: 0 1px 1px rgba(0,0,0,0.25); }
  .qt-chip.day { font-weight: 600; color: rgba(255,255,255,0.72); }
  .qt-b.quote { width: min(84vw, 440px); padding: 10px 12px 7px; }
  .qt-b.dim > * { opacity: 0.5; }
  .qt-q-label { font-size: 13px; font-weight: 600; color: #FFB27A; }
  .out .qt-q-label { color: #FFE2CC; }
  .qt-q-total { margin-top: 1px; font: 700 30px/1.12 "Poppins", sans-serif; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .qt-q-was { margin-top: 3px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 13px; color: rgba(255,255,255,0.7); }
  .qt-q-was s { color: rgba(255,255,255,0.55); }
  .qt-delta { font-weight: 700; font-size: 12px; padding: 1px 6px; border-radius: 5px; background: rgba(255,178,122,0.16); color: #FFB27A; font-variant-numeric: tabular-nums; }
  .out .qt-delta { background: rgba(4,21,48,0.35); color: #fff; }
  .qt-t { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 14.5px; line-height: 1.38; }
  .qt-t th { padding: 0 4px 7px; font-size: 13px; font-weight: 600; text-align: left; color: rgba(255,255,255,0.6); border-bottom: 1px solid rgba(255,255,255,0.16); }
  .qt-t td { padding: 9px 4px; vertical-align: top; border-bottom: 1px solid rgba(255,255,255,0.12); }
  .out .qt-t th, .out .qt-t td { border-color: rgba(255,255,255,0.2); }
  .qt-t .idx { width: 20px; padding-left: 0; color: rgba(255,255,255,0.75); font-variant-numeric: tabular-nums; }
  .qt-t .qty { width: 58px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .qt-t .amt { width: 74px; padding-right: 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .qt-unit { color: #9DB4D8; }
  .out .qt-unit { color: #FFD9BF; }
  .qt-t tfoot td { border-bottom: 0; padding-top: 11px; padding-bottom: 4px; font-weight: 700; letter-spacing: 0.01em; }
  .qt-t .sec td { padding: 11px 0 6px; font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.6); }
  .qt-t .gone td { opacity: 0.5; }
  .qt-t .gone .desc, .qt-t .gone .amt { text-decoration: line-through; }
  .qt-old { display: block; font-size: 12px; color: rgba(255,255,255,0.55); text-decoration: line-through; }
  .qt-tag { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 17px; vertical-align: 1px; white-space: nowrap; }
  .qt-tag.locked { color: #FFB27A; box-shadow: inset 0 0 0 1px rgba(255,178,122,0.4); }
  .out .qt-tag.locked { color: #FFE2CC; box-shadow: inset 0 0 0 1px rgba(255,226,204,0.5); }
  .qt-tag.new { background: #FE6902; color: #041530; }
  .out .qt-tag.new { background: #041530; color: #fff; }
  .qt-q-note { margin-top: 9px; padding-left: 9px; border-left: 2px solid #FE6902; font-size: 14px; line-height: 1.5; color: rgba(255,255,255,0.88); white-space: pre-line; }
  .out .qt-q-note { border-color: #FFE2CC; }
  .qt-q-foot { margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .qt-status { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.62); }
  .qt-status.waiting { color: #FFB27A; }
  .out .qt-status.waiting { color: #FFE2CC; }
  .qt-status.accepted { color: #fff; }
  .qt-bar { position: relative; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 12px calc(env(safe-area-inset-bottom) + 10px); background: #041530; box-shadow: 0 -1px 0 rgba(255,255,255,0.05); }
  .qt-bar-inner { width: 100%; max-width: 760px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .qt-bar-text { flex: 1 1 100%; font-size: 13.5px; line-height: 1.5; color: rgba(255,255,255,0.75); padding: 2px 2px; }
  .qt-bar-text b { color: #fff; font-weight: 600; }
  .qt-error { flex: 1 1 100%; font-size: 13px; color: #FFB4A8; }
  .qt-btn { min-height: 48px; padding: 0 16px; border-radius: 12px; font: 600 15px/1 "Inter", sans-serif; transition: transform 200ms cubic-bezier(.34,1.56,.64,1), background-color 160ms ease, filter 160ms ease; }
  .qt-btn:active { transform: scale(0.97); }
  .qt-btn:disabled { opacity: 0.55; pointer-events: none; }
  .qt-btn.primary { flex: 1 1 auto; color: #fff; background: linear-gradient(180deg, #FE8A3D 0%, #FE6902 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 10px 22px -10px rgba(254,105,2,0.7); }
  .qt-btn.primary:hover { filter: brightness(1.06); }
  .qt-btn.ghost { flex: 0 1 auto; color: #fff; background: rgba(255,255,255,0.08); }
  .qt-btn.ghost:hover { background: rgba(255,255,255,0.13); }
  .qt-btn.light { color: #041530; background: rgba(4,21,48,0.06); }
  .qt-btn.light:hover { background: rgba(4,21,48,0.1); }
  .qt-btn.danger { color: #fff; background: #B42318; }
  .qt-btn.danger:hover { background: #9A1B12; }
  .qt-empty { margin: 40px auto; max-width: 320px; text-align: center; color: rgba(255,255,255,0.75); font-size: 14.5px; line-height: 1.6; }
  .qt-sheet-back { position: absolute; inset: 0; z-index: 5; background: rgba(4,21,48,0.6); animation: qtFade 200ms ease both; }
  @keyframes qtFade { from { opacity: 0; } to { opacity: 1; } }
  .qt-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 6; max-width: 560px; max-height: 92%; margin: 0 auto; overflow-y: auto; overscroll-behavior: contain; padding: 18px 16px calc(env(safe-area-inset-bottom) + 16px); border-radius: 18px 18px 0 0; background: #fff; color: #041530; box-shadow: 0 -24px 48px -16px rgba(4,21,48,0.5), 0 -2px 6px rgba(4,21,48,0.08); animation: qtSheet 420ms cubic-bezier(.22,1.15,.36,1) both; }
  @keyframes qtSheet { from { transform: translateY(100%); } to { transform: none; } }
  .qt-sheet h2 { font: 700 19px/1.25 "Poppins", sans-serif; letter-spacing: -0.02em; }
  .qt-sheet p.hint { margin-top: 4px; font-size: 13.5px; line-height: 1.55; color: rgba(4,21,48,0.62); }
  .qt-sheet .qt-icon { color: #041530; width: 40px; height: 40px; }
  .qt-sheet .qt-icon:hover { background: rgba(4,21,48,0.06); }
  .qt-label { display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: rgba(4,21,48,0.72); }
  .qt-in { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid rgba(4,21,48,0.16); border-radius: 10px; background: #fff; color: #041530; font: 400 15px/1.35 "Inter", sans-serif; outline: none; transition: border-color 160ms ease, box-shadow 160ms ease; }
  .qt-in:focus { border-color: #FE6902; box-shadow: 0 0 0 3px rgba(254,105,2,0.16); }
  .qt-in[readonly] { background: #F4F6F9; }
  .qt-money { display: flex; align-items: center; border: 1px solid rgba(4,21,48,0.16); border-radius: 10px; background: #fff; transition: border-color 160ms ease, box-shadow 160ms ease; }
  .qt-money:focus-within { border-color: #FE6902; box-shadow: 0 0 0 3px rgba(254,105,2,0.16); }
  .qt-money span { padding-left: 11px; font-size: 13.5px; color: rgba(4,21,48,0.5); }
  .qt-money input { width: 100%; min-height: 42px; padding: 9px 11px 9px 6px; border: 0; background: transparent; font: 600 15px/1.3 "Inter", sans-serif; color: #041530; outline: none; font-variant-numeric: tabular-nums; }
  .qt-sum { margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: #041530; color: #fff; box-shadow: 0 12px 24px -14px rgba(4,21,48,0.6); }
  .qt-sum small { display: block; font-size: 12.5px; color: rgba(255,255,255,0.65); }
  .qt-sum strong { display: block; font: 700 28px/1.15 "Poppins", sans-serif; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .qt-line { margin-top: 10px; padding: 10px; border: 1px solid rgba(4,21,48,0.1); border-radius: 12px; background: #FAFBFC; display: grid; grid-template-columns: 1fr 132px; gap: 8px; }
  .qt-line .wide { grid-column: 1 / -1; }
  .qt-line .qtyrow { display: grid; grid-template-columns: 84px 1fr; gap: 8px; }
  .qt-fixed { margin-top: 10px; padding: 11px 12px; border-radius: 12px; background: #FFF1E6; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14.5px; }
  .qt-fixed b { font-weight: 600; }
  .qt-fixed em { font-style: normal; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #B34A00; }
  .qt-add { margin-top: 10px; width: 100%; min-height: 44px; border-radius: 12px; border: 1px dashed rgba(4,21,48,0.25); color: #041530; font-weight: 600; font-size: 14.5px; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background-color 160ms ease, transform 200ms cubic-bezier(.34,1.56,.64,1); }
  .qt-add:hover { background: rgba(4,21,48,0.04); }
  .qt-add:active { transform: scale(0.98); }
  .qt-pay { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
  .qt-pay label { cursor: pointer; min-height: 52px; display: grid; place-items: center; border-radius: 12px; border: 1.5px solid rgba(4,21,48,0.15); font-weight: 600; font-size: 15px; transition: border-color 160ms ease, background-color 160ms ease; }
  .qt-pay label:hover { border-color: rgba(4,21,48,0.32); }
  .qt-pay label:has(input:checked) { border-color: #FE6902; background: #FFF1E6; }
  .qt-pay label:has(input:focus-visible) { outline: 2px solid #FE6902; outline-offset: 2px; }
  .qt-sheet .qt-error { margin-top: 10px; color: #B42318; }
  .qt-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  .qt-actions .qt-btn { flex: 1 1 140px; }
  @media (prefers-reduced-motion: reduce) {
    .qt-root.qt-enter, .qt-b, .qt-sheet, .qt-sheet-back { animation: none; }
  }`;

  // ---------- small helpers ----------
  const h = (s) => escapeHtml(s);
  const amount = (n) => Number(n).toLocaleString('en-KE');
  const ksh = (n) => formatKsh(n);
  const firstName = (name, fallback) => ((name || '').trim().split(/\s+/)[0]) || fallback;
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const newId = () => Math.random().toString(36).slice(2, 10);

  function dayLabel(iso) {
    const key = dayKey(iso);
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
    if (key === today) return 'Today';
    if (key === yesterday) return 'Yesterday';
    return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
  }

  function qtyCell(line) {
    if (!line.qty) return '–';
    return `${line.qty} <span class="qt-unit">${h(line.unit || 'pcs')}</span>`;
  }

  // ---------- state ----------
  let root = null;
  let state = null; // { jobId, role, data, preview }
  let opener = null;
  let pushedHistory = false;

  function ensureStyles() {
    if (document.getElementById('qt-styles')) return;
    const style = document.createElement('style');
    style.id = 'qt-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- drawing ----------
  function names() {
    const job = state.data.job;
    const other = job.counterpart || {};
    const otherName = other.full_name || (state.role === 'customer' ? 'Your fundi' : 'The customer');
    return { other, otherName, otherFirst: firstName(other.full_name, state.role === 'customer' ? 'your fundi' : 'the customer') };
  }

  function drawHeader() {
    const job = state.data.job;
    const { other, otherName } = names();
    const photo = state.role === 'customer' ? (other.selfie_url || other.avatar_url) : other.avatar_url;
    const initials = otherName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const title = job.subcategory || CATEGORY_LABELS[job.category] || 'Job';
    const head = document.createElement('header');
    head.className = 'qt-head';
    head.innerHTML = `
      <button type="button" class="qt-icon qt-back" aria-label="Back to my jobs">${ICONS.back}</button>
      ${photo ? `<img class="qt-avatar" src="${h(photo)}" alt="">` : `<span class="qt-avatar" aria-hidden="true">${h(initials)}</span>`}
      <div class="qt-who">
        <p class="qt-name">${h(otherName)}</p>
        <p class="qt-sub">${h(title)}${job.area ? ` in ${h(job.area)}` : ''}</p>
      </div>
      ${other.phone ? `<a class="qt-icon" href="tel:${h(other.phone)}" aria-label="Call ${h(otherName)}">${ICONS.phone}</a>` : ''}
    `;
    head.querySelector('.qt-back').addEventListener('click', close);
    return head;
  }

  // What changed between the agreed quotation and an update, line by line.
  function diffLines(base, next) {
    const before = Object.fromEntries((base || []).map((l) => [l.id, l]));
    const kept = [];
    const added = [];
    next.forEach((line) => {
      const old = before[line.id];
      if (!old) { added.push({ line }); return; }
      kept.push({ line, old: old.amount !== line.amount || old.description !== line.description || old.qty !== line.qty ? old : null });
      delete before[line.id];
    });
    const removed = Object.values(before).map((line) => ({ line, removed: true }));
    return { kept: [...kept, ...removed], added };
  }

  function lineRow(n, line, { old = null, removed = false, isNew = false } = {}) {
    const tag = line.kind === 'service'
      ? `<span class="qt-tag locked">${ICONS.lock}Fixed rate</span>`
      : (isNew ? '<span class="qt-tag new">New</span>' : '');
    const oldAmount = old && old.amount !== line.amount ? `<span class="qt-old">${amount(old.amount)}</span>` : '';
    return `<tr class="${removed ? 'gone' : ''}">
      <td class="idx">${n}</td>
      <td class="desc">${h(line.description)}${tag}</td>
      <td class="qty">${qtyCell(line)}</td>
      <td class="amt">${oldAmount}${amount(line.amount)}</td>
    </tr>`;
  }

  function quotationBubble(q, agreedBefore, mine) {
    const isUpdate = q.stage === 'update';
    const { otherFirst } = names();
    let body = '';
    let n = 0;
    if (isUpdate) {
      const { kept, added } = diffLines(agreedBefore && agreedBefore.items, q.items);
      body += '<tr class="sec"><td colspan="4">Agreed quotation</td></tr>';
      kept.forEach((k) => { n += 1; body += lineRow(n, k.line, { old: k.old, removed: k.removed }); });
      if (added.length) {
        body += '<tr class="sec"><td colspan="4">Added since</td></tr>';
        added.forEach((a) => { n += 1; body += lineRow(n, a.line, { isNew: true }); });
      }
    } else {
      q.items.forEach((line) => { n += 1; body += lineRow(n, line); });
    }

    const delta = isUpdate ? q.total - q.previous_total : 0;
    const was = isUpdate ? `<p class="qt-q-was">Agreed <s>${ksh(q.previous_total)}</s><span class="qt-delta">${delta > 0 ? '+' : '−'}${ksh(Math.abs(delta))}</span></p>` : '';

    const waitingText = state.role === 'customer' ? 'Waiting for you' : `Waiting for ${h(otherFirst)}`;
    const statusText = {
      waiting: waitingText,
      accepted: `${ICONS.check}Accepted`,
      declined: isUpdate ? 'Turned down, the agreed price stands' : 'Turned down',
      replaced: 'Replaced by a newer quotation',
    }[q.status];

    const div = document.createElement('div');
    div.className = `qt-b quote ${mine ? 'out' : 'in'}${q.status === 'replaced' ? ' dim' : ''}`;
    div.innerHTML = `
      <p class="qt-q-label">${isUpdate ? 'Updated quotation' : 'Quotation'}</p>
      <p class="qt-q-total">${ksh(q.total)}</p>
      ${was}
      <table class="qt-t">
        <thead><tr><th class="idx">#</th><th>Description</th><th class="qty">Qty</th><th class="amt">Amount (KSh)</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td class="idx"></td><td colspan="2">TOTAL QUOTATION</td><td class="amt">${amount(q.total)}</td></tr></tfoot>
      </table>
      ${q.note ? `<p class="qt-q-note">${h(q.note)}</p>` : ''}
      <div class="qt-q-foot"><span class="qt-status ${q.status}">${statusText}</span><span class="qt-time">${clock(q.created_at)}</span></div>
    `;
    return div;
  }

  function textBubble(text, at, mine) {
    const div = document.createElement('div');
    div.className = `qt-b ${mine ? 'out' : 'in'}`;
    div.innerHTML = `<div class="qt-text"><span>${text}</span><span class="qt-time">${clock(at)}</span></div>`;
    return div;
  }

  function chip(text, cls = '') {
    const p = document.createElement('p');
    p.className = `qt-chip ${cls}`;
    p.innerHTML = text;
    return p;
  }

  function chipFor(e) {
    const customer = state.role === 'customer';
    const { otherFirst } = names();
    switch (e.type) {
      case 'booked': return 'You posted this job';
      case 'matched': return customer
        ? `${h(otherFirst)} took your job and will call you, then send a quotation`
        : `You took this job. Call ${h(otherFirst)} to understand it, then send your quotation`;
      case 'earlier_fundi': return e.declined_by_customer
        ? `You turned down an earlier quotation${e.total ? ` of ${ksh(e.total)}` : ''}`
        : 'An earlier fundi could not take this job';
      case 'materials': {
        const who = customer ? h(otherFirst) : 'You';
        const back = e.expected_back ? `. Back about ${clock(e.expected_back)}` : '';
        return `${who} went for materials${e.note ? `: ${h(e.note)}` : ''}${back}`;
      }
      case 'completed': return 'Job marked complete';
      case 'cancelled': {
        if (e.by === 'admin') return 'Find Fundi cancelled this job';
        return customer ? 'You cancelled this job' : `${h(otherFirst)} cancelled this job`;
      }
      default: return null;
    }
  }

  function drawList(list) {
    const events = state.data.events;
    const quotes = events.filter((e) => e.type === 'quotation').map((e) => e.quotation);
    let lastDay = null;
    let lastSide = null;

    events.forEach((e) => {
      const day = dayKey(e.at);
      if (day !== lastDay) {
        list.appendChild(chip(dayLabel(e.at), 'day'));
        lastDay = day;
        lastSide = null;
      }

      // Which side the bubble sits on: the fundi sends quotations, the
      // customer answers them. Your own messages sit on the right.
      let side = null;
      let bubble = null;
      if (e.type === 'quotation') {
        side = 'fundi';
        const agreedBefore = quotes.filter((q) => q.version < e.quotation.version && q.accepted_at).pop();
        bubble = quotationBubble(e.quotation, agreedBefore, state.role === 'fundi');
      } else if (e.type === 'accepted') {
        side = 'customer';
        const pay = e.payment_method ? ` Paying by ${PAYMENT_LABELS[e.payment_method] || e.payment_method}.` : '';
        bubble = textBubble(`Accepted ${ksh(e.total)}.${pay}`, e.at, state.role === 'customer');
      } else if (e.type === 'update_answer') {
        side = 'customer';
        bubble = textBubble(e.accepted
          ? `Accepted the updated quotation of ${ksh(e.total)}.`
          : `Kept the agreed price of ${ksh(e.previous_total)}.`, e.at, state.role === 'customer');
      } else {
        const text = chipFor(e);
        if (text) list.appendChild(chip(text));
        lastSide = null;
        return;
      }

      const row = document.createElement('div');
      const mine = side === state.role;
      row.className = `qt-row ${mine ? 'out' : 'in'}${side !== lastSide ? ' gap' : ''}`;
      if (side !== lastSide) bubble.classList.add('tail');
      row.appendChild(bubble);
      list.appendChild(row);
      lastSide = side;
    });
  }

  // The one thing each side can do next, or where things stand.
  function drawBar(bar) {
    const job = state.data.job;
    const customer = state.role === 'customer';
    const latest = job.latest_quotation;
    const pending = job.pending_price_change;
    const { otherFirst } = names();
    const inner = document.createElement('div');
    inner.className = 'qt-bar-inner';
    const text = (html) => `<p class="qt-bar-text">${html}</p>`;
    const btn = (cls, label, action) => `<button type="button" class="qt-btn ${cls}" data-act="${action}">${label}</button>`;
    let html = '';

    if (job.status === 'cancelled') {
      html = text('This job was cancelled.');
    } else if (job.status === 'completed') {
      html = text(`Job complete. Final price <b>${ksh(job.final_cost)}</b>.`);
    } else if (customer) {
      if (job.status === 'matched' && latest && latest.stage === 'quote' && latest.status === 'waiting') {
        html = btn('ghost', 'Find another fundi', 'decline') + btn('primary', `Accept ${ksh(latest.total)}`, 'accept');
      } else if (job.status === 'matched') {
        html = text(`Waiting for ${h(otherFirst)}'s quotation. They will call you first to understand the job.`);
      } else if (pending) {
        html = btn('ghost', 'Keep agreed price', 'keep') + btn('primary', `Accept ${ksh(pending.amount)}`, 'accept-update');
      } else {
        const pay = job.payment_method ? ` Paying by ${PAYMENT_LABELS[job.payment_method]}.` : '';
        html = text(`Agreed price <b>${ksh(job.final_cost)}</b>.${pay} If anything changes, ${h(otherFirst)} sends an updated quotation for you to accept.`);
      }
    } else if (job.status === 'matched') {
      if (latest && latest.stage === 'quote' && latest.status === 'waiting') {
        html = text(`Waiting for ${h(otherFirst)} to accept <b>${ksh(latest.total)}</b>. You can change it until they do.`)
          + btn('primary', 'Edit quotation', 'compose');
      } else {
        html = btn('primary', 'Send quotation', 'compose');
      }
    } else if (pending) {
      html = text(`Waiting for ${h(otherFirst)} to answer your updated quotation. Carry on at the agreed <b>${ksh(job.final_cost)}</b> until they do.`);
    } else {
      html = text(`Agreed price <b>${ksh(job.final_cost)}</b>.`) + btn('primary', 'Update quotation', 'compose');
    }

    inner.innerHTML = `${html}<p class="qt-error" role="alert" hidden></p>`;
    inner.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b)));
    bar.replaceChildren(inner);
  }

  function draw() {
    const keepScroll = root.querySelector('.qt-scroll');
    const atBottom = !keepScroll || keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 80;
    const previousTop = keepScroll ? keepScroll.scrollTop : 0;

    const scroll = document.createElement('div');
    scroll.className = 'qt-scroll';
    const list = document.createElement('div');
    list.className = 'qt-list';
    scroll.appendChild(list);
    drawList(list);

    const bar = document.createElement('footer');
    bar.className = 'qt-bar';
    drawBar(bar);

    const sheet = root.querySelector('.qt-sheet');
    const back = root.querySelector('.qt-sheet-back');
    root.replaceChildren(drawHeader(), scroll, bar, ...(back && sheet ? [back, sheet] : []));
    scroll.scrollTop = atBottom ? scroll.scrollHeight : previousTop;
  }

  function drawMessage(message) {
    root.replaceChildren();
    const head = document.createElement('header');
    head.className = 'qt-head';
    head.innerHTML = `<button type="button" class="qt-icon qt-back" aria-label="Back to my jobs">${ICONS.back}</button><div class="qt-who"><p class="qt-name">Quotation</p></div>`;
    head.querySelector('.qt-back').addEventListener('click', close);
    const scroll = document.createElement('div');
    scroll.className = 'qt-scroll';
    scroll.innerHTML = `<p class="qt-empty">${h(message)}</p>`;
    root.append(head, scroll);
  }

  function barError(message) {
    const el = root.querySelector('.qt-bar .qt-error');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  // ---------- sheets ----------
  function closeSheet() {
    root.querySelectorAll('.qt-sheet, .qt-sheet-back').forEach((el) => el.remove());
  }

  function openSheet(html) {
    closeSheet();
    const back = document.createElement('div');
    back.className = 'qt-sheet-back';
    back.addEventListener('click', closeSheet);
    const sheet = document.createElement('div');
    sheet.className = 'qt-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = html;
    root.append(back, sheet);
    const shut = sheet.querySelector('[data-close]');
    if (shut) shut.addEventListener('click', closeSheet);
    const first = sheet.querySelector('input, select, textarea, button:not([data-close])');
    if (first) first.focus({ preventScroll: true });
    return sheet;
  }

  function sheetHead(title, hint) {
    return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div><h2>${title}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}</div>
      <button type="button" class="qt-icon" data-close aria-label="Close">${ICONS.close}</button>
    </div>`;
  }

  function sheetError(sheet, message) {
    const el = sheet.querySelector('.qt-error');
    el.textContent = message;
    el.hidden = false;
  }

  async function busy(button, label, work) {
    const was = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await work();
    } finally {
      if (button.isConnected) { button.disabled = false; button.textContent = was; }
    }
  }

  async function afterAction() {
    closeSheet();
    try { QuoteThread.onChange(); } catch (err) { /* the page catches up on its own timer */ }
    await refresh();
  }

  // The fundi changed the quotation while the customer was looking at it.
  async function staleQuote(err, sheet) {
    if (err.code !== 'quote_changed' && !/changed the quotation/i.test(err.message)) return false;
    closeSheet();
    await refresh();
    barError(err.message);
    return true;
  }

  function payAndAccept() {
    const job = state.data.job;
    const q = job.latest_quotation;
    const { otherFirst } = names();
    const sheet = openSheet(`
      ${sheetHead(`Accept ${ksh(q.total)}`, `${h(otherFirst)} starts the job once you accept. You pay ${h(otherFirst)} directly when it is done.`)}
      <fieldset style="margin-top:14px">
        <legend class="qt-label">How will you pay?</legend>
        <div class="qt-pay">
          <label><input type="radio" name="qt-pay" value="mpesa" class="sr-only">M-Pesa</label>
          <label><input type="radio" name="qt-pay" value="cash" class="sr-only">Cash</label>
        </div>
      </fieldset>
      <p class="qt-error" role="alert" hidden></p>
      <div class="qt-actions">
        <button type="button" class="qt-btn primary" data-go>Accept ${ksh(q.total)}</button>
      </div>
    `);
    const go = sheet.querySelector('[data-go]');
    go.addEventListener('click', () => {
      const chosen = sheet.querySelector('input[name="qt-pay"]:checked');
      if (!chosen) return sheetError(sheet, 'Choose how you will pay first.');
      busy(go, 'Accepting…', async () => {
        try {
          await apiFetch(`/jobs/${job.id}/accept-quote`, { method: 'POST', body: JSON.stringify({ payment_method: chosen.value, quoted_at: job.quoted_at }) });
          await afterAction();
        } catch (err) {
          if (!(await staleQuote(err, sheet))) sheetError(sheet, err.message);
        }
      });
    });
  }

  function confirmDecline() {
    const job = state.data.job;
    const { otherFirst } = names();
    const sheet = openSheet(`
      ${sheetHead('Find another fundi?', `${h(otherFirst)} won't be offered this job again. We'll offer it to the next fundi, who will call you and send their own quotation.`)}
      <label style="display:block;margin-top:14px">
        <span class="qt-label">Why not this price? (optional)</span>
        <input type="text" maxlength="300" class="qt-in" data-note placeholder="For example: too high for the parts listed">
      </label>
      <p class="qt-error" role="alert" hidden></p>
      <div class="qt-actions">
        <button type="button" class="qt-btn light" data-close>Keep this quotation</button>
        <button type="button" class="qt-btn danger" data-go>Find another fundi</button>
      </div>
    `);
    sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
    const go = sheet.querySelector('[data-go]');
    go.addEventListener('click', () => busy(go, 'Sending…', async () => {
      try {
        await apiFetch(`/jobs/${job.id}/decline-quote`, {
          method: 'POST',
          body: JSON.stringify({ note: sheet.querySelector('[data-note]').value.trim() || null, quoted_at: job.quoted_at }),
        });
        closeSheet();
        try { QuoteThread.onChange(); } catch (err) { /* page catches up */ }
        close();
      } catch (err) {
        if (!(await staleQuote(err, sheet))) sheetError(sheet, err.message);
      }
    }));
  }

  async function answerUpdate(accept, button) {
    const job = state.data.job;
    await busy(button, accept ? 'Accepting…' : 'Saving…', async () => {
      try {
        await apiFetch(`/jobs/${job.id}/answer-price`, { method: 'POST', body: JSON.stringify({ accept }) });
        await afterAction();
      } catch (err) {
        barError(err.message);
      }
    });
  }

  // ---------- the fundi's quotation form ----------
  let menuPromise = null;
  function serviceMenu() {
    if (!menuPromise) menuPromise = apiFetch('/service-rates').catch(() => { menuPromise = null; return []; });
    return menuPromise;
  }

  function compose() {
    if (!root || !state || !state.data || state.role !== 'fundi') return;
    const job = state.data.job;
    const quotes = state.data.events.filter((e) => e.type === 'quotation').map((e) => e.quotation);
    const isUpdate = job.status === 'in_progress';
    const editing = !isUpdate && job.latest_quotation && job.latest_quotation.status === 'waiting' ? job.latest_quotation : null;
    const agreed = isUpdate ? quotes.filter((q) => q.accepted_at).pop() : null;
    const base = isUpdate ? agreed : editing;
    const { otherFirst } = names();

    // The lines the fundi can change. A listed service stays its own fixed line.
    let fixed = base ? base.items.find((l) => l.kind === 'service') || null : null;
    let serviceRateId = !isUpdate && editing ? editing.service_rate_id || null : null;
    let lines = base
      ? base.items.filter((l) => l.kind !== 'service').map((l) => ({ ...l }))
      : [];
    if (!lines.length && !fixed) lines.push({ id: newId(), kind: 'labour', description: '', qty: null, unit: 'pcs', amount: '' });

    const title = isUpdate ? 'Update quotation' : (editing ? 'Edit quotation' : 'Send quotation');
    const hint = isUpdate
      ? `${h(otherFirst)} agreed ${ksh(job.final_cost)}. Change or add lines; ${h(otherFirst)} has to accept before it counts.`
      : `List each charge on its own line, so ${h(otherFirst)} sees what they are paying for.`;

    const sheet = openSheet(`
      ${sheetHead(title, hint)}
      <div class="qt-sum"><small data-sum-label>Total</small><strong data-total>KSh 0</strong></div>
      <label class="qt-menu" style="display:none;margin-top:14px">
        <span class="qt-label">What is the job?</span>
        <select class="qt-in" data-menu></select>
      </label>
      <div data-fixed></div>
      <div data-lines></div>
      <button type="button" class="qt-add" data-add>${ICONS.plus}Add a line</button>
      <label style="display:block;margin-top:14px">
        <span class="qt-label">${isUpdate ? `What changed? ${h(otherFirst)} reads this before deciding` : `Note for ${h(otherFirst)} (optional)`}</span>
        <textarea class="qt-in" data-note rows="3" maxlength="500" style="resize:none" placeholder="${isUpdate
          ? 'For example: the pipe behind the wall is cracked and needs replacing'
          : 'For example: price includes taking away the old unit'}"></textarea>
      </label>
      <p class="qt-error" role="alert" hidden></p>
      <div class="qt-actions">
        <button type="button" class="qt-btn primary" data-go>${isUpdate ? 'Send updated quotation' : (editing ? 'Send new quotation' : 'Send quotation')}</button>
      </div>
    `);
    if (editing && editing.note && !isUpdate) sheet.querySelector('[data-note]').value = editing.note;

    const linesEl = sheet.querySelector('[data-lines]');
    const fixedEl = sheet.querySelector('[data-fixed]');
    const totalEl = sheet.querySelector('[data-total]');
    const sumLabel = sheet.querySelector('[data-sum-label]');

    const total = () => (fixed ? fixed.amount : 0) + lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const showTotal = () => {
      const t = total();
      totalEl.textContent = ksh(t);
      if (isUpdate) {
        const d = t - job.final_cost;
        sumLabel.textContent = d === 0 ? `Same as the agreed ${ksh(job.final_cost)}` : `New total, ${d > 0 ? 'up' : 'down'} ${ksh(Math.abs(d))} from the agreed ${ksh(job.final_cost)}`;
      }
    };

    const drawFixed = () => {
      fixedEl.innerHTML = fixed
        ? `<div class="qt-fixed"><span><b>${h(fixed.description)}</b><br><em>${ICONS.lock}Fixed rate</em></span><b>${ksh(fixed.amount)}</b></div>`
        : '';
    };

    const drawLines = () => {
      linesEl.replaceChildren(...lines.map((line, i) => {
        const div = document.createElement('div');
        div.className = 'qt-line';
        div.innerHTML = `
          <label><span class="sr-only">What line ${i + 1} is for</span>
            <select class="qt-in" data-f="kind">${KINDS.map((k) => `<option value="${k.key}"${k.key === line.kind ? ' selected' : ''}>${k.label}</option>`).join('')}</select></label>
          <label class="qt-money"><span>KSh</span><input type="number" inputmode="numeric" min="1" step="1" data-f="amount" placeholder="Amount" aria-label="Amount for line ${i + 1}"></label>
          <label class="wide"><span class="sr-only">Description for line ${i + 1}</span>
            <input type="text" class="qt-in" maxlength="120" data-f="description" placeholder="${line.kind === 'parts' ? 'For example: roll bolts 10 mm' : 'For example: fitting and testing'}"></label>
          <div class="qtyrow">
            <label><span class="sr-only">Quantity (optional)</span><input type="number" inputmode="numeric" min="1" step="1" class="qt-in" data-f="qty" placeholder="Qty"></label>
            <label><span class="sr-only">Unit</span><select class="qt-in" data-f="unit">${UNITS.map((u) => `<option${u === (line.unit || 'pcs') ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
          </div>
          <button type="button" class="qt-icon" style="justify-self:end;color:#041530" data-remove aria-label="Remove line ${i + 1}">${ICONS.trash}</button>
        `;
        div.querySelector('[data-f="amount"]').value = line.amount || '';
        div.querySelector('[data-f="description"]').value = line.description || '';
        div.querySelector('[data-f="qty"]').value = line.qty || '';
        div.querySelectorAll('[data-f]').forEach((input) => {
          input.addEventListener('input', () => {
            const f = input.dataset.f;
            line[f] = f === 'amount' || f === 'qty' ? (input.value === '' ? '' : Number(input.value)) : input.value;
            if (f === 'amount') showTotal();
          });
        });
        div.querySelector('[data-remove]').addEventListener('click', () => {
          lines.splice(i, 1);
          drawLines();
          showTotal();
        });
        return div;
      }));
    };

    sheet.querySelector('[data-add]').addEventListener('click', () => {
      lines.push({ id: newId(), kind: lines.length ? 'parts' : 'labour', description: '', qty: null, unit: 'pcs', amount: '' });
      drawLines();
      const last = linesEl.lastElementChild;
      if (last) last.querySelector('[data-f="description"]').focus();
    });

    // A listed service sets the first line and its price. Only for a new
    // quotation: once a price is agreed the service can't be swapped.
    if (!isUpdate) {
      serviceMenu().then((menu) => {
        if (!menu.length || !sheet.isConnected) return;
        const select = sheet.querySelector('[data-menu]');
        select.appendChild(new Option('Other job: I will list the charges', ''));
        menu.forEach((s) => select.appendChild(new Option(`${s.name}: ${formatKsh(s.price_kes)}`, s.id)));
        // A first quotation starts from the service the customer picked when
        // booking, so its fixed charge is already the first line.
        const asked = !editing && !serviceRateId && job.requested_rate_id ? menu.find((s) => s.id === job.requested_rate_id) : null;
        if (asked) {
          serviceRateId = asked.id;
          fixed = { id: 'service', kind: 'service', description: asked.name, amount: asked.price_kes };
          lines = lines.filter((l) => l.description || l.amount);
          drawFixed();
          drawLines();
          showTotal();
        }
        if (serviceRateId && menu.some((s) => s.id === serviceRateId)) select.value = serviceRateId;
        sheet.querySelector('.qt-menu').style.display = 'block';
        select.addEventListener('change', () => {
          const chosen = menu.find((s) => s.id === select.value);
          serviceRateId = chosen ? chosen.id : null;
          fixed = chosen ? { id: 'service', kind: 'service', description: chosen.name, amount: chosen.price_kes } : null;
          if (!fixed && !lines.length) lines.push({ id: newId(), kind: 'labour', description: '', qty: null, unit: 'pcs', amount: '' });
          drawFixed();
          drawLines();
          showTotal();
        });
      });
    }

    drawFixed();
    drawLines();
    showTotal();

    const go = sheet.querySelector('[data-go]');
    go.addEventListener('click', () => {
      sheet.querySelector('.qt-error').hidden = true;
      for (let i = 0; i < lines.length; i += 1) {
        const l = lines[i];
        if (!l.description || l.description.trim().length < 2) return sheetError(sheet, `Say what line ${i + 1} is for.`);
        if (!Number.isInteger(Number(l.amount)) || Number(l.amount) < 1) return sheetError(sheet, `Enter the amount for line ${i + 1} in whole shillings.`);
      }
      if (!lines.length && !fixed) return sheetError(sheet, 'Add at least one line.');
      const note = sheet.querySelector('[data-note]').value.trim();
      if (isUpdate && note.length < 10) return sheetError(sheet, `Say what changed, in a sentence, so ${otherFirst} can decide fairly.`);
      if (isUpdate && total() === job.final_cost) return sheetError(sheet, 'That comes to the same total already agreed.');

      const items = lines.map((l) => ({
        id: l.id, kind: l.kind, description: l.description.trim(), amount: Number(l.amount),
        qty: l.qty ? Number(l.qty) : null, unit: l.qty ? l.unit || 'pcs' : null,
      }));
      busy(go, 'Sending…', async () => {
        try {
          if (isUpdate) {
            await apiFetch(`/jobs/${job.id}/revise-price`, { method: 'POST', body: JSON.stringify({ items, reason: note }) });
          } else {
            await apiFetch(`/jobs/${job.id}/quote`, { method: 'POST', body: JSON.stringify({ items, service_rate_id: serviceRateId, note: note || null }) });
          }
          await afterAction();
        } catch (err) {
          sheetError(sheet, err.message);
        }
      });
    });
  }

  function act(action, button) {
    if (state.preview) return;
    if (action === 'accept') payAndAccept();
    else if (action === 'decline') confirmDecline();
    else if (action === 'accept-update') answerUpdate(true, button);
    else if (action === 'keep') answerUpdate(false, button);
    else if (action === 'compose') compose();
  }

  // ---------- open, refresh, close ----------
  function mount() {
    ensureStyles();
    if (!root) {
      root = document.createElement('div');
      root.className = 'qt-root qt-enter';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Quotation');
      root.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (root.querySelector('.qt-sheet')) closeSheet(); else close();
      });
      document.body.appendChild(root);
      document.documentElement.style.overflow = 'hidden';
    }
  }

  async function load() {
    try {
      const data = await apiFetch(`/jobs/${state.jobId}/thread`);
      if (!root || !state) return;
      // The pages refresh every few seconds. Redraw only when something
      // changed, or the bubbles would flicker and replay. The photo links are
      // signed afresh on every read, so they are left out of the comparison.
      const seen = JSON.stringify(data, (key, value) => (key === 'selfie_url' ? undefined : value));
      if (seen === state.seen) return;
      state.seen = seen;
      state.data = data;
      state.role = data.role;
      draw();
    } catch (err) {
      if (!root || !state) return;
      const gone = /not found/i.test(err.message);
      // A failed refresh leaves the thread being read where it is.
      if (state.data && !gone) return;
      state.seen = null;
      drawMessage(gone
        ? "This job isn't on your list any more. If the customer turned down a quotation, it has gone to another fundi."
        : err.message);
    }
  }

  async function open(jobId, role) {
    opener = document.activeElement;
    state = { jobId, role, data: null, preview: false };
    mount();
    drawMessage('Loading…');
    if (!pushedHistory) {
      history.pushState({ quoteThread: jobId }, '');
      pushedHistory = true;
    }
    await load();
    const back = root && root.querySelector('.qt-back');
    if (back) back.focus({ preventScroll: true });
  }

  async function refresh() {
    if (!root || !state || state.preview) return;
    if (root.querySelector('.qt-sheet')) return; // never wipe a half-filled form
    await load();
  }

  function teardown() {
    if (root) root.remove();
    root = null;
    state = null;
    document.documentElement.style.overflow = '';
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  // Closing goes back through history, so the phone's back button and the
  // arrow in the header do the same thing.
  function close() {
    if (pushedHistory) { history.back(); return; }
    teardown();
  }

  window.addEventListener('popstate', () => {
    if (!pushedHistory) return;
    pushedHistory = false;
    teardown();
  });

  // A notification link (?job=<id>&thread=1) opens the thread straight away.
  function openFromUrl(role) {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    if (!jobId || params.get('thread') !== '1') return;
    params.delete('job');
    params.delete('thread');
    const rest = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    open(jobId, role);
  }

  function preview(data, role) {
    state = { jobId: data.job.id, role, data: { ...data, role }, preview: true };
    mount();
    draw();
  }

  const QuoteThread = { open, refresh, close, openFromUrl, preview, compose: () => compose(), onChange: () => {} };
  window.QuoteThread = QuoteThread;
}());
