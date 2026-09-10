---
name: no-vibe-coded
description: Ricky's "does not look vibe-coded" bar for Find Fundi — banned visual/copy patterns that read as generic AI output, plus the launch checklist that must be fully done before the site goes live. Use whenever writing or reviewing any frontend copy, design, or pre-launch work for this project. Companion to CLAUDE.md's Anti-Generic Guardrails and the frontend-design skill.
metadata:
  owner: Ricky Ngigi
  version: "1.0.0"
---

# Find Fundi — "Not Vibe-Coded" Bar

Ricky's top priority: this must never look like a template AI spat out. Read this before writing or reviewing any frontend copy or design, and before considering the site ready to launch.

## Banned Visual Patterns
- No purple gradients, anywhere.
- No pill-shaped buttons (fully rounded `rounded-full` buttons) — use rectangular or subtly-rounded shapes instead.
- No emoji used as icons — use a real icon set (e.g. Lucide/Heroicons) or none.
- No over-the-top scroll animations (parallax-everything, elements flying in from all directions). Motion should be subtle and purposeful, per CLAUDE.md's animation rules (`transform`/`opacity` only, no `transition-all`).
- No custom cursor animations/effects.
- No AI-slop photography — no obviously AI-generated stock-looking people/scenes. Use real photos or honest placeholders, never fake "AI slop" imagery presented as real.

## Banned Copy Patterns
- No vague hero text ("Empowering your journey to excellence" style filler). Hero copy must say a specific, concrete thing about what Find Fundi does.
- No em dashes in copy — rewrite the sentence instead.
- No AI-slop copy — no generic marketing-speak paragraphs that could apply to any startup. Every sentence should say something specific and true about Find Fundi.

## Banned Fake Content — zero tolerance
- No fake reviews or testimonials.
- No fake metrics or stats (e.g. invented "10,000+ jobs completed").
- No fake customer counters (live-looking "X people booked today" widgets with made-up numbers).
- If real reviews/metrics don't exist yet, the section is either left out entirely or clearly marked as coming soon — never faked to look established.

## Launch Checklist — do not launch until ALL of these are done
- [ ] Custom domain connected (not the default hosting subdomain).
- [ ] Favicon added.
- [ ] Any "Made with [AI tool]" badge/tag removed.
- [ ] Privacy Policy page written and linked.
- [ ] Terms and Conditions page written and linked.

## Most Important Rule
Make no mistakes. Before calling anything done: re-check copy for the banned patterns above, verify links/buttons actually work, and verify the launch checklist item-by-item rather than assuming it's handled. When unsure whether something crosses a line (a gradient that isn't quite purple, a rounded-but-not-pill button), flag it to Ricky rather than guessing.
