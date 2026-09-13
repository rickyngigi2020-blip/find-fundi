// ---------- voice note player ----------
// Voice notes play through the Web Audio API instead of a bare <audio> element.
// Browser recordings (WebM from MediaRecorder) carry no duration or seek index,
// which leaves some browsers' built-in players stuck at 0:00. Decoding the file
// ourselves always yields a real duration and dependable replay and seeking.

let _playbackContext = null;
let _activeVoicePlayer = null;

function playbackContext() {
  if (!_playbackContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    _playbackContext = new Ctx();
  }
  return _playbackContext;
}

// Decoding in an offline context needs no user gesture, so the duration can be
// shown before anyone presses play.
function decodeVoiceNote(bytes) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new Offline(1, 1, 48000).decodeAudioData(bytes);
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PLAY_ICON = '<svg class="w-4 h-4 translate-x-[1px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.3-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z"/></svg>';
const PAUSE_ICON = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';

// `source` is a Blob (fresh recording) or a URL (saved voice note).
function createVoicePlayer(source) {
  const root = document.createElement('div');
  root.className = 'voice-player flex items-center gap-3 rounded-xl border border-navy/10 bg-white py-1.5 pl-1.5 pr-3';
  root.innerHTML = `
    <button type="button" class="vp-btn w-9 h-9 shrink-0 rounded-full bg-navy text-white flex items-center justify-center hover:bg-navy-soft active:scale-95 disabled:opacity-50" aria-label="Play voice note">${PLAY_ICON}</button>
    <div class="vp-track flex-1 h-8 flex items-center cursor-pointer" role="slider" tabindex="0" aria-label="Voice note position" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
      <div class="w-full h-1.5 rounded-full bg-navy/10 overflow-hidden"><div class="vp-fill h-full w-full bg-orange origin-left" style="transform: scaleX(0)"></div></div>
    </div>
    <span class="vp-time shrink-0 tabular-nums text-[12.5px] text-navy/60">Loading…</span>
  `;
  const btn = root.querySelector('.vp-btn');
  const track = root.querySelector('.vp-track');
  const fill = root.querySelector('.vp-fill');
  const time = root.querySelector('.vp-time');

  let buffer = null;
  let loading = null;
  let node = null;
  let startedAt = 0;
  let offset = 0;
  let playing = false;
  let frame = 0;

  const duration = () => (buffer ? buffer.duration : 0);
  const position = () => (playing ? Math.min(duration(), playbackContext().currentTime - startedAt) : offset);

  function render() {
    const dur = duration();
    const pos = position();
    fill.style.transform = `scaleX(${dur ? pos / dur : 0})`;
    time.textContent = buffer ? `${formatClock(pos)} / ${formatClock(dur)}` : time.textContent;
    track.setAttribute('aria-valuemax', dur.toFixed(1));
    track.setAttribute('aria-valuenow', pos.toFixed(1));
    track.setAttribute('aria-valuetext', `${formatClock(pos)} of ${formatClock(dur)}`);
  }

  function setButton() {
    btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    btn.setAttribute('aria-label', playing ? 'Pause voice note' : 'Play voice note');
  }

  function tick() {
    render();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function load() {
    if (!loading) {
      loading = (async () => {
        const bytes = source instanceof Blob
          ? await source.arrayBuffer()
          : await (await fetch(source)).arrayBuffer();
        buffer = await decodeVoiceNote(bytes);
        render();
      })();
    }
    return loading;
  }

  // Last resort for a browser that can't decode the recording itself.
  function fallBackToNativePlayer() {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.className = 'w-full h-10';
    audio.src = source instanceof Blob ? URL.createObjectURL(source) : source;
    root.replaceWith(audio);
  }

  async function play() {
    try {
      await load();
    } catch (err) {
      fallBackToNativePlayer();
      return;
    }
    if (playing) return; // a second click landed while the file was loading
    if (_activeVoicePlayer && _activeVoicePlayer !== api) _activeVoicePlayer.pause();
    const ctx = playbackContext();
    if (ctx.state === 'suspended') await ctx.resume();
    if (offset >= duration() - 0.05) offset = 0;

    const thisNode = ctx.createBufferSource();
    thisNode.buffer = buffer;
    thisNode.connect(ctx.destination);
    thisNode.onended = () => {
      // Also fires when paused; only a natural finish should rewind.
      if (node !== thisNode || !playing) return;
      playing = false;
      offset = 0;
      node = null;
      cancelAnimationFrame(frame);
      setButton();
      render();
    };
    node = thisNode;
    thisNode.start(0, offset);
    startedAt = ctx.currentTime - offset;
    playing = true;
    _activeVoicePlayer = api;
    setButton();
    tick();
  }

  function pause() {
    if (!playing) return;
    offset = position();
    playing = false;
    const stopping = node;
    node = null;
    try { stopping.stop(); } catch (err) { /* already stopped */ }
    cancelAnimationFrame(frame);
    setButton();
    render();
  }

  function seekTo(seconds) {
    if (!buffer) return;
    const wasPlaying = playing;
    pause();
    offset = Math.max(0, Math.min(duration(), seconds));
    if (wasPlaying) play();
    else render();
  }

  btn.addEventListener('click', () => (playing ? pause() : play()));
  track.addEventListener('click', (e) => {
    const rect = track.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration());
  });
  track.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
    if (step) { e.preventDefault(); seekTo(position() + step); }
    if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
    if (e.key === 'End') { e.preventDefault(); seekTo(duration()); }
  });

  const api = { element: root, play, pause, destroy: pause };
  load().catch(() => { time.textContent = '0:00'; });
  return api;
}

