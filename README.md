# KopiPal ☕

**Never kopi alone.** KopiPal helps lonely people find a *kopi kaki* (coffee buddy) for small, in-person café sessions in Singapore. The oldest problem with meetups is flaking, so **PayPal is the product's trust layer**: every guest puts a small show-up deposit on hold, and the money moves based on who actually turns up.

## How PayPal is central (not bolted on)
| Moment | PayPal API | What happens |
|---|---|---|
| Join a session | Orders v2, `intent=AUTHORIZE` + JS SDK Buttons | Deposit is held on the buyer's PayPal, not charged |
| Guest shows up and enters the host's code | Payments v2 `authorizations/{id}/void` | Hold is released, guest pays S$0 |
| Guest no-shows | Payments v2 `authorizations/{id}/capture` | Deposit is captured |
| Host was left waiting | Payouts v1 | 80% of the forfeited deposit is paid to the host's PayPal. KopiPal keeps 20% |

Take PayPal away and there is no product. Calls use `PayPal-Request-Id` for idempotency. A live feed in the UI shows every authorization, capture and payout ID.

**AI:** Claude powers the matchmaker. It reads how you feel and what you like, picks the best open session and writes an icebreaker.

## Run it
1. Create a free account at developer.paypal.com. Go to **Apps & Credentials > Sandbox > Create App** and copy the Client ID and Secret.
2. Under **Features** on that app, make sure **Payouts** is enabled. Under **Testing tools > Sandbox accounts**, note the personal (buyer) account login and a second personal account email for receiving payouts.
3. `cp .env.example .env` and fill in the values. `DEMO_HOST_EMAIL` is the payout receiver for the two seeded sessions.
4. `npm install && npm start`, then open http://localhost:3000.

**Deploy on Render:** push to GitHub, create a Render Blueprint from this repo (`render.yaml`), and set the env vars.

## Demo flow (about 2 minutes)
1. Type a name, describe your mood, and click **Find my kaki** (AI pick and icebreaker).
2. Join a session and approve the deposit hold with the sandbox buyer login.
3. Open the host card, enter the code as a guest, and click **Check in**. Then **Settle** to see the hold released.
4. Repeat with a second guest who doesn't check in, then settle. Watch the capture and payout appear in the live feed.

## Notes
- Sandbox only. State is in memory and resets on restart.
- PayPal authorizations have a limited honor period (about 3 days), which is plenty for same-day meetups.
- Possible next steps: PayPal webhooks, real auth, Venmo and Zettle for café partners, Agent Ready for AI-initiated bookings.

MIT licensed.

## Little details
- Time-aware greeting in Singapore time, plus a live "held on PayPal right now" counter.
- Hover any drink chip for a kopi-lingo translation (Kopi Siew Dai, Kopi Kosong and more).
- Session cards show live countdowns. Tap your host code to copy it.
- Settling prints a tear-off KopiPal receipt showing what was released, captured and paid out.
- Tap the cup for Singlish one-liners. The tab title says "Your kopi is getting cold" when you switch away.
- Easter egg: try the Konami code (up, up, down, down, left, right, left, right, B, A) or just type “kopi” (outside a text box), for a kopi bean rain.
