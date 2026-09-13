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
  if (job.status === 'matched' && job.quote_amount) return 'Price sent';
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

// After talking to the customer, the fundi sends a price. It can be changed
// until the customer accepts; after that the job can be marked complete.
function renderFundiQuoteSection(section, job, pill, card) {
  section.replaceChildren();
  pill.textContent = statusLabel(job);
  pill.className = 'status-pill shrink-0 ' + (STATUS_STYLES[job.status] || 'bg-gray-100 text-navy/60');
  const customerName = (job.counterpart && job.counterpart.full_name) || 'the customer';

  const box = document.createElement('div');
  box.className = 'mt-3 rounded-xl border border-navy/10 px-4 py-3';

  const showForm = (existing) => {
    box.innerHTML = `
      <p class="text-[13.5px] font-semibold text-navy">Send your price</p>
      <p class="mt-0.5 text-[12.5px] text-navy/55 leading-[1.5]">Call <span class="q-cust"></span> to understand the job first, then enter the price you agreed on.</p>
      <div class="mt-3 grid gap-2 sm:grid-cols-[180px_1fr]">
        <label class="block">
          <span class="sr-only">Price in shillings</span>
          <span class="flex items-center rounded-lg border border-navy/15 bg-white focus-within:border-orange">
            <span class="pl-3 text-[14px] text-navy/50">KSh</span>
            <input type="number" inputmode="numeric" min="1" step="1" class="q-amount w-full bg-transparent px-2 py-2.5 text-[15px] outline-none" placeholder="2500">
          </span>
        </label>
        <label class="block">
          <span class="sr-only">Note for the customer (optional)</span>
          <input type="text" maxlength="500" class="q-note w-full rounded-lg border border-navy/15 px-3 py-2.5 text-[14px] outline-none focus:border-orange" placeholder="What the price covers (optional)">
        </label>
      </div>
      <p class="q-error hidden mt-2 text-[13px] text-red-600" role="alert"></p>
      <div class="mt-3 flex gap-2">
        <button type="button" class="q-send btn-primary text-white font-semibold text-[13.5px] px-4 py-2 rounded-lg">Send price</button>
        ${existing ? '<button type="button" class="q-cancel btn-outline text-navy font-semibold text-[13.5px] px-4 py-2 rounded-lg border border-navy/15 hover:bg-navy/5">Cancel</button>' : ''}
      </div>
    `;
    box.querySelector('.q-cust').textContent = customerName;
    const amountInput = box.querySelector('.q-amount');
    const noteInput = box.querySelector('.q-note');
    if (existing) {
      amountInput.value = job.quote_amount;
      noteInput.value = job.quote_note || '';
      box.querySelector('.q-cancel').addEventListener('click', () => renderFundiQuoteSection(section, job, pill, card));
    }
    const errorEl = box.querySelector('.q-error');
    const sendBtn = box.querySelector('.q-send');
    sendBtn.addEventListener('click', async () => {
      errorEl.classList.add('hidden');
      const amount = Number(amountInput.value);
      if (!Number.isInteger(amount) || amount < 1) {
        errorEl.textContent = 'Enter the agreed price in whole shillings.';
        errorEl.classList.remove('hidden');
        amountInput.focus();
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        const updated = await apiFetch(`/jobs/${job.id}/quote`, {
          method: 'POST',
          body: JSON.stringify({ amount, note: noteInput.value.trim() || null }),
        });
        renderFundiQuoteSection(section, { ...updated, counterpart: job.counterpart }, pill, card);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send price';
      }
    });
  };

  if (job.status === 'matched' && !job.quote_amount) {
    showForm(false);
    section.appendChild(box);
    return;
  }

  if (job.status === 'matched' && job.quote_amount) {
    box.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[12px] font-semibold uppercase tracking-wide text-navy/50">Price sent</p>
          <p class="q-amount mt-0.5 font-display font-800 text-[1.35rem] tracking-[-0.02em] text-navy"></p>
        </div>
        <button type="button" class="q-change btn-outline shrink-0 text-navy font-semibold text-[13px] px-3 py-1.5 rounded-lg border border-navy/15 hover:bg-navy/5">Change price</button>
      </div>
      <p class="q-note mt-1 text-[13px] text-navy/65 whitespace-pre-line"></p>
      <p class="mt-1.5 text-[12.5px] text-navy/50">Waiting for <span class="q-cust"></span> to accept.</p>
    `;
    box.querySelector('.q-amount').textContent = formatKsh(job.quote_amount);
    box.querySelector('.q-cust').textContent = customerName;
    const note = box.querySelector('.q-note');
    if (job.quote_note) note.textContent = job.quote_note; else note.remove();
    box.querySelector('.q-change').addEventListener('click', () => showForm(true));
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

function openJobCard(job) {
  const div = document.createElement('div');
  div.className = 'bg-white rounded-2xl border border-navy/10 p-5';
  div.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <p class="font-display font-700 text-[15.5px] text-navy">${escapeHtml(jobTitle(job))}</p>
      ${job.urgency === 'urgent' ? URGENT_TAG : ''}
    </div>
    <p class="text-[13.5px] text-navy/55 mt-0.5">${escapeHtml(jobSummaryText(job))}</p>
    <p class="mt-2 text-[13px] text-navy/50">${escapeHtml(jobDetailsLine(job))}</p>
  `;
  renderJobMedia(div, job);
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
        <p class="text-[13.5px] text-navy/55 mt-0.5">${escapeHtml(jobSummaryText(job))}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">${job.urgency === 'urgent' ? URGENT_TAG : ''}<span class="status-pill"></span></div>
    </div>
    <p class="mt-2 text-[13px] text-navy/50">${escapeHtml(jobDetailsLine(job))}</p>
    <div class="media-section"></div>
    <div class="contact-section"></div>
    <div class="quote-section"></div>
    <div class="location-section mt-3 hidden"></div>
  `;
  renderJobMedia(div.querySelector('.media-section'), job);
  if (job.counterpart) {
    div.querySelector('.contact-section').appendChild(renderContactCard(job.counterpart, 'Customer'));
  }
  renderFundiQuoteSection(div.querySelector('.quote-section'), job, div.querySelector('.status-pill'), div);

  if (job.status === 'matched' || job.status === 'in_progress') {
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
