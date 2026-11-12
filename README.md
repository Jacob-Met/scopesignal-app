# ScopeSignal

Agree what "done" means before any money moves, then pay for exactly that.

ScopeSignal is a local workspace for freelancers and small studios who are paid by milestone. A brief becomes a short list of priced deliverables, each with a clear finish line. When work arrives it is reviewed beside what was agreed. Only an accepted delivery can be paid, and each payment is one PayPal order for one milestone.

## Try the simulated demo

No PayPal account and no local AI model are needed.

```sh
npm run demo        # or: node scripts/sandbox-live.mjs --demo
# open http://127.0.0.1:4273/live.html
```

1. The project name, the sample brief and the budget are already filled in. Choose **Suggest milestones** and wait a moment for the canned suggestions.
2. Add each suggestion with **Add deliverable**, give the three milestones prices (800, 900 and 700 USD), then **Start review**.
3. Attach any small file as the delivered file, write what you checked, and choose **Accept delivery**.
4. Choose **Create payment**, then **Open PayPal approval**. On the page that says "Simulated PayPal approval", press **Approve**.
5. Back in ScopeSignal, choose **Confirm** and then **Capture**. The milestone shows as paid.

A yellow badge reads "Simulated demo: no real PayPal call". PayPal (OAuth, create order, read order, capture) and the AI suggestion are answered by small in-process fakes in `demo-mode.mjs`, and the demo workspace is stored in a temporary folder. The real PayPal Sandbox and Ollama setup is described below.

## Scope watch: what the client actually said

Open `/drift.html` (or the **Scope watch** link in the header). Each project shows a mark, **Drifting** or **On scope**. Inside a project, paste the chat or email thread, or add a recording of the client call (transcribed by a local speech-to-text service, `SCOPESIGNAL_LISTEN_URL`, default `http://127.0.0.1:5621/listen`). The conversation is shown as a timeline and the exact sentences that ask for something outside the agreed scope are highlighted. Each one is a card: swipe or tap **In scope** or **Change order**. The local model drafts a price and a "Ready when" line, and you can change either by typing or saying a correction ("make it $350", "ready when the PDF is print-ready"). Accepted change orders roll into one PayPal request through the existing order path.

Try it in the simulated demo: on the Scope watch page choose **Add the sample bakery project**, open it, **Use sample thread**, **Find the asks**, decide the cards, then **Create PayPal request**. Without a model the asks are found by plain rules and labelled that way.

## How it uses AI

A local language model reads the client's brief and proposes deliverables. Every suggestion carries the client's own sentences beside it, so you can see where it came from. The model only suggests: a person adds, renames, prices and locks the scope, and a person accepts each delivery. The model never approves work and never triggers a payment.

Any Ollama model works; it was built and tested with `qwen2.5:7b`.

## How it uses PayPal

Payments run on the PayPal REST API in **Sandbox**:

- OAuth client credentials, kept on the server only
- Orders v2: create an order for one accepted milestone, send the buyer to PayPal to approve, then capture
- Capture is a separate, explicit confirmation in the app
- If a capture response is lost, the result is treated as unknown and reconciled against the same order; a second capture is never sent blindly

The PayPal endpoint is fixed to Sandbox in code.

## Run it

Requires Node.js 24 or newer. There are no npm dependencies.

Explore the offline example (no accounts needed):

```sh
node scripts/serve.mjs
# open http://127.0.0.1:4173
```

Run the full workspace with PayPal Sandbox and a local model:

```sh
ollama pull qwen2.5:7b

export PAYPAL_SANDBOX_CLIENT_ID="your sandbox client id"
export PAYPAL_SANDBOX_CLIENT_SECRET="your sandbox client secret"
export SCOPESIGNAL_OLLAMA_MODEL="qwen2.5:7b"
export SCOPESIGNAL_STORE="$HOME/.scopesignal"

node scripts/sandbox-live.mjs
# open http://127.0.0.1:4273/live.html
```

Create Sandbox credentials at <https://developer.paypal.com/dashboard/applications/sandbox>. Pay as the buyer with a Sandbox personal account or PayPal's Sandbox test cards.

## A two-minute walkthrough

1. Start a new project, paste a brief and a budget, and choose **Suggest milestones**.
2. Add the suggestions you want, fix their names, set prices, then **Start review**.
3. Attach the delivered file, write what you checked, and **Accept delivery**.
4. **Create payment**, open the PayPal approval page and pay as the Sandbox buyer.
5. Back in ScopeSignal, confirm and **Capture**. The milestone shows as paid.

## Tests

```sh
node --test
```

## License

MIT. The Archivo typeface in `media/` is under the SIL Open Font License.

## Light and dark mode

The interface follows the system colour scheme, and the round button in the bottom-right corner switches between light and dark. The second colour sheet is generated from the first with `tools/retheme.py`, so the two always share the same layout.
