# PG Rental Management System — Project Report Checklist

> Maps the 14 college report chapters to the evidence collected in **`PROJECT_ANALYSIS.md`** (referred to below as **PA**, with section numbers such as *PA §6*).
> For each chapter: what is **available**, what is **missing**, which **screenshots** are required and what **additional evidence** is needed.
> Nothing here is invented: if something is not in the repository it is listed as missing. Please also follow your college's own Table of Contents and formatting rules, which were not provided to the analysis.

## A. Quick facts you can safely quote (all verified in the repository or by running it)

| Fact | Value | Evidence |
|---|---|---|
| Project name | PG Rental Management System (UI brand "PG Manager") | `README.md:1`, `client/src/components/Layout.jsx:20` |
| Stack | React 19.3 + Vite 8.3 + Tailwind CSS 4.3 + react-router 7.18 / Node.js + Express 5.3 / SQLite via better-sqlite3 13.0 / npm workspaces | PA §5.1 |
| Users | 1 owner (configured on the server), tenants (added by the owner, then self-register) | PA §1.8 |
| Database | 9 tables, 10 indexes (2 partial-unique), 1 trigger, schema version 4 | PA §6 |
| API | 49 endpoints (7 system/auth, 8 tenant, 34 owner) | PA §13 |
| UI | 17 page components (+ not-found page): 9 owner, 5 tenant, Login, Tenant registration, Profile | PA §15.2 |
| Source size | 61 files, 6,469 lines (client 2,728 · server 1,760 · tests 1,618) at analysis time | PA §0 |
| Automated tests | 147 tests in 36 suites in 7 files — **147 passed, 0 failed**, ≈3.2 s (executed 2026-10-13, Node 24.21.0) | PA §14.2 |
| Production build | succeeds; JS 328.66 kB (98.49 kB gzip), CSS 22.91 kB (5.26 kB gzip) | PA §14.2 |
| Git history | 2 commits, both dated 2026-10-13 | PA §0 |

## B. Claims you must **not** make (not supported by the code)

* E-mail verification / OTP — it existed briefly and was **removed** (migration 4); no e-mail is sent by the application.
* Online payments, receipts/invoices, reminders or notifications, reports or export.
* Multiple PGs, multiple owners, or staff accounts (blocked by design).
* Automatic monthly rent generation, proration or late fees.
* Frontend automated tests, code-coverage figures, CI, or any performance/load numbers.
* Deployment to a live server or real users (nothing in the repository shows this).
* That the UI was user-tested or accessibility-audited.

## C. Information only you can supply (missing from the repository)

1. College Table of Contents/format, university, department, academic year, semester.
2. Team member names, roll numbers, guide/supervisor, HoD, external guide, acknowledgement text.
3. Project start/end dates and a work schedule (the repository has only two commits on one day).
4. The real-world motivation: who the PG owner/stakeholders are, any interviews, survey or field observation.
5. Literature: papers, books, existing products, with proper citations (none were collected).
6. Your hardware used for development/testing (to state hardware requirements honestly).
7. Browsers and devices you actually tested on.
8. Each member's contribution, if the college asks for it.

---

## Chapter 1 — Introduction

