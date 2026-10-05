// Why a fundi could not take a job they had accepted. Kept as a short list so
// the reasons can be counted later: free text alone tells you nothing about
// which problems keep coming up.
//
// A fundi can only turn a job down before the customer accepts a price. After
// that the job is agreed work, and backing out is a cancellation, not a pass.
const RELEASE_REASONS = [
  { key: 'too_far', label: 'The job is too far from me' },
  { key: 'already_booked', label: "I'm already booked" },
  { key: 'no_tools', label: "I don't have the right tools for this" },
  { key: 'no_parts', label: "I can't get the parts or materials" },
  { key: 'wrong_work', label: "This isn't the kind of work I do" },
  { key: 'bigger_than_described', label: 'The job is bigger than described' },
  { key: 'no_answer', label: "The customer isn't answering" },
  { key: 'no_price_agreement', label: "We couldn't agree on a price" },
  { key: 'emergency', label: 'Something came up' },
  { key: 'other', label: 'Other' },
];

const RELEASE_REASON_KEYS = RELEASE_REASONS.map((r) => r.key);

module.exports = { RELEASE_REASONS, RELEASE_REASON_KEYS };
