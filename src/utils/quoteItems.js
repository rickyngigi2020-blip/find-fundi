const crypto = require('crypto');
const { apiError } = require('./apiError');

// The lines of a quotation. The fundi lists each charge on its own line, so the
// customer sees what they are paying for and anything added later stands apart
// from what they agreed. A listed service is a line too, but only the server
// writes it (withService), from the menu, so its price can't be changed.

const KINDS = [
  { key: 'labour', label: 'Labour' },
  { key: 'parts', label: 'Parts' },
  { key: 'transport', label: 'Transport' },
  { key: 'other', label: 'Other' },
];
const KIND_KEYS = KINDS.map((k) => k.key);
const UNITS = ['pcs', 'm', 'kg', 'litres', 'hrs'];
const MAX_LINES = 20;
const MAX_TOTAL = 10000000;
const ID_PATTERN = /^[a-z0-9]{1,24}$/;

function bad(message) {
  return apiError(400, message, 'invalid_request');
}

function newId() {
  return crypto.randomBytes(5).toString('hex');
}

// Returns the lines the fundi sent, cleaned, or throws a message they can act on.
function cleanItems(raw, { allowEmpty = false } = {}) {
  if (!Array.isArray(raw)) throw bad('Add the lines of your quotation.');
  if (raw.length > MAX_LINES) throw bad(`A quotation can have up to ${MAX_LINES} lines.`);
  if (!raw.length && !allowEmpty) throw bad('Add at least one line to your quotation.');

  const seen = new Set();
  return raw.map((line, i) => {
    const n = i + 1;
    if (!line || typeof line !== 'object') throw bad(`Line ${n} is not filled in.`);
    if (line.kind === 'service') throw bad('The listed service is added from the menu. Pick it from "What is the job?".');
    if (!KIND_KEYS.includes(line.kind)) throw bad(`Choose what line ${n} is for: labour, parts, transport or other.`);

    const description = typeof line.description === 'string' ? line.description.trim().replace(/\s+/g, ' ') : '';
    if (description.length < 2 || description.length > 120) throw bad(`Say what line ${n} is for (2 to 120 characters).`);

    const amount = Number(line.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TOTAL) throw bad(`Enter the amount for line ${n} in whole shillings.`);

    let qty = null;
    let unit = null;
    if (line.qty !== undefined && line.qty !== null && line.qty !== '') {
      qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw bad(`The quantity on line ${n} must be a whole number from 1 to 9999.`);
      unit = UNITS.includes(line.unit) ? line.unit : 'pcs';
    }

    let id = typeof line.id === 'string' && ID_PATTERN.test(line.id) && line.id !== 'service' ? line.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);

    return { id, kind: line.kind, description, qty, unit, amount };
  });
}

// The listed service goes first, at its menu price, and can't be edited.
function withService(items, rate) {
  return [{ id: 'service', kind: 'service', description: rate.name, qty: null, unit: null, amount: rate.price_kes, locked: true }, ...items];
}

function totalOf(items) {
  const total = items.reduce((sum, line) => sum + line.amount, 0);
  if (total > MAX_TOTAL) throw bad('That total is too large. Check the amounts.');
  return total;
}

module.exports = { KINDS, UNITS, cleanItems, withService, totalOf };
