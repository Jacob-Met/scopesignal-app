import { appendRecipientFeedback, appendRecipientResponse } from '../src/recipient-feedback.mjs';
import { createClientSharePortal, clientReviewMode } from '../src/client-share.mjs';
import { hasAuthoredFindings } from '../src/review-findings.mjs';
import { handleLocalSuggestions, listLocalModels, localModelSelection, validateModelPort } from '../src/local-scope-ai-server.mjs';
import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve, extname, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { validateScopeDraft } from "../src/scope-plan.mjs";
import { validateBriefResult } from "../src/workers-ai.mjs";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 64 * 1024;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function assert(condition, status, message) {
  if (!condition) throw httpError(status, message);
}
function selectProject(workspace, id) {
  if (id === null) return null;
  if (id === undefined) return workspace.projects.findLast(project => !project.archivedAt) ?? null;
  const project = workspace.projects.find(project => project.id === id);
  assert(project, 404, "This project could not be found. Choose a project from the workspace.");
  return project;
}
function publicState(workspace, config, id) {
  const state = selectProject(workspace, id);
  const localModel = localModelSelection(workspace, config);
  return {
    version: 2,
    projectId: state?.id ?? null,
    draftId: state?.draftId ?? null,
    archivedAt: state?.archivedAt ?? null,
    project: state?.project ?? null,
    checkpoints: state?.checkpoints ?? [],
    events: state?.events ?? [],
    recipientFeedback: state?.recipientFeedback ?? [],
    clientDecisions: state?.clientDecisions ?? [],
    clientShares: (state?.clientShares ?? []).map(({id,createdAt,expiresAt,revokedAt,report})=>({id,createdAt,expiresAt,revokedAt:revokedAt??null,files:report.checkpoints.length})),
    projects: workspace.projects.map(project => ({
      id: project.id,
      label: project.project.label,
      cap: project.project.cap,
      ...(project.project.reviewOnly === true ? {reviewOnly:true} : {}),
      archivedAt: project.archivedAt ?? null,
      checkpointCount: project.checkpoints.length,
      acceptedCount: project.checkpoints.filter(cp => cp.approvedAt).length,
      capturedAmount: project.checkpoints.filter(cp => cp.status === "captured").reduce((sum, cp) => sum + cp.amount, 0),
      unresolvedCount: project.checkpoints.filter(cp => ["order_unknown", "capture_unknown"].includes(cp.status)).length,
      awaitingBuyerCount: project.checkpoints.filter(cp => cp.status === "awaiting_buyer").length,
    })),
    localModel,
    clientReview: {mode:clientReviewMode(config.clientBaseUrl)},
    configured: {
      paypal: Boolean(config.clientId && config.clientSecret),
      ai: Boolean(config.aiAccount && config.aiToken),
      localAi: Boolean(localModel.model),
    },
  };
}
function validateWorkspace(restored, status = 400) {
  assert(restored?.version === 2 && Array.isArray(restored.projects) &&
    restored.projects.every(project => project && typeof project.id === "string" &&
      project.project && Array.isArray(project.checkpoints) && Array.isArray(project.events)) &&
    new Set(restored.projects.map(project => project.id)).size === restored.projects.length,
    status, "Unsupported workspace backup. Choose a downloaded workspace records backup.");
}
function newState() {
  return { version: 2, projects: [] };
}
async function readBody(request, limit = MAX_BODY) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    assert(length <= limit, 413, "Request exceeds the permitted size.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert(
      value && typeof value === "object" && !Array.isArray(value),
      400,
      "Expected a JSON object.",
    );
    return value;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "Invalid JSON.");
  }
}
// Name the operation, never its order ID: capture failures must not look like order creation.
function paypalOperationLabel(method, path) {
  if (method === "POST" && path === "/v2/checkout/orders")
    return "PayPal order creation";
  if (method === "POST" && /^\/v2\/checkout\/orders\/[^/]+\/capture$/.test(path))
    return "PayPal order capture";
  if (method === "GET" && /^\/v2\/checkout\/orders\/[^/]+$/.test(path))
    return "PayPal order lookup";
  return "PayPal request";
}

