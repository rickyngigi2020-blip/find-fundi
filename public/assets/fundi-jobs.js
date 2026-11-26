// Job cards for the fundi side: open jobs, booked jobs with the price
// agreement, completion, and live location sharing. Needs supabase-client.js,
// map.js, categories.js and job-media.js loaded first.

// Pages set this to reload their job lists after a job changes here.
let onFundiJobsChanged = () => {};

const STATUS_STYLES = {
  matched: 'bg-orange-50 text-orange-700', in_progress: 'bg-orange-50 text-orange-700',
  completed: 'bg-green-50 text-green-700', cancelled: 'bg-red-50 text-red-600',
};
const STATUS_LABELS = { matched: 'Booked', in_progress: 'Price agreed', completed: 'Completed', cancelled: 'Cancelled' };

function statusLabel(job) {
  if (job.status === 'matched' && job.quote_amount) return 'Quotation sent';
  return STATUS_LABELS[job.status] || job.status;
}

// Every job a fundi sees is in their own category, so cards lead with the
// specific problem and fall back to the category only when there isn't one.
function jobTitle(job) {
  return job.subcategory || CATEGORY_LABELS[job.category] || job.category;
}

function postedText(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Posted just now';
  if (minutes < 60) return `Posted ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Posted ${hours} hr ago`;
  return `Posted ${new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}`;
}

function jobDetailsLine(job) {
  return [job.area, job.created_at ? postedText(job.created_at) : null].filter(Boolean).join(' · ');
}

const URGENT_TAG = '<span class="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 text-[11.5px] font-semibold text-orange-600">Urgent</span>';

// After talking to the customer, the fundi sends a quotation. Writing it, and
// changing it until the customer accepts, happens in the job thread
// (quote-thread.js); the card says where things stand and opens it.
function openThread(job, thenCompose) {
  QuoteThread.open(job.id, 'fundi').then(() => { if (thenCompose) QuoteThread.compose(); });
}

