const fundiService = require('../services/fundiService');

// A trade rarely needs more than a handful of papers; this caps abuse of the
// private documents bucket.
const MAX_CERTIFICATES = 5;

// A phone photo of a paper counts the same as a PDF. Many fundis hold their
// papers only on paper, and a PDF-only form pushed them into the "no
// certificate" route even when they had one.
const DOCUMENT_TYPES = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;

// A selfie must be a photo, never a PDF.
const PHOTO_TYPES = /\.(jpe?g|png|webp|heic|heif)$/i;

// KRA PINs are a letter (A for a person, P for a company), nine digits and a
// closing letter.
const KRA_PIN = /^[AP]\d{9}[A-Z]$/;

const CATEGORIES = ['phone_electronics', 'computer_laptop', 'appliance', 'mechanical', 'general_maintenance', 'installation', 'tailoring'];

async function apply(req, res, next) {
  try {
    const {
      category, national_id, highest_qualification, years_experience,
      id_document_url, certificate_paths, no_certificate, bio, selfie_path,
    } = req.body;
    const kraPin = String(req.body.kra_pin || '').replace(/\s+/g, '').toUpperCase();

    // Highest qualification is no longer asked; older applications keep it.
    if (!category || !national_id || !years_experience || !id_document_url) {
      return res.status(400).json({
        error: { message: 'Fill in every field and upload your ID before submitting.', code: 'invalid_request' },
      });
    }
    if (!selfie_path) {
      return res.status(400).json({ error: { message: 'Take a selfie before submitting.', code: 'invalid_request' } });
    }
    if (!KRA_PIN.test(kraPin)) {
      return res.status(400).json({
        error: { message: 'Enter your KRA PIN as it appears on your certificate: a letter, nine digits and a letter, like A123456789B.', code: 'invalid_request' },
      });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: { message: `category must be one of: ${CATEGORIES.join(', ')}`, code: 'invalid_request' } });
    }

    // Qualification is shown one way or the other: certificates, or asking for
    // an interview. Nothing has to be written, so the route stays open to
    // applicants who do not read or write comfortably.
    const certificates = Array.isArray(certificate_paths) ? certificate_paths.filter(Boolean) : [];
    const wantsInterview = no_certificate === true;

    if (!certificates.length && !wantsInterview) {
      return res.status(400).json({ error: { message: 'Attach a certificate, or tick the box to say you have none.', code: 'invalid_request' } });
    }
    if (certificates.length > MAX_CERTIFICATES) {
      return res.status(400).json({ error: { message: `Attach at most ${MAX_CERTIFICATES} certificates.`, code: 'invalid_request' } });
    }

    // Uploads go to the applicant's own folder; don't accept someone else's
    // files, and only accept photos and PDFs.
    const ownFolder = `${req.user.id}/`;
    const allPaths = [id_document_url, ...certificates, selfie_path];
    if (allPaths.some((path) => typeof path !== 'string' || !path.startsWith(ownFolder))) {
      return res.status(400).json({ error: { message: 'Upload your documents again and resubmit.', code: 'invalid_request' } });
    }
    if ([id_document_url, ...certificates].some((path) => !DOCUMENT_TYPES.test(path))) {
      return res.status(400).json({ error: { message: 'Your ID and certificates must each be a photo or a PDF.', code: 'invalid_request' } });
    }
    if (!PHOTO_TYPES.test(selfie_path)) {
      return res.status(400).json({ error: { message: 'Your selfie must be a photo.', code: 'invalid_request' } });
    }

    const application = await fundiService.applyAsFundi(req.user.id, {
      category, national_id, highest_qualification: highest_qualification || null, years_experience, id_document_url,
      certificate_paths: certificates,
      kra_pin: kraPin,
      selfie_path,
      no_certificate: !certificates.length,
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

module.exports = { apply, status, setAvailability, dashboard };
