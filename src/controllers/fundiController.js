const fundiService = require('../services/fundiService');

// A trade rarely needs more than a handful of papers; this caps abuse of the
// private documents bucket.
const MAX_CERTIFICATES = 5;

// An applicant with no papers has to say something real about how they learned
// the trade, since that is what the interview is booked from.
const MIN_REASON_LENGTH = 40;
const MAX_REASON_LENGTH = 1000;

const CATEGORIES = ['phone_electronics', 'computer_laptop', 'appliance', 'mechanical', 'general_maintenance', 'installation', 'tailoring'];

async function apply(req, res, next) {
  try {
    const {
      category, national_id, highest_qualification, years_experience,
      id_document_url, certificate_paths, no_certificate_reason, bio,
    } = req.body;

    if (!category || !national_id || !highest_qualification || !years_experience || !id_document_url) {
      return res.status(400).json({
        error: { message: 'Fill in every field and upload your ID before submitting.', code: 'invalid_request' },
      });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: { message: `category must be one of: ${CATEGORIES.join(', ')}`, code: 'invalid_request' } });
    }

    // Qualification must be shown one way or the other: certificates, or a
    // written explanation that sends the applicant to a Find Fundi interview.
    const certificates = Array.isArray(certificate_paths) ? certificate_paths.filter(Boolean) : [];
    const reason = typeof no_certificate_reason === 'string' ? no_certificate_reason.trim() : '';

    if (!certificates.length && !reason) {
      return res.status(400).json({ error: { message: 'Attach a certificate, or tell us how you learned the trade so we can arrange an interview.', code: 'invalid_request' } });
    }
    if (!certificates.length && reason.length < MIN_REASON_LENGTH) {
      return res.status(400).json({ error: { message: `Tell us a bit more about how you learned the trade, at least ${MIN_REASON_LENGTH} characters.`, code: 'invalid_request' } });
    }
    if (certificates.length > MAX_CERTIFICATES) {
      return res.status(400).json({ error: { message: `Attach at most ${MAX_CERTIFICATES} certificates.`, code: 'invalid_request' } });
    }

    // Uploads go to the applicant's own folder; don't accept someone else's
    // files, and only accept PDFs.
    const ownFolder = `${req.user.id}/`;
    const allPaths = [id_document_url, ...certificates];
    if (allPaths.some((path) => typeof path !== 'string' || !path.startsWith(ownFolder))) {
      return res.status(400).json({ error: { message: 'Upload your documents again and resubmit.', code: 'invalid_request' } });
    }
    if (allPaths.some((path) => !path.toLowerCase().endsWith('.pdf'))) {
      return res.status(400).json({ error: { message: 'Your ID and certificates must each be a PDF.', code: 'invalid_request' } });
    }

    const application = await fundiService.applyAsFundi(req.user.id, {
      category, national_id, highest_qualification, years_experience, id_document_url,
      certificate_paths: certificates,
      no_certificate_reason: certificates.length ? null : reason.slice(0, MAX_REASON_LENGTH),
      bio,
    });
    res.json({ data: application });
  } catch (err) {
    next(err);
  }
}

async function status(req, res, next) {
  try {
    const data = await fundiService.getStatus(req.accessToken, req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function search(req, res, next) {
  try {
    const { category, area } = req.query;
    const data = await fundiService.searchVerifiedFundis({ category, area });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function setAvailability(req, res, next) {
  try {
    if (typeof req.body.online !== 'boolean') {
      return res.status(400).json({ error: { message: 'online must be true or false', code: 'invalid_request' } });
    }
    const data = await fundiService.setAvailability(req.user.id, req.body.online);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function dashboard(req, res, next) {
  try {
    const data = await fundiService.getDashboard(req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { apply, status, search, setAvailability, dashboard };
