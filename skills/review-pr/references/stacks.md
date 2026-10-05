# Stack signals

Build the stack profile from evidence in the PR, not from the repository name. Count each
changed file's additions plus deletions toward every stack its signals name, then order the
stacks by that count. The top one or two make the persona: "a senior <stack> engineer". A
manifest counts when the diff touches it or it sits at the repository root; read it at the
head SHA.

## Signal → stack

| Signal | Stack |
|---|---|
| `package.json` dependency `next` | Next.js |
| `package.json` dependency `react`, `react-dom`, or `react-native` with `.tsx`/`.jsx` | React (React Native when `react-native`) |
| `package.json` dependency `vue` or `nuxt`; `.vue` files | Vue |
| `package.json` dependency `@angular/core` | Angular |
| `package.json` dependency `express`, `fastify`, `koa`, or `@nestjs/core` | Node.js backend (NestJS when `@nestjs/core`) |
| `.ts`, `.js`, `tsconfig.json`, with none of the above | TypeScript / JavaScript |
| `go.mod`, `.go` | Go |
| `Cargo.toml`, `.rs` | Rust |
| `pyproject.toml` or `requirements*.txt` naming `django` | Django |
| the same naming `fastapi` or `flask` | FastAPI / Flask |
| `.py` with none of the above | Python |
| `Gemfile` naming `rails`; `app/models`, `db/migrate` | Rails |
| `.rb` otherwise | Ruby |
| `pom.xml` or `build.gradle(.kts)` naming `spring-boot` | Spring |
| `.java` | Java |
| `.kt` with `AndroidManifest.xml` or `com.android.*` Gradle plugins | Android (Kotlin) |
| `.kt` otherwise | Kotlin backend |
| `.swift`, `.xcodeproj`, `Package.swift` | iOS (Swift) |
| `.tf`, `.tfvars`, `.terraform.lock.hcl` | Terraform |
| `Dockerfile`, `compose*.yml`, Kubernetes manifests (`kind:` plus `apiVersion:`), Helm charts | Containers and Kubernetes |
| `.sql`, `migrations/`, `db/migrate/`, ORM migration files | SQL and schema migrations |
| `.graphql`, `.gql`, schema SDL | GraphQL |
| `.github/workflows/*.yml`, `.circleci/config.yml`, `.gitlab-ci.yml`, `Jenkinsfile` | CI pipelines |

A file can count toward two stacks (a migration inside a Rails app counts toward Rails and
SQL). When React is in the profile, also read `skills/frontend-code-style/SKILL.md` and put
the rules that touch the changed files into the brief's checklist.

## What a senior in that stack looks at first

Paste the matching rows into the brief's checklist slot. They are where to look, not a
complete list, and they never outrank the review priorities.

| Stack | First looks |
|---|---|
| React / Next.js | effect dependencies and cleanup; state derived instead of stored; keys on lists; server and client boundary (`"use client"`, secrets reaching the client bundle); data fetching and caching mode; hydration mismatches; accessible names on interactive elements |
| React Native | re-renders in lists; native module calls on the JS thread; platform branches that only one side handles; permissions |
| Vue / Angular | reactivity lost by destructuring or mutation; subscription and watcher cleanup; change detection in hot paths |
| Node.js backend | unawaited promises and swallowed rejections; input validation at the route boundary; auth on every new route; transactions around multi-write paths; N+1 queries |
| TypeScript / JavaScript | `any` or casts that hide a modeling error; nullable paths; exhaustiveness of unions; floating promises |
| Go | ignored errors; goroutine leaks and missing `context` cancellation; data races on shared maps; `defer` in loops |
| Rust | `unwrap`/`expect` on fallible input; blocking calls in async code; lock scope across `.await`; error types that erase cause |
| Django / FastAPI / Flask | queries in loops; migrations that lock big tables; missing permission checks; sync I/O in async views; mutable default arguments |
| Rails | callbacks with side effects; N+1 without `includes`; migrations that lock or rewrite large tables; strong parameters |
| Spring / Java / Kotlin backend | transaction boundaries and propagation; lazy loading outside a session; thread safety of singletons; null handling at API edges |
| Android | lifecycle leaks (context held by long-lived objects); work on the main thread; configuration-change state; permissions |
| iOS | retain cycles in closures; main-thread UI updates; optional force-unwraps; background task expiry |
| Terraform | resources that force replacement; state moves and imports; IAM wider than the use; secrets in variables or outputs; provider pins |
| Containers and Kubernetes | image tags not pinned; root user; resource requests and limits; probes; secrets in env or layers |
| SQL and schema migrations | locking and table rewrites; backfill size and batching; rollback path; deploy order between code and schema; indexes for new queries |
| GraphQL | breaking schema changes; resolver N+1; authorization per field; nullability changes |
| CI pipelines | secrets exposed to forks; unpinned third-party actions; caches keyed wrong; steps that skip on failure |