// ---------- job media ----------
// Renders a job's photos and voice note into `container` using short-lived
// signed URLs from the private job-media bucket. Built with DOM APIs, not
// innerHTML, since paths come from the database.
async function renderJobMedia(container, job) {
  const photos = Array.isArray(job.photo_paths) ? job.photo_paths : [];
  const paths = [...photos, ...(job.voice_note_path ? [job.voice_note_path] : [])];
  if (!paths.length) return;

  const { data, error } = await sb.storage.from('job-media').createSignedUrls(paths, 60 * 60);
  if (error || !data) return;
  const urlFor = Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));

  const wrap = document.createElement('div');
  wrap.className = 'job-media mt-3 space-y-2.5';

  if (job.voice_note_path && urlFor[job.voice_note_path]) {
    const label = document.createElement('p');
    label.className = 'text-[12px] font-semibold text-navy/50 uppercase tracking-wide';
    label.textContent = 'Voice note';
    wrap.append(label, createVoicePlayer(urlFor[job.voice_note_path]).element);
  }

  const photoUrls = photos.map((p) => urlFor[p]).filter(Boolean);
  if (photoUrls.length) {
    const grid = document.createElement('div');
    grid.className = 'flex flex-wrap gap-2';
    photoUrls.forEach((url, i) => {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'block w-16 h-16 rounded-lg overflow-hidden border border-navy/10 hover:border-orange focus-visible:border-orange';
      link.setAttribute('aria-label', `Open photo ${i + 1} of ${photoUrls.length}`);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.className = 'w-full h-full object-cover';
      link.appendChild(img);
      grid.appendChild(link);
    });
    wrap.appendChild(grid);
  }

  container.appendChild(wrap);
}

// Text to show where a job's description would go.
function jobSummaryText(job) {
  return job.description || 'Described in a voice note';
}

function formatKsh(amount) {
  return `KSh ${Number(amount).toLocaleString('en-KE')}`;
}

const PAYMENT_LABELS = { mpesa: 'M-Pesa', card: 'Card', cash: 'Cash' };

// Contact card for the other party on a booked job (name, photo, tap-to-call).
function renderContactCard(person, roleLabel) {
  const card = document.createElement('div');
  card.className = 'contact-card mt-3 flex items-center gap-3 rounded-xl border border-navy/10 bg-gray-50 px-3 py-2.5';

  const avatar = document.createElement('div');
  avatar.className = 'w-10 h-10 shrink-0 rounded-full overflow-hidden bg-navy text-white flex items-center justify-center font-display font-700 text-[14px]';
  const parts = String(person.full_name || '').trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  if (person.avatar_url) {
    const img = document.createElement('img');
    img.src = person.avatar_url;
    img.alt = '';
    img.className = 'w-full h-full object-cover';
    img.onerror = () => { img.remove(); avatar.textContent = initials; };
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials;
  }

  const text = document.createElement('div');
  text.className = 'min-w-0 flex-1';
  const role = document.createElement('p');
  role.className = 'text-[11.5px] font-semibold uppercase tracking-wide text-navy/45';
  role.textContent = roleLabel;
  const name = document.createElement('p');
  name.className = 'text-[14.5px] font-semibold text-navy truncate';
  name.textContent = person.full_name || '';
  const phone = document.createElement('p');
  phone.className = 'text-[13px] text-navy/65 tabular-nums';
  phone.textContent = person.phone || '';
  text.append(role, name, phone);

  card.append(avatar, text);

  if (person.phone) {
    const call = document.createElement('a');
    call.href = `tel:${String(person.phone).replace(/[^\d+]/g, '')}`;
    call.className = 'call-btn shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-[13px] font-semibold text-white hover:bg-navy-soft active:scale-[0.98]';
    call.setAttribute('aria-label', `Call ${person.full_name || ''}`.trim());
    call.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 4.9 4.9l1.3-2 4 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>Call';
    card.appendChild(call);
  }
  return card;
}
