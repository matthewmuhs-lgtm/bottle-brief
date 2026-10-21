Bottle Brief - setup notes

1. Sign-in: email + password. Each of you taps "Create account" once, then taps the
   link in the confirmation email before signing in.
2. Supabase: keep "Confirm email" ON (Authentication > Sign In / Providers). It stops
   anyone from using your email address to get in.
3. Supabase > Authentication > URL Configuration: set "Site URL" to the app's web
   address (https://matthewmuhs-lgtm.github.io/bottle-brief/) so the confirmation
   link opens the app.
4. Live updates: Database > Publications > supabase_realtime has the bottles table on.
   Without it the app still refreshes every minute and when you switch back to it.
5. Both of you sign in once while online so the app is cached for offline use.
6. Once you both have accounts, turn off "Allow new users to sign up"
   (Authentication > Sign In / Providers).
