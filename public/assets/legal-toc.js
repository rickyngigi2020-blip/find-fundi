// Builds the "On this page" list for the Terms and Privacy pages from their
// section headings, and highlights the section currently being read.
(function () {
  const sections = [...document.querySelectorAll('#doc > section[id]')];
  const lists = document.querySelectorAll('.toc-list');

  lists.forEach((list) => {
    sections.forEach((section) => {
      const heading = section.querySelector('h2');
      const number = heading.querySelector('span');
      const title = [...heading.childNodes].filter((n) => n !== number).map((n) => n.textContent).join('').trim();
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${section.id}`;
      a.className = 'block border-l-2 border-transparent pl-3 py-1.5 text-navy/55';
      a.textContent = title;
      li.appendChild(a);
      list.appendChild(li);
    });
  });

  // Close the mobile list after picking a section.
  document.querySelectorAll('details.toc a').forEach((a) => {
    a.addEventListener('click', () => a.closest('details').removeAttribute('open'));
  });

  if (!('IntersectionObserver' in window)) return;
  const links = [...document.querySelectorAll('.toc-list a')];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  sections.forEach((s) => observer.observe(s));
})();