| | |
|---|---|
| **Available** | Title, draft abstract, problem statement, need, objectives, scope (in/out), intended users, main use cases — **PA §1**. Quick facts — section A above. |
| **Missing** | Real-world background with sources; statistics about PG/hostel management (none collected — PA §1.3 is general context only); motivation story; organisation of the report chapter; team/guide/institution details. |
| **Screenshots required** | Optional: login page and owner dashboard as a "system at a glance" figure (PA §15.3 #1, #3). |
| **Additional evidence needed** | Any statistic or claim about the PG industry needs a citation. Decide whether to describe the owner as a single administrator (true for this deployment) — be consistent with PA §1.8. |

## Chapter 2 — Literature Survey

| | |
|---|---|
| **Available** | A neutral framework only: how the problem is commonly handled and the typical risks of manual methods — **PA §2.1–2.2** (explicitly *general background, not research*). A comparison of manual/spreadsheet approach vs this application — **PA §2.5**. |
| **Missing** | **The actual literature survey.** No papers, standards, books or competing applications were studied or cited. |
| **Screenshots required** | Only if you compare with existing products: screenshots of those products with attribution. |
| **Additional evidence needed** | Search scholarly databases and app stores for hostel/PG/rental management systems; read and cite the sources you actually use; extend the comparison table with *only* features you verified in those systems. Do not reuse PA §2.1 as if it were researched. |

## Chapter 3 — Proposed System

| | |
|---|---|
| **Available** | Proposed solution and benefits tied to code — **PA §2.3–2.5**; implemented feature list — **PA §3.1** (34 features); explicitly *not* implemented features — **PA §3.2**; overall architecture overview — **PA §5.6**; user roles — **PA §8.1**. |
| **Missing** | Team's own justification and feasibility discussion (technical, operational, economic) — not in the repository. |
| **Screenshots required** | Architecture diagram image (PA §5.6); owner dashboard and tenant dashboard (PA §15.3 #3, #12). |
| **Additional evidence needed** | If the college requires feasibility study, write it from your own judgement; economic feasibility needs your cost assumptions (none exist in the repository). |

## Chapter 4 — System Requirements

| | |
|---|---|
| **Available** | Functional requirements with page/endpoint/table/validation/status — **PA §3.1**; non-functional analysis with evidence and test status — **PA §4**; software stack and versions — **PA §5.1, §17.2**. Software prerequisites from `README.md`: Node.js ≥ 22 (developed on 24, Windows), npm ≥ 10. |
| **Missing** | **Hardware requirements** (not stated anywhere); supported browsers (not stated or tested); target numbers for performance/availability (none defined); operating systems other than Windows (not evidenced). |
| **Screenshots required** | None required. Optional: `node --version` / `npm --version` terminal output. |
| **Additional evidence needed** | Record your own machine's specifications and the browsers/devices you actually used; label any "recommended" hardware as your assumption. |

## Chapter 5 — System Design

| | |
|---|---|
| **Available** | Architecture + diagram (**PA §5**); database design, data dictionary, ER diagram, constraints, migrations (**PA §6**); Level 0 and Level 1 DFD (**PA §7**); use-case diagram + PlantUML (**PA §8**); module/component and domain-model diagrams and the explanation of why a class diagram would mislead (**PA §9**); sequence diagrams for login, registration, tenant/stay management, rent and payment, move-out (**PA §10**); security design (**PA §4.1**); page inventory (**PA §15.2**). |
| **Missing** | UI wireframes/mock-ups (none in the repository); activity or flow charts (not produced — see the state tables below if you need them); the team's design-decision log; deployment diagram for a real hosting environment. |
| **Screenshots required** | Render and insert all diagrams as images (PA §15.3 #20); a database viewer screenshot showing the tables (#19). |
| **Additional evidence needed** | Choose which diagrams your college requires. Render Mermaid blocks (they were checked to render) and test the PlantUML block before use (it was not rendered). |

**State models derivable from the code** (for activity/state diagrams, if required):

| Entity | States (from `CHECK` constraints / code) | Transitions (code) |
|---|---|---|
| Tenant account | *invited* (`registered_at` NULL) → *registered* | register (`routes/auth.js:89`); *registered* → *invited* by "Reset access" (`tenants.js:122`) |
| Tenancy (stay) | `active`, `ended` | `ended` by move-out, transfer or approved move-out (`endTenancy`, `tenants.js:70`); never back to active |
| Payment (charge) | `pending`, `partial`, `paid` | derived from `amount_paid` vs `amount_due` on every record/edit (`payments.js:24`) |
| Complaint | `open`, `in_progress`, `resolved` | owner sets any value (`complaints.js:30`) |
| Move-out request | `pending`, `approved`, `rejected`, `cancelled` | tenant cancels (pending only); owner approves/rejects (pending only); ending the stay cancels pending ones |
| Room availability | vacant / partly filled / full | computed from active stays vs capacity (`properties.js:26`) |

## Chapter 6 — Methodology / Algorithm

| | |
|---|---|
| **Available** | Technical method and step-by-step algorithms with pseudocode: authentication, hashing, sessions, authorization, owner bootstrap, tenant registration, validation, capacity and floors, assignment/transfer/move-out, rent generation, payments, move-out approval, CSRF/CORS, rate limiting, business-rules table — **PA §11**. |
| **Missing** | The **development methodology** actually followed (Agile/Waterfall/iterative), requirement-gathering method, sprint or milestone plan — the repository does not record these. |
| **Screenshots required** | None (optionally, flow diagrams drawn from the pseudocode). |
| **Additional evidence needed** | Describe your real process. For the password-hashing choice, cite the scrypt specification (RFC 7914) and Node.js documentation; state that cost parameters are Node defaults (PA §4.1) and have not been independently assessed. |

## Chapter 7 — Implementation

| | |
|---|---|
| **Available** | Module-by-module description with files, functions, DB operations, error handling and verbatim/abridged snippets with line references — **PA §12**; full API reference — **PA §13**; tools and versions — **PA §5.1**; folder inventory — **PA §0**; configuration variables (names) — `server/.env.example`, **PA §12.1**. |
| **Missing** | Screenshots of the development environment; coding standards/conventions document (none; no linter); the story of how modules were developed (git history has 2 commits only). |
| **Screenshots required** | Project folder tree; terminal showing `npm run dev` start (hide secrets); Add tenant dialog and registration page (PA §15.3 #2, #7, #16). |
| **Additional evidence needed** | Choose the code listings for the appendix (suggested files in PA §17.4 F). |

## Chapter 8 — Results and Discussion

| | |
|---|---|
| **Available** | Executed test results (147/147), per-suite expected results, untested areas, observations and limitations, suggested extra tests — **PA §14**; build result (PA §14.2); page inventory — **PA §15.2**. |
| **Missing** | **Screenshots of every screen**; performance measurements; code-coverage report; user-acceptance or usability results; comparison of results against objectives with real users. |
| **Screenshots required** | Everything in **PA §15.3** (items 1–19), especially #3, #5, #6, #8, #9, #12, #13, #17. |
| **Additional evidence needed** | Optional measurements you may run yourself: coverage using Node's built-in test-coverage option (check the exact flag for your Node version in its documentation), simple page-load timing, a small user trial. Report only what you measure. |

**Draft objective-to-evidence mapping** (for the discussion; verify wording against your final report):

| Objective (PA §1.6) | Feature(s) | Automated evidence |
|---|---|---|
| 1 Separate dashboards on one backend/DB | FR-24, FR-25, FR-04 | role-separation tests (`api.test.js`, `registration.test.js`) |
| 2 One PG with floors/rooms and availability | FR-08–FR-10 | `pg-setup.test.js` (26 tests) |
| 3 Tenant and stay management | FR-11–FR-18 | `tenant-accounts.test.js`, `api.test.js`, `workflows.test.js` |
| 4 Tenant self-registration only for owner-added e-mails | FR-07 | `registration.test.js` (24 tests incl. concurrency) |
| 5 Rent charges, full/part payments, tenant balance/history | FR-19–FR-23, FR-26 | `workflows.test.js`, `api.test.js` (payments) |
| 6 Complaints, notices, move-out workflow | FR-27–FR-31 | `api.test.js`, `workflows.test.js` |
| 7 Data protection | §4.1 | `owner-config.test.js`, `cors.test.js`, hashing checks in several files |

## Chapter 9 — Applications

| | |
|---|---|
| **Available** | Realistic uses of the implemented functionality — **PA §16.1**. |
| **Missing** | Evidence of real deployment or users (none in the repository); sector-specific claims need sources. |
| **Screenshots required** | None. |
| **Additional evidence needed** | If you mention other domains (e.g. student hostels, small guest houses), phrase them as *potential* applications unless you have evidence. |

## Chapter 10 — Advantages and Limitations

| | |
|---|---|
| **Available** | Advantages tied to code/tests — **PA §16.2**; **actual** limitations (verified) and **potential** limitations (assessment) — **PA §16.3**; detailed observations incl. time-zone note, instalment history, move-out behaviour — **PA §14.5**; security trade-offs — **PA §4.1**. |
| **Missing** | Measured benefits (time saved, error reduction) — none exist; user feedback. |
| **Screenshots required** | None. |
| **Additional evidence needed** | Do not state quantitative benefits unless you measure them. |

## Chapter 11 — Future Scope

| | |
|---|---|
| **Available** | Ideas clearly labelled as not implemented — **PA §16.4**, plus the "Not found in code" list in **PA §3.2** and the suggested tests in **PA §14.6**. |
| **Missing** | Team's prioritisation or roadmap. |
| **Screenshots required** | None. |
| **Additional evidence needed** | Order items by your own judgement; keep the wording "future work", never "completed". |

## Chapter 12 — Conclusion

| | |
|---|---|
| **Available** | Verified facts to summarise: working owner and tenant workflows end to end; 49 API endpoints; 9-table schema with enforced rules; role-based security measures; 147 passing automated tests; known limitations — **PA §3, §6, §13, §14, §16**. |
| **Missing** | The team's reflections, lessons learned, challenges faced and personal contributions. |
| **Screenshots required** | None. |
| **Additional evidence needed** | Tie the conclusion back to your stated objectives (see the mapping in Chapter 8) and to the limitations. |

## Chapter 13 — References

| | |
|---|---|
| **Available** | The documentation *sources to consult* and the dependency list with versions — **PA §17.2–17.3**. Existing project documentation: `README.md`. |
| **Missing** | **The reference list itself**: titles, authors/organisations, editions/versions, dates, URLs and access dates. No papers or citations were collected and none were invented. |
| **Screenshots required** | None. |
| **Additional evidence needed** | Open each official site, locate the exact page you used, and cite it in your college's style (IEEE/APA/etc.), recording the access date. Add the literature from Chapter 2. |

## Chapter 14 — Appendix

| | |
|---|---|
| **Available** | Appendix checklist with locations — **PA §17.4**: database DDL (`server/src/schema.js`), data dictionary (PA §6.1), API table (PA §13), diagrams (PA §5–§10), selected code (PA §12 and listed files), test listing (PA §14.3), configuration reference. |
| **Missing** | Rendered diagram images; screenshots; full code listings in print format; user manual (none exists). |
| **Screenshots required** | #17 (`npm test` output), #18 (build output), #19 (schema view). |
| **Additional evidence needed** | Decide how much source code the college allows in the appendix. If a user manual is required it must be written from the running application. |

---

## D. Screenshot master list (see PA §15.3 for details)

1. Login (empty / error) · 2. Tenant registration (empty / each validation message) · 3. Owner dashboard (guidance / populated) · 4. PG Details · 5. Floors & Rooms (+ add room, duplicate error) · 6. Tenants list (Registered / Invited) · 7. Add tenant + success dialog · 8. Tenant detail + dialogs · 9. Rent & Payments + record payment · 10. Owner complaints / move-out requests / notices · 11. Owner My Account · 12. Tenant dashboard · 13. Tenant payments / complaints / move out / notices · 14. 404 page and role redirect · 15. Mobile width · 16. Server start log · 17. `npm test` output · 18. `npm run build` output · 19. Database schema view · 20. Rendered diagrams.

## E. How to reproduce the evidence safely

| Evidence | Command (run from the project root) | Notes |
|---|---|---|
| Automated tests | `npm test` | Uses in-memory databases only; does not touch `server/data/pg-rental.db` |
| Production build | `npm run build` | Writes the git-ignored `client/dist/` folder |
| Run for screenshots | `npm run dev`, then open `http://localhost:5173` | Needs `server/.env` with the owner settings (see `README.md`). Use `npm run seed` only on a **development** database; the seed adds demo data to the configured owner's PG; it does nothing if the owner already has a PG, and stops with an error if the demo e-mails already exist |
| Schema without opening your data | create an in-memory database with the project's migrations (`migrate()` from `server/src/schema.js`) and read `PRAGMA table_info(...)` | This is how the schema in PA §6 was obtained; no real data is read |

## F. Known documentation inconsistencies in the repository (fix before submission if you quote them)

* `server/test/api.test.js:198` — a test title still mentions an "emailed code" that no longer exists.
* `client/src/pages/Profile.jsx` / `client/src/components/Layout.jsx` — contain a "temporary password" path that the server can no longer trigger (PA §3.2).
* `README.md` — states the demo data and workflow correctly for the current design, but contains a small typographical gap at the end of the sentence about `neha@demo.com`; on reading I found no other mismatch with the code, but this was a reading check, not an exhaustive line-by-line audit.
