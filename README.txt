Bottle Brief - setup notes

1. Sign-in codes: in Supabase, go to Authentication > Emails > Magic Link and add {{ .Token }}
   to the email body so the 6-digit code appears in the email.
2. Live updates (optional): Database > Replication, turn on the bottles table for realtime.
   Without it the app still refreshes every minute and when you switch back to it.
3. Both of you sign in once while online so the app is cached for offline use.
4. Once you both have accounts, consider turning off "Allow new users to sign up"
   (Authentication > Sign In / Providers).
5. Hosting: copy the contents of this app folder to GitHub Pages (or any static host).
