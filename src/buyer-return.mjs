// A return URL locates an existing payment. Only the provider read establishes approval.
const single = (params, key) => {
  const values = params.getAll(key);
  return values.length === 1 && values[0] ? values[0] : null;
};
export function clearBuyerReturnUrl(href) {
  const url = new URL(href);
  for (const key of ['buyer_return', 'buyer_cancel', 'checkpoint', 'token', 'PayerID'])
    url.searchParams.delete(key);
  return url.href;
}
export function resolveBuyerReturn(href, state) {
  const params = new URL(href).searchParams;
  if (!params.has('buyer_return') && !params.has('buyer_cancel')) return null;
  const invalid = {kind:'invalid', message:'This PayPal return does not match a saved payment. Open the project and choose its payment.'};
  const approving = single(params, 'buyer_return') === '1' && !params.has('buyer_cancel');
  const cancelled = single(params, 'buyer_cancel') === '1' && !params.has('buyer_return');
  if (!approving && !cancelled) return invalid;
  const projectId = single(params, 'project');
  if (!projectId || projectId !== state?.projectId || !state.project ||
      !Array.isArray(state.checkpoints)) return invalid;
  const orderId = single(params, 'token');
  const checkpointId = single(params, 'checkpoint');
  if ((params.has('token') && !orderId) ||
      (params.has('checkpoint') && !checkpointId)) return invalid;
  // Some cancellation returns omit the token. Our own callback identifies the
  // checkpoint; cancellation only changes navigation and never queries or writes payment state.
  if (!orderId && (!cancelled || !checkpointId)) return invalid;
  const matches = state.checkpoints.filter(cp => cp.orderId &&
    (!orderId || cp.orderId === orderId) && (!checkpointId || cp.id === checkpointId));
  if (matches.length !== 1) return invalid;
  return {kind:cancelled?'cancel':'approval', projectId, checkpointId:matches[0].id,
    orderId:matches[0].orderId};
}
