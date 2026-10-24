# Planner

Installable web app (PWA) with login and cloud sync. Frontend is static HTML/JS; backend is Supabase
(Postgres + Auth + Realtime). Hosted on Vercel.

- Shared work: tasks and focus areas are visible to every approved member.
- Private: personal tasks, goals and goal logs are visible only to the person who owns them (enforced by Postgres row-level security, not just the UI).
- The first person to sign up is the owner. Everyone else must be added to `allowed_emails` first.

## Setup (about 15 minutes)

1. **Supabase**: create a free project at supabase.com.
   - SQL Editor -> paste `supabase/schema.sql` -> Run.
   - Authentication -> Providers -> Email: keep enabled. For quick setup turn off "Confirm email"; otherwise confirmation mails are sent.
   - Authentication -> URL Configuration: set Site URL to your Vercel URL once you have it.
   - Project Settings -> API: copy the Project URL and the `anon` public key.
2. **Config**: put them into `config.js`, commit, push.
3. **Vercel**: Add New Project -> import this GitHub repo -> Framework "Other", no build command, output directory `.` -> Deploy.
4. **First login**: open the Vercel URL, tap "Create an account" with vismay@tranquebarhome.in. You become the owner.
5. **Import your existing data** (optional): Supabase SQL Editor -> paste `import/my-data.sql` -> Run. That file is git-ignored and stays on your computer.
6. **Add a teammate**: in Supabase run `insert into allowed_emails values ('name@company.com');` then ask them to create an account. (If they signed up first: `update profiles set approved = true where email = 'name@company.com';`)
7. **Phone**: open the URL, then Add to Home Screen (iPhone: Share -> Add to Home Screen).

Updates: push to GitHub and Vercel redeploys; the app picks up the new version on the next open.

## Not built yet
- Push reminders (needs a notification service; in-app reminders show while the app is open).
- Native App Store / Play Store builds.
