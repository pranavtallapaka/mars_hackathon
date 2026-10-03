# Landing Page & Frontend — Design Doc

Oct 3, 2026 · @Pt

## Status

Direction chosen: **C, Survey map**. Mission control is restyled to its tokens before Batch 6; the landing page itself is built in Batch 8. Product design decisions live in the main design doc; this doc covers only how the product looks and how people get into it.

| Date | Change | Note |
| --- | --- | --- |
| 2026-10-03 | Chose direction C, kept the name, picked the headline | Added text-safe grey and amber after a contrast check; mission control restyled to the tokens |
| 2026-10-03 | Scheduled frontend work | Direction, name and tokens after Batch 5 (before Batch 6); hero and sections in Batch 8 |
| 2026-10-03 | Doc started | Goals: professional, fits the product, does not look AI-generated |

## Purpose and audience

The landing page has one job: make the delay problem felt in five seconds, then get the visitor into mission control.

| Audience | When they see it | What they need |
| --- | --- | --- |
| SpaceX / xAI judges | Booth visit, judging, Devpost link | The thesis in one glance, proof it uses real space data |
| General judges (AI track, Grand Prize) | Judging | The stakes in plain language, no space background needed |
| You, on stage | Opening of the demo | A strong first frame to talk over, one click into the product |

It is not a marketing site. No pricing, no sign-up, no feature grid. One page, then the product.

## Not AI-generated

Generated pages look generic because their choices could belong to any product. Every choice here must come from the subject: Mars, rover operations, maps, signal delay.

