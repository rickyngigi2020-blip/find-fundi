// Renders a job's photos and voice note into `container` using short-lived
// signed URLs from the private job-media bucket. Built with DOM APIs, not
// innerHTML, since paths come from the database.
async function renderJobMedia(container, job) {
  const photos = Array.isArray(job.photo_paths) ? job.photo_paths : [];
  const paths = [...photos, ...(job.voice_note_path ? [job.voice_note_path] : [])];
  if (!paths.length) return;

  const { data, error } = await sb.storage.from('job-media').createSignedUrls(paths, 60 * 30);
  if (error || !data) return;
  const urlFor = Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));

  const wrap = document.createElement('div');
  wrap.className = 'job-media mt-3 space-y-2.5';

  if (job.voice_note_path && urlFor[job.voice_note_path]) {
    const label = document.createElement('p');
    label.className = 'text-[12px] font-semibold text-navy/50 uppercase tracking-wide';
    label.textContent = 'Voice note';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = urlFor[job.voice_note_path];
    audio.className = 'w-full h-10';
    wrap.append(label, audio);
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
