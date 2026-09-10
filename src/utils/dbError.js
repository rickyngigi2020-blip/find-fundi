// Translates a raw Supabase/Postgres error into a safe API error — never
// forward the raw error object to a client, per the backend-design skill.
function toApiError(error) {
  const err = new Error(error.message);
  if (error.code === '23505') {
    err.status = 409;
    err.publicMessage = 'That record already exists.';
  } else if (error.code === '42501') {
    err.status = 403;
    err.publicMessage = 'You are not allowed to do that.';
  } else if (error.code === 'PGRST116') {
    err.status = 404;
    err.publicMessage = 'Not found.';
  } else {
    err.status = 400;
    err.publicMessage = error.message;
  }
  return err;
}

module.exports = { toApiError };
