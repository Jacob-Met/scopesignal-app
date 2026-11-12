# ScopeSignal

Agree what "done" means before any money moves, then pay for exactly that.

ScopeSignal is a local workspace for freelancers and small studios who are paid by milestone. A brief becomes a short list of priced deliverables, each with a clear finish line. When work arrives it is reviewed beside what was agreed. Only an accepted delivery can be paid, and each payment is one PayPal order for one milestone.

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