async function remoteJSON(fetchImpl, url, init, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw httpError(
      502,
      label +
        " did not return a trustworthy response. Inspect or reconcile; do not retry a capture.",
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  assert(
    response.ok && body && typeof body === "object",
    502,
    label +
      " returned HTTP " +
      response.status +
      "; no successful outcome was assumed.",
  );
  return body;
}
function captureFromOrder(order, checkpoint) {
  if (
    !order ||
    order.id !== checkpoint.orderId ||
    !Array.isArray(order.purchase_units)
  )
    return null;
  const captures = order.purchase_units.flatMap((unit) =>
    Array.isArray(unit?.payments?.captures) ? unit.payments.captures : [],
  );
  const completed = captures.filter((c) => c && c.status === "COMPLETED");
  if (completed.length !== 1) return null;
  const capture = completed[0];
  if (
    typeof capture.id !== "string" ||
    !capture.id ||
    capture.amount?.currency_code !== "USD" ||
    capture.amount?.value !== (checkpoint.amount / 100).toFixed(2)
  )
    return null;
  return { id: capture.id, status: "COMPLETED" };
}
function validateCheckpointId(state, id) {
  const cp = state.checkpoints.find((row) => row.id === id);
  assert(cp, 404, "Unknown checkpoint.");
  return cp;
}

export function createSandboxLiveServer(options = {}) {
  const config = {
    clientBaseUrl: options.clientBaseUrl ?? process.env.SCOPESIGNAL_CLIENT_BASE_URL ?? null,
    clientId: options.clientId ?? process.env.PAYPAL_SANDBOX_CLIENT_ID ?? "",
    clientSecret:
      options.clientSecret ?? process.env.PAYPAL_SANDBOX_CLIENT_SECRET ?? "",
    aiAccount: options.aiAccount ?? process.env.CF_AI_ACCOUNT_ID ?? "",
    aiToken: options.aiToken ?? process.env.CF_AI_API_TOKEN ?? "",
    localAiModel: options.localAiModel ?? process.env.SCOPESIGNAL_OLLAMA_MODEL ?? "",
    localAiPort: options.localAiPort ?? Number(process.env.SCOPESIGNAL_OLLAMA_PORT || 11434),
  };
  const paypalBase = options.paypalBase ?? SANDBOX;
  // Production cannot switch to live PayPal by changing an environment variable.
  assert(
    paypalBase === SANDBOX || options.allowTestProvider === true,
    500,
    "Only PayPal Sandbox is supported.",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const storePath = resolve(
    options.storePath ??
      process.env.SCOPESIGNAL_STORE ??
      resolve(ROOT, ".local", "sandbox-live.json"),
  );
  const csrf = randomBytes(24).toString("hex");
  let workspace = newState();
  // Only successfully renamed records may authorize a later payment action.
  let persistedState = structuredClone(workspace);
  let chain = Promise.resolve();
  let token = null;
  let expiresAt = 0;
  function record(state, type, checkpoint, details = {}) {
    state = workspace.projects.find(project => project.id === state.id) ?? state;
    if (!Array.isArray(state.events)) state.events = [];
    state.events.push({
      seq: state.events.length + 1,
      at: new Date().toISOString(),
      type,
      checkpointId: checkpoint?.id ?? null,
      ...details,
    });
  }

  function exclusive(fn) {
    const op = chain.then(fn);
    chain = op.catch(() => {});
    return op;
  }
  async function save() {
    const tmp = storePath + "." + randomUUID() + ".tmp";
    const snapshot = structuredClone(workspace);
    try {
      await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
      // Inject a slow store in concurrency tests; production writes immediately.
      if (options.beforePersist) await options.beforePersist(snapshot);
      await writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(tmp, storePath);
      // Nothing asynchronous separates the successful rename from promotion.
      persistedState = snapshot;
    } catch (error) {
      // An HTTP 500 must not leave an unrecorded approval or capture state
      // eligible for the next operation. Earlier successful pre-effect writes
      // (order_unknown, capture_unknown) remain authoritative and fail closed.
      workspace = structuredClone(persistedState);
      await unlink(tmp).catch(() => {});
      throw error;
    }
  }
  async function load() {
    try {
      const bytes = await readFile(storePath, "utf8");
      const restored = JSON.parse(bytes);
      if (restored?.version === 1 && Array.isArray(restored.checkpoints)) {
        // Preserve a recoverable copy before the one-time atomic migration.
        await writeFile(storePath + ".v1-backup", bytes, {mode: 0o600, flag: "wx"})
          .catch(error => { if (error.code !== "EEXIST") throw error; });
        const {version, ...legacy} = restored;
        workspace = {version: 2, projects: legacy.project ? [{
          ...legacy, id: randomUUID(), archivedAt: null,
          events: Array.isArray(legacy.events) ? legacy.events : [],
        }] : []};
        await save();
      } else {
        validateWorkspace(restored, 500);
        workspace = restored;
        persistedState = structuredClone(workspace);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const ready = load();
  const portal = createClientSharePortal({
    storePath,ready,
    getWorkspace: () => persistedState,
    commit: fn => exclusive(() => fn(workspace,save,record)),
    baseUrl: () => config.clientBaseUrl ??
      'http://127.0.0.1:' + portal.clientServer.address()?.port,
  });


  async function paypal(path, method = "GET", payload, requestId) {
    assert(
      config.clientId && config.clientSecret,
      409,
      "PayPal Sandbox is not configured. No PayPal request was sent. Configure the server credentials, restart it, then refresh verified state.",
    );
    if (!token || Date.now() >= expiresAt) {
      const basic = Buffer.from(
        config.clientId + ":" + config.clientSecret,
      ).toString("base64");
      const auth = await remoteJSON(
        fetchImpl,
        paypalBase + "/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + basic,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        },
        "PayPal OAuth",
      );
      assert(
        typeof auth.access_token === "string" &&
          Number.isFinite(auth.expires_in),
        502,
        "Invalid PayPal access token response.",
      );
      token = auth.access_token;
      expiresAt = Date.now() + Math.max(0, auth.expires_in - 90) * 1000;
    }
    return remoteJSON(
      fetchImpl,
      paypalBase + path,
      {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      },
      paypalOperationLabel(method, path),
    );
  }

  async function aiSuggest(brief) {
    assert(
      config.aiAccount && config.aiToken,
      503,
      "Workers AI credentials are not configured.",
    );
    assert(
      typeof brief === "string" &&
        brief.trim().length >= 15 &&
        brief.length <= 8000,
      400,
      "Provide a meaningful brief of 15 to 8000 characters.",
    );
    const response = await remoteJSON(
      fetchImpl,
      "https://api.cloudflare.com/client/v4/accounts/" +
        encodeURIComponent(config.aiAccount) +
        "/ai/run/" +
        AI_MODEL,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.aiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You design verifiable creative project acceptance criteria. Return ONLY a JSON object with checkpoints, each containing title and evidence. Suggest 2 to 5 actionable milestones, explicit evidence a human can inspect. Never approve payment or claim work occurred.",
            },
            { role: "user", content: brief },
          ],
        }),
      },
      "Workers AI",
    );
    const content = response?.result?.response ?? response?.response;
    assert(
      typeof content === "string",
      502,
      "Workers AI provided no inspectable JSON suggestions.",
    );
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw httpError(502, "Workers AI returned malformed JSON suggestions.");
    }
    const result = validateBriefResult(parsed);
    assert(
      result.checkpoints.length >= 1 && result.checkpoints.length <= 12,
      502,
      "Workers AI suggested an unsupported number of checkpoints.",
    );
    return result;
  }

  async function act(path, input, base) {
    if (path === "/api/suggest")
      return { suggestions: await aiSuggest(input.brief) };
    if (path === "/api/setup") {
      // Existing single-project clients cannot accidentally create another scope.
      // Updated clients persist one draft ID before sending the first lock request.
      assert(input.draftId === undefined || (typeof input.draftId === "string" &&
        /^[a-zA-Z0-9-]{16,80}$/.test(input.draftId)), 400, "Invalid draft identity.");
      assert(input.draftId || workspace.projects.length === 0, 409,
        "A scope is already active. Start a new project explicitly; existing payment history must not be overwritten.");
      const validated = validateScopeDraft(input.draft, {allowReviewOnly:true});
      assert(
        validated.ok,
        400,
        validated.errors.map((e) => e.message).join(" "),
      );
      const seed = validated.seed;
      const digest = createHash("sha256").update(JSON.stringify(seed)).digest("hex");
      const existing = input.draftId && workspace.projects.find(project => project.draftId === input.draftId);
      if (existing) {
        assert(existing.draftDigest === digest, 409,
          "This draft was already locked with different terms. Open its recorded project before starting another.");
        return {state: publicState(workspace, config, existing.id)};
      }
      const state = {id: randomUUID(), archivedAt: null, events: [],
        draftId: input.draftId ?? null, draftDigest: digest};
      state.project = {
        ...(seed.reviewOnly === true ? {reviewOnly:true} : {}),
        label: seed.label,
        brief: seed.brief,
        cap: seed.amount,
        currency: "USD",
      };
      state.checkpoints = seed.checkpoints.map((cp) => ({
        id: cp.id,
        title: cp.title,
        amount: cp.amount,
        proposedEvidence: cp.evidence,
        acceptedEvidence: null,
        approvedAt: null,
        status: "unapproved",
        orderId: null,
        approvalUrl: null,
        orderRequestId: null,
        captureRequestId: null,
        captureId: null,
      }));
      workspace.projects.push(state);
      record(state, "scope.locked", null, {
        checkpointCount: state.checkpoints.length,
        cap: seed.amount,
      });
      await save();
      return { state: publicState(workspace, config, state.id) };
    }
    assert(input.projectId !== undefined || workspace.projects.length <= 1, 409,
      "Choose the project explicitly before changing its review or payment history.");
    const state = selectProject(workspace, input.projectId);
    assert(state, 404, "No locked project was selected.");
    assert(!state.project.reviewOnly || !["/api/order","/api/buyer-status","/api/capture","/api/reconcile"].includes(path),
      409, "This is a review-only project. No payment is tracked or requested.");
    if (path === "/api/projects/archive" || path === "/api/projects/reopen") {
      if (path.endsWith("/archive")) {
        assert(input.confirm === true, 400, "Confirm archiving this project. Its payment outcomes and history remain unchanged.");
        if (!state.archivedAt) {
          state.archivedAt = new Date().toISOString();
          record(state, "scope.archived", null);
          await save();
        }
      } else if (state.archivedAt) {
        state.archivedAt = null;
        record(state, "scope.reopened", null);
        await save();
      }
      return {state: publicState(workspace, config, state.id)};
    }
    assert(!state.archivedAt || ["/api/reconcile", "/api/buyer-status", "/api/client-share/revoke"].includes(path), 409,
      "This project is archived. Reopen it before making a new decision or payment request. Existing orders can still be reconciled.");
    if (path === "/api/client-share/revoke") {
      assert(input.confirm===true&&typeof input.shareId==="string",400,"Confirm the review link to revoke.");
      const share=(state.clientShares??[]).find(s=>s.id===input.shareId);
      assert(share,404,"This client invitation is not in the selected project.");
      if(!share.revokedAt){share.revokedAt=new Date().toISOString();record(state,"client.share_revoked",null);await save();}
      return {state:publicState(workspace,config,state.id),guidance:"Client invitation revoked."};
    }
    if (path === "/api/client-share") {
      const shared = await portal.create(state,input,save);
      record(state,"client.share_created",null);
      await save();
      return {state:publicState(workspace,config,state.id),shareUrl:shared.shareUrl,expiresAt:shared.expiresAt};
    }
    if (path === "/api/recipient-response") {
      assert(input.confirm === true, 400, "Confirm recording this response to the client comment.");
      let next;
      try { next = appendRecipientResponse(state, input.response); }
      catch (error) { throw httpError(400, error.message); }
      if (next !== state.recipientFeedback) {
        state.recipientFeedback = next;
        record(state, "client.response_recorded", null);
        await save();
      }
      return {state: publicState(workspace, config, state.id),
        guidance: "Response recorded. It will appear with the client comment in the next delivery."};
    }
    if (path === "/api/recipient-feedback") {
      assert(input.confirm === true, 400, "Review the client comments and confirm saving them.");
      let next;
      try { next = appendRecipientFeedback(state, input.feedback); }
      catch (error) { throw httpError(400, error.message); }
      const added = next.length - (state.recipientFeedback ?? []).length;
      if (added) {
        state.recipientFeedback = next;
        record(state, "client.feedback_saved", null);
        await save();
      }
      return {state: publicState(workspace, config, state.id),
        guidance: added ? added + " client comment(s) saved. Work acceptance and payment are unchanged." : "These client comments were already saved."};
    }
    const cp = validateCheckpointId(state, input.checkpointId);
    if (path === "/api/request-changes") {
      assert(["unapproved", "changes_requested"].includes(cp.status), 409,
        "Only work awaiting acceptance can receive a revision request.");
      assert(input.reviewRevision === (cp.reviewHistory ?? []).length, 409,
        "The review changed. Refresh verified state and inspect its latest decision.");
      assert(typeof input.evidence === "string" && input.evidence.trim().length > 0 &&
        input.evidence.length <= 5000, 400, "Describe the submitted work you inspected.");
      assert(typeof input.changes === "string" && input.changes.trim().length > 0 &&
        input.changes.length <= 5000, 400, "Describe the changes needed before acceptance.");
      assert(hasAuthoredFindings(input.evidence), 400, "Add what you inspected and found. A file reference alone is not a review.");
      const review = {at: new Date().toISOString(), evidence: input.evidence.trim(), changes: input.changes.trim()};
      cp.reviewHistory = [...(cp.reviewHistory ?? []), review];
      cp.status = "changes_requested";
      record(state, "checkpoint.changes_requested", cp, {reviewRevision: cp.reviewHistory.length});
      await save();
      return {state: publicState(workspace, config, state.id),
        guidance: "Changes needed recorded locally. No message was sent and no payment was authorized."};
    }
    if (path === "/api/approve") {
      assert(
        ["unapproved", "changes_requested"].includes(cp.status),
        409,
        "This checkpoint has already progressed.",
      );
      assert(
        typeof input.evidence === "string" &&
          input.evidence.trim().length > 0 &&
          input.evidence.length <= 5000,
        400,
        "Explicit accepted evidence is required.",
      );
      assert(!(cp.reviewHistory?.length) || input.reviewRevision === cp.reviewHistory.length, 409,
        "The review changed. Refresh verified state and inspect its latest decision.");
      assert(hasAuthoredFindings(input.evidence), 400, "Add what you inspected and found. A file reference alone is not a review.");
      cp.acceptedEvidence = input.evidence.trim();
      cp.approvedAt = new Date().toISOString();
      cp.status = "approved";
      record(state, "checkpoint.approved", cp, { amount: cp.amount });
      await save();
    } else if (path === "/api/order") {
      assert(
        cp.status === "approved",
        409,
        "Human approval is required, and each checkpoint may have only one order.",
      );
      assert(
        config.clientId && config.clientSecret,
        409,
        "PayPal Sandbox is not configured. No PayPal request was sent. Configure the server credentials, restart it, then refresh verified state.",
      );
      cp.status = "order_unknown";
      cp.orderRequestId = randomUUID();
      record(state, "paypal.order.requested", cp, { amount: cp.amount });
      await save(); // Persist the possibility of an external effect BEFORE the request.
      try {
        const order = await paypal(
          "/v2/checkout/orders",
          "POST",
          {
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: state.id + ":" + cp.id,
                custom_id: state.id + ":" + cp.id,
                description: cp.title,
                amount: {
                  currency_code: "USD",
                  value: (cp.amount / 100).toFixed(2),
                },
              },
            ],
            payment_source: {
              paypal: {
                experience_context: {
                  brand_name: "ScopeSignal Sandbox",
                  landing_page: "GUEST_CHECKOUT",
                  shipping_preference: "NO_SHIPPING",
                  user_action: "PAY_NOW",
                  return_url: base + "/live.html?project=" + encodeURIComponent(state.id) +
                    "&checkpoint=" + encodeURIComponent(cp.id) + "&buyer_return=1",
                  cancel_url: base + "/live.html?project=" + encodeURIComponent(state.id) +
                    "&checkpoint=" + encodeURIComponent(cp.id) + "&buyer_cancel=1",
                },
              },
            },
          },
          cp.orderRequestId,
        );
        assert(
          typeof order.id === "string" &&
            order.id,
          502,
          "PayPal order response was incomplete.",
        );
        // Keep the known external identity even when buyer navigation is malformed.
        // Reconciliation must still be able to inspect this order after restart.
        cp.orderId = order.id;
        await save();
        assert(Array.isArray(order.links), 502, "PayPal supplied no trusted Sandbox approval link.");
        const approval = order.links.find(
          (link) => link.rel === "approve" || link.rel === "payer-action",
        );
        assert(
          approval &&
            typeof approval.href === "string" &&
            approval.href.startsWith("https://www.sandbox.paypal.com/"),
          502,
          "PayPal supplied no trusted Sandbox approval link.",
        );
        cp.approvalUrl = approval.href;
        cp.status = "awaiting_buyer";
        record(state, "paypal.order.created", cp, { orderId: cp.orderId });
        await save();
      } catch (error) {
        record(state, "paypal.order.response_unknown", cp);
        await save();
        // Unknown response is never treated as permission to create a second order.
        throw error;
      }
    } else if (path === "/api/buyer-status") {
      assert(
        cp.status === "awaiting_buyer",
        409,
        "Only an outstanding Sandbox order can be checked for buyer approval.",
      );
      // This is strictly a provider GET. No capture request, local mutation,
      // audit event, or durable write is performed when checking buyer status.
      const observed = await paypal(
        "/v2/checkout/orders/" + encodeURIComponent(cp.orderId),
      );
      assert(
        observed.id === cp.orderId,
        502,
        "PayPal returned a different order identity. No capture was attempted.",
      );
      assert(
        Array.isArray(observed.purchase_units) &&
          observed.purchase_units.length === 1 &&
          observed.purchase_units[0]?.amount?.currency_code === "USD" &&
          observed.purchase_units[0].amount.value ===
            (cp.amount / 100).toFixed(2),
        409,
        "The PayPal order does not match the checkpoint amount. No capture was attempted.",
      );
      const approved = observed.status === "APPROVED";
      return {
        state: publicState(workspace, config, state.id),
        buyerApproval: { checkpointId: cp.id, approved },
        guidance: approved
          ? "PayPal reports buyer approval for this order and exact amount. A separate capture confirmation is required."
          : "PayPal has not reported buyer approval. No capture was attempted; approve as a Sandbox buyer and check again.",
      };
    } else if (path === "/api/capture") {
      assert(
        cp.status === "awaiting_buyer",
        409,
        "A buyer-approved sandbox order is required before capture.",
      );
      assert(
        input.confirm === true,
        400,
        "Explicit one-attempt Sandbox capture confirmation is required.",
      );
      const observed = await paypal(
        "/v2/checkout/orders/" + encodeURIComponent(cp.orderId),
      );
      assert(
        observed.id === cp.orderId && observed.status === "APPROVED",
        409,
        "PayPal has not confirmed buyer approval. Open the buyer approval link first.",
      );
      assert(
        Array.isArray(observed.purchase_units) &&
          observed.purchase_units.length === 1 &&
          observed.purchase_units[0]?.amount?.currency_code === "USD" &&
          observed.purchase_units[0].amount.value ===
            (cp.amount / 100).toFixed(2),
        409,
        "Sandbox order amount does not match the approved checkpoint.",
      );
      cp.status = "capture_unknown";
      cp.captureRequestId = randomUUID();
      record(state, "paypal.capture.requested", cp, { orderId: cp.orderId });
      await save(); // Never repeat a capture after a crash, timeout or lost response.
      try {
        const result = await paypal(
          "/v2/checkout/orders/" + encodeURIComponent(cp.orderId) + "/capture",
          "POST",
          {},
          cp.captureRequestId,
        );
        const capture = captureFromOrder(result, cp);
        if (capture) {
          cp.captureId = capture.id;
          cp.status = "captured";
          record(state, "paypal.capture.completed", cp, {
            captureId: capture.id,
            amount: cp.amount,
          });
          await save();
        } else
          throw httpError(
            502,
            "Capture response was not a matching completed capture. Reconcile before further action.",
          );
      } catch (error) {
        record(state, "paypal.capture.response_unknown", cp);
        await save();
        throw error;
      }
    } else if (path === "/api/reconcile") {
      assert(
        ["capture_unknown", "awaiting_buyer", "order_unknown"].includes(
          cp.status,
        ),
        409,
        "No uncertain transaction is eligible for reconciliation.",
      );
      assert(
        cp.orderId,
        409,
        "No PayPal order ID was recorded. Do not create a replacement order without manual investigation.",
      );
      const observed = await paypal(
        "/v2/checkout/orders/" + encodeURIComponent(cp.orderId),
      );
      const approval = Array.isArray(observed.links) && observed.links.find(link =>
        (link?.rel === "approve" || link?.rel === "payer-action") &&
        typeof link.href === "string" &&
        link.href.startsWith("https://www.sandbox.paypal.com/"));
      if (cp.status === "order_unknown" && observed.id === cp.orderId &&
          ["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(observed.status) &&
          observed.purchase_units?.length === 1 &&
          observed.purchase_units[0].amount?.currency_code === "USD" &&
          observed.purchase_units[0].amount.value === (cp.amount / 100).toFixed(2) &&
          (approval || observed.status === "APPROVED")) {
        cp.approvalUrl = approval ? approval.href : null;
        cp.status = "awaiting_buyer";
        record(state, "paypal.order.reconciled", cp, { orderId: cp.orderId });
        await save();
        return {
          state: publicState(workspace, config, state.id),
          ...(observed.status === "APPROVED"
            ? { buyerApproval: { checkpointId: cp.id, approved: true } } : {}),
        };
      }
      const capture = captureFromOrder(observed, cp);
      if (capture) {
        cp.captureId = capture.id;
        cp.status = "captured";
        record(state, "paypal.capture.reconciled", cp, {
          captureId: capture.id,
          amount: cp.amount,
        });
        await save();
      } else {
        return {
          state: publicState(workspace, config, state.id),
          guidance:
            "No matching completed capture found. Outcome remains uncertain; do not repeat capture.",
        };
      }
    } else throw httpError(404, "Unknown action.");
    return { state: publicState(workspace, config, state.id) };
  }

  const server = createServer(async (req, res) => {
    const sendJSON = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    try {
      await ready;
      assert(
        req.headers.host === "127.0.0.1:" + server.address()?.port ||
          req.headers.host === "localhost:" + server.address()?.port,
        403,
        "Only local requests are accepted.",
      );
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/api/local-suggestions") {
        return await handleLocalSuggestions(req, res, {
          ...localModelSelection(persistedState, config),
          fetchImpl: options.localAiFetchImpl ?? fetch,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        // A concurrent approval/capture may still be writing to disk. Never
        // render or export that tentative state as a completed decision.
        const requested = url.searchParams.get("project");
        let id = requested === "new" ? null : requested ?? undefined;
        if (requested === "new" && url.searchParams.has("draft")) {
          id = persistedState.projects.find(project =>
            project.draftId === url.searchParams.get("draft"))?.id ?? null;
        }
        return sendJSON(200, {
          token: csrf,
          state: publicState(persistedState, config, id),
        });
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        assert(
          req.headers["x-scopesignal-token"] === csrf,
          403,
          "Missing session protection token.",
        );
        assert(
          (req.headers.origin ?? "") ===
            "http://127.0.0.1:" + server.address().port ||
            req.headers.origin === "http://localhost:" + server.address().port,
          403,
          "Request origin is not this local ScopeSignal server.",
        );
        const input = await readBody(req, url.pathname === "/api/client-share" ? 30 * 1024 * 1024 : url.pathname === "/api/recipient-feedback" ? 512 * 1024 : MAX_BODY);
        if (url.pathname === "/api/local-models" || url.pathname === "/api/local-model") {
          const selecting = url.pathname === "/api/local-model";
          assert(Object.keys(input).every(key => (selecting ? ['model', 'port'] : ['port']).includes(key)), 400, 'Only a local model and server port are accepted.');
          const port = validateModelPort(input.port);
          const model = input.model;
          if (selecting) assert(typeof model === 'string' && (model === '' || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model)), 400, 'Choose an installed model.');
          const models = selecting && model === '' ? [] : await listLocalModels({ port, fetchImpl: options.localAiFetchImpl ?? fetch });
          if (!selecting) return sendJSON(200, { models });
          assert(model === '' || models.includes(model), 409, 'That model is no longer available. Refresh the model list and choose again.');
          const outcome = await exclusive(async () => {
            workspace.localModel = { model, port };
            await save();
            const current = publicState(persistedState, config, null);
            return { localModel: current.localModel, configured: current.configured };
          });
          return sendJSON(200, outcome);

        }
        if (url.pathname === "/api/workspace-restore") {
          validateWorkspace(input.workspace);
          assert(input.workspace.projects.length > 0, 400, "This backup has no saved projects.");
          const outcome = await exclusive(async () => {
            assert(workspace.projects.length === 0, 409, "This workspace already has projects. Open the backup in an empty Studio workspace.");
            // Import canonical records, never preferences or credentials from another computer.
            workspace.projects = structuredClone(input.workspace.projects);
            await save();
            return { projectId: workspace.projects.findLast(project => !project.archivedAt)?.id ?? workspace.projects[0].id,
              projects: workspace.projects.length };
          });
          return sendJSON(200, outcome);
        }
        if (url.pathname === "/api/workspace-backup") {
          // Export committed project records without this machine's model choice.
          const backup = structuredClone(persistedState);
          delete backup.localModel;
          return sendJSON(200, {workspace: backup});

        }
        const outcome = await exclusive(() =>
          act(url.pathname, input, "http://127.0.0.1:" + server.address().port),
        );
        return sendJSON(200, outcome);
      }
      if (req.method === "GET") {
        const pathname = url.pathname === "/" ? "/live.html" : url.pathname;
        assert(/^\/[a-zA-Z0-9._\/-]+$/.test(pathname), 404, "Not found.");
        const file = resolve(ROOT, "." + pathname);
        assert(
          file.startsWith(ROOT + sep) &&
            ([".html", ".mjs", ".js", ".css", ".md"].includes(extname(file)) ||
              ["/media/Archivo.ttf", "/media/Archivo-OFL.txt", "/media/archivo-source.txt"].includes(pathname)),
          404,
          "Not found.",
        );
        const bytes = await readFile(file);
        const type = extname(file) === ".ttf" ? "font/ttf" :
          extname(file) === ".md" || extname(file) === ".txt" ? "text/plain; charset=utf-8" :
          extname(file) === ".html" ? "text/html; charset=utf-8" :
          extname(file) === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; frame-src blob:; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(bytes);
      }
      throw httpError(405, "Method not permitted.");
    } catch (error) {
      sendJSON(error.status ?? 500, {
        error: error.status
          ? error.message
          : "Internal operation failed; consult server logs without exposing credentials.",
      });
    }
  });
  return { server, clientServer: portal.clientServer, ready, getState: () => structuredClone(publicState(workspace, config)) };
}

export function listenClientReview(app,operatorPort) {
  const clientPort=Number(process.env.SCOPESIGNAL_CLIENT_PORT||4274);
  assert(Number.isInteger(clientPort)&&clientPort>=1024&&clientPort<=65535&&clientPort!==operatorPort,500,"Invalid client review port.");
  const clientHost=process.env.SCOPESIGNAL_CLIENT_HOST||"127.0.0.1";
  if(!["127.0.0.1","localhost","::1"].includes(clientHost))
    assert(/^https:\/\//.test(process.env.SCOPESIGNAL_CLIENT_BASE_URL||""),500,
      "Remote client review needs a configured HTTPS public base URL and TLS reverse proxy.");
  app.clientServer.listen(clientPort,clientHost,()=>console.log("ScopeSignal client review listener ready."));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const port = Number(process.env.PORT || 4273);
  assert(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    500,
    "Invalid local port.",
  );
  const app = createSandboxLiveServer();
  await app.ready;
  app.server.listen(port, "127.0.0.1", () =>
    console.log(
      "ScopeSignal Sandbox live review at http://127.0.0.1:" +
        port +
        "/live.html",
    ),
  );
  listenClientReview(app,port);

}
