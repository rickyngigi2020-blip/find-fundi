// An error whose message is safe to show the client, with its HTTP status.
function apiError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.publicMessage = message;
  err.code = code;
  return err;
}

module.exports = { apiError };