**Never use** (the common tells, and Cursor's defaults if left unchecked):

- Purple-to-blue gradients, glowing orbs, starfields, glassmorphism cards
- Stock rocket, astronaut or planet-from-space imagery
- A grid of identical rounded cards, each with an icon and three lines of text
- One word in a headline set in a different color or italic
- Tracked-out ALL-CAPS labels above every heading
- Fade-and-slide-up animation on every section
- Sparkle or "AI" icons, emoji as icons
- "→" appended to every button
- Hype copy: revolutionize, seamless, unlock, cutting-edge, next-generation, AI-powered

**Always do:**

- Use real material: actual HiRISE imagery, actual live Earth–Mars light-time, actual numbers from a sim run
- Spend boldness in one place (the signature element); keep everything else quiet
- One deliberate motion moment, not scattered effects
- Numbering only where content is truly a sequence
- Color carries meaning, used the same way on the landing page and in mission control

**Test before shipping:** if you could swap in another product's name and the page would still work, it's too generic.

## Visual directions

**Chosen: C, Survey map.** It is built from real Mars data, matches how rover planners actually work (on maps), and is the least likely to look like any other hackathon project.

|  | A. Flight operations console | B. Engineering report | C. Survey map (recommended) |
| --- | --- | --- | --- |
| Idea | The room where rovers are driven: dense telemetry, panels, timestamps | A NASA technical memo: strict grid, plain type, figures and captions | A planetary survey map: real terrain, contour lines, route plotted in ink |
| Look | Dark slate, data-dense, small type | White page, strong grid, one signal red | Greyscale HiRISE relief, cool paper, one plotting blue |
| Strength | Instantly reads as "mission control" | Very credible, very calm | Real data is the visual; unique to this product |
| Risk | Dark UI + single bright accent + monospace labels is a common generated look | Can feel dry; red accent edges toward clichés | Imagery must be prepared (ties into Stretch S1) |

### C. Survey map: tokens

| Token | Hex | Use |
| --- | --- | --- |
| Survey paper | #EEF0EE | Page background (cool, not cream) |
| Basalt ink | #22272B | Text, rules |
| Relief grey | #8C9194 | Contours, terrain, borders (not text: 2.8:1 on paper) |
| Secondary ink | #5F6569 | Secondary text, captions, stale-data labels |
| Plot blue | #2554C7 | The plan: routes, links, primary button, signal pulse |
| Hazard amber | #D9831A | Only hazards, no-go zones and escalations, everywhere (fills and strokes) |
| Hazard text | #A35E0C | Amber used as text (the fill amber is 2.5:1 on paper) |
| Stale grey | #B5B9BB | Fills and tints for data that is "as of N minutes ago" (not text; too faint for thin marks on light terrain, so the map ghost uses a dashed secondary-ink ring) |

Type: **Barlow** for everything (derived from California highway signage; reads as wayfinding and maps), with **Barlow Condensed** for map labels and coordinates. Use tabular figures for all live numbers. Fonts are self-hosted so venue wifi cannot break them.

Layout: left-aligned, map-like. Text sits in a narrow column over or beside full-bleed terrain; captions behave like map legends, with a real scale bar and coordinates where they mean something.

## Page structure

### Signature element: the live light-time line

The one bold thing on the page. A to-scale line from Earth to Mars, with a sentence computed live from real ephemeris data:

> A command sent now reaches Jezero crater in 11 min 42 s.

The number updates every second (tabular figures, so it doesn't jitter). On load, one signal pulse travels the line on the product's own clock (1 real second = 1 sim minute), so it crosses in about as many seconds as the light-time has minutes and teaches the demo's time compression. That is the page's only automatic motion. It uses the same ephemeris code as Stretch S1, so it is real data, not decoration.

### Sections, top to bottom

1. **Hero.** Full-bleed greyscale HiRISE relief of Jezero with the planned route plotted in blue. Headline plus the live light-time sentence. One button: "Open mission control."
2. **The wait.** A single day of conventional rover operations drawn as a timeline: short bursts of driving separated by long round-trip waits. Makes the problem visible without a paragraph.
3. **How it works.** The real sequence (intent → compiled plan → safety check → uplink → robot decides locally → rare escalation), drawn as a route on the map, not as cards.
4. **Results.** Numbers from an actual side-by-side sim run: round trips, mission time, bytes downlinked. Never invented; filled in after Batch 3 works.
5. **Honest notes.** Two lines: demo time is compressed but ratios are real; scene reconstructions are AI-generated and labeled illustrative. Judges trust a project that states its limits.
6. **Footer.** Data sources (HiRISE, ephemeris), built with Grok, ElevenLabs and Cursor, MHacks 2026.

If time runs short, ship only section 1. The hero alone does the job.

## Copy voice

Write like a flight engineer briefing a smart outsider: plain, specific, calm. Numbers do the persuading.

- Sentence case everywhere; short sentences
- Specific beats impressive: "11 minutes each way" over "massive delays"
- Name things the way operators would: plan, uplink, escalation, round trip
- Buttons say exactly what happens: "Open mission control," "Run the comparison"
- Never claim to reduce latency; say round trips and time-to-outcome

| Instead of | Write |
| --- | --- |
| Revolutionizing space exploration with AI | Mars is 11 minutes away right now. Your rover shouldn't spend them waiting. |
| Seamless, AI-powered mission control | State the goal once. The rover handles the rest, and asks when it must. |
| Get started | Open mission control |

Draft headlines (pick one or rewrite):

- Mars is 11 minutes away right now. Your rover shouldn't spend them waiting.
- We can't beat the speed of light. We can stop waiting on it.
- Fewer round trips to Mars.

## Link to the product

The landing page and mission control are one design system. The landing page is the map at rest; mission control is the same map at work.

- **Same app:** the landing page is the `/` route of the existing Vite app; mission control is `/control`. One click, no reload, no sign-in.
- **Same tokens:** one CSS file of color and type tokens shared by both. No second palette for the app.
- **Colors mean the same thing everywhere:** plot blue is always the plan or signal; hazard amber is always a hazard or escalation; stale grey is always delayed data. A judge who learns this on the landing page can read mission control instantly.
- **Continuity on entry:** the hero map and route are the starting state of the mission in `/control`, so clicking in feels like zooming into the same place.
- **Mission control adds density, not new style:** panels for the two side-by-side runs, counters, decision log and escalation panel, all on the same paper, ink and type.

## Build plan and open questions

The landing page is not in the 10-hour product plan, so it stays small: about 1 hour of frontend work, placed around the product batches as below. The product is ahead of schedule (Batch 5 reached about 2.5 hours in), so Stretch S1 is likely and provides the light-time calculation.

| When | Step | Time |
| --- | --- | --- |
| After Batch 5, before Batch 6 | Pick the visual direction and product name | 5 min |
| After Batch 5, before Batch 6 | Add the shared token CSS (colors, type) and restyle existing mission control UI to use it, so Batches 6 and 7 build new UI already styled | 20 min |
| Any time, in the background | Download a HiRISE browse image of Jezero (small JPEG) for the hero | 5 min |
| Batch 8 | Hero: terrain image, headline, live light-time sentence, "Open mission control" button | 30 min |
| Batch 8, only if time remains | Remaining sections; Results uses real numbers from side-by-side runs | 20 min |

Dependencies: the live light-time line needs the ephemeris calculation from Stretch S1; if S1 is skipped, build only that calculation in Batch 8 (about 15 min with the astronomy-engine package). The hero image can be a HiRISE browse image (small JPEG) if the full terrain model isn't ready.

**Open questions**

- [x] Pick a visual direction: C, Survey map
- [x] Product name: keep "Mars Latency Mediation" for now
- [x] Headline: "We can't beat the speed of light. We can stop waiting on it." The live light-time sentence below it carries the number, so the headline never goes stale.
- [ ] Use the free .Tech domain from MLH for the link judges open?