function renderFundiQuoteSection(section, job, pill, card) {
  section.replaceChildren();
  pill.textContent = statusLabel(job);
  pill.className = 'status-pill shrink-0 ' + (STATUS_STYLES[job.status] || 'bg-gray-100 text-navy/60');
  const customerName = (job.counterpart && job.counterpart.full_name) || 'the customer';

  const box = document.createElement('div');
  box.className = 'mt-3 rounded-xl border border-navy/10 px-4 py-3';

  if (job.status === 'matched' && !job.quote_amount) {
    box.innerHTML = `
      <p class="text-[13.5px] font-semibold text-navy">Send your quotation</p>
      <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">Call <span class="q-cust"></span> to understand the job first, then list each charge: the job, labour, parts, transport.</p>
      <button type="button" class="q-send btn-primary mt-3 text-white font-semibold text-[13.5px] px-4 py-2 rounded-lg">Write quotation</button>
    `;
    box.querySelector('.q-cust').textContent = customerName;
    box.querySelector('.q-send').addEventListener('click', () => openThread(job, true));
    section.appendChild(box);
    return;
  }

  if (job.status === 'matched' && job.quote_amount) {
    box.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[13px] font-semibold text-navy/55">Quotation sent</p>
          <p class="q-amount mt-0.5 font-display font-800 text-[1.35rem] tracking-[-0.02em] text-navy tabular-nums"></p>
        </div>
        <button type="button" class="q-open btn-outline shrink-0 text-navy font-semibold text-[13px] px-3 py-1.5 rounded-lg border border-navy/15 hover:bg-navy/5">Open quotation</button>
      </div>
      <p class="mt-1.5 text-[12.5px] text-navy/50">Waiting for <span class="q-cust"></span> to accept. You can change it until they do.</p>
    `;
    box.querySelector('.q-amount').textContent = formatKsh(job.quote_amount);
    box.querySelector('.q-cust').textContent = customerName;
    box.querySelector('.q-open').addEventListener('click', () => openThread(job, false));
    section.appendChild(box);
    return;
  }

  if (job.final_cost) {
    const p = document.createElement('p');
    p.className = 'text-[13.5px] text-navy/70';
    p.innerHTML = '<span class="q-label font-semibold text-navy"></span> <span class="q-amount font-semibold text-navy"></span><span class="q-pay"></span>';
    p.querySelector('.q-label').textContent = job.status === 'completed' ? 'Final price:' : 'Agreed price:';
    p.querySelector('.q-amount').textContent = formatKsh(job.final_cost);
    p.querySelector('.q-pay').textContent = job.payment_method ? ` · Customer pays by ${PAYMENT_LABELS[job.payment_method]}` : '';
    box.appendChild(p);
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn-outline -ml-2 mt-1 rounded-md px-2 py-1 text-[13px] font-semibold text-orange-700 hover:bg-navy/5';
    view.textContent = job.status === 'in_progress' ? 'View or update quotation' : 'View quotation';
    view.addEventListener('click', () => openThread(job, false));
    box.appendChild(view);
    section.appendChild(box);
  }

  if (job.status === 'in_progress') {
    const completeBtn = document.createElement('button');
    completeBtn.className = 'btn-primary mt-3 text-white font-semibold text-[13.5px] px-4 py-2 rounded-lg';
    completeBtn.textContent = 'Mark complete';
    completeBtn.addEventListener('click', async () => {
      completeBtn.disabled = true;
      completeBtn.textContent = 'Saving…';
      try {
        stopSharing(job.id);
        await apiFetch(`/jobs/${job.id}/complete`, { method: 'POST', body: JSON.stringify({}) });
        onFundiJobsChanged();
      } catch (err) {
        completeBtn.disabled = false;
        completeBtn.textContent = 'Mark complete';
        const errorEl = document.createElement('p');
        errorEl.className = 'mt-2 text-[13px] text-red-600';
        errorEl.setAttribute('role', 'alert');
        errorEl.textContent = err.message;
        section.appendChild(errorEl);
      }
    });
    section.appendChild(completeBtn);
  }
}

// The booked fundi can't do the job: after an inline confirmation it goes
// back to the open list and the customer is told to choose someone else.
// Changing an agreed price, and saying you have gone for parts. Both exist so a
// job that turns out bigger than it looked stays on the rails, instead of being
// settled by an argument on the doorstep.
function renderRevisionSection(section, job) {
  const wrap = document.createElement('div');
  wrap.className = 'mt-4 border-t border-navy/10 pt-3';

  const showError = (message) => {
    const el = wrap.querySelector('.v-error');
    el.textContent = message;
    el.classList.remove('hidden');
  };

  const render = () => {
    if (job.pending_price_change) {
      const c = job.pending_price_change;
      wrap.innerHTML = `
        <p class="text-[13.5px] font-semibold text-navy">Updated quotation sent: ${formatKsh(c.amount)}</p>
        <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">Agreed ${formatKsh(c.previous_amount)}. Waiting for the customer to accept. Carry on at the agreed price until they do.</p>
      `;
      return;
    }

    if (job.materials_since) {
      wrap.innerHTML = `
        <p class="text-[13.5px] font-semibold text-navy">Marked as getting materials</p>
        <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">${escapeHtml(job.materials_note || 'The customer knows you have gone for parts.')}</p>
        <button type="button" class="m-back btn-outline mt-2.5 rounded-lg border border-navy/15 px-3.5 py-1.5 text-[13px] font-semibold text-navy/70 hover:bg-navy/5">I am back on the job</button>
        <p class="v-error hidden mt-2 text-[13px] text-red-600" role="alert"></p>
      `;
      wrap.querySelector('.m-back').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await apiFetch(`/jobs/${job.id}/materials`, { method: 'POST', body: JSON.stringify({ done: true }) });
          onFundiJobsChanged();
        } catch (err) {
          showError(err.message);
          e.target.disabled = false;
        }
      });
      return;
    }

    wrap.innerHTML = `
      <div class="flex flex-wrap gap-2">
        <button type="button" class="v-open btn-outline rounded-lg border border-navy/15 px-3.5 py-1.5 text-[13px] font-semibold text-navy/70 hover:bg-navy/5">Update quotation</button>
        <button type="button" class="m-open btn-outline rounded-lg border border-navy/15 px-3.5 py-1.5 text-[13px] font-semibold text-navy/70 hover:bg-navy/5">I have gone for materials</button>
      </div>
      <p class="v-error hidden mt-2 text-[13px] text-red-600" role="alert"></p>
    `;
    wrap.querySelector('.v-open').addEventListener('click', () => openThread(job, true));
    wrap.querySelector('.m-open').addEventListener('click', showMaterials);
  };

  const showMaterials = () => {
    wrap.innerHTML = `
      <p class="text-[13.5px] font-semibold text-navy">Gone for materials</p>
      <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">The customer sees this instead of a job that looks abandoned.</p>
      <textarea class="m-note mt-2.5 w-full rounded-lg border border-navy/15 px-3 py-2 text-[14px] outline-none resize-none" rows="2" maxlength="300" placeholder="What you are getting, and when you expect to be back"></textarea>
      <p class="v-error hidden mt-2 text-[13px] text-red-600" role="alert"></p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button type="button" class="m-send btn-primary rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white">Tell the customer</button>
        <button type="button" class="m-cancel btn-outline rounded-lg border border-navy/15 px-4 py-2 text-[13.5px] font-semibold text-navy hover:bg-navy/5">Back</button>
      </div>
    `;
    wrap.querySelector('.m-cancel').addEventListener('click', render);
    const send = wrap.querySelector('.m-send');
    send.addEventListener('click', async () => {
      send.disabled = true;
      send.textContent = 'Sending...';
      try {
        await apiFetch(`/jobs/${job.id}/materials`, {
          method: 'POST',
          body: JSON.stringify({ note: wrap.querySelector('.m-note').value.trim() || null }),
        });
        onFundiJobsChanged();
      } catch (err) {
        showError(err.message);
        send.disabled = false;
        send.textContent = 'Tell the customer';
      }
    });
  };

  render();
  section.appendChild(wrap);
}

function renderReleaseSection(section, job) {
  const wrap = document.createElement('div');
  wrap.className = 'mt-4 border-t border-navy/10 pt-3';

  const showButton = () => {
    wrap.innerHTML = `<button type="button" class="r-open btn-outline rounded-lg border border-navy/15 px-3.5 py-1.5 text-[13px] font-semibold text-navy/70 hover:bg-navy/5">Can&rsquo;t take this job</button>`;
    wrap.querySelector('.r-open').addEventListener('click', showConfirm);
  };

  const showConfirm = () => {
    wrap.innerHTML = `
      <p class="text-[13.5px] font-semibold text-navy">Turn this job down?</p>
      <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">It goes straight to the next fundi. Tell us why so we send you better jobs.</p>
      <label class="block text-[12.5px] font-semibold text-navy/70 mt-3 mb-1" for="r-reason-${job.id}">Reason</label>
      <select id="r-reason-${job.id}" class="r-reason w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-[14px] outline-none">
        <option value="">Choose a reason</option>
        ${RELEASE_REASONS.map((r) => `<option value="${r.key}">${escapeHtml(r.label)}</option>`).join('')}
      </select>
      <textarea class="r-note hidden mt-2 w-full rounded-lg border border-navy/15 px-3 py-2 text-[14px] outline-none resize-none" rows="2" maxlength="500" placeholder="Tell us what happened"></textarea>
      <p class="r-error hidden mt-2 text-[13px] text-red-600" role="alert"></p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button type="button" class="r-yes rounded-lg bg-red-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-55">Turn it down</button>
        <button type="button" class="r-no btn-outline rounded-lg border border-navy/15 px-4 py-2 text-[13.5px] font-semibold text-navy hover:bg-navy/5">Keep job</button>
      </div>
    `;

    const reason = wrap.querySelector('.r-reason');
    const note = wrap.querySelector('.r-note');
    // "Other" is the only one that needs typing; the rest are one tap.
    reason.addEventListener('change', () => {
      note.classList.toggle('hidden', reason.value !== 'other');
      if (reason.value === 'other') note.focus();
    });

    wrap.querySelector('.r-no').addEventListener('click', showButton);
    const yes = wrap.querySelector('.r-yes');
    yes.addEventListener('click', async () => {
      const errorEl = wrap.querySelector('.r-error');
      errorEl.classList.add('hidden');
      if (!reason.value) {
        errorEl.textContent = 'Choose a reason first.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (reason.value === 'other' && !note.value.trim()) {
        errorEl.textContent = 'Tell us what happened.';
        errorEl.classList.remove('hidden');
        return;
      }
      yes.disabled = true;
      yes.textContent = 'Saving…';
      try {
        stopSharing(job.id);
        await apiFetch(`/jobs/${job.id}/release`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.value, note: note.value.trim() || null }),
        });
        onFundiJobsChanged();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        yes.disabled = false;
        yes.textContent = 'Turn it down';
      }
    });
  };

  showButton();
  section.appendChild(wrap);
}


// Mirrors src/utils/releaseReasons.js. Kept here so the picker needs no extra
// request before it can open.
const RELEASE_REASONS = [
  { key: 'too_far', label: 'The job is too far from me' },
  { key: 'already_booked', label: "I'm already booked" },
  { key: 'no_tools', label: "I don't have the right tools for this" },
  { key: 'no_parts', label: "I can't get the parts or materials" },
  { key: 'wrong_work', label: "This isn't the kind of work I do" },
  { key: 'bigger_than_described', label: 'The job is bigger than described' },
  { key: 'no_answer', label: "The customer isn't answering" },
  { key: 'no_price_agreement', label: "We couldn't agree on a price" },
  { key: 'emergency', label: 'Something came up' },
  { key: 'other', label: 'Other' },
];

// A job the matching service has put in front of this fundi. They take it or
// pass, and either way it moves on: there is no browsing a list any more.
function offerCard(offer, { onAccept, onDecline }) {
  const job = offer.job;
  const div = document.createElement('div');
  // Laid out like a ride request: what and where in big type, one large
  // Accept that empties as time runs out, Pass out of the way at the top.
  div.className = 'offer-card';
  div.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <p class="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-navy/65">
        <span class="live-dot" aria-hidden="true"></span><span>New job, <span class="o-countdown tabular-nums">${offer.seconds_left}</span>s to answer</span>
      </p>
      <button type="button" class="o-decline btn-outline rounded-full border border-navy/15 px-4 py-1.5 text-[13.5px] font-semibold text-navy">Pass</button>
    </div>
    <h2 class="mt-4 font-display font-800 text-[1.7rem] leading-[1.15] tracking-[-0.03em] text-navy">${escapeHtml(jobTitle(job))}</h2>
    <p class="mt-1 text-[14px] text-navy/60">${escapeHtml(jobDetailsLine(job))}</p>
    ${job.urgency === 'urgent' ? `<div class="mt-2.5">${URGENT_TAG}</div>` : ''}
    ${requestedServiceText(job) ? `<p class="mt-3 inline-flex rounded-lg bg-orange-50 px-2.5 py-1.5 text-[13.5px] font-semibold text-navy">${escapeHtml(requestedServiceText(job))}</p>` : ''}
    <p class="mt-3 whitespace-pre-line text-[15px] leading-[1.6] text-navy/80">${escapeHtml(jobSummaryText(job))}</p>
    <div class="o-media"></div>
    <p class="o-error hidden mt-3 text-[13px] text-red-600" role="alert"></p>
    <button type="button" class="o-accept accept-btn btn-primary mt-5 w-full rounded-2xl py-4 text-white font-display font-700 text-[18px]"><span class="o-drain" aria-hidden="true"></span><span class="o-label relative">Accept job</span></button>
    <p class="mt-2.5 text-center text-[12.5px] text-navy/50">If you don't answer, it passes to the next fundi.</p>
  `;
  renderJobMedia(div.querySelector('.o-media'), job);

  const accept = div.querySelector('.o-accept');
  const decline = div.querySelector('.o-decline');
  const errorEl = div.querySelector('.o-error');
  const setLabel = (btn, text) => { (btn.querySelector('.o-label') || btn).textContent = text; };

  const run = async (btn, label, action) => {
    errorEl.classList.add('hidden');
    accept.disabled = true;
    decline.disabled = true;
    setLabel(btn, label);
    try {
      await action();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      accept.disabled = false;
      decline.disabled = false;
      setLabel(accept, 'Accept job');
      setLabel(decline, 'Pass');
    }
  };

  accept.addEventListener('click', () => run(accept, 'Taking…', () => onAccept(job.id)));
  decline.addEventListener('click', () => run(decline, 'Passing…', () => onDecline(job.id)));
  return div;
}

// job.id -> browser geolocation watchId, so toggles can be cleanly stopped.
const activeWatchers = {};

function stopSharing(jobId) {
  if (activeWatchers[jobId] != null) {
    navigator.geolocation.clearWatch(activeWatchers[jobId]);
    delete activeWatchers[jobId];
  }
}

function myJobCard(job) {
  const div = document.createElement('div');
  div.className = 'bg-white rounded-2xl border border-navy/10 p-5';
  div.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="font-display font-700 text-[15.5px] text-navy">${escapeHtml(jobTitle(job))}</p>
        ${requestedServiceText(job) ? `<p class="mt-0.5 text-[13.5px] font-semibold text-navy/75">${escapeHtml(requestedServiceText(job))}</p>` : ''}
        <p class="whitespace-pre-line text-[13.5px] text-navy/55 mt-0.5">${escapeHtml(jobSummaryText(job))}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">${job.urgency === 'urgent' ? URGENT_TAG : ''}<span class="status-pill"></span></div>
    </div>
    <p class="mt-2 text-[13px] text-navy/50">${escapeHtml(jobDetailsLine(job))}</p>
    <div class="media-section"></div>
    <div class="contact-section"></div>
    <div class="quote-section"></div>
    <div class="revision-section"></div>
    <div class="location-section mt-3 hidden"></div>
    <div class="release-section"></div>
  `;
  renderJobMedia(div.querySelector('.media-section'), job);
  if (job.counterpart) {
    div.querySelector('.contact-section').appendChild(renderContactCard(job.counterpart, 'Customer'));
  }
  renderFundiQuoteSection(div.querySelector('.quote-section'), job, div.querySelector('.status-pill'), div);

  // Agreed work can turn out to need more than anyone could see at the start.
  if (job.status === 'in_progress') {
    renderRevisionSection(div.querySelector('.revision-section'), job);
  }

  // Turning a job down is only possible before a price is agreed. After that
  // the customer has arranged their day around it.
  if (job.status === 'matched' && !job.quote_accepted_at) {
    renderReleaseSection(div.querySelector('.release-section'), job);
  }

  // Location sharing only shows on a map, which needs a Google Maps key.
  if ((job.status === 'matched' || job.status === 'in_progress') && hasMapsKey()) {
    const locationSection = div.querySelector('.location-section');
    locationSection.classList.remove('hidden');
    const mapId = `map-${job.id}`;
    locationSection.innerHTML = `
      <button class="share-toggle btn-outline text-navy font-semibold text-[13.5px] px-4 py-2 rounded-lg border border-navy/15 hover:bg-navy/5">Share my location</button>
      <p class="share-error hidden mt-2 text-[13px] text-red-600"></p>
      <div id="${mapId}" class="map-box mt-3 hidden bg-gray-100"></div>
    `;

    const toggleBtn = locationSection.querySelector('.share-toggle');
    const shareError = locationSection.querySelector('.share-error');
    const mapBox = locationSection.querySelector(`#${mapId}`);

    toggleBtn.addEventListener('click', async () => {
      const isSharing = activeWatchers[job.id] != null;
      if (isSharing) {
        stopSharing(job.id);
        toggleBtn.textContent = 'Share my location';
        toggleBtn.classList.remove('bg-orange-50', 'text-orange-700', 'border-orange');
        return;
      }

      if (!navigator.geolocation) {
        shareError.textContent = 'Location is not available in this browser.';
        shareError.classList.remove('hidden');
        return;
      }

      const session = await getSession();
      mapBox.classList.remove('hidden');
      if (job.customer_lat != null && job.customer_lng != null) {
        await renderPinMap(mapId, [
          { key: 'customer', position: { lat: job.customer_lat, lng: job.customer_lng }, label: 'C', title: 'Customer' },
        ]);
      } else {
        mapBox.innerHTML = '<p class="p-4 text-[13px] text-navy/50">Customer didn\'t share a location for this job.</p>';
      }

      const watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            await sb.from('fundi_locations').upsert({
              fundi_id: session.user.id,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              updated_at: new Date().toISOString(),
            });
          } catch (err) {
            // Transient write failures aren't worth interrupting the toggle for.
          }
        },
        () => {
          shareError.textContent = 'Could not get your location. Check your browser permissions.';
          shareError.classList.remove('hidden');
          stopSharing(job.id);
          toggleBtn.textContent = 'Share my location';
        },
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
      activeWatchers[job.id] = watchId;
      toggleBtn.textContent = 'Sharing location…';
      toggleBtn.classList.add('bg-orange-50', 'text-orange-700', 'border-orange');
    });

  }
  return div;
}
